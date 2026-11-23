import { cardId, type Card } from '@/src/domain/cards';
import { buildDeck } from '@/src/domain/decks';
import type { GameState, HandState } from '@/src/domain/types';
import { legalMoves } from './engine';

/**
 * Checks the game's invariants (spec FR-239, design §5.6) and returns one human-readable message
 * per violation, or `[]` for a valid state. Every message starts with its rule tag — `(s)` for the
 * structural checks, `(a)` … `(i)` for the rules — followed by the offending values.
 *
 * With `N = seats.length`, the structural checks run first: `handIndex < handPlan.length`, and,
 * when `hand` is non-null, `hand.hands` / `hand.bids` / `hand.tricksWon` of length N and
 * `hand.toAct` / `hand.dealer` / `hand.currentTrick.leader` in `0 … N − 1`. If any fails, it is
 * reported and (a)–(i) are skipped. Then:
 *
 * - (a) no card twice across all hands and the current trick;
 * - (b) every such card belongs to `buildDeck(rules.deck, N)`;
 * - (c) each seat holds `cardsPerPlayer` − completed tricks (sum of `tricksWon`) − (1 if it has
 *   played to the current trick) cards;
 * - (d) in `playing`, every bid is set;
 * - (e) in `playing`, on a hand where the dealer restriction applies, the sum of bids ≠
 *   `cardsPerPlayer` (checked only when every bid is set; a missing bid is (d));
 * - (f) `legalMoves(state, toAct)` is non-empty while the game is not over — skipped when (a) or
 *   (b) failed, and when `cardsPerPlayer` exceeds the deck size (no real hand can, and listing
 *   that many bids would not fit in memory);
 * - (g) `hand` is `null` iff `phase === 'game-over'`;
 * - (h) `hand.cardsPerPlayer === handPlan[handIndex]`;
 * - (i) `completedHands.length` is `handIndex` before game over, `handPlan.length` at game over.
 *
 * (a)–(f) and (h) run only when `hand` is non-null. Pure: no I/O, never mutates `state`, and never
 * throws for a state that parses with `GameStateSchema` (spec FR-240) — the guards above make sure
 * no check runs on data it cannot handle.
 */
export function checkInvariants(state: GameState): string[] {
  const structural = structuralProblems(state);
  if (structural.length > 0) return structural;

  const problems: string[] = [];
  const hand = state.hand;
  const gameOver = state.phase === 'game-over';

  if (hand !== null) {
    const cardProblems = cardChecks(state, hand);
    problems.push(...cardProblems);
    problems.push(...handSizeChecks(hand));
    if (state.phase === 'playing') problems.push(...bidChecks(state, hand));
    if (!gameOver && cardProblems.length === 0) {
      const deckSize = buildDeck(state.rules.deck, state.seats.length).length;
      if (hand.cardsPerPlayer <= deckSize && legalMoves(state, hand.toAct).length === 0) {
        problems.push(`(f) seat ${hand.toAct} to act has no legal move in phase ${state.phase}`);
      }
    }
  }

  if ((hand === null) !== gameOver) {
    problems.push(
      hand === null
        ? `(g) hand is null while phase is ${state.phase}`
        : `(g) hand is not null while phase is game-over`,
    );
  }

  if (hand !== null && hand.cardsPerPlayer !== state.handPlan[state.handIndex]) {
    problems.push(
      `(h) hand.cardsPerPlayer is ${hand.cardsPerPlayer}, but handPlan[${state.handIndex}] is ` +
        `${state.handPlan[state.handIndex]}`,
    );
  }

  const expectedCompleted = gameOver ? state.handPlan.length : state.handIndex;
  if (state.completedHands.length !== expectedCompleted) {
    problems.push(
      `(i) completedHands has ${state.completedHands.length} entries, expected ` +
        (gameOver
          ? `${expectedCompleted} (handPlan.length) at game-over`
          : `${expectedCompleted} (handIndex) in phase ${state.phase}`),
    );
  }

  return problems;
}

/** The (s) checks: everything the other checks index by must be in range. */
function structuralProblems(state: GameState): string[] {
  const n = state.seats.length;
  const problems: string[] = [];
  if (state.handIndex >= state.handPlan.length) {
    problems.push(
      `(s) handIndex ${state.handIndex} is not below handPlan.length ${state.handPlan.length}`,
    );
  }
  const hand = state.hand;
  if (hand !== null) {
    for (const key of ['hands', 'bids', 'tricksWon'] as const) {
      if (hand[key].length !== n) {
        problems.push(`(s) hand.${key} has length ${hand[key].length}, expected ${n} (seats)`);
      }
    }
    const seatFields: [string, number][] = [
      ['hand.toAct', hand.toAct],
      ['hand.dealer', hand.dealer],
      ['hand.currentTrick.leader', hand.currentTrick.leader],
    ];
    for (const [name, seat] of seatFields) {
      if (!Number.isInteger(seat) || seat < 0 || seat >= n)
        problems.push(`(s) ${name} is ${seat}, outside seats 0–${n - 1}`);
    }
  }
  return problems;
}

/** (a) and (b): duplicate cards and cards outside the game's deck, each distinct id reported once. */
function cardChecks(state: GameState, hand: HandState): string[] {
  const all: Card[] = [...hand.hands.flat(), ...hand.currentTrick.plays.map((play) => play.card)];
  const counts = new Map<string, number>();
  for (const c of all) counts.set(cardId(c), (counts.get(cardId(c)) ?? 0) + 1);

  const deckIds = new Set(buildDeck(state.rules.deck, state.seats.length).map(cardId));
  const problems: string[] = [];
  for (const [id, count] of counts) {
    if (count > 1) {
      problems.push(`(a) card ${id} appears ${count} times across the hands and the current trick`);
    }
  }
  for (const id of counts.keys()) {
    if (!deckIds.has(id)) {
      problems.push(
        `(b) card ${id} is not in the ${state.rules.deck.id} deck for ${state.seats.length} players`,
      );
    }
  }
  return problems;
}

/** (c): each seat's hand size. */
function handSizeChecks(hand: HandState): string[] {
  const completed = hand.tricksWon.reduce((sum, t) => sum + t, 0);
  const problems: string[] = [];
  hand.hands.forEach((cards, seat) => {
    const played = hand.currentTrick.plays.some((play) => play.seat === seat) ? 1 : 0;
    const expected = hand.cardsPerPlayer - completed - played;
    if (cards.length !== expected) {
      problems.push(
        `(c) seat ${seat} holds ${cards.length} cards, expected ${expected} ` +
          `(cardsPerPlayer ${hand.cardsPerPlayer} − ${completed} completed tricks − ${played} ` +
          `played to the current trick)`,
      );
    }
  });
  return problems;
}

/** (d) and (e), for a hand in `playing`. */
function bidChecks(state: GameState, hand: HandState): string[] {
  const problems: string[] = [];
  const missing = hand.bids.flatMap((bid, seat) => (bid === null ? [seat] : []));
  for (const seat of missing) problems.push(`(d) seat ${seat} has no bid in phase playing`);

  const { dealerRestriction, dealerRestrictionExemptCardCounts } = state.rules.bidding;
  const applies =
    dealerRestriction && !dealerRestrictionExemptCardCounts.includes(hand.cardsPerPlayer);
  if (applies && missing.length === 0) {
    const sum = hand.bids.reduce<number>((total, bid) => total + (bid ?? 0), 0);
    if (sum === hand.cardsPerPlayer) {
      problems.push(
        `(e) bids sum to ${sum} = cardsPerPlayer after bidding closed (dealer restriction applies)`,
      );
    }
  }
  return problems;
}
