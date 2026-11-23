// Applying moves and automatic transitions (spec 02 FR-213 to FR-217 for hands > 0, FR-218 to
// FR-220 at a real game over, FR-226 to FR-235, BR-203; VC-213 rotation, VC-214 hands 1–2, VC-216
// dealing part, VC-217 real game-over, VC-218 applyMove rows, VC-222 to VC-227).
import { describe, expect, it } from 'vitest';
import { cardId, type Card } from '@/src/domain/cards';
import { buildDeck } from '@/src/domain/decks';
import { getPreset } from '@/src/domain/presets';
import type { PresetId } from '@/src/domain/rules';
import { GameEventSchema, GameStateSchema } from '@/src/domain/schemas';
import type { GameEvent, GameState } from '@/src/domain/types';
import {
  IllegalMoveError,
  applyMove,
  createGame,
  currentActor,
  legalMoves,
} from '@/src/engine/engine';
import { deriveRng } from '@/src/engine/rng';
import { firstMove, makeSeats, newGame, playGame, type PlayedGame } from './helpers';

const types = (events: GameEvent[]) => events.map((e) => e.type);

/** Runs `applyMove` and returns the thrown `IllegalMoveError` (fails if none). */
function illegal(state: GameState, seat: number, moveId: string): IllegalMoveError {
  try {
    applyMove(state, seat, moveId);
  } catch (err) {
    expect(err).toBeInstanceOf(IllegalMoveError);
    return err as IllegalMoveError;
  }
  throw new Error('applyMove did not throw');
}

/** Index in `game.states` of the state right after hand `handIndex` was dealt. */
function dealtStateIndex(game: PlayedGame, handIndex: number): number {
  if (handIndex === 0) return 0;
  const i = game.moves.findIndex((m) =>
    m.events.some((e) => e.type === 'hand-dealt' && e.handIndex === handIndex),
  );
  expect(i).toBeGreaterThanOrEqual(0);
  return i + 1;
}

/** A first-legal-move game, memoised per preset/players/seed (tests never mutate it). */
const games = new Map<string, PlayedGame>();
function fullGame(id: PresetId, players: number, seed = 'seed-1'): PlayedGame {
  const key = `${id}/${players}/${seed}`;
  if (!games.has(key)) games.set(key, playGame(newGame(id, players, seed)));
  return games.get(key)!;
}

describe('VC-213 dealer rotation', () => {
  it.each<[PresetId, number]>([
    ['argentina-fidepo', 4],
    ['mexico-bazas', 3],
    ['gamerules', 7],
  ])('%s, %i players: every next hand is dealt by (dealer + 1) mod N', (id, players) => {
    const game = fullGame(id, players);
    const dealt = game.events.filter((e) => e.type === 'hand-dealt');
    expect(dealt).toHaveLength(game.final.handPlan.length);
    const first = deriveRng('seed-1', 'deal', 0).int(0, players - 1);
    dealt.forEach((e, i) => {
      expect(e.handIndex).toBe(i);
      expect(e.dealer).toBe((first + i) % players);
    });
    game.final.completedHands.forEach((r, i) => expect(r.dealer).toBe((first + i) % players));
  });
});

