// Seeded all-AI simulation of the spain-ludoteka preset, every valid player count (spec 04 FR-413 to
// FR-417; VC-411). Tests are named "spain-ludoteka <players>p seed <i>"; see `./harness`.
import { defineSimTests } from './harness';

defineSimTests('spain-ludoteka');
