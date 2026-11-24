// Display labels of the rule presets (spec FR-811; plan P-9). A `Record` over `PresetId` makes the
// table exhaustive at compile time.
import type { PresetId } from '@/src/domain/rules';

/** The name and one-sentence description (1–200 characters) of every preset. */
export const PRESET_LABELS: Readonly<Record<PresetId, { name: string; description: string }>> =
  Object.freeze({
    'argentina-fidepo': {
      name: 'Argentina (F.I.DE.PO.)',
      description:
        'French 52-card deck; hands go down from the maximum to 5 cards, then one 4-card hand per player, then back up.',
    },
    'spain-ludoteka': {
      name: 'Spain (Ludoteka)',
      description:
        'Spanish 40-card deck; hands go up from 1 card to one below the maximum, then one maximum hand per player, then back down to 1.',
    },
    gamerules: {
      name: 'GameRules',
      description:
        'French 52-card deck; hands go down from 10 cards (or the maximum, if lower) to 1, then back up.',
    },
    'mexico-bazas': {
      name: 'Mexico (Bazas)',
      description:
        'French 52-card deck; hands go up from 3 to 6 cards, then one 7-card hand per player, then back down to 3.',
    },
  });