describe('VC-214 hands 1 and 2 (independent recomputation)', () => {
  it.each<[PresetId, number, string]>([
    ['argentina-fidepo', 4, 'deal-a'],
    ['argentina-fidepo', 3, 'deal-b'],
    ['spain-ludoteka', 3, 'deal-c'],
    ['gamerules', 5, 'deal-d'],
  ])('%s, %i players, seed %s', (id, players, seed) => {
    const rules = getPreset(id);
    const game = fullGame(id, players, seed);
    const sortKey = (c: Card) =>
      rules.deck.suits.indexOf(c.suit) * 100 + rules.deck.ranksHighToLow.indexOf(c.rank);

    let dealer = deriveRng(seed, 'deal', 0).int(0, players - 1);
    for (const handIndex of [1, 2]) {
      const hand = game.states[dealtStateIndex(game, handIndex)].hand!;
      // Hands > 0: dealer = next(previous dealer), no draw before the shuffle.
      dealer = (dealer + 1) % players;
      const shuffled = deriveRng(seed, 'deal', handIndex).shuffle(buildDeck(rules.deck, players));
      const c = game.states[0].handPlan[handIndex];
      const expected: Card[][] = Array.from({ length: players }, () => []);
      for (let k = 0; k < players * c; k++) expected[(dealer + 1 + k) % players].push(shuffled[k]);
      const expectedIds = expected.map((h) =>
        [...h].sort((a, b) => sortKey(a) - sortKey(b)).map(cardId),
      );
      const wholeDeck = players * c === shuffled.length;

      expect(hand.dealer).toBe(dealer);
      expect(hand.cardsPerPlayer).toBe(c);
      expect(hand.hands.map((h) => h.map(cardId))).toEqual(expectedIds);
      for (const h of hand.hands) {
        const keys = h.map(sortKey);
        expect(keys).toEqual([...keys].sort((a, b) => a - b));
      }
      expect(cardId(hand.trumpCard)).toBe(
        cardId(shuffled[wholeDeck ? players * c - 1 : players * c]),
      );
      expect(hand.trumpCardInDealerHand).toBe(wholeDeck);
      expect(hand.trumpSuit).toBe(hand.trumpCard.suit);
      const mano = (dealer + 1) % players;
      expect(hand.toAct).toBe(mano);
      expect(hand.currentTrick).toEqual({ leader: mano, plays: [] });
      expect(hand.bids).toEqual(Array(players).fill(null));
      expect(hand.tricksWon).toEqual(Array(players).fill(0));
      expect(hand).not.toHaveProperty('lastTrick');
    }
  });
});

describe('VC-216 whole-deck hands (dealing part)', () => {
  it('argentina-fidepo 4 players: hand 0 and the last hand (13 × 4 = 52) put the trump in the dealer’s hand', () => {
    const game = fullGame('argentina-fidepo', 4);
    const last = game.final.handPlan.length - 1;
    for (const handIndex of [0, last]) {
      const hand = game.states[dealtStateIndex(game, handIndex)].hand!;
      expect(hand.cardsPerPlayer).toBe(13);
      expect(hand.trumpCardInDealerHand).toBe(true);
      expect(hand.hands[hand.dealer].map(cardId)).toContain(cardId(hand.trumpCard));
      hand.hands.forEach((h, seat) => {
        if (seat !== hand.dealer) expect(h.map(cardId)).not.toContain(cardId(hand.trumpCard));
      });
      const event = game.events.find((e) => e.type === 'hand-dealt' && e.handIndex === handIndex);
      expect(event).toMatchObject({ trumpCardInDealerHand: true, trumpCard: hand.trumpCard });
    }
  });
});

describe('VC-217 at a real game over', () => {
  it('currentActor is null and every seat has no legal move', () => {
    const { final } = fullGame('mexico-bazas', 3);
    expect(final.phase).toBe('game-over');
    expect(currentActor(final)).toBeNull();
    for (let seat = 0; seat < 3; seat++) expect(legalMoves(final, seat)).toEqual([]);
  });
});

describe('VC-218 applyMove seat range check (RangeError before anything else)', () => {
  const { state } = newGame('argentina-fidepo', 4);
  const over = fullGame('mexico-bazas', 3).final;

  it.each([4, -1, 1.5, Number.NaN])('bidding state, seat %s → RangeError', (seat) => {
    expect(() => applyMove(state, seat, 'bid:0')).toThrow(RangeError);
  });

  it.each([3, -1, 1.5])('game-over state, seat %s → RangeError (not IllegalMoveError)', (seat) => {
    expect(() => applyMove(over, seat, 'bid:0')).toThrow(RangeError);
    expect(() => applyMove(over, seat, 'bid:0')).not.toThrow(IllegalMoveError);
  });
});

