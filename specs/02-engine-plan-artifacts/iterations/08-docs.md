# Iteration 8 — Design and developer documentation

**Commit**: this commit ("Document the game engine in design and developer docs"). Previous: `3023965` (reconciliation of Iterations 6–7).

## Criteria results

| Criterion | Result | Command / evidence |
|---|---|---|
| VC-235 `JSON.stringify` | PASS | `grep -n "JSON.stringify" docs/design.md` → lines 252, 256 (§4.5 derivation + framing rationale). |
| VC-235 before the shuffle | PASS | `grep -n "before the shuffle\|before shuffling" docs/design.md` → lines 210 (§4.4), 258 (§4.5). |
| VC-235 sorted | PASS | `grep -n "sorted" docs/design.md` → line 263 (§4.5 "Dealing hand `i`"). |
| VC-235 Engine section | PASS | `grep -n "## 10. Engine" docs/development.md` → line 310. |
| VC-235 `ENGINE_VERSION` | PASS | `grep -c "ENGINE_VERSION" docs/development.md` → 5 (module map, §10.5 bump rule + golden tripwire). |
| VC-235 eight modules | PASS | `grep -c "@/src/engine/<m>\`" docs/development.md` for `rng sequence bidding play trick engine view invariants` → each ≥ 1 (§10.1 table). |
| `hand: null` at game-over (FR-242) | PASS | design.md §4.5 `GameState` comments and "Game over" paragraph (`hand` null, `handIndex` stays at `handPlan.length − 1`). |
| Decision coverage | PASS | Every D-001…D-009 reflected in development.md (table below); none internal. |
| Doc example compiles and runs | PASS | §10.2 code block extracted verbatim into a temporary `tests/unit/engine/doc-example.test.ts` (wrapped in one `it`, plus asserts: game-over, `hand` null, 29 `completedHands`, last event `game-over`, `view.you 0`). `pnpm vitest run tests/unit/engine/doc-example.test.ts` → 1 passed; `pnpm exec tsc --noEmit` → exit 0; `pnpm exec eslint tests/unit/engine/doc-example.test.ts --max-warnings 0` → exit 0. File then deleted (`rm`; `git status` shows only the two docs before artifacts were written). |
| VC-236 local gate | PASS | `pnpm install --frozen-lockfile` exit 0; `pnpm typecheck` exit 0; `pnpm lint` exit 0 (0 warnings, "All matched files use Prettier code style!"); `pnpm test` exit 0 (22 files, 481 tests); `pnpm test:sim` exit 0 (no sim tests); `pnpm build` exit 0. |
| VC-236 engine tests | PASS | `pnpm vitest run tests/unit/engine/` → 12 files, 266 tests passed (includes perf NFR-203 and golden VC-237). |
| VC-236 purity grep | PASS | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.\|src/score\|\.\./score' src/engine` → no output (exit 1). |
| VC-236 dependencies | PASS | `node -e "const d=require('./package.json').dependencies;console.log(Object.keys(d).sort().join(','),d['@noble/hashes'])"` → `@noble/hashes,next,react,react-dom,zod 2.4.0`. |
| No spec/plan/artifact refs in docs | PASS | `grep -niE 'spec\|plan\|artifact\|FR-\|VC-\|NFR-\|BR-\|iteration\|D-00' docs/design.md docs/development.md` → only false positives (`spectator`, "hand plan"). |
| VC-236 CI part | NOT RUN | Orchestrator's job after the user approves a push. |
| Artifacts | PASS | `CONTEXT.md` rewritten to the final Phase 2 state with "Hand-off to Phase 3/4"; this record. `DECISIONS.md` unchanged (no new decision). |

## Final Verification (plan "Final acceptance test", local part)

All commands above, run on the final tree: install, `typecheck && lint && test && test:sim && build` all exit 0; `pnpm vitest run tests/unit/engine/` green; purity grep empty; dependency line exactly `@noble/hashes,next,react,react-dom,zod 2.4.0`. Requirement → test mapping of the plan's Final Verification table is unchanged since Iterations 1–7 (every listed test file exists and passes in the 266-test engine run). Remaining: branch CI run after push.

## Files

- Changed: `docs/design.md` (§4.4 first-dealer bullet; §4.5 `GameState` comments on `handIndex`/`hand`, "Randomness" rewritten with the exact derivation, new "Dealing hand `i`" and "Game over" paragraphs), `docs/development.md` (§1 toolchain row + dependency sentence fix; §2 layout note; §9.3/§9.4/§9.6 cross-references; new §10 Engine with 10.1–10.8; "Known limitations" → §11, "No game logic yet" bullet replaced), `specs/02-engine-plan-artifacts/CONTEXT.md`, `specs/02-engine-plan-artifacts/iterations/08-docs.md` (new).
- Added/deleted: temporary `tests/unit/engine/doc-example.test.ts` (created and deleted, never staged).

## Deviations

- Extra development.md edits outside §2/§10/§11, because they now contradicted the code: §1 (added an `@noble/hashes` toolchain row; replaced "is added when the engine needs hashing"), §9.3 and §9.4 (pointed at `expandHandSequence` §10.1 and `checkInvariants` §10.4 instead of §9.6), §9.6 (engine behaviour now "lives in `src/engine` (§10)"; sequence sanity "checked by `expandHandSequence`, reported by `createGame`").
- design.md: beyond the listed §4.4/§4.5 content, §4.5 also states the `int` rejection-sampling and Fisher–Yates details and the dealing order (card `k` → seat `(dealer+1+k) mod N`, trump index) so the derivation is reproducible from the doc alone. No other design.md section was changed: §5.1 (conceptual `GameEngine` interface without `aiRng`) and §5.6 (prose invariant summary) do not contradict the code; noted in CONTEXT.md Known gaps.
- No intra-document links to "Known limitations" existed, so the renumbering needed no link fixes; README's `#5-configuration` anchor is untouched.

## Decision coverage

| Decision | Where |
|---|---|
| D-001 `rngFromSource` coerces with `>>> 0` | reflected in docs §10.8 (gotcha bullet). |
| D-002 `trickWinner([])` throws `RangeError` | reflected in docs §10.8. |
| D-003 moves/events carry card copies | reflected in docs §10.3 ("Moves and events carry copies") and §10.8 (`legalPlays` vs `legalMoves`). |
| D-004 `createGame` problem granularity and order | reflected in docs §10.2 ("Creating a game"). |
| D-005 `playGame` test-helper contract | reflected in docs §10.7. |
| D-006 private seat-check copy in `view.ts` | reflected in docs §10.8. |
| D-007 game-over view shape and copy rules | reflected in docs §10.2 ("Building a view") and §10.8 (`hand === null`, dealer fallback 0). |
| D-008 (e) only when every bid is set | reflected in docs §10.4 (skip rules). |
| D-009 (f) skipped when `cardsPerPlayer` > deck size | reflected in docs §10.4 and §10.8 (known gap). |

## Gotchas

- My first wording ("**before** that stream shuffles") missed the VC-235 literal grep; the docs now say "before the shuffle" verbatim. Keep that phrase if §4.4/§4.5 are edited.
- `rng.test.ts`'s golden stream is computed in-test with `@noble/hashes`, so it would not detect a swapped hash library; `golden.test.ts` would (stated in docs §10.6).
- `docs/` is excluded from Prettier, so `pnpm lint` does not check the Markdown.

## For the next step

- Phase 2 complete. Orchestrator: run verify-spec; after the user approves a push of `spec/02-engine`, confirm the branch CI run (VC-236 CI part).
