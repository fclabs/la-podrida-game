import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CardView } from '@/app/_client/card-view';
import { COPY } from '@/app/_client/copy';
import { viewToDisplay } from '@/app/_client/display';
import { Table } from '@/app/_client/table';
import { card, makeView } from './support/fixtures';

const handPlan = Array.from({ length: 28 }, (_, i) => (i === 2 ? 3 : 1));

function fixture() {
  return makeView({
    handIndex: 2,
    handPlan,
    dealer: 3,
    toAct: 1,
    trumpCard: card('9', 'H'),
    trumpCardInDealerHand: true,
    seats: [
      { seat: 0, name: 'Ana', kind: 'human', cardCount: 2, bid: 1, tricksWon: 1 },
      { seat: 1, name: 'Bot 1', kind: 'ai', cardCount: 2, bid: null, tricksWon: 0 },
      { seat: 2, name: 'Bot 2', kind: 'ai', cardCount: 2, bid: 0, tricksWon: 0 },
      { seat: 3, name: 'Bot 3', kind: 'ai', cardCount: 2, bid: 2, tricksWon: 0 },
    ],
    yourHand: [card('2', 'S'), card('K', 'D')],
    currentTrick: [{ seat: 0, card: card('10', 'S') }],
    lastTrick: {
      winner: 2,
      plays: [
        { seat: 2, card: card('A', 'H') },
        { seat: 3, card: card('3', 'C') },
      ],
    },
  });
}

describe('Table (VC-940, FR-925)', () => {
  it('renders every FR-925 element', () => {
    const view = fixture();
    const { container } = render(<Table model={viewToDisplay(view)} toAct={1} deck="french-52" />);

    expect(screen.getByText('Mano 3 de 28 · 3 cartas')).toBeTruthy();
    expect(COPY.handLine(2, 28, 3)).toBe('Mano 3 de 28 · 3 cartas');

    const seat = (n: number) => container.querySelector<HTMLElement>(`[data-seat="${n}"]`)!;
    expect(within(seat(0)).getByText(`Ana ${COPY.you}`)).toBeTruthy();
    expect(within(seat(1)).queryByText(COPY.you, { exact: false })).toBeNull();
    expect(within(seat(0)).getByText(`${COPY.seatCards}: 2`)).toBeTruthy();
    expect(within(seat(0)).getByText(`${COPY.seatBid}: 1`)).toBeTruthy();
    expect(within(seat(0)).getByText(`${COPY.seatTricks}: 1`)).toBeTruthy();
    expect(within(seat(1)).getByText(`${COPY.seatBid}: ${COPY.noBid}`)).toBeTruthy();

    // Dealer marker on seat 3 only; turn marker on seat 1 only.
    expect(within(seat(3)).getByText(COPY.dealerMarker)).toBeTruthy();
    expect(screen.getAllByText(COPY.dealerMarker)).toHaveLength(1);
    expect(within(seat(1)).getByText(COPY.turnMarker)).toBeTruthy();
    expect(screen.getAllByText(COPY.turnMarker)).toHaveLength(1);

    // Trump card, flagged as in the dealer's hand.
    expect(screen.getByText(COPY.trumpInDealerHand)).toBeTruthy();
    expect(screen.getAllByRole('img', { name: '9 de corazones' })).toHaveLength(1);

    // Current trick with the seat of each card; last trick with its winner.
    const current = screen.getByText(COPY.currentTrickLabel).parentElement!;
    expect(within(current).getByText('Ana')).toBeTruthy();
    expect(within(current).getByRole('img', { name: '10 de picas' })).toBeTruthy();
    const last = screen.getByText(COPY.lastTrickLabel).parentElement!;
    expect(within(last).getByText(COPY.lastTrickWinner('Bot 2'))).toBeTruthy();
    expect(within(last).getByRole('img', { name: 'As de corazones' })).toBeTruthy();
    expect(within(last).getByRole('img', { name: '3 de tréboles' })).toBeTruthy();

    // The human's hand.
    const hand = screen.getByText(COPY.yourHandLabel).parentElement!;
    expect(
      within(hand)
        .getAllByRole('img')
        .map((e) => e.getAttribute('aria-label')),
    ).toEqual(['2 de picas', 'Rey de diamantes']);
  });

  it('omits the trump flag, the last trick and the turn marker when they do not apply', () => {
    const view = makeView({ lastTrick: null, trumpCardInDealerHand: false });
    render(<Table model={viewToDisplay(view)} toAct={null} deck="french-52" />);
    expect(screen.queryByText(COPY.trumpInDealerHand)).toBeNull();
    expect(screen.queryByText(COPY.lastTrickLabel)).toBeNull();
    expect(screen.queryByText(COPY.turnMarker)).toBeNull();
  });
});

describe('CardView (VC-944, render part)', () => {
  it('is a button with the accessible name when it has onClick', () => {
    render(<CardView card={card('10', 'S')} deck="french-52" onClick={() => {}} />);
    expect(screen.getByRole('button', { name: '10 de picas' })).toBeTruthy();
  });

  it('is a non-interactive element with the name otherwise; spanish names follow the deck', () => {
    render(<CardView card={card('R', 'C')} deck="spanish-40" />);
    expect(screen.getByRole('img', { name: 'Rey de copas' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