describe('VC-222 illegal moves', () => {
  const { state } = newGame('argentina-fidepo', 4);
  const actor = currentActor(state)!;

  it('wrong seat → not-your-turn', () => {
    const other = (actor + 1) % 4;
    const err = illegal(state, other, 'bid:0');
    expect(err.reason).toBe('not-your-turn');
    expect(err.seat).toBe(other);
    expect(err.moveId).toBe('bid:0');
    expect(err.message).toContain(String(other));
    expect(err.message).toContain('bid:0');
  });

  it.each(['bid:99', 'play:AS', 'bid:-1', 'bid:01', ''])(
    '%j during bidding → unknown-move',
    (id) => {
      const err = illegal(state, actor, id);
      expect(err.reason).toBe('unknown-move');
      expect(err.message).toContain(String(actor));
      expect(err.message).toContain(`"${id}"`);
    },
  );

  it("the dealer's forbidden bid → unknown-move", () => {
    let s = state;
    const dealer = s.hand!.dealer;
    while (currentActor(s) !== dealer) s = applyMove(s, currentActor(s)!, 'bid:0').state;
    const forbidden = s.hand!.cardsPerPlayer; // others all bid 0 → forbidden = 13 − 0
    expect(legalMoves(s, dealer).map((m) => m.id)).not.toContain(`bid:${forbidden}`);
    const err = illegal(s, dealer, `bid:${forbidden}`);
    expect(err.reason).toBe('unknown-move');
    expect(err.message).toContain(String(dealer));
    expect(err.message).toContain(`bid:${forbidden}`);
  });

  it('a bid during playing and a card not legal to play → unknown-move', () => {
    const game = fullGame('argentina-fidepo', 4);
    const i = game.states.findIndex((s) => s.phase === 'playing');
    const s = game.states[i];
    const seat = currentActor(s)!;
    expect(illegal(s, seat, 'bid:0').reason).toBe('unknown-move');
    // A card held by another seat is never legal for this one.
    const foreign = cardId(s.hand!.hands[(seat + 1) % 4][0]);
    expect(illegal(s, seat, `play:${foreign}`).reason).toBe('unknown-move');
  });

  it('game-over state → game-over (with seat and moveId in the message)', () => {
    const over = fullGame('mexico-bazas', 3).final;
    for (let seat = 0; seat < 3; seat++) {
      const err = illegal(over, seat, 'bid:0');
      expect(err.reason).toBe('game-over');
      expect(err.message).toContain(String(seat));
      expect(err.message).toContain('bid:0');
    }
  });

  it('illegal moves leave the input untouched', () => {
    const before = structuredClone(state);
    illegal(state, actor, 'bid:99');
    illegal(state, (actor + 1) % 4, 'bid:0');
    expect(state).toEqual(before);
  });
});

/** Every object (incl. arrays) reachable from `value`. */
function objectsOf(value: unknown, into = new Set<object>()): Set<object> {
  if (value !== null && typeof value === 'object' && !into.has(value)) {
    into.add(value);
    for (const v of Object.values(value)) objectsOf(v, into);
  }
  return into;
}

describe('VC-223 applyMove never mutates its input', () => {
  it('every move of a full 4-player game: input unchanged, no shared objects with the result', () => {
    let { state } = newGame('argentina-fidepo', 4, 'immut');
    let moves = 0;
    while (currentActor(state) !== null) {
      const seat = currentActor(state)!;
      const before = structuredClone(state);
      const { state: next, events } = applyMove(state, seat, legalMoves(state, seat)[0].id);
      expect(state).toEqual(before);
      const inputObjects = objectsOf(state);
      for (const o of objectsOf({ next, events })) expect(inputObjects.has(o)).toBe(false);
      state = next;
      moves++;
    }
    expect(moves).toBeGreaterThan(500);
  });

  it("mutating the returned state's hand.hands[0] and seats[0] does not change the input", () => {
    const { state } = newGame('argentina-fidepo', 4);
    const before = structuredClone(state);
    const { state: next } = applyMove(state, currentActor(state)!, 'bid:0');
    next.hand!.hands[0].pop();
    next.hand!.hands[0][0].rank = 'A';
    next.seats[0].name = 'Mallory';
    expect(state).toEqual(before);
  });

  it("mutating a move's events does not change the returned state", () => {
    const game = fullGame('argentina-fidepo', 4);
    const step = game.moves.findIndex((m) => types(m.events).includes('hand-completed'));
    const after = game.states[step + 1];
    const snapshot = structuredClone(after);
    const replay = applyMove(game.states[step], game.moves[step].seat, game.moves[step].moveId);
    expect(replay.state).toEqual(snapshot);
    for (const e of replay.events) {
      if (e.type === 'card-played') e.card.rank = 'A';
      if (e.type === 'hand-completed') {
        e.result.bids[0] = 99;
        e.result.tricks[0] = 99;
      }
      if (e.type === 'hand-dealt') e.trumpCard.rank = 'A';
    }
    expect(replay.state).toEqual(snapshot);
  });
});

