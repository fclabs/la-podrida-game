# Iteration 4 — Design doc alignment, developer docs and CI check (final)

- Commit: `Align design doc with the domain model and document it` (on `spec/01-domain-model`, parent `2d9be04`). Pushed to `origin` with the user's approval (relayed by the orchestrator); no PR opened.
- Environment: macOS, Node 26.13.1 locally (project declares 24), pnpm 10.15.1. CI runs Node 24.
- Carry-over from Iteration 3 applied: development.md §9.1 uses the CONTEXT.md "Domain export map"; the listed facts (`Phase = GameState['phase']`, hand-written score/view/player types, persistence types in Phase 6, shape-only `GameStateSchema`, `Exp*` update rule) are all in §9.4/§9.6.
- The branch also carries `2d9be04` (removal of the Phase 0 working spec files, keeping `specs/00-project-scaffold-frozen.md`); intentional, not touched here.

## Criteria results

| Criterion | Command | Result |
|---|---|---|
| VC-118 offset in §4.3 | `grep -n "offset" docs/design.md` | PASS — line 159 (`Bound` type), 166 (semantics), 177/179 (spain-ludoteka sequence) |
| VC-118 PresetId | `grep -n "PresetId" docs/design.md` | PASS — line 102 `type PresetId = …` declaration, line 105 `id: PresetId;` |
| VC-118 removeRanksForPlayers | `grep -n "removeRanksForPlayers" docs/design.md` | PASS — line 90 `removeRanksForPlayers: Record<string, Rank[]>;` (no `?`, `{}` when none) |
| VC-118 §4.2 table | `grep -n "^\| handSequence" docs/design.md` | PASS — `1→max−1, N×max, max−1→1` (spain-ludoteka), `3→6, N×7, 6→3` (mexico-bazas) |
| VC-118 four sequences | manual diff of design.md §4.3 against spec Preset values table and `src/domain/presets.ts` | PASS — segment-for-segment identical; hands-per-game table matches the spec's intended counts (re-derived by hand, e.g. spain 3p: 11+3+11 = 25) |
| VC-119 suite | `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm test:sim && pnpm build` | PASS — exit 0; ESLint 0 warnings, "All matched files use Prettier code style!", 10 files / 215 tests, sim "No test files found, exiting with code 0", build compiled |
| VC-119 dependencies | `node -e "console.log(Object.keys(require('./package.json').dependencies).join(', '))"` | PASS — `next, react, react-dom, zod` |
| VC-119 purity | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.' src/domain` | PASS — no matches (exit 1) |
| VC-119 CI | `git push -u origin spec/01-domain-model`; `gh run list --branch spec/01-domain-model`; `gh run watch <id>` | See "CI verification" below |
| Docs section exists | `grep -n "^## 9. Domain model" docs/development.md` | PASS — line 229, subsections 9.1–9.6 |
| No internal references | `grep -nE 'specs/\|VC-\|artifact' docs/development.md` | PASS — no matches (exit 1) |
| Every decision reflected or internal | manual check | PASS — D-001 (helper exports) §9.4; D-002 (`import type`) §9.5; D-003 (frozen decks) §9.2; D-004 (quoted input) §9.2; D-005 (prototype keys) §9.3; D-006 (clones, two `deepFreeze` copies) §9.3/§9.5; D-007 (`PresetIdSchema` single id source) §9.3; D-009 (non-empty `gameId`, known `trumpSuit`, `handPlan` ≥ 1) §9.4; D-010 (`Phase`, hand-written types) §9.4; D-011 (`Exp*` shapes) §9.4 "Changing a persisted shape"; D-012 this record. **Internal**: D-008 (VC-114 test-row placement and `players` refine path) |

## CI verification

Pending at the time of the main commit; recorded in the follow-up commit `Record Phase 1 CI verification results`.

## Files

Changed: `docs/design.md` (§4.1 `removeRanksForPlayers`; §4.2 `type PresetId`, `id: PresetId`, spain/mexico table cells; §4.3 `Bound` with `offset`, `max` definition, four preset sequences, hands-per-game table), `docs/development.md` (new §9 Domain model; Known limitations renumbered §10; §1 Zod row, §2 layout note and §10 "No game logic yet" corrected), `specs/01-domain-model-plan-artifacts/{CONTEXT.md,DECISIONS.md}`.
Added: `specs/01-domain-model-plan-artifacts/iterations/04-docs-ci.md`.

## Deviations

- Three small corrections in `docs/development.md` outside the new section (§1, §2, §10), because the domain made them false ("Zod … later the domain", "layer folders are empty", "No game code yet"). Recorded in D-012.
- design.md: beyond the required edits, §4.3 now defines `deckSize` as the deck after rank removal and gives a hands-per-game table (the plan asks for the sequences "with the intended hand counts"). The rest of design.md (incl. the gamerules `start→1→start` table cell) is unchanged.
- Decisions: D-012 (section placement) is mine.

## Gotchas

- README links `docs/development.md#5-configuration`; adding sections before §5 would break it (hence §9).
- `docs/` is excluded from Prettier, so `pnpm lint` does not check the Markdown; tables were checked by eye.

## For the next iteration (Phase 2)

- Read `docs/development.md` §9 and CONTEXT.md "Hand-off to Phase 2": import map, `getPreset` clones, frozen decks, `buildDeck` order, bound semantics (`offset` = max + n), and the hand counts the `handPlan` expansion must reproduce.
- `src/config.ts`'s preset list is synced with `PRESET_IDS` by review only.
