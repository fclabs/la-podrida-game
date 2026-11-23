import { compareRanks, type Suit } from '@/src/domain/cards';
import type { DeckDefinition } from '@/src/domain/decks';
import type { TrickPlay } from '@/src/domain/types';

/**
 * The seat that wins a complete trick (spec FR-225): the seat of the highest trump played if any
 * trump was played, otherwise the seat of the highest card of the led suit (`plays[0].card.suit`).
 * Ranks compare by `compareRanks(deck, …)`. Returns a seat, never a play index. Throws
 * `RangeError` when `plays` is empty.
 */
export function trickWinner(
  plays: readonly TrickPlay[],
  trumpSuit: Suit,
  deck: DeckDefinition,
): number {
  if (plays.length === 0) throw new RangeError('trickWinner needs at least one play');
  const led = plays[0].card.suit;
  let best = plays[0];
  for (const play of plays.slice(1)) {
    const bestIsTrump = best.card.suit === trumpSuit;
    if (play.card.suit === trumpSuit) {
      if (!bestIsTrump || compareRanks(deck, play.card.rank, best.card.rank) > 0) best = play;
    } else if (
      !bestIsTrump &&
      play.card.suit === led &&
      compareRanks(deck, play.card.rank, best.card.rank) > 0
    ) {
      best = play;
    }
  }
  return best.seat;
}