describe('VC-224 aiDecisionCount and version', () => {
  it('seats [human, ai, ai, human]: +1 per AI move only; version stays 0', () => {
    const start = createGame({
      gameId: 'g',
      rules: getPreset('argentina-fidepo'),
      seats: makeSeats(4, ['human', 'ai', 'ai', 'human']),
      seed: 'ai-seed',
    });
    const game = playGame(start);
    let aiMoves = 0;
    game.moves.forEach((m, i) => {
      const before = game.states[i].aiDecisionCount;
      const after = game.states[i + 1].aiDecisionCount;
      const isAi = m.seat === 1 || m.seat === 2;
      if (isAi) aiMoves++;
      expect(after).toBe(isAi ? before + 1 : before);
      expect(game.states[i + 1].version).toBe(0);
    });
    expect(aiMoves).toBeGreaterThan(0);
    expect(game.final.aiDecisionCount).toBe(aiMoves);
  });
});

describe('VC-225 bids, plays and tricks', () => {
  const game = fullGame('argentina-fidepo', 4);
  const N = 4;

  it('bids go mano → … → dealer, each emitting bid-made; the dealer closes bidding', () => {
    for (let h = 0; h < 3; h++) {
      const start = dealtStateIndex(game, h);
      const dealer = game.states[start].hand!.dealer;
      for (let k = 0; k < N; k++) {
        const move = game.moves[start + k];
        const after = game.states[start + k + 1];
        const bidder = (dealer + 1 + k) % N;
        expect(move.seat).toBe(bidder);
        expect(move.events).toEqual([{ type: 'bid-made', seat: bidder, tricks: 0 }]);
        expect(after.hand!.bids[bidder]).toBe(0);
        if (k < N - 1) {
          expect(after.phase).toBe('bidding');
          expect(after.hand!.toAct).toBe((bidder + 1) % N);
        } else {
          expect(bidder).toBe(dealer);
          expect(after.phase).toBe('playing');
          expect(after.hand!.toAct).toBe((dealer + 1) % N);
        }
      }
    }
  });

  it('plays: non-final emits only card-played; final emits card-played, trick-won and the winner leads', () => {
    let trickNumber = 0;
    let checkedFinal = 0;
    game.moves.forEach((m, i) => {
      const before = game.states[i];
      const after = game.states[i + 1];
      if (before.phase !== 'playing') return;
      const hb = before.hand!;
      const played = m.moveId.slice('play:'.length);
      const playedCard = hb.hands[m.seat].find((c) => cardId(c) === played)!;
      expect(m.events[0]).toEqual({ type: 'card-played', seat: m.seat, card: playedCard });
      if (hb.currentTrick.plays.length === 0) trickNumber = hb.tricksWon.reduce((a, b) => a + b, 0);
      if (hb.currentTrick.plays.length < N - 1) {
        expect(types(m.events)).toEqual(['card-played']);
        const ha = after.hand!;
        expect(ha.hands[m.seat].map(cardId)).not.toContain(played);
        expect(ha.hands[m.seat]).toHaveLength(hb.hands[m.seat].length - 1);
        expect(ha.currentTrick.plays.at(-1)).toEqual({ seat: m.seat, card: playedCard });
        expect(ha.toAct).toBe((m.seat + 1) % N);
        return;
      }
      trickNumber++;
      expect(types(m.events).slice(0, 2)).toEqual(['card-played', 'trick-won']);
      const won = m.events[1] as Extract<GameEvent, { type: 'trick-won' }>;
      expect(won.trickNumber).toBe(trickNumber);
      if (types(m.events).length === 2) {
        const ha = after.hand!;
        expect(ha.lastTrick).toEqual({
          winner: won.seat,
          plays: [...hb.currentTrick.plays, { seat: m.seat, card: playedCard }],
        });
        expect(ha.currentTrick).toEqual({ leader: won.seat, plays: [] });
        expect(ha.toAct).toBe(won.seat);
        expect(ha.tricksWon[won.seat]).toBe(hb.tricksWon[won.seat] + 1);
        checkedFinal++;
      }
    });
    expect(checkedFinal).toBeGreaterThan(100);
  });
});

