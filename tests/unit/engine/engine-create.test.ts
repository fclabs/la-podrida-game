// Game creation, dealing and legal moves (spec 02 FR-206, FR-211 to FR-223, FR-241; VC-206,
// VC-211, VC-212, VC-213 hand 0, VC-214 hand 0, VC-215, VC-217 bidding + hand-built game-over,
// VC-218 legalMoves rows, VC-219 `bid:` ids, VC-220 `play:` ids, VC-234).
import { describe, expect, it } from 'vitest';
import { cardId, compareRanks, type Card } from '@/src/domain/cards';
import { buildDeck } from '@/src/domain/decks';
import { getPreset } from '@/src/domain/presets';
import type { HandSequenceSpec, PresetId, RuleSet } from '@/src/domain/rules';
import { GameEventSchema, GameStateSchema } from '@/src/domain/schemas';
import type { GameState, Rng, SeatInfo } from '@/src/domain/types';
import {
  ENGINE_VERSION,
  IllegalMoveError,
  InvalidGameSetupError,
  aiRng,
  createGame,
  currentActor,
  legalMoves,
  type CreateGameInput,
} from '@/src/engine/engine';
import { deriveRng } from '@/src/engine/rng';
import { expandHandSequence } from '@/src/engine/sequence';
import { cards, makeSeats, newGame, rulesWith, trick, withHand } from './helpers';

const RAW = 2 ** 32 - 1;

function rawOutputs(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.int(0, RAW));
}

function validInput(overrides: Partial<CreateGameInput> = {}): CreateGameInput {
  return {
    gameId: 'game-1',
    rules: getPreset('argentina-fidepo'),
    seats: makeSeats(4),
    seed: 'seed-1',
    ...overrides,
  };
}

/** Runs `createGame` and returns the thrown `InvalidGameSetupError` (fails if none). */
function setupError(input: CreateGameInput): InvalidGameSetupError {
  try {
    createGame(input);
  } catch (err) {
    expect(err).toBeInstanceOf(InvalidGameSetupError);
    return err as InvalidGameSetupError;
  }
  throw new Error('createGame did not throw');
}

function withSequence(id: PresetId, handSequence: HandSequenceSpec): RuleSet {
  const rules = getPreset(id);
  rules.handSequence = handSequence;
  return rules;
}

function ids(state: GameState, seat: number): string[] {
  return legalMoves(state, seat).map((m) => m.id);
}

describe('VC-206 aiRng', () => {
  it('aiRng(state, 2) equals deriveRng(seed, "ai", 2, aiDecisionCount)', () => {
    const { state } = newGame('argentina-fidepo', 4, 'seed-ai');
    expect(rawOutputs(aiRng(state, 2), 10)).toEqual(
      rawOutputs(deriveRng('seed-ai', 'ai', 2, 0), 10),
    );
  });

  it('follows aiDecisionCount and differs from the deal stream', () => {
    const { state } = newGame('argentina-fidepo', 4, 'seed-ai');
    const later = { ...state, aiDecisionCount: 7 };
    expect(rawOutputs(aiRng(later, 2), 10)).toEqual(
      rawOutputs(deriveRng('seed-ai', 'ai', 2, 7), 10),
    );
    expect(rawOutputs(aiRng(later, 2), 10)).not.toEqual(rawOutputs(aiRng(state, 2), 10));
    expect(rawOutputs(aiRng(state, 2), 10)).not.toEqual(
      rawOutputs(deriveRng('seed-ai', 'deal', 0), 10),
    );
  });
});

