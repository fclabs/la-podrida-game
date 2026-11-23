// The card-conservation ledger fails loudly on corruption (spec 04 FR-415; VC-412).
import { describe, expect, it } from 'vitest';
import type { Transition } from '@/src/domain/types';
import { playSimGame, type SimGame } from './harness';
import { createLedger, LedgerError } from './ledger';

/** A recorded all-AI gamerules 3-player game (P-4 input), played without checks. */
const game: SimGame = playSimGame('gamerules', 3, 'ledger-seed', { check: false });

/** The hand whose deal or first play is corrupted (not hand 0, so the name is meaningful). */
const TARGET_HAND = 2;

/** Feeds `game` to a fresh ledger, with transition `k` replaced by `alter(k, transition)`. */
function feed(alter: (k: number, transition: Transition) => Transition = (_k, t) => t): void {
  const ledger = createLedger();
  ledger.openHand(game.initial);
  game.steps.forEach(({ transition }, k) => ledger.onTransition(alter(k, transition)));
}

/** Index of the step whose events contain `hand-dealt` for `TARGET_HAND`. */
const dealStep = game.steps.findIndex(({ transition }) =>
  transition.events.some((e) => e.type === 'hand-dealt' && e.handIndex === TARGET_HAND),
);

/** Index of the first step of `TARGET_HAND` that plays a card. */
const playStep = game.steps.findIndex(
  ({ prev, transition }) =>
    prev.handIndex === TARGET_HAND && transition.events.some((e) => e.type === 'card-played'),
);

describe('VC-412 the ledger', () => {
  it('accepts the recorded game unaltered', () => {
    expect(dealStep).toBeGreaterThan(0);
    expect(playStep).toBeGreaterThan(dealStep);
    expect(() => feed()).not.toThrow();
  });

  it('rejects a card-played event whose card is not in that seat hand, naming the hand', () => {
    const { prev } = game.steps[playStep];
    const corrupt = (k: number, transition: Transition): Transition => {
      if (k !== playStep) return transition;
      const altered = structuredClone(transition);
      const event = altered.events.find((e) => e.type === 'card-played');
      if (event?.type !== 'card-played') throw new Error('no card-played event');
      // A card still held by another seat: in the dealt set, never in the player's hand.
      const other = (event.seat + 1) % prev.seats.length;
      event.card = { ...prev.hand!.hands[other][0] };
      return altered;
    };
    expect(() => feed(corrupt)).toThrow(LedgerError);
    expect(() => feed(corrupt)).toThrow(
      new RegExp(`^ledger: hand ${TARGET_HAND}: card \\S+ played`),
    );
  });

  it('rejects a card-played event whose card was never dealt, naming the hand', () => {
    const { prev } = game.steps[playStep];
    const corrupt = (k: number, transition: Transition): Transition => {
      if (k !== playStep) return transition;
      const altered = structuredClone(transition);
      const event = altered.events.find((e) => e.type === 'card-played');
      if (event?.type !== 'card-played') throw new Error('no card-played event');
      event.card = { ...prev.hand!.trumpCard }; // gamerules 3p hand 2 has a stock trump card
      return altered;
    };
    expect(prev.hand!.trumpCardInDealerHand).toBe(false);
    expect(() => feed(corrupt)).toThrow(
      new RegExp(`^ledger: hand ${TARGET_HAND}: card \\S+ played by seat \\d was not dealt`),
    );
  });

  it('rejects a hand-dealt state with a duplicated card, naming the hand', () => {
    const corrupt = (k: number, transition: Transition): Transition => {
      if (k !== dealStep) return transition;
      const altered = structuredClone(transition);
      const hands = altered.state.hand!.hands;
      hands[1][0] = { ...hands[0][0] };
      return altered;
    };
    expect(() => feed(corrupt)).toThrow(LedgerError);
    expect(() => feed(corrupt)).toThrow(
      new RegExp(`^ledger: hand ${TARGET_HAND}: card \\S+ dealt twice`),
    );
  });

  it('rejects a duplicated card in the hand-0 deal, naming hand 0', () => {
    const initial = structuredClone(game.initial);
    initial.hand!.hands[2][0] = { ...initial.hand!.hands[1][0] };
    expect(() => createLedger().openHand(initial)).toThrow(/^ledger: hand 0: card \S+ dealt twice/);
  });
});
