// The no-leak oracle of the API tests (spec BR-801, VC-831; plan P-12). It checks one response body
// against the server's current state, read directly from the store.
import { expect } from 'vitest';
import type { Card } from '@/src/domain/cards';
import { buildDeck } from '@/src/domain/decks';
import type { GameEvent, PlayerUpdate } from '@/src/domain/types';
import { GameStateManager } from '@/src/state/game-state-manager';
import type { ObjectStore } from '@/src/storage/object-store';

/** What `assertNoLeak` compares a body with. */
export interface LeakContext {
  /** The store the service writes to (the oracle reads it through a `GameStateManager`). */
  store: ObjectStore;
  gameId: string;
  /** The responding seat. */
  seat: number;
  /** The seat token issued for `seat`. */
  seatToken: string;
  /** `true` only for the 201 body of `POST /api/games`. */
  allowToken: boolean;
}

/** What one checked body was, so a test can count the cases it covered. */
export interface LeakCheckResult {
  /** `none`: the body carries no update (e.g. a 422). */
  kind: 'none' | 'in-progress' | 'game-over';
  /** The update's hand keeps its trump card in the stock (not a full deal). */
  stockTrump: boolean;
  /** The update's hand dealt the whole deck (`trumpCardInDealerHand`). */
  fullDeal: boolean;
}

/** Keys that must not appear at any depth of any body. */
const FORBIDDEN_KEYS = ['seed', 'seatTokenHashes', 'aiDecisionCount'] as const;

/** The exact top-level keys of a `PlayerUpdate`. */
const UPDATE_KEYS = ['events', 'legalMoves', 'version', 'view'];

/** View keys the stock/other-hands walk skips: cards there are public (BR-801). */
const PUBLIC_VIEW_KEYS = new Set(['currentTrick', 'lastTrick', 'trumpCard']);

/** Per event type, the one key that may hold a card object. */
const EVENT_CARD_KEYS: Readonly<Record<string, string>> = {
  'card-played': 'card',
  'hand-dealt': 'trumpCard',
};

type Json = unknown;

function isPlainObject(value: Json): value is Record<string, Json> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** A plain object whose own keys are exactly `suit` and `rank`, both strings. */
export function isCardObject(value: Json): value is Card {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 2 &&
    keys[0] === 'rank' &&
    keys[1] === 'suit' &&
    typeof value.suit === 'string' &&
    typeof value.rank === 'string'
  );
}

const cardKey = (card: Card): string => `${card.suit}|${card.rank}`;

