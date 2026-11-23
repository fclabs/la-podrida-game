import { buildDeck, type DeckDefinition } from '@/src/domain/decks';
import type { Bound, RuleSet } from '@/src/domain/rules';

/**
 * The most cards each player can be dealt: `floor(buildDeck(deck, players).length / players)`,
 * counting the deck after the ranks removed for `players` (spec FR-207).
 */
export function maxCardsPerPlayer(deck: DeckDefinition, players: number): number {
  return Math.floor(buildDeck(deck, players).length / players);
}

/** Resolves a card-count bound against `max` (spec FR-208). */
function resolveBound(bound: Bound, max: number): number {
  if (typeof bound === 'number') return bound;
  if (bound === 'max') return max;
  if ('min' in bound) return Math.min(bound.min[0], max);
  return max + bound.offset[1];
}

/**
 * Expands `rules.handSequence` for `players` into a new hand plan: the card count of every hand,
 * in order (spec FR-208, FR-209). A `range` yields every count from `from` to `to` inclusive in
 * steps of ±1; a `repeat` yields `cards` exactly `times` times (`'players'` → `players`).
 *
 * Throws `RangeError` naming the offending value when `players` is outside `rules.players`, or when
 * any expanded count is `< 1` or `> maxCardsPerPlayer(rules.deck, players)` (spec FR-210).
 */
export function expandHandSequence(rules: RuleSet, players: number): number[] {
  if (!Number.isInteger(players) || players < rules.players.min || players > rules.players.max) {
    throw new RangeError(
      `player count ${players} is outside ${rules.players.min}–${rules.players.max} for rule set ${rules.id}`,
    );
  }
  const max = maxCardsPerPlayer(rules.deck, players);
  const plan: number[] = [];
  for (const segment of rules.handSequence) {
    if (segment.kind === 'range') {
      const from = resolveBound(segment.from, max);
      const to = resolveBound(segment.to, max);
      const step = from <= to ? 1 : -1;
      for (let count = from; count !== to + step; count += step) plan.push(count);
    } else {
      const cards = resolveBound(segment.cards, max);
      const times = segment.times === 'players' ? players : segment.times;
      for (let i = 0; i < times; i++) plan.push(cards);
    }
  }
  for (const count of plan) {
    if (count < 1 || count > max) {
      throw new RangeError(
        `hand of ${count} cards is outside 1–${max} for ${players} players with rule set ${rules.id}`,
      );
    }
  }
  return plan;
}
