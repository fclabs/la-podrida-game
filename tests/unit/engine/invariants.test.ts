// Game-state invariants (spec 02 FR-239, FR-240; VC-233).
import { describe, expect, it } from 'vitest';
import { InvalidCardError, cardId } from '@/src/domain/cards';
import type { PresetId } from '@/src/domain/rules';
import { GameStateSchema } from '@/src/domain/schemas';
import type { GameState } from '@/src/domain/types';
import { legalMoves } from '@/src/engine/engine';
import { checkInvariants } from '@/src/engine/invariants';
import { card, firstMove, lastMove, newGame, playGame, withHand, type PlayedGame } from './helpers';

const TAG = /^\(([sa-i])\) \S/;

/** The distinct rule tags (`'s'`, `'a'` … `'i'`) of `problems`, sorted. */
function tags(problems: string[]): string[] {
  return [...new Set(problems.map((p) => TAG.exec(p)?.[1] ?? '?'))].sort();
}

/** `checkInvariants(state)`, also asserting that the state is schema-valid and left unchanged. */
function check(state: GameState): string[] {
  expect(GameStateSchema.safeParse(state).success).toBe(true);
  const before = structuredClone(state);
  const problems = checkInvariants(state);
  expect(state).toEqual(before);
  for (const p of problems) expect(p).toMatch(TAG);
  return problems;
}

const games = new Map<string, PlayedGame>();
/** Memoised full game for `id` at `players` seats, played with `policy`. */
function game(id: PresetId, players = 3, policy: 'first' | 'last' = 'first'): PlayedGame {
  const key = `${id}/${players}/${policy}`;
  let g = games.get(key);
  if (g === undefined) {
    g = playGame(newGame(id, players), policy === 'first' ? firstMove : lastMove);
    games.set(key, g);
  }
  return g;
}

/** The first state of `g` matching `pred`, as a mutable clone. */
function stateWhere(g: PlayedGame, pred: (s: GameState) => boolean): GameState {
  const found = g.states.find(pred);
  if (found === undefined) throw new Error('no matching state');
  return structuredClone(found);
}

// argentina-fidepo 3p, hand 0 just dealt: 17 cards each, the trump card is the 52nd (stock) card.
const bidding = () => structuredClone(game('argentina-fidepo').states[0]);
// argentina-fidepo 3p, hand 0 in play with tricks completed and a trick in progress.
const playing = () =>
  stateWhere(
    game('argentina-fidepo'),
    (s) =>
      s.phase === 'playing' &&
      s.handIndex === 0 &&
      s.hand !== null &&
      s.hand.tricksWon.some((t) => t > 0) &&
      s.hand.currentTrick.plays.length === 1,
  );

describe('VC-233 valid games: every state passes', () => {
  it.each([
    ['argentina-fidepo', 'first'],
    ['spain-ludoteka', 'first'],
    ['gamerules', 'first'],
    ['mexico-bazas', 'first'],
    ['argentina-fidepo', 'last'],
    ['mexico-bazas', 'last'],
  ] as const)('%s at 3 players (%s legal move) → [] for every state', (id, policy) => {
    const g = game(id, 3, policy);
    expect(g.final.phase).toBe('game-over');
    for (const state of g.states) {
      const before = structuredClone(state);
      expect(checkInvariants(state)).toEqual([]);
      expect(state).toEqual(before);
    }
  });
});