/** Calls `visit(value, path)` on `value` and every nested value, depth first. */
function walk(value: Json, path: string, visit: (value: Json, path: string) => void): void {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, visit));
  } else if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`, visit);
  }
}

/** Every path holding a card object inside `value`. */
function cardPaths(value: Json, path: string): string[] {
  const found: string[] = [];
  walk(value, path, (v, p) => {
    if (isCardObject(v)) found.push(p);
  });
  return found;
}

/**
 * Per store and game, the events of each commit already read. Commits are written create-only and
 * never change, so each one is loaded (and schema-checked) once per test run (D-016).
 */
const eventCache = new WeakMap<ObjectStore, Map<string, GameEvent[][]>>();

/** The events of commits `0…tip`, in order, each commit read once with `GameStateManager.load`. */
async function eventsUpTo(
  manager: GameStateManager,
  store: ObjectStore,
  gameId: string,
  tip: number,
): Promise<GameEvent[]> {
  let games = eventCache.get(store);
  if (games === undefined) {
    games = new Map();
    eventCache.set(store, games);
  }
  let perCommit = games.get(gameId);
  if (perCommit === undefined) {
    perCommit = [];
    games.set(gameId, perCommit);
  }
  for (let v = perCommit.length; v <= tip; v++) {
    perCommit.push((await manager.load(gameId, v)).events);
  }
  return perCommit.slice(0, tip + 1).flat();
}

/** The update a body carries: the 201/409 `update`, a 200 body itself, or `null`. */
function updateOf(body: Json): Json {
  if (!isPlainObject(body)) return null;
  if ('update' in body) return body.update;
  if ('view' in body) return body;
  return null;
}

/**
 * Asserts `body` leaks nothing (plan P-12), against the state at the store's tip:
 * - every body: no `seed`/`seatTokenHashes`/`aiDecisionCount` key at any depth, no array of card
 *   arrays, no seed or seat-token hash string, and the seat token only when `allowToken`;
 * - an update: exactly `version`/`events`/`view`/`legalMoves`, at the tip's version; in `events`,
 *   cards only at `card-played.card` and `hand-dealt.trumpCard`; legal moves are the seat's own,
 *   and every played card is in `view.yourHand`;
 * - in progress: outside `currentTrick`/`lastTrick`/`trumpCard`, no card of another seat's hand or
 *   of the stock in `view`; `yourHand` and `trumpCard` equal the state's;
 * - game over: `trumpCard` is `null` and `yourHand` is empty.
 */
export async function assertNoLeak(body: Json, ctx: LeakContext): Promise<LeakCheckResult> {
  const manager = new GameStateManager(ctx.store);
  const meta = await manager.loadMeta(ctx.gameId);
  const { state } = await manager.loadLatest(ctx.gameId);
  const serialized = JSON.stringify(body);

  // Every body.
  walk(body, '$', (value, path) => {
    if (isPlainObject(value)) {
      for (const key of FORBIDDEN_KEYS) {
        expect(Object.hasOwn(value, key), `forbidden key ${key} at ${path}`).toBe(false);
      }
    }
    if (Array.isArray(value)) {
      const nested = value.some((item) => Array.isArray(item) && item.some(isCardObject));
      expect(nested, `array of card arrays at ${path}`).toBe(false);
    }
  });
  expect(serialized.includes(state.seed), 'the seed is in the body').toBe(false);
  for (const hash of meta.seatTokenHashes) {
    if (hash !== null) expect(serialized.includes(hash), 'a seat-token hash').toBe(false);
  }
  expect(serialized.includes(ctx.seatToken), 'the seat token').toBe(ctx.allowToken);

  const raw = updateOf(body);
  if (raw === null) return { kind: 'none', stockTrump: false, fullDeal: false };

  // The update's shape and freshness.
  expect(isPlainObject(raw), 'the update is an object').toBe(true);
  expect(Object.keys(raw as object).sort()).toEqual(UPDATE_KEYS);
  const update = raw as PlayerUpdate;
  expect(update.version, 'the update is at the tip').toBe(state.version);
  const { view } = update;
  expect(view.you).toBe(ctx.seat);

  // Events: cards only at their two public positions.
  update.events.forEach((event, i) => {
    const allowed = EVENT_CARD_KEYS[event.type];
    for (const [key, value] of Object.entries(event)) {
      const path = `events[${i}](${event.type}).${key}`;
      if (key === allowed) {
        expect(isCardObject(value), `${path} is a card`).toBe(true);
      } else {
        expect(cardPaths(value, path)).toEqual([]);
      }
    }
  });

  // Legal moves: the seat's own, playing only cards it holds.
  const own = new Set(view.yourHand.map(cardKey));
  for (const { id, move } of update.legalMoves) {
    expect(move.seat, `legal move ${id} seat`).toBe(ctx.seat);
    if (move.type === 'play') expect(own.has(cardKey(move.card)), `${id} in yourHand`).toBe(true);
  }

  const hand = state.hand;
  if (hand === null) {
    expect(view.trumpCard).toBeNull();
    expect(view.yourHand).toEqual([]);
    return { kind: 'game-over', stockTrump: false, fullDeal: false };
  }

  expect(view.yourHand).toEqual(hand.hands[ctx.seat]);
  expect(view.trumpCard).toEqual(hand.trumpCard);

  // Forbidden: the other seats' hands and the stock (deck minus every card dealt this hand).
  const events = await eventsUpTo(manager, ctx.store, ctx.gameId, state.version);
  const lastDeal = events.findLastIndex((e) => e.type === 'hand-dealt');
  expect(lastDeal, 'a hand-dealt event exists').toBeGreaterThanOrEqual(0);
  const dealt = new Set(hand.hands.flat().map(cardKey));
  for (const event of events.slice(lastDeal + 1)) {
    if (event.type === 'card-played') dealt.add(cardKey(event.card));
  }
  const forbidden = new Set(
    buildDeck(state.rules.deck, state.seats.length)
      .map(cardKey)
      .filter((key) => !dealt.has(key)),
  );
  expect(forbidden.size, 'stock size').toBe(
    buildDeck(state.rules.deck, state.seats.length).length -
      state.seats.length * hand.cardsPerPlayer,
  );
  expect(forbidden.has(cardKey(hand.trumpCard)), 'trump in stock').toBe(
    !hand.trumpCardInDealerHand,
  );
  hand.hands.forEach((cards, seat) => {
    if (seat !== ctx.seat) for (const card of cards) forbidden.add(cardKey(card));
  });

  for (const [key, value] of Object.entries(view)) {
    if (PUBLIC_VIEW_KEYS.has(key)) continue;
    walk(value, `view.${key}`, (v, path) => {
      if (isCardObject(v)) expect(forbidden.has(cardKey(v)), `leaked card at ${path}`).toBe(false);
    });
  }

  return {
    kind: 'in-progress',
    stockTrump: !hand.trumpCardInDealerHand,
    fullDeal: hand.trumpCardInDealerHand,
  };
}