describe('VC-226 hand completion and next deal', () => {
  it('the last play of hand 0 emits card-played, trick-won, hand-completed, hand-dealt', () => {
    const game = fullGame('argentina-fidepo', 4);
    const step = game.moves.findIndex((m) => types(m.events).includes('hand-completed'));
    const before = game.states[step];
    const after = game.states[step + 1];
    const move = game.moves[step];
    expect(types(move.events)).toEqual([
      'card-played',
      'trick-won',
      'hand-completed',
      'hand-dealt',
    ]);

    const h0 = before.hand!;
    const won = move.events[1] as Extract<GameEvent, { type: 'trick-won' }>;
    expect(won.trickNumber).toBe(h0.cardsPerPlayer);
    const tricks = h0.tricksWon.map((t, s) => (s === won.seat ? t + 1 : t));
    const result = {
      handIndex: 0,
      cardsPerPlayer: h0.cardsPerPlayer,
      dealer: h0.dealer,
      trumpSuit: h0.trumpSuit,
      bids: h0.bids,
      tricks,
    };
    expect(after.completedHands).toEqual([result]);
    expect(tricks.reduce((a, b) => a + b, 0)).toBe(h0.cardsPerPlayer);
    expect(move.events[2]).toEqual({ type: 'hand-completed', handIndex: 0, result });

    const h1 = after.hand!;
    expect(after.handIndex).toBe(1);
    expect(after.phase).toBe('bidding');
    expect(h1.dealer).toBe((h0.dealer + 1) % 4);
    expect(h1.cardsPerPlayer).toBe(after.handPlan[1]);
    expect(h1).not.toHaveProperty('lastTrick');
    expect(move.events[3]).toEqual({
      type: 'hand-dealt',
      handIndex: 1,
      dealer: h1.dealer,
      cardsPerPlayer: h1.cardsPerPlayer,
      trumpCard: h1.trumpCard,
      trumpCardInDealerHand: h1.trumpCardInDealerHand,
    });
  });

  it('every move’s events follow the FR-235 order', () => {
    const order = ['bid-made|card-played', 'trick-won', 'hand-completed', 'hand-dealt|game-over'];
    for (const m of fullGame('argentina-fidepo', 4).moves) {
      let pos = -1;
      for (const t of types(m.events)) {
        const at = order.findIndex((o) => o.split('|').includes(t));
        expect(at).toBeGreaterThan(pos);
        pos = at;
      }
      expect(['bid-made', 'card-played']).toContain(m.events[0].type);
    }
  });
});

describe('VC-227 full mexico-bazas 3-player game', () => {
  const game = fullGame('mexico-bazas', 3);

  it('ends with hand-completed, game-over; hand null; handIndex 10; 11 completed hands', () => {
    expect(types(game.moves.at(-1)!.events).slice(-2)).toEqual(['hand-completed', 'game-over']);
    expect(types(game.events).slice(-2)).toEqual(['hand-completed', 'game-over']);
    expect(game.final.phase).toBe('game-over');
    expect(game.final.hand).toBeNull();
    expect(game.final.handIndex).toBe(10);
    expect(game.final.completedHands).toHaveLength(11);
    expect(game.final.completedHands.map((r) => r.handIndex)).toEqual([...Array(11).keys()]);
    for (const r of game.final.completedHands) {
      expect(r.tricks.reduce((a, b) => a + b, 0)).toBe(r.cardsPerPlayer);
    }
    expect(game.events.filter((e) => e.type === 'game-over')).toHaveLength(1);
  });

  it('every state parses with GameStateSchema and every event with GameEventSchema', () => {
    for (const s of game.states) expect(GameStateSchema.safeParse(s).success).toBe(true);
    for (const e of game.events) expect(GameEventSchema.safeParse(e).success).toBe(true);
  });

  it.each<[PresetId, number]>([
    ['argentina-fidepo', 3],
    ['spain-ludoteka', 6],
    ['gamerules', 7],
  ])('%s, %i players also plays to a schema-valid game over', (id, players) => {
    const g = fullGame(id, players);
    expect(g.final.phase).toBe('game-over');
    expect(g.final.completedHands).toHaveLength(g.final.handPlan.length);
    expect(GameStateSchema.safeParse(g.final).success).toBe(true);
    for (const e of g.events) expect(GameEventSchema.safeParse(e).success).toBe(true);
  });
});

describe('playGame helper', () => {
  it('records states, events and moves consistently', () => {
    const start = newGame('mexico-bazas', 3);
    const game = playGame(start, firstMove);
    expect(game.states).toHaveLength(game.moves.length + 1);
    expect(game.states[0]).toBe(start.state);
    expect(game.final).toBe(game.states.at(-1));
    expect(game.events).toEqual([...start.events, ...game.moves.flatMap((m) => m.events)]);
  });
});
