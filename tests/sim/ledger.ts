// Card-conservation ledger for simulated games (spec 04 FR-415). Not collected: no `.test.ts`.
import { cardId } from '@/src/domain/cards';
import { buildDeck } from '@/src/domain/decks';
import type { GameState, Transition } from '@/src/domain/types';

/** Thrown when the ledger finds a card that was not conserved. The message names the hand. */
export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/** The ledger of one game. Feed it the `createGame` state, then every transition in order. */
export interface Ledger {
  /** Opens the hand dealt in `state` (hand 0 from the `createGame` state) and checks the deal. */
  openHand(state: GameState): void;
  /** Processes `transition.events` in order, then checks conservation on `transition.state`. */
  onTransition(transition: Transition): void;
  /** (cards still in hands) ∪ (cards played in the open hand) = the dealt set, no card twice. */
  check(state: GameState): void;
}

interface OpenHand {
  handIndex: number;
  /** Every dealt card id → the seat it was dealt to. */
  dealtTo: Map<string, number>;
  /** Card ids played so far in this hand. */
  played: Set<string>;
}

/**
 * A new ledger. Every check failure throws `LedgerError` with a message starting
 * `ledger: hand <k>: ` (or `ledger: ` when no hand is open).
 */
export function createLedger(): Ledger {
  let open: OpenHand | null = null;
  let over = false;

  function fail(problem: string, handIndex = open?.handIndex): never {
    throw new LedgerError(
      handIndex === undefined ? `ledger: ${problem}` : `ledger: hand ${handIndex}: ${problem}`,
    );
  }

  function openHand(state: GameState): void {
    const hand = state.hand;
    if (hand === null) fail(`state at handIndex ${state.handIndex} has no hand to open`);
    const handIndex = state.handIndex;
    const n = state.seats.length;
    const deckIds = new Set(buildDeck(state.rules.deck, n).map(cardId));

    const dealtTo = new Map<string, number>();
    hand.hands.forEach((cards, seat) => {
      for (const c of cards) {
        const id = cardId(c);
        if (dealtTo.has(id)) {
          fail(`card ${id} dealt twice (seats ${dealtTo.get(id)} and ${seat})`, handIndex);
        }
        if (!deckIds.has(id)) fail(`dealt card ${id} is not in the deck`, handIndex);
        dealtTo.set(id, seat);
      }
    });
    const expected = n * hand.cardsPerPlayer;
    if (dealtTo.size !== expected) {
      fail(`dealt ${dealtTo.size} cards, expected ${n} × ${hand.cardsPerPlayer}`, handIndex);
    }
    const trump = cardId(hand.trumpCard);
    if (!deckIds.has(trump)) fail(`trump card ${trump} is not in the deck`, handIndex);
    if (dealtTo.has(trump) !== hand.trumpCardInDealerHand) {
      fail(
        `trump card ${trump} is ${dealtTo.has(trump) ? '' : 'not '}dealt, but ` +
          `trumpCardInDealerHand is ${hand.trumpCardInDealerHand}`,
        handIndex,
      );
    }
    open = { handIndex, dealtTo, played: new Set() };
  }

  function check(state: GameState): void {
    if (open === null) fail('no open hand to check');
    const { dealtTo, played } = open;
    if (state.hand === null) fail('state has no hand');
    if (state.handIndex !== open.handIndex) {
      fail(`state is at handIndex ${state.handIndex}, but the open hand is ${open.handIndex}`);
    }
    const seen = new Set(played);
    for (const cards of state.hand.hands) {
      for (const c of cards) {
        const id = cardId(c);
        if (!dealtTo.has(id)) fail(`card ${id} is in a hand but was not dealt`);
        if (seen.has(id)) fail(`card ${id} is counted twice (held and played, or held twice)`);
        seen.add(id);
      }
    }
    if (seen.size !== dealtTo.size) {
      const missing = [...dealtTo.keys()].filter((id) => !seen.has(id));
      fail(`cards missing from hands and plays: ${missing.join(' ')}`);
    }
  }

  function onTransition(transition: Transition): void {
    if (over) return;
    let dealt = false;
    for (const event of transition.events) {
      switch (event.type) {
        case 'card-played': {
          if (open === null) fail(`card-played by seat ${event.seat} with no open hand`);
          const id = cardId(event.card);
          const owner = open.dealtTo.get(id);
          if (owner === undefined) fail(`card ${id} played by seat ${event.seat} was not dealt`);
          if (owner !== event.seat) {
            fail(`card ${id} played by seat ${event.seat} was dealt to seat ${owner}`);
          }
          if (open.played.has(id)) fail(`card ${id} played twice`);
          open.played.add(id);
          break;
        }
        case 'hand-completed': {
          if (open === null) fail(`hand-completed for hand ${event.handIndex} with no open hand`);
          if (event.handIndex !== open.handIndex) {
            fail(`hand-completed names hand ${event.handIndex}`);
          }
          if (open.played.size !== open.dealtTo.size) {
            const { played } = open;
            const unplayed = [...open.dealtTo.keys()].filter((id) => !played.has(id));
            fail(`hand completed with unplayed cards: ${unplayed.join(' ')}`);
          }
          open = null;
          break;
        }
        case 'hand-dealt': {
          if (open !== null) fail(`hand ${event.handIndex} dealt before this hand completed`);
          if (transition.state.handIndex !== event.handIndex) {
            fail(
              `hand-dealt names hand ${event.handIndex}, state is at ${transition.state.handIndex}`,
              event.handIndex,
            );
          }
          openHand(transition.state);
          dealt = true;
          break;
        }
        case 'game-over': {
          if (open !== null) fail('game over with the hand still open');
          over = true;
          return;
        }
        default:
          break;
      }
    }
    if (!dealt && transition.state.hand !== null) check(transition.state);
  }

  return { openHand, onTransition, check };
}