describe('VC-233 mutations: each is reported and names its rule', () => {
  it('(a) the same card in two hands', () => {
    const s = bidding();
    s.hand!.hands[1][0] = { ...s.hand!.hands[0][0] };
    const problems = check(s);
    expect(tags(problems)).toEqual(['a']);
    expect(problems[0]).toContain(cardId(s.hand!.hands[0][0]));
  });

  it('(a) a card both in a hand and in the current trick', () => {
    const s = playing();
    const played = s.hand!.currentTrick.plays[0];
    const other = (played.seat + 1) % 3;
    s.hand!.hands[other][0] = { ...played.card };
    expect(tags(check(s))).toEqual(['a']);
  });

  it('(b) a Spanish card {O, 3} in a French-deck game', () => {
    const s = bidding();
    s.hand!.hands[2][0] = { suit: 'O', rank: '3' };
    const problems = check(s);
    expect(tags(problems)).toEqual(['b']);
    expect(problems[0]).toContain('3O');
  });

  it('(c) one seat with an extra card', () => {
    const s = bidding();
    s.hand!.hands[0].push({ ...s.hand!.trumpCard }); // the stock card: in the deck, in no hand
    const problems = check(s);
    expect(tags(problems)).toEqual(['c']);
    expect(problems[0]).toContain('seat 0 holds 18 cards, expected 17');
  });

  it('(d) a null bid in playing', () => {
    const s = playing();
    s.hand!.bids[1] = null;
    const problems = check(s);
    expect(tags(problems)).toEqual(['d']);
    expect(problems[0]).toContain('seat 1');
  });

  it('(e) the dealer bid makes the sum equal cardsPerPlayer after bidding closed', () => {
    const s = playing();
    const h = s.hand!;
    const others = h.bids.reduce<number>((t, b, seat) => (seat === h.dealer ? t : t + (b ?? 0)), 0);
    h.bids[h.dealer] = h.cardsPerPlayer - others;
    expect(h.bids[h.dealer]).toBeGreaterThanOrEqual(0);
    expect(tags(check(s))).toEqual(['e']);
  });

  it('(e) is not reported while bidding, nor on an exempt hand', () => {
    const s = bidding();
    s.hand!.bids = [s.hand!.cardsPerPlayer, 0, null]; // partial sums may equal cardsPerPlayer
    expect(tags(check(s))).not.toContain('e');

    const spain = stateWhere(
      game('spain-ludoteka'),
      (st) => st.phase === 'playing' && st.hand?.cardsPerPlayer === 1,
    );
    spain.hand!.bids = [1, 0, 0]; // 1-card hands are exempt in spain-ludoteka
    expect(tags(check(spain))).not.toContain('e');
  });

  it('(f) the seat to act has no legal move', () => {
    const s = playing();
    const toAct = s.hand!.toAct;
    s.hand!.hands[toAct] = [];
    expect(legalMoves(s, toAct)).toEqual([]);
    const problems = check(s);
    expect(tags(problems)).toEqual(['c', 'f']);
    expect(problems.find((p) => p.startsWith('(f)'))).toContain(`seat ${toAct}`);
  });

  it("(g) hand null while phase 'bidding'", () => {
    const s = bidding();
    s.hand = null;
    expect(tags(check(s))).toEqual(['g']);
  });

  it("(g) hand not null while phase 'game-over'", () => {
    const s = bidding();
    s.phase = 'game-over';
    expect(tags(check(s))).toContain('g');
  });

  it('(h) hand.cardsPerPlayer ≠ handPlan[handIndex]', () => {
    const s = bidding();
    s.hand!.cardsPerPlayer = 16;
    const problems = check(s);
    expect(tags(problems)).toEqual(['c', 'h']);
    expect(problems.find((p) => p.startsWith('(h)'))).toContain('handPlan[0] is 17');
  });

  it('(i) completedHands length off by one (mid-game and at game-over)', () => {
    const mid = stateWhere(game('mexico-bazas'), (st) => st.handIndex === 2);
    mid.completedHands.pop();
    expect(tags(check(mid))).toEqual(['i']);

    const over = structuredClone(game('mexico-bazas').final);
    over.completedHands.push(structuredClone(over.completedHands[0]));
    expect(tags(check(over))).toEqual(['i']);
  });

  it('(s) hand.toAct = N: reported alone, no throw, (f) skipped', () => {
    const s = bidding();
    s.hand!.toAct = 3;
    expect(() => legalMoves(s, 3)).toThrow(RangeError);
    const problems = check(s);
    expect(problems).toHaveLength(1);
    expect(tags(problems)).toEqual(['s']);
    expect(problems[0]).toContain('hand.toAct is 3');
  });

  it('(s) hand.bids of length N − 1', () => {
    const s = bidding();
    s.hand!.bids.pop();
    const problems = check(s);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('hand.bids has length 2, expected 3');
  });

  it.each([
    ['hands', (s: GameState) => s.hand!.hands.push([])],
    ['tricksWon', (s: GameState) => s.hand!.tricksWon.push(0)],
    ['dealer', (s: GameState) => (s.hand!.dealer = 5)],
    ['leader', (s: GameState) => (s.hand!.currentTrick.leader = 3)],
    ['handIndex', (s: GameState) => (s.handIndex = s.handPlan.length)],
  ])('(s) %s out of range → only (s)', (_, mutate) => {
    const s = bidding();
    mutate(s);
    expect(tags(check(s))).toEqual(['s']);
  });

  it('several violations at once are all reported', () => {
    const s = playing();
    s.hand!.bids[0] = null;
    s.completedHands.push(structuredClone(game('argentina-fidepo').final.completedHands[0]));
    s.hand!.hands[1][0] = { suit: 'O', rank: '3' };
    expect(tags(check(s))).toEqual(['b', 'd', 'i']);
  });
});

