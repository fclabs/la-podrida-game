// Shared builders for engine tests (not collected: no `.test.ts` suffix).
import { parseCard, type Card } from '@/src/domain/cards';
import { FRENCH_52, type DeckDefinition } from '@/src/domain/decks';
import { getPreset } from '@/src/domain/presets';
import type { PresetId, RuleSet } from '@/src/domain/rules';
import type {
  GameEvent,
  GameState,
  HandState,
  LegalMove,
  SeatInfo,
  Transition,
  TrickPlay,
} from '@/src/domain/types';
import { applyMove, createGame, currentActor, legalMoves } from '@/src/engine/engine';

/** Parses one card id (`'9H'`, `'10S'`, `'3O'`) for `deck` (default french-52). */
export function card(id: string, deck: DeckDefinition = FRENCH_52): Card {
  return parseCard(id, deck);
}

/** Parses a whitespace-separated list of card ids (`'KS AH 3H'`), keeping the order given. */
export function cards(ids: string, deck: DeckDefinition = FRENCH_52): Card[] {
  return ids
    .split(/\s+/)
    .filter((id) => id !== '')
    .map((id) => card(id, deck));
}

/**
 * Trick plays for `ids` (as in `cards`), the first by `leader` and each next one by the next seat
 * clockwise, wrapping at `seatCount`.
 */
export function trick(
  leader: number,
  ids: string,
  seatCount = 4,
  deck: DeckDefinition = FRENCH_52,
): TrickPlay[] {
  return cards(ids, deck).map((c, i) => ({ seat: (leader + i) % seatCount, card: c }));
}

/** A mutable copy of preset `id` with `play` and `bidding` fields overridden. */
export function rulesWith(
  id: PresetId,
  overrides: { play?: Partial<RuleSet['play']>; bidding?: Partial<RuleSet['bidding']> } = {},
): RuleSet {
  const rules = getPreset(id);
  rules.play = { ...rules.play, ...overrides.play };
  rules.bidding = { ...rules.bidding, ...overrides.bidding };
  return rules;
}

/**
 * A full `HandState` with defaults for a 4-seat french-52 hand: 4 cards each, dealer 0, trump
 * card 2S (spades trump, not in the dealer's hand), empty hands, no bids, no tricks won, an empty
 * current trick led by seat 1, seat 1 to act. Any field can be overridden; `hands`, `bids` and
 * `tricksWon` default to one entry per seat of `seatCount`.
 */
export function makeHand(overrides: Partial<HandState> = {}, seatCount = 4): HandState {
  return {
    cardsPerPlayer: 4,
    dealer: 0,
    trumpCard: card('2S'),
    trumpCardInDealerHand: false,
    trumpSuit: 'S',
    hands: Array.from({ length: seatCount }, () => []),
    bids: Array.from({ length: seatCount }, () => null),
    tricksWon: Array.from({ length: seatCount }, () => 0),
    currentTrick: { leader: 1 % seatCount, plays: [] },
    toAct: 1 % seatCount,
    ...overrides,
  };
}

/**
 * `count` valid seats: seat `i` has playerId `p<i>`, name `Player <i>`, and kind `kinds[i]`
 * (default `'human'`).
 */
export function makeSeats(count: number, kinds: SeatInfo['kind'][] = []): SeatInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    seat: i,
    playerId: `p${i}`,
    name: `Player ${i}`,
    kind: kinds[i] ?? 'human',
  }));
}

/** `createGame` for preset `id` with `players` seats (`makeSeats`), `seed`, gameId `'game-1'`. */
export function newGame(id: PresetId, players: number, seed = 'seed-1'): Transition {
  return createGame({ gameId: 'game-1', rules: getPreset(id), seats: makeSeats(players), seed });
}

/**
 * A copy of `state` with `hand` replaced by `makeHand(overrides, seats.length)` and `phase` set.
 * For tests of `legalMoves` on hand-built positions; the result need not pass invariants.
 */
export function withHand(
  state: GameState,
  overrides: Partial<HandState>,
  phase: GameState['phase'] = 'bidding',
): GameState {
  return { ...structuredClone(state), phase, hand: makeHand(overrides, state.seats.length) };
}

/**
 * Chooses one move from the non-empty list of legal moves of the seat to act (`state` is the
 * position before the move). Must return an element of `moves`.
 */
export type Policy = (moves: LegalMove[], state: GameState) => LegalMove;

/** Always the first legal move (lowest bid; first card in hand order). */
export const firstMove: Policy = (moves) => moves[0];

/** Always the last legal move (highest bid; last card in hand order). */
export const lastMove: Policy = (moves) => moves[moves.length - 1];

/** One applied move of a `playGame` run: who moved, the move id and the events it produced. */
export interface PlayedMove {
  seat: number;
  moveId: string;
  events: GameEvent[];
}

/** The full record of a `playGame` run. */
export interface PlayedGame {
  /** `start.state`, then the state after each move (`states.length === moves.length + 1`). */
  states: GameState[];
  /** `start.events`, then every move's events, in order. */
  events: GameEvent[];
  /** Every applied move in order; `moves[i]` turned `states[i]` into `states[i + 1]`. */
  moves: PlayedMove[];
  /** The last state (`phase === 'game-over'`). */
  final: GameState;
}

/**
 * Plays the game in `start` to completion: while `currentActor(state)` is not `null`, calls
 * `legalMoves(state, actor)`, picks one with `policy` (default `firstMove`) and applies it with
 * `applyMove`. Returns every state and every event. Throws if `maxMoves` moves are exceeded or a
 * seat to act has no legal move. Pure: never mutates `start`.
 */
export function playGame(
  start: Transition,
  policy: Policy = firstMove,
  maxMoves = 10_000,
): PlayedGame {
  const states: GameState[] = [start.state];
  const events: GameEvent[] = [...start.events];
  const moves: PlayedMove[] = [];
  let state = start.state;
  for (let actor = currentActor(state); actor !== null; actor = currentActor(state)) {
    if (moves.length >= maxMoves) throw new Error(`playGame exceeded ${maxMoves} moves`);
    const legal = legalMoves(state, actor);
    if (legal.length === 0) throw new Error(`seat ${actor} to act has no legal move`);
    const { id } = policy(legal, state);
    const transition = applyMove(state, actor, id);
    state = transition.state;
    states.push(state);
    events.push(...transition.events);
    moves.push({ seat: actor, moveId: id, events: transition.events });
  }
  return { states, events, moves, final: state };
}