describe('VC-211 createGame rejects invalid input with InvalidGameSetupError', () => {
  const badPlayersRules = getPreset('argentina-fidepo');
  badPlayersRules.players.min = 1;
  const rows: { name: string; input: CreateGameInput; problems?: number }[] = [
    { name: 'rules with players.min = 1', input: validInput({ rules: badPlayersRules }) },
    {
      name: '2 seats for argentina-fidepo',
      input: validInput({ seats: makeSeats(2) }),
      problems: 1,
    },
    {
      name: '7 seats for spain-ludoteka',
      input: validInput({ rules: getPreset('spain-ludoteka'), seats: makeSeats(7) }),
      problems: 1,
    },
    {
      name: 'seats indexed [0, 2, 1]',
      input: validInput({
        seats: makeSeats(3).map((s, i) => ({ ...s, seat: [0, 2, 1][i] })),
      }),
    },
    {
      name: "a seat with kind 'robot'",
      input: validInput({
        seats: makeSeats(4).map((s, i) =>
          i === 2 ? ({ ...s, kind: 'robot' } as unknown as SeatInfo) : s,
        ),
      }),
      problems: 1,
    },
    {
      name: 'two seats with the same playerId',
      input: validInput({
        seats: makeSeats(4).map((s, i) => (i === 3 ? { ...s, playerId: 'p0' } : s)),
      }),
      problems: 1,
    },
    { name: "gameId ''", input: validInput({ gameId: '' }), problems: 1 },
    { name: "seed ''", input: validInput({ seed: '' }), problems: 1 },
  ];

  it.each(rows)('$name', ({ input, problems }) => {
    const err = setupError(input);
    expect(err.problems.length).toBeGreaterThan(0);
    if (problems !== undefined) expect(err.problems).toHaveLength(problems);
    for (const problem of err.problems) expect(err.message).toContain(problem);
  });

  it('a RuleSetSchema failure is one problem (player range and expansion skipped)', () => {
    const err = setupError(validInput({ rules: badPlayersRules, seats: makeSeats(9) }));
    expect(err.problems).toHaveLength(1);
  });

  it('a custom sequence {repeat, cards: 20} with 4 seats → one problem containing 20', () => {
    const rules = withSequence('argentina-fidepo', [{ kind: 'repeat', cards: 20, times: 1 }]);
    const err = setupError(validInput({ rules }));
    expect(err.problems).toHaveLength(1);
    expect(err.problems[0]).toContain('20');
    expect(() => expandHandSequence(rules, 4)).toThrow(err.problems[0]);
  });

  it('empty seed and duplicate playerIds → problems.length === 2', () => {
    const seats = makeSeats(4).map((s, i) => (i === 1 ? { ...s, playerId: 'p0' } : s));
    const err = setupError(validInput({ seed: '', seats }));
    expect(err.problems).toHaveLength(2);
  });

  it('error class names', () => {
    expect(setupError(validInput({ seed: '' })).name).toBe('InvalidGameSetupError');
    const illegal = new IllegalMoveError('unknown-move', 2, 'bid:99');
    expect(illegal.name).toBe('IllegalMoveError');
    expect(illegal.message).toContain('2');
    expect(illegal.message).toContain('bid:99');
    expect([illegal.reason, illegal.seat, illegal.moveId]).toEqual(['unknown-move', 2, 'bid:99']);
  });
});

describe('VC-212 createGame builds the initial state and events', () => {
  it('argentina-fidepo, 4 seats, seed "seed-1"', () => {
    const input = validInput();
    const { state, events } = createGame(input);
    expect(GameStateSchema.safeParse(state).success).toBe(true);
    expect(state).toMatchObject({
      schemaVersion: 1,
      gameId: 'game-1',
      seed: 'seed-1',
      phase: 'bidding',
      handIndex: 0,
      version: 0,
      aiDecisionCount: 0,
      completedHands: [],
    });
    expect(state.handPlan).toHaveLength(22);
    expect(state.handPlan).toEqual(expandHandSequence(input.rules, 4));
    expect(state.rules).toEqual(getPreset('argentina-fidepo'));
    expect(state.seats).toEqual(makeSeats(4));
    expect(state.hand).not.toBeNull();

    expect(events.map((e) => e.type)).toEqual(['game-started', 'hand-dealt']);
    for (const e of events) expect(GameEventSchema.safeParse(e).success).toBe(true);
    expect(events[0]).toEqual({
      type: 'game-started',
      seats: makeSeats(4),
      handPlan: state.handPlan,
    });
    expect(events[1]).toEqual({
      type: 'hand-dealt',
      handIndex: 0,
      dealer: state.hand?.dealer,
      cardsPerPlayer: 13,
      trumpCard: state.hand?.trumpCard,
      trumpCardInDealerHand: state.hand?.trumpCardInDealerHand,
    });
  });

  it('mutating the input afterwards leaves the state unchanged', () => {
    const input = validInput();
    const { state } = createGame(input);
    const before = structuredClone(state);
    input.rules.players.max = 99;
    input.seats[0].name = 'Changed';
    expect(state).toEqual(before);
    expect(state.rules.players.max).toBe(6);
    expect(state.seats[0].name).toBe('Player 0');
  });
});