describe('VC-233 off-deck rank: (f) is skipped and nothing throws', () => {
  it("a French-deck state holding {suit:'H', rank:'R'}", () => {
    const g = newGame('argentina-fidepo', 3).state;
    // Seat 2 to act with RH and 9H on the table: listing its plays would rank 'R' and throw.
    const s = withHand(
      g,
      {
        cardsPerPlayer: g.handPlan[0],
        dealer: 2,
        hands: [[card('2C')], [card('3C')], [card('4H'), card('5C')]],
        bids: [0, 0, 0],
        tricksWon: [0, 0, 0],
        currentTrick: {
          leader: 0,
          plays: [
            { seat: 0, card: card('9H') },
            { seat: 1, card: { suit: 'H', rank: 'R' } },
          ],
        },
        toAct: 2,
      },
      'playing',
    );
    expect(() => legalMoves(s, 2)).toThrow(InvalidCardError);
    let problems: string[] = [];
    expect(() => (problems = check(s))).not.toThrow();
    expect(tags(problems)).toContain('b');
    expect(tags(problems)).not.toContain('f');
    expect(problems.find((p) => p.startsWith('(b)'))).toContain('RH');
  });
});

describe('FR-240 never throws on schema-valid oddities', () => {
  const base = () => bidding();
  it.each<[string, (s: GameState) => void]>([
    ['no seats, hand present', (s) => (s.seats = [])],
    [
      'no seats, game over',
      (s) => {
        s.seats = [];
        s.hand = null;
        s.phase = 'game-over';
      },
    ],
    [
      'cardsPerPlayer 2^32 matching the plan',
      (s) => {
        s.handPlan[0] = 2 ** 32;
        s.hand!.cardsPerPlayer = 2 ** 32;
      },
    ],
    [
      'trump suit outside the deck, playing',
      (s) => {
        s.phase = 'playing';
        s.hand!.trumpSuit = 'O';
      },
    ],
    [
      'unresolved full trick with a foreign seat',
      (s) => {
        s.phase = 'playing';
        s.hand!.currentTrick.plays = [0, 1, 2, 9].map((seat) => ({
          seat,
          card: s.hand!.hands[seat % 3].pop()!,
        }));
      },
    ],
    ['empty hand plan', (s) => (s.handPlan = [])],
    ['huge tricksWon', (s) => (s.hand!.tricksWon = [1e9, 0, 0])],
  ])('%s', (_, mutate) => {
    const s = base();
    mutate(s);
    let problems: string[] = [];
    expect(() => (problems = check(s))).not.toThrow();
    expect(problems.length).toBeGreaterThanOrEqual(0);
  });

  it('cardsPerPlayer above the deck size skips (f) instead of listing 2^32 + 1 bids', () => {
    const s = base();
    s.handPlan[0] = 2 ** 32;
    s.hand!.cardsPerPlayer = 2 ** 32;
    const problems = check(s);
    expect(tags(problems)).toEqual(['c']);
  });
});
