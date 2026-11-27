# Frozen: Spec 10 — Retention

Source: [`specs/10-retention.md`](./10-retention.md) (review ledger: `specs/10-retention.review.md`; plan and build record: `specs/10-retention-plan.md`, `specs/10-retention-plan-artifacts/`)
Status: SHIPPED
Frozen: 2026-11-27
PR / commit: https://github.com/fclabs/la-podrida-game/pull/14 (squash commit `cacb355`)

## Purpose

Every game is stored forever: commits, `meta.json`, `head.json` and an index marker stay in Vercel Blob (or the local store) indefinitely. This spec delivers the daily retention job from architecture §6.5: `GET /api/cron/cleanup`, called by Vercel Cron with `Authorization: Bearer ${CRON_SECRET}`, deletes every game created more than `RETENTION_DAYS` days ago, finished or not. It finds expired games from the date index with no reads, deletes a game's keys page by page, deletes the index marker last so an interrupted run resumes the next day, and handles at most 500 games per run. It runs unchanged on the memory and file stores, so it is tested without Vercel. It benefits the operator, who caps Blob cost without manual work, and Phase 11, which deploys it and verifies the first cron run.

## What it does

- The route runs the job only when the request carries exactly `Authorization: Bearer <CRON_SECRET>`, compared in constant time.
- Any other header, or no configured `CRON_SECRET`, answers 401 `unauthorized` (the spec 08 body), writes no log line and makes no store call; the order is config, then authentication, then store.
- The cutoff day is the UTC date of `now − RETENTION_DAYS × 86,400,000 ms`; a game is expired iff its marker's day is strictly earlier.
- The job lists `index/created/` in ascending order, page by page, and stops at the first valid marker whose day is not expired.
- For each expired game it lists `games/{id}/` and deletes each page until the listing is empty, then deletes the marker and counts the game; a game that needs more than 10,000 list rounds fails the run.
- After deleting 500 games the run stops without looking ahead, and `capReached` is true even when nothing remains.
- A run that failed halfway leaves the marker of the unfinished game, so the next run deletes the remaining keys and then the marker.
- A completed run answers 200 `{ gamesDeleted, capReached, skippedMarkers }` with `Content-Type: application/json` and `Cache-Control: no-store`; with nothing expired it answers zeros and issues no `delete`.
- Any store error (or a `ConfigError`) answers the fixed 500 `internal` body and logs one `error` line with `route`, `gamesDeleted` so far, `errorName` and `errorMessage` (≤ 500 chars); deletions already made stay deleted.
- A key under `index/created/` that is not `index/created/{real date}/{valid gameId}` is skipped, counted in `skippedMarkers` and never deleted.
- A completed run writes one `info` line `{ route: 'cron/cleanup', status: 200, gamesDeleted, capReached, skippedMarkers, durationMs }` regardless of the log level.
- `vercel.json` schedules the route daily at `0 3 * * *`; the route file exports only `GET`.
- The handler takes `getConfig`, `getStore`, a wall clock, a log sink, `batchSize` and `pageSize` as arguments; the route binds the production defaults (`createObjectStore`, `new Date()`, `consoleLog`, 500, 1000).
- `docs/development.md` has §18 "Retention" and Known limitations is §19; `architecture.md` §6.5 and §7 describe the shipped job.
- Rules:
  - The marker of a game is deleted only after a listing of `games/{id}/` returned no keys.
  - Only keys under `games/{id}/` and the one marker of an expired game are deleted; keys of other games, other prefixes and malformed markers are never touched.
  - Runs are idempotent and overlap-safe.
  - The secret is never logged, echoed or compared with `===`, and with no secret configured every call is rejected.
  - The cleanup reads no game document and imports no game-layer module; `src/` is unchanged.
  - A game is deleted by its creation date alone, whether finished, in progress or unsupported by the current engine.

## Public interfaces / data

### Route

| Method & path | Auth | Request | Response |
|---|---|---|---|
| `GET /api/cron/cleanup` | `Authorization: Bearer ${CRON_SECRET}` | – | 200 `{ gamesDeleted, capReached, skippedMarkers }`; 401 `unauthorized`; 500 `internal` |

Other methods are answered by Next's default 405 (the route exports only `GET`).