describe('VC-213 hand-0 dealer', () => {
  it.each(Array.from({ length: 20 }, (_, i) => `seed-${i}`))(
    'dealer for %s = deriveRng(seed, "deal", 0).int(0, N − 1)',
    (seed) => {
      const { state } = newGame('argentina-fidepo', 4, seed);
      expect(state.hand?.dealer).toBe(deriveRng(seed, 'deal', 0).int(0, 3));
    },
  );

  it('over 200 seeds with 4 players all four seats appear as first dealer', () => {
    const dealers = new Set<number>();
    for (let i = 0; i < 200; i++) {
      dealers.add(newGame('mexico-bazas', 4, `many-${i}`).state.hand?.dealer ?? -1);
    }
    expect([...dealers].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('VC-214 hand 0 deal (independent recomputation)', () => {
  const cases: [PresetId, number, string][] = [
    ['argentina-fidepo', 4, 'deal-a'],
    ['argentina-fidepo', 3, 'deal-b'],
    ['spain-ludoteka', 3, 'deal-c'],
    ['gamerules', 5, 'deal-d'],
  ];

  it.each(cases)('%s, %i players, seed %s', (id, players, seed) => {
    const rules = getPreset(id);
    const { state } = newGame(id, players, seed);
    const hand = state.hand!;

    // Independent recomputation: dealer first, then shuffle, round-robin from next(dealer), sort.
    const rng = deriveRng(seed, 'deal', 0);
    const dealer = rng.int(0, players - 1);
    const shuffled = rng.shuffle(buildDeck(rules.deck, players));
    const c = state.handPlan[0];
    const expected: string[][] = Array.from({ length: players }, () => []);
    for (let k = 0; k < players * c; k++) {
      expected[(dealer + 1 + k) % players].push(cardId(shuffled[k]));
    }
    const sortKey = (card: Card) =>
      rules.deck.suits.indexOf(card.suit) * 100 + rules.deck.ranksHighToLow.indexOf(card.rank);
    const sortIds = (list: string[]) =>
      list
        .map((cid) => shuffled.find((card) => cardId(card) === cid)!)
        .sort((a, b) => sortKey(a) - sortKey(b))
        .map(cardId);

    expect(hand.dealer).toBe(dealer);
    expect(hand.cardsPerPlayer).toBe(c);
    expect(hand.hands.map((h) => h.map(cardId))).toEqual(expected.map(sortIds));

    for (const h of hand.hands) {
      for (let i = 1; i < h.length; i++) {
        const suitDiff =
          rules.deck.suits.indexOf(h[i - 1].suit) - rules.deck.suits.indexOf(h[i].suit);
        expect(
          suitDiff < 0 ||
            (suitDiff === 0 && compareRanks(rules.deck, h[i - 1].rank, h[i].rank) > 0),
        ).toBe(true);
      }
    }
    const mano = (dealer + 1) % players;
    expect(hand.toAct).toBe(mano);
    expect(hand.currentTrick).toEqual({ leader: mano, plays: [] });
    expect(currentActor(state)).toBe(mano);
    expect(hand.bids).toEqual(Array(players).fill(null));
    expect(hand.tricksWon).toEqual(Array(players).fill(0));
    expect('lastTrick' in hand).toBe(false);
    expect(hand.trumpSuit).toBe(hand.trumpCard.suit);
  });
});

describe('VC-215 trump card from the stock', () => {
  it('argentina-fidepo, 3 players, hand 0 (51 of 52 dealt)', () => {
    for (const seed of ['stock-1', 'stock-2', 'stock-3']) {
      const { state, events } = newGame('argentina-fidepo', 3, seed);
      const hand = state.hand!;
      expect(hand.cardsPerPlayer).toBe(17);
      expect(hand.trumpCardInDealerHand).toBe(false);
      const trumpId = cardId(hand.trumpCard);
      for (const h of hand.hands) expect(h.map(cardId)).not.toContain(trumpId);
      expect(hand.trumpSuit).toBe(hand.trumpCard.suit);

      // The trump is shuffled card N·c (the next stock card).
      const rng = deriveRng(seed, 'deal', 0);
      rng.int(0, 2);
      const shuffled = rng.shuffle(buildDeck(state.rules.deck, 3));
      expect(trumpId).toBe(cardId(shuffled[51]));

      // The hand-dealt event carries the trump card but never any hand.
      expect(Object.keys(events[1]).sort()).toEqual(
        [
          'cardsPerPlayer',
          'dealer',
          'handIndex',
          'trumpCard',
          'trumpCardInDealerHand',
          'type',
        ].sort(),
      );
    }
  });
});

describe('VC-217 currentActor and legalMoves for non-actors', () => {
  it('bidding: currentActor = hand.toAct; other seats get []', () => {
    const { state } = newGame('argentina-fidepo', 4, 'actor');
    const actor = currentActor(state);
    expect(actor).toBe(state.hand?.toAct);
    for (let seat = 0; seat < 4; seat++) {
      if (seat === actor) expect(legalMoves(state, seat).length).toBeGreaterThan(0);
      else expect(legalMoves(state, seat)).toEqual([]);
    }
  });

  it('playing: currentActor = hand.toAct; other seats get []', () => {
    const { state } = newGame('argentina-fidepo', 4, 'actor');
    const playing = withHand(
      state,
      { hands: [[], cards('KS AH 3H'), [], []], bids: [1, 1, 1, 0], toAct: 1 },
      'playing',
    );
    expect(currentActor(playing)).toBe(1);
    for (const seat of [0, 2, 3]) expect(legalMoves(playing, seat)).toEqual([]);
  });

  it('hand-built game-over (phase "game-over", hand null): null actor, every seat []', () => {
    const { state } = newGame('argentina-fidepo', 4, 'actor');
    const over: GameState = { ...state, phase: 'game-over', hand: null };
    expect(currentActor(over)).toBeNull();
    for (let seat = 0; seat < 4; seat++) expect(legalMoves(over, seat)).toEqual([]);
  });
});

describe('VC-218 legalMoves seat range check', () => {
  const { state } = newGame('argentina-fidepo', 4, 'range');
  const over: GameState = { ...state, phase: 'game-over', hand: null };

  it.each([-1, 4, 1.5, Number.NaN])('bidding state, seat %s → RangeError', (seat) => {
    expect(() => legalMoves(state, seat)).toThrow(RangeError);
  });

  it.each([-1, 4, 1.5])('game-over state, seat %s → RangeError (before the [] rule)', (seat) => {
    expect(() => legalMoves(over, seat)).toThrow(RangeError);
  });
});

describe('VC-219 bid ids via legalMoves', () => {
  const { state } = newGame('argentina-fidepo', 4, 'bids');

  it('dealer, 4 cards, others sum to 1 → bid:0, bid:1, bid:2, bid:4', () => {
    const s = withHand(state, { cardsPerPlayer: 4, dealer: 3, bids: [0, 1, 0, null], toAct: 3 });
    expect(ids(s, 3)).toEqual(['bid:0', 'bid:1', 'bid:2', 'bid:4']);
    expect(legalMoves(s, 3)[3]).toEqual({ id: 'bid:4', move: { type: 'bid', seat: 3, tricks: 4 } });
  });

  it('dealer, others sum to 5 → bid:0 … bid:4', () => {
    const s = withHand(state, { cardsPerPlayer: 4, dealer: 3, bids: [2, 2, 1, null], toAct: 3 });
    expect(ids(s, 3)).toEqual(['bid:0', 'bid:1', 'bid:2', 'bid:3', 'bid:4']);
  });

  it('non-dealer → bid:0 … bid:4', () => {
    const s = withHand(state, {
      cardsPerPlayer: 4,
      dealer: 3,
      bids: [0, null, null, null],
      toAct: 1,
    });
    expect(ids(s, 1)).toEqual(['bid:0', 'bid:1', 'bid:2', 'bid:3', 'bid:4']);
  });

  it('dealerRestriction false → dealer gets bid:0 … bid:4', () => {
    const s = withHand(
      { ...state, rules: rulesWith('argentina-fidepo', { bidding: { dealerRestriction: false } }) },
      { cardsPerPlayer: 4, dealer: 3, bids: [0, 1, 0, null], toAct: 3 },
    );
    expect(ids(s, 3)).toEqual(['bid:0', 'bid:1', 'bid:2', 'bid:3', 'bid:4']);
  });

  it('spain-ludoteka 1 card (exempt) → dealer gets bid:0, bid:1; 2 cards → restricted', () => {
    const spain = newGame('spain-ludoteka', 4, 'bids').state;
    const one = withHand(spain, { cardsPerPlayer: 1, dealer: 3, bids: [0, 0, 0, null], toAct: 3 });
    expect(ids(one, 3)).toEqual(['bid:0', 'bid:1']);
    const two = withHand(spain, { cardsPerPlayer: 2, dealer: 3, bids: [0, 1, 0, null], toAct: 3 });
    expect(ids(two, 3)).toEqual(['bid:0', 'bid:2']);
  });

  it('a 13-card bid id has no padding (bid:13) on a created game', () => {
    const actor = currentActor(state)!;
    const list = ids(state, actor);
    expect(list[0]).toBe('bid:0');
    expect(list.at(-1)).toBe('bid:13');
  });
});

describe('VC-220 play ids via legalMoves (playing phase)', () => {
  const { state } = newGame('argentina-fidepo', 4, 'plays');

  it('follow suit: 9H led, hold KS, AH, 3H → play:AH, play:3H', () => {
    const s = withHand(
      state,
      {
        hands: [[], cards('KS AH 3H'), [], []],
        bids: [1, 1, 1, 0],
        currentTrick: { leader: 0, plays: trick(0, '9H') },
        toAct: 1,
      },
      'playing',
    );
    const moves = legalMoves(s, 1);
    expect(moves.map((m) => m.id)).toEqual(['play:AH', 'play:3H']);
    expect(moves[0]).toEqual({
      id: 'play:AH',
      move: { type: 'play', seat: 1, card: cards('AH')[0] },
    });
    // Moves hold copies, not the state's own card objects.
    expect(moves[0].move.type === 'play' && moves[0].move.card).not.toBe(s.hand?.hands[1][1]);
  });

  it('empty trick → every card in hand order, ids use cardId (play:10S)', () => {
    const s = withHand(
      state,
      { hands: [[], cards('10S 2S QH 5D'), [], []], bids: [1, 1, 1, 0], toAct: 1 },
      'playing',
    );
    expect(ids(s, 1)).toEqual(['play:10S', 'play:2S', 'play:QH', 'play:5D']);
  });
});

describe('VC-234 ENGINE_VERSION', () => {
  it('is the number 1', () => {
    expect(ENGINE_VERSION).toBe(1);
    expect(typeof ENGINE_VERSION).toBe('number');
  });
});
