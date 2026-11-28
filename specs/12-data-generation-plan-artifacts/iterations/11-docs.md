# Iteration 11 — Documentation and final verification

Commit: see `git log -1` (message `Phase 12: document data generation and record measured figures`). Only docs, README and artifacts changed.

## Criteria
- PASS FR-1224 / VC-1231: `grep -n "generate-data" docs/development.md README.md` lists the heading `## 19. Data generation: \`pnpm generate-data\``
  (development.md:2470, both subcommands and every option in §19.2/§19.3) and the README row (README.md:35). `docs/__future__/data-generation.md`
  §4.4 states 26,179 B/game (2,617.9 MB for 100,000 games; 26,224 B/game at 1,000 games) and §5.1 states 44.0 ms/game (72.1 ms for 3 players),
  650 s for the full run; status line says phases 1-2 are implemented. File is staged by explicit path.
- PASS standalone: `sed -n '2470,2769p' docs/development.md | grep -nE "iteration|VC-12|FR-12|BR-12|NFR-12|plan\.md|plan-artifacts|specs/12|spec 12|Iteration"`
  prints nothing (checked only the new section; rest of the document untouched). The same pattern on the added lines of README.md and
  docs/architecture.md prints nothing; the proposal's edited lines carry none (its pre-existing `specs/04-players-frozen.md` stays).
- PASS decisions mapping: see below (every D-001..D-029 is "docs" or "internal").
- PASS commands run: temp dir under the scratchpad. `run --run-id doc-check --games 20 --shard-size 10` exit 0 (summary quoted in §19.2);
  `validate` exit 0 `status: OK` (report quoted in §19.3); deleted `shard-00001.hands...gz`, same `run` command: exit 0, `1 skipped`;
  `--shard-size 5` -> `generate-data: run "doc-check" has a different shard-size`, exit 1; `validate --run-id nope` -> `no run "nope" in <out>`, exit 1;
  non-empty dir without manifest -> `exists without a manifest`, exit 1; `--run-id eval-1` -> exit 1; hook example
  (`GENERATE_DATA_TEST_HOOKS=tests/unit/datagen/fixtures/hooks-configurable.ts HOOK_FAIL_SEED=t-1-0 HOOK_MODE=not-game-over`, 30 games, shard size 10):
  exit 1, `2 complete (0 skipped, 1 failed)`, manifest `failed` with `seed: t-1-0`, `validate` -> `INCOMPLETE` exit 1, rerun without hook -> `3 complete (2 skipped)` exit 0.
  Unparsable manifest (`{`) -> `SyntaxError` stack trace (documented as a limitation). `gunzip -c ... | wc -l` works as written.
- PASS cross-references: `grep -rn "§19" docs README.md | grep -v "§19\.[0-9]"` shows only the new section's heading and the new references
  (the layout line in §2 and the proposal's status line). The one old reference (§18.9, "Blob's list order") now says §20; the limitations
  index sentence of §20 gained "data generation limitations in §19.11".
- PASS lint/typecheck: `pnpm typecheck` ok; `pnpm lint` ok (ESLint and `prettier --check .`). Prettier ignores `docs/` and `specs/`
  (`.prettierignore`), so only README.md was checked/formatted (its command table was re-aligned by `prettier --write`).
- PASS isolation: `git diff --stat af777e04..HEAD -- src app` empty.
- PASS artifacts: this record; `CONTEXT.md` final (299 lines); `DECISIONS.md` 29 entries + two "no new decisions" notes, no `D-?`.
- Not run here (orchestrator): full suite, `verify-spec`.

## Decision mapping
docs: D-002 D-003 D-004 D-005 D-010 D-011 D-014 D-015 D-018 D-019 D-020 D-021 D-022 D-024 D-026 D-027 D-028 D-029 (D-001 in §19.10 as `runCli`)
internal: D-006 D-007 D-008 D-009 D-012 D-013 (superseded) D-016 (superseded) D-017 D-023 D-025

## Files
Changed: `docs/development.md` (new `## 19. Data generation: pnpm generate-data` with 19.1-19.11; Known limitations renumbered `## 20`; layout
line in §2; limitations index sentence), `README.md` (command row), `docs/architecture.md` (scripts tree line),
`docs/__future__/data-generation.md` (added to git: status, §4.4, §5.1, §5 tree), `CONTEXT.md`, `DECISIONS.md`. Added: this record.
`docs/implementation.md` left unchanged: it is the MVP phase plan, and the generator is outside the MVP phases.

## Deviations
- Extra small doc edits beyond the named ones: the §2 layout line, the §20 limitations index, the architecture tree line, and the proposal's §5 tree.

## Gotchas
- The new section is exactly 300 lines (upper end of the requested range).
