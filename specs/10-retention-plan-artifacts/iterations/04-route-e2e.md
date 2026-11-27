# Iteration 4: Route, cron schedule, end-to-end and static checks

Commit: see `git log` (message `Phase 10 iter 4: cron route, schedule, end-to-end and static checks`).

## Criteria (run from the project root)
- PASS `pnpm vitest run --project node tests/retention`: 5 files, 98 tests passed.
- PASS VC-1014: same command (`structure.test.ts`: crons deep-equal, framework `nextjs`, `Object.keys(route module)` equals `['GET']`). `pnpm build` output line: `├ ƒ /api/cron/cleanup` (legend `ƒ (Dynamic) server-rendered on demand`).
- PASS VC-1017: same command (`end-to-end.test.ts`: `gamesDeleted` 1, game GET 404 `game_not_found`, `snapshot(store)` is `[]`; marker `index/created/2026-11-23/{id}` seen before the run).
- PASS VC-1018 (a) and (b): same command. `git diff main -- src | wc -l` -> 0 (empty).
- PASS `git diff main -- package.json | wc -l` -> 0 (dependencies unchanged).
- PASS VC-1022 recorded as PASS in `MANUAL-CHECKS.md` (with one wording deviation, see Deviations).
- PASS `pnpm typecheck`; PASS `pnpm lint`; PASS `pnpm test` (104 files passed, 1 skipped; 1805 tests passed, 30 skipped); PASS `pnpm build`.
- PASS Dev server stopped (`pgrep -fl next` empty, nothing on port 3000).
- PASS Artifacts: CONTEXT.md rewritten, MANUAL-CHECKS.md exists, D-008 appended.

## Files
Added: `app/api/cron/cleanup/route.ts`, `tests/retention/structure.test.ts`, `tests/retention/end-to-end.test.ts`, `specs/10-retention-plan-artifacts/MANUAL-CHECKS.md`, this record.
Changed: `vercel.json`, `specs/10-retention-plan-artifacts/{CONTEXT.md,DECISIONS.md}`. Deleted: none. `src/` and `package.json` untouched.

## Hands off (final shapes)
- Route: `app/api/cron/cleanup/route.ts`, `export const GET = (req: Request) => cleanupHandler(req, defaultCleanupDeps);`, exports only `GET`.
- `vercel.json`: `{ "$schema": "https://openapi.vercel.sh/vercel.json", "framework": "nextjs", "crons": [{ "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }] }`.
- Static tests: `tests/retention/structure.test.ts` (describes `VC-1014: wiring`, `VC-1018 (a): layering`, `VC-1018 (b): secret handling`; local helpers `filesUnder`, `specifiers`, `stripComments`; constant `ALLOWED_IMPORTS`). End to end: `tests/retention/end-to-end.test.ts` (uses `makeApi`, `createGameVia`, `getGameHandler`, `snapshot`).
- VC-1022 exact commands: see `MANUAL-CHECKS.md` steps 1-11 (docs iteration reuses them for "how to try the job locally").
- For the docs: order is `getConfig` -> auth -> `getStore` (a `ConfigError` answers 500 even unauthenticated; 401 writes no log and touches no store); markers that are malformed before the stop point are skipped, counted, never deleted; `capReached` is true when exactly `batchSize` (500) games were deleted, even if none remain; a run cut off by the platform leaves the marker of the unfinished game, so the next run resumes; no `maxDuration` is set (platform default limit); the file store leaves empty directories after a delete.

## Deviations
- VC-1022 wording "`games/<id>` no longer exists" does not hold on the file store: empty directories remain (`games/<id>/commits`), no file does. Recorded in MANUAL-CHECKS.md; the docs should say "no key remains" (D-008).

## Gotchas
- `STORAGE_DRIVER` defaults to `file` outside Vercel, so the manual run needs no extra variable.
- `route.ts` is imported by the test, which loads `defaultCleanupDeps` (no store or config is touched at import).
- The secret scan in `structure.test.ts` is line-based: any new line in `cleanup.ts` that mentions `secret`, `cronSecret`, `header` or `authorization` with `===`, `==`, `startsWith` or `includes` (other than against null/undefined) fails it.

## For the next iteration
- Write `docs/development.md` `## 18. Retention` (FR-1015 topics) and rename Known limitations to `## 19`, updating every `§18` reference; update `docs/architecture.md` §7 (route row) and §6.5, and the "does not exist yet" statements. Reuse `MANUAL-CHECKS.md` for "how to try the job locally".
- VC-1020 greps; do not touch `docs/__future__/`.
