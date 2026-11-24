# Iteration 8: Documentation (final)

Commit: this commit, on `spec/09-ui`.

## Criteria results

| Criterion | Command | Result |
|---|---|---|
| VC-960 headings | `grep -n '^## 17. UI' docs/development.md` -> `2082:## 17. UI`; `grep -n '^## 18. Known limitations' docs/development.md` -> `2263:## 18. Known limitations` | PASS (one match each) |
| No `§17` still meaning Known limitations | `grep -rn '§17' docs README.md`: every hit is inside `development.md` and means the UI section (`§17.x`); none in README or other docs | PASS |
| §17 covers page and module map, slot, version guard and retry rules, display model, UI tests, manual play-through | read; sections 17.1, 17.2, 17.4, 17.5, 17.8, 17.9 | PASS |
| `docs/implementation.md` §5 decision 1 reads as decided | row 1: "Decided in Phase 9: default preset only ... sends `rulesPreset: defaultPresetId`" | PASS |
| No spec/plan/artifact reference | `grep -rn 'specs/09\|plan-artifacts\|09-ui-plan' docs README.md` printed nothing; `grep -rnE 'FR-[0-9]\|VC-[0-9]\|BR-[0-9]\|NFR-[0-9]\|D-0[0-9]{2}\|[Ii]teration [0-9]\|P-[0-9]' docs README.md` printed nothing | PASS |
| Documented commands run | `pnpm test`: 99 files + 1 skipped, 1707 tests + 30 skipped, ~9 s. `pnpm vitest run --project ui`: 21 files, 239 tests, ~5 s. `FILE_STORE_DIR=... pnpm dev`: `/` 200 with "Tu nombre" and "Empezar partida"; `/game/<id>` 200; `POST /api/games` 201; the server was killed (`pgrep -fl next` empty) | PASS |
| Every DECISIONS entry accounted for | table below | PASS |
| `pnpm typecheck`, `pnpm lint` (prettier included), `pnpm test`, `pnpm build` | run together | PASS x4 (build routes `/`, `/game/[id]`, 4 API routes) |

The LAN access with `DEV_ALLOWED_ORIGINS` was verified in Iteration 7 (header-based, localhost); not re-run here.

## Manual checks: pending the human

VC-950 (full game, 5 AIs, Chrome), VC-951 (reload mid-hand), VC-952 (offline retry A and B), VC-953 (375 px, both worst cases, tap targets), VC-954 (Firefox, Safari iOS over LAN IP) are NOT run and NOT claimed passed. Steps and result table: `MANUAL-CHECKS.md`. `§17.9` in the docs carries the same steps as a play-through.

## Files

- Changed: `docs/development.md` (new `## 17. UI`; old 17 is `## 18. Known limitations`; stale statements updated: toolchain row, layout tree and paragraph, tests table, "Two Vitest configs", the "No UI yet" limitation), `docs/implementation.md` (decision 1 decided; Phase 9 task 1 wording), `CONTEXT.md` (rewritten, final), this record.
- Added/deleted: none besides this record. `DECISIONS.md`: no new decision.

## Deviations

- `README.md` not touched (binding rule: only for renumbering; no reference needed renumbering). It still says the UI comes "in a later phase" and that `pnpm test` runs only three folders. Listed under Known gaps in `CONTEXT.md` for a follow-up.
- Extra edits in `docs/development.md` beyond §17/§18 (listed above) because they would otherwise contradict the shipped UI.

## DECISIONS accounting (reflected in `development.md` section, or internal)

| Entry | Where |
|---|---|
| D-001 two Vitest projects, no React plugin | §4 "Two Vitest configs", §17.8 |
| D-002 exact devDependency pins | §1, §17.8 (pinned dev deps listed) |
| D-003 in-process API | §17.8 |
| D-004 page structure | §17.1 |
| D-005 kept update under Strict Mode | §17.2, §17.10 |
| D-006 global CSS plus modules | §17.7 |
| D-007 `COPY` | §17.1, §17.6 |
| D-008 `Card` derived from `PlayerView` | §17.1 (layer rule) |
| D-009 abort raced against the call | §17.3 |
| D-010 4xx without body keeps status | §17.3 |
| D-011 timer deps typing (`clearTimeout(id: never)`) | internal |
| D-012 display model is a pure fold | §17.5 |
| D-013 version guard, capture, `isAnimated` | §17.1, §17.4 |
| D-014 shared fixtures | §17.8 |
| D-015 `ClientDeps` context | §17.1 |
| D-016 reducer state | §17.4, §17.5 (reducer shape itself internal) |
| D-017 in-memory slot | §17.2 |
| D-018 load deduplicated per attempt | §17.2, §17.10 |
| D-019, D-025 minimal copy | §17.6 |
| D-020 `fireEvent` under fake timers | §17.8 |
| D-021 `Table` optional `hand` node | internal |
| D-022 move pipeline actions and refs | §17.4 (behaviour); action names internal |
| D-023 no bid prompt, hand dimming | §17.6, §17.10 |
| D-024 `finished` keyed on adopted view | §17.4, §17.5 |
| D-026 queue and one timer per head | §17.5, §17.8 |
| D-027 filter page chrome buttons in tests | §17.8 |
| D-028 `allowedDevOrigins` / `DEV_ALLOWED_ORIGINS` | §17.9 |
| D-029 full-game test records one run | §17.8 |
| D-030 CSS conventions and static test | §17.7 |

## Gotchas

- `pnpm lint` runs prettier over `docs/`; write docs in the existing table style and run `pnpm prettier --check docs`.
- Shipped docs must stay free of spec, plan, requirement and iteration identifiers.

## For the human

- Run `MANUAL-CHECKS.md` and record the results. Update README.md's stale UI sentences. Then `verify-spec`.
