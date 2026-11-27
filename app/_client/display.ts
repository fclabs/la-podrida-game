import type { GameEvent, PlayerView } from '@/src/domain/types';

type Card = PlayerView['yourHand'][number];
type Seat = PlayerView['seats'][number];
type Play = PlayerView['currentTrick'][number];

/** The hand banner of FR-921: each seat's bid and tricks from a `hand-completed` result. */
export interface Banner {
  handIndex: number;
  perSeat: { seat: number; bid: number; tricks: number }[];
}

/** What the table renders while events play (FR-920): the table-view fields plus event state. */
export interface DisplayModel {
  seats: Seat[];
  handIndex: number;
  handPlan: number[];
  dealer: number;
  trumpCard: Card | null;
  trumpCardInDealerHand: boolean;
  yourHand: Card[];
  currentTrick: Play[];
  lastTrick: { winner: number; plays: Play[] } | null;
  you: number | null;
  banner: Banner | null;
  /** The seat of the last `bid-made` / `card-played` / `trick-won` event, else null (FR-924). */
  highlightSeat: number | null;
  /** False until the first `hand-dealt` of an empty table (header and dealer marker hidden). */
  dealt: boolean;
}

/** The display model that equals `view` (the shown view when no event is playing). */
export function viewToDisplay(view: PlayerView): DisplayModel {
  return {
    seats: view.seats.map((s) => ({ ...s })),
    handIndex: view.handIndex,
    handPlan: [...view.handPlan],
    dealer: view.dealer,
    trumpCard: view.trumpCard,
    trumpCardInDealerHand: view.trumpCardInDealerHand,
    yourHand: [...view.yourHand],
    currentTrick: view.currentTrick.map((p) => ({ ...p })),
    lastTrick: view.lastTrick
      ? { winner: view.lastTrick.winner, plays: view.lastTrick.plays.map((p) => ({ ...p })) }
      : null,
    you: view.you,
    banner: null,
    highlightSeat: null,
    dealt: true,
  };
}

/** FR-920 empty start (201 update): seats from `view`, nothing dealt yet. */
export function emptyTable(view: PlayerView): DisplayModel {
  return {
    seats: view.seats.map((s) => ({ ...s, cardCount: 0, bid: null, tricksWon: 0 })),
    handIndex: view.handIndex,
    handPlan: [...view.handPlan],
    dealer: view.dealer,
    trumpCard: null,
    trumpCardInDealerHand: false,
    yourHand: [],
    currentTrick: [],
    lastTrick: null,
    you: view.you,
    banner: null,
    highlightSeat: null,
    dealt: false,
  };
}

function mapSeat(seats: Seat[], seat: number, f: (s: Seat) => Seat): Seat[] {
  return seats.map((s) => (s.seat === seat ? f(s) : s));
}

/** FR-921 / FR-922: the effect of one event on the display model. `target` is the adopted view. */
export function applyEvent(
  model: DisplayModel,
  event: GameEvent,
  target: PlayerView,
): DisplayModel {
  switch (event.type) {
    case 'game-started':
    case 'game-over':
      return { ...model, highlightSeat: null };
    case 'hand-dealt':
      return {
        ...model,
        seats: model.seats.map((s) => ({
          ...s,
          cardCount: event.cardsPerPlayer,
          bid: null,
          tricksWon: 0,
        })),
        handIndex: event.handIndex,
        dealer: event.dealer,
        trumpCard: event.trumpCard,
        trumpCardInDealerHand: event.trumpCardInDealerHand,
        yourHand: [...target.yourHand],
        currentTrick: [],
        lastTrick: null,
        banner: null,
        highlightSeat: null,
        dealt: true,
      };
    case 'bid-made':
      return {
        ...model,
        seats: mapSeat(model.seats, event.seat, (s) => ({ ...s, bid: event.tricks })),
        highlightSeat: event.seat,
      };
    case 'card-played': {
      const played = event.card;
      const fromHuman = model.you !== null && event.seat === model.you;
      let removed = false;
      return {
        ...model,
        seats: mapSeat(model.seats, event.seat, (s) => ({ ...s, cardCount: s.cardCount - 1 })),
        currentTrick: [...model.currentTrick, { seat: event.seat, card: played }],
        yourHand: fromHuman
          ? model.yourHand.filter((c) => {
              if (!removed && c.suit === played.suit && c.rank === played.rank) {
                removed = true;
                return false;
              }
              return true;
            })
          : model.yourHand,
        highlightSeat: event.seat,
      };
    }
    case 'trick-won':
      return {
        ...model,
        seats: mapSeat(model.seats, event.seat, (s) => ({ ...s, tricksWon: s.tricksWon + 1 })),
        lastTrick: { winner: event.seat, plays: model.currentTrick },
        currentTrick: [],
        highlightSeat: event.seat,
      };
    case 'hand-completed':
      return {
        ...model,
        banner: {
          handIndex: event.handIndex,
          perSeat: event.result.bids.map((bid, seat) => ({
            seat,
            bid,
            tricks: event.result.tricks[seat] ?? 0,
          })),
        },
        highlightSeat: null,
      };
  }
}

/** FR-921 delay held after an event starts. */
export function eventDelayMs(event: GameEvent): number {
  switch (event.type) {
    case 'game-started':
    case 'game-over':
      return 0;
    case 'hand-dealt':
    case 'bid-made':
    case 'card-played':
      return 600;
    case 'trick-won':
    case 'hand-completed':
      return 1200;
  }
}