### Storage layout used (per specs 05/06; no changes)

```
index/created/{yyyy-mm-dd}/{gameId}    empty marker, written first on create
games/{gameId}/…                       meta.json, head.json, commits/{v:08d}.json, scores/final.json
```

### Modules (`app/api/_lib/cleanup.ts`; exact names may change in the plan, the behaviour may not)

```ts
export const DEFAULT_BATCH_SIZE = 500;
export const DEFAULT_PAGE_SIZE = 1000;
export const MAX_LIST_ROUNDS_PER_GAME = 10_000;

export interface CleanupOptions {
  store: ObjectStore;
  now: Date;
  retentionDays: number;
  batchSize: number;   // ≥ 1
  pageSize: number;    // 1–1000 (the ObjectStore limit)
}
export interface CleanupResult { gamesDeleted: number; capReached: boolean; skippedMarkers: number }

/** Throws CleanupFailedError (carries gamesDeleted so far; cause = the original error) on any store error. */
export function runCleanup(opts: CleanupOptions): Promise<CleanupResult>;
export class CleanupFailedError extends Error { readonly gamesDeleted: number }

export interface CleanupDeps {
  getConfig: () => Config;
  getStore: (config: Config) => ObjectStore;
  now: () => Date;                 // wall clock
  log: LogSink;                    // from app/api/_lib/log.ts
  batchSize: number;
  pageSize: number;
}
export function cleanupHandler(req: Request, deps: CleanupDeps): Promise<Response>;
export const defaultCleanupDeps: CleanupDeps;
```

```ts
// app/api/cron/cleanup/route.ts
export const GET = (req: Request) => cleanupHandler(req, defaultCleanupDeps);
```

### `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "crons": [{ "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }]
}
```

## Key decisions

- **Strictly older than the cutoff day:** a game lives at least `RETENTION_DAYS` full days; deleting early is the worse error.
- **Fixed 500 batch, no new env var:** no change to `src/config.ts`; tests pass a small batch through the injected deps.
- **500 on a store error, not a 200 summary:** Vercel then shows the cron run as failed; progress is kept and the next run resumes because the marker goes last.
- **03:00 UTC**, a quiet hour for the Americas.
- **Platform default function time limit, no `maxDuration`:** a run cut off by the platform resumes the next day; Phase 11 records the real `durationMs` on Blob.
- **Marker-driven, no document reads:** retention works for unsupported or corrupt games, and a run costs only `list` and `delete` calls.
- **The code lives in `app/api/_lib`, not a new `src` layer:** a new layer would change the ESLint layer table for one consumer.
- **A listing that never empties fails the run (10,000 rounds):** on Blob a listing is a hint (spec 05), so a stale listing must not loop a cron function.
- **Skipped markers are never deleted:** the job deletes only what it can prove it created.
- **Tests live in `tests/retention/`**, which `vitest.config.ts` now includes in the `node` project.

## Known limits (still true at freeze)

- A run deletes at most 500 games, each bounded by 10,000 list rounds; the marker walk lists once per page of 1000 markers up to the first non-expired one.
- Store calls per expired game with `k` keys and page size `p`: `ceil(k/p) + 1` lists, `ceil(k/p)` deletes for its keys and one marker delete; no `get`, `exists` or `put`.
- The Blob listing order (ascending across pages) is assumed from spec 05 and not verified on a real store; if it is wrong, the early stop could skip expired markers. Phase 11 verifies it, the Vercel Cron call (production only, UTC, Hobby fires within the hour) and the real `durationMs`.
- `FileObjectStore.delete` removes files only, so the file store keeps empty folders such as `games/{id}/commits` after cleanup; no key remains.
- A game with no marker (a caller-bug orphan) is never deleted; a partially deleted game answers 404.
- A logged store error message can contain key paths, and so a game id.
- No cutoff other than UTC creation date; no last-activity tracking; requests in flight on a game being deleted are not fenced.

## Deliberately excluded

- Production verification of the cron and a run on real Blob (Phase 11); a configurable batch size or schedule; a manual trigger, dry-run mode, metrics or alerting.
- Changes to `src/**`, `src/config.ts`, the ESLint layer table, `HandlerDeps`, the other routes and `dependencies`.
