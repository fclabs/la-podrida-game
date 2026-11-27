# Iteration 5: Documentation

Commit: see `git log` (message `Phase 10 iter 5: retention developer documentation`).

## Criteria (run from the project root)
- PASS VC-1020 `grep -n '^## 18. Retention' docs/development.md` -> 2265 (one match); `grep -n '^## 19. Known limitations' docs/development.md` -> 2469 (one match).
- PASS `grep -rn '§18' docs README.md` (docs/__future__ excluded): before the edit no match at all (nothing referenced the old §18 by number; Known limitations is reached by name and from the §-lists nowhere); after, every match means Retention. Also added a pointer "retention limitations in §18.12" to the Known limitations index bullet.
- PASS `grep -n 'Not built yet' docs/architecture.md` -> no match (§7 cleanup row now describes the built route); §6.5 has one added sentence (`app/api/_lib/cleanup.ts`), policy text unchanged.
- PASS `grep -n 'does not exist yet' docs/development.md` -> no match (HTTP API limitations now points to §18). README: no section number, no "cron missing": unchanged.
- PASS §18 covers every listed topic: 18.1 what and why; 18.2 route, auth order, fail closed, silent 401, ConfigError 500, logs; 18.3 cutoff and worked example; 18.4 walk, delete order, marker last; 18.5 cap and `capReached`; 18.6 failure, resume, 10,000 rounds; 18.7 skipped markers; 18.8 code locations and `CleanupDeps`; 18.9 schedule and Vercel facts; 18.10 tests command; 18.11 try it locally; 18.12 gotchas.
- PASS Try it locally, steps 1-9 run as written with `DIR` set to a fresh directory under the scratchpad, `pnpm dev` in the background: files listed (`head.json`, `meta.json`, `commits/00000000.json`, `index/created/2026-11-27/<id>`); no secret -> `401` `{"error":{"code":"unauthorized","message":"Missing or invalid seat token"}}`; with secret -> `200` `{"gamesDeleted":1,"capReached":false,"skippedMarkers":0}`; `find -type f` empty, empty dirs `games/<id>/commits` and `index/created/2020-01-01` remain; game GET -> `404` `game_not_found`; repeat -> `{"gamesDeleted":0,...}`; dev log shows the `info` lines. Server stopped: `pgrep -fl next` empty, nothing listening on 3000.
- PASS `grep -rniE '10-retention|plan-artifacts|specs/|Iteration [0-9]|VC-10|D-00|spec 10' docs/development.md docs/architecture.md`: no match. Only broader pattern hit is `docs/architecture.md:403` ("Phase 5b and Phase 11"), pre-existing (not in this diff); a scan of the added lines for spec/plan/iteration/phase/artifact/VC-/D-00 finds only "inspect" and "Hobby plan".
- PASS `pnpm lint` (eslint + prettier on the Markdown), `pnpm typecheck`, `pnpm test` (104 files passed, 1 skipped; 1805 tests passed, 30 skipped). `pnpm format` run before the commit.
- PASS `git diff main -- src package.json | wc -l` -> 0. Nothing under `app/` or `tests/` changed.
- PASS Artifacts: this record, final `CONTEXT.md`, `D-009` appended.

## Decision-by-decision mapping
- D-001 (vitest include): docs yes: §4 table row and the Vitest-configs paragraph name `tests/retention`.
- D-002 (`makeGameKeys` `final` flag): internal (test helper detail); §18.10 lists the helpers.
- D-003 (one try/catch, `CleanupFailedError`, `RangeError` unwrapped): docs yes: §18.6, §18.8.
- D-004 (SHA-256 digests + `timingSafeEqual`): docs yes: §18.2 "works this way because".
- D-005 (401 from `RequestError`, 500 from a fresh `Error`): docs yes in effect (fixed bodies, nothing from the error: §18.2); the `RequestError` mechanics are internal.
- D-006 (`errorName`/`errorMessage` describe the cause): docs yes: §18.2 logging, §18.12.
- D-007 (`durationMs` brackets `runCleanup`): docs yes: §18.2 ("store build to the end of the walk").
- D-008 (VC-1022 "no key remains"): docs yes: §18.11 step 6, §18.12, §19.
- D-009 (doc structure): this iteration; recorded in `DECISIONS.md`.

## Files
Changed: `docs/development.md`, `docs/architecture.md`, `specs/10-retention-plan-artifacts/{CONTEXT.md,DECISIONS.md}`. Added: this record. Deleted: none. `docs/__future__/` untouched and unstaged.

## Deviations
- None. The plan's grep for `§18` found nothing before the change, so there was no cross-reference to renumber; the Known limitations index in §19 gained a pointer to §18.12.

## Gotchas
- The spec/plan name the manual check VC-1022; the docs describe it only as a task.
- Spec FR-1015 and VC-1022 wording about the folder is amended in the spec (commit 4fc7ab2); the docs say "no file remains".

## For verify-spec / freeze-spec
- All VCs are covered: automated 1000-1021 by `tests/retention` and the build; 1022 by `MANUAL-CHECKS.md` and re-run here; 1020 above.
