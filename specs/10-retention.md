# Spec 10 — Retention

> Version: 0.1 · Last updated: 2026-11-27 · Status: Draft · Owner: Federico Castañeda
> Source: [`docs/implementation.md`](../docs/implementation.md) §3 Phase 10 (tasks 1–4, Done when). Context: [`docs/architecture.md`](../docs/architecture.md) §6.5 Retention, §7 (routes), §9 (config), AD-11.
> Builds on: [`specs/05-storage-frozen.md`](./05-storage-frozen.md) (`ObjectStore`: sorted paginated `list`, idempotent `delete`, `createObjectStore`; a Blob listing is a hint), [`specs/06-game-state-manager-frozen.md`](./06-game-state-manager-frozen.md) (key layout `games/{gameId}/…` and `index/created/{yyyy-mm-dd}/{gameId}`, key builders `gameKeyPrefix`, `indexCreatedPrefix`; the marker is written first on create), [`specs/08-http-api-frozen.md`](./08-http-api-frozen.md) (`jsonResponse`, the `unauthorized` and `internal` error bodies, the `LogSink` shape, route files bind a handler to default deps), [`specs/00-project-scaffold-frozen.md`](./00-project-scaffold-frozen.md) (`RETENTION_DAYS`, `CRON_SECRET`, layer rule, CI).
> Requirement IDs use the 10xx range.

## Purpose

Every game is stored forever: commits, `meta.json`, `head.json` and an index marker stay in Vercel Blob (or the local store) indefinitely. This spec delivers the daily retention job from architecture §6.5: `GET /api/cron/cleanup`, called by Vercel Cron with `Authorization: Bearer ${CRON_SECRET}`, deletes every game created more than `RETENTION_DAYS` days ago, finished or not. It finds expired games from the date index with no reads, deletes a game's keys page by page, deletes the index marker last so an interrupted run resumes the next day, and handles at most 500 games per run. It runs unchanged on the memory and file stores, so it is tested without Vercel. It benefits the operator, who caps Blob cost without manual work, and Phase 11, which deploys it and verifies the first cron run.

## Scope

**In**
- `GET /api/cron/cleanup` (`app/api/cron/cleanup/route.ts`), authenticated by `CRON_SECRET` (FR-1000, FR-1001).
- The cleanup logic and its handler under `app/api/_lib/` (`cleanup.ts`); they use only `ObjectStore`, `Config` and the key builders from `src/state/keys.ts`; no game document is read or parsed.
- Cutoff by UTC creation date (FR-1002), ordered marker walk with an early stop (FR-1003), per-game paginated deletion (FR-1004), a batch cap fixed at 500 (FR-1006), resume after failure (FR-1007), skipping malformed markers (FR-1011).
- A JSON summary response, a structured log line per run, and a fixed 500 with the progress logged on failure (FR-1008, FR-1009, FR-1012).
- `vercel.json`: one daily cron at 03:00 UTC (FR-1013).
- An injectable clock, store, batch size and list page size, so tests need no sleeping, no Vercel and no 500-game fixtures (FR-1014).
- Docs: `docs/development.md` gains §18 "Retention" (Known limitations becomes §19, cross-references updated); `docs/architecture.md` §7 and §6.5 and `docs/development.md` statements that the cron "does not exist yet" are updated (FR-1015).
- Tests in `tests/` (new folder `tests/retention/`), run by `pnpm test` and CI, against `MemoryObjectStore` **and** `FileObjectStore`.

**Out**
- Production verification that the Vercel cron fires and succeeds, and a run against a real Blob store: Phase 11 (this spec's automated tests never touch Blob).
- "Last activity" tracking, finished-game early deletion, archiving, or any policy other than creation date.
- Deleting games that have no index marker (an orphan from a caller bug, `development.md` §14 limitation) or keys outside `games/{id}/` and `index/created/`.
- Fencing requests in flight on a game being deleted: a partially deleted game answers 404 (architecture §6.5, accepted).
- A configurable batch size or schedule (the 500 cap and `0 3 * * *` are constants), any change to `src/**`, `src/config.ts`, the ESLint layer table, `HandlerDeps` or the existing four routes, and any new dependency.
- A manual trigger, an admin UI, metrics, alerting, or a dry-run mode.
- A different cutoff timezone: the cutoff is always UTC.

## Actors

| Actor | Description | Permissions |
|---|---|---|
| Vercel Cron | Calls the route once a day with `Authorization: Bearer ${CRON_SECRET}` | May call `GET /api/cron/cleanup` |
| Operator | Owns the deployment; reads the run's log line | Sets `CRON_SECRET` and `RETENTION_DAYS`; may call the route with the secret |
| Anyone else | A browser, a player, a scanner | Rejected with 401; learns nothing about the store |
| Cleanup job | The handler | Lists and deletes `index/created/…` markers and `games/{id}/…` keys; reads no document |

## Functional Requirements

### Route and authentication

- **FR-1000 (Must)** — Given `config.cronSecret` is set, when `GET /api/cron/cleanup` arrives with `Authorization: Bearer <cronSecret>` (exact scheme `Bearer`, one space, then the secret, compared in constant time), then the job runs (FR-1002–FR-1007).
- **FR-1001 (Must)** — Given a request whose `Authorization` header is missing, is not exactly `Bearer <cronSecret>`, or has any other scheme or case, or given `config.cronSecret` is unset, when the route is called, then it answers 401 with the spec 08 `unauthorized` body (the existing message text `Missing or invalid seat token` is reused unchanged), writes no log line, never calls the store getter and so makes no store call. With no secret configured the endpoint rejects every request (fail closed). The order is: `getConfig()` first (a `ConfigError` answers 500 `internal` per FR-1009, even for an unauthenticated call), then the authentication check, then `getStore`.

### Which games expire

- **FR-1002 (Must)** — Given `now` and `retentionDays` N, when the job starts, then the cutoff day is the UTC calendar date (`yyyy-mm-dd`) of `now − N × 86,400,000 ms`. A game is expired iff its marker's day is **strictly earlier** than the cutoff day. Example: `now` = 2026-11-27T03:00Z and N = 365 → cutoff 2025-11-27; markers dated 2025-11-26 and earlier are expired, 2025-11-27 is kept.
- **FR-1003 (Must)** — Given the markers under `index/created/`, when the job walks them, then it lists `index/created/` in ascending key order, page by page (`list` with the returned `cursor`), and stops at the first valid marker whose day is not expired. It lists no page beyond the one containing that marker.

### Deleting a game

- **FR-1004 (Must)** — Given an expired game id, when the job deletes it, then it repeats: list `games/{id}/` (page size `pageSize`); if the page has no keys, stop; otherwise `delete` that page's keys. After at most 10,000 list rounds for one game it stops and fails per FR-1009 (a listing that never empties must not loop forever).
- **FR-1005 (Must)** — Given a game whose `games/{id}/` listing returned no keys, when the job finishes it, then it deletes the marker `index/created/{day}/{id}` and counts the game as deleted. A game whose marker is deleted is never counted twice in one run.
- **FR-1006 (Must) — Batch cap.** Given more expired games than the batch size (500), when a run has deleted 500 games, then it stops without starting another game, and the remaining expired games are handled by the next run. `capReached` is `true` iff the run stopped because it deleted 500 games, even when no expired game remains (the job does not look ahead).
- **FR-1007 (Must) — Resume.** Given a run that failed after deleting only some keys of a game (its marker still present), when the next run starts, then it finds the marker again, deletes the remaining keys and then the marker; afterwards no key of that game and no marker remains.

### Response, failure, logging

- **FR-1008 (Must)** — On a completed run the route answers 200 with `{ gamesDeleted: number, capReached: boolean, skippedMarkers: number }`, `Content-Type: application/json` and `Cache-Control: no-store` (via `jsonResponse`).
- **FR-1009 (Must)** — Given any error thrown by the store (or FR-1004's round limit) during the run, when it occurs, then the run stops, the route answers the fixed 500 `internal` body of spec 08, and one `error`-level log line records `route` (`'cron/cleanup'`), `gamesDeleted` (games fully deleted before the error), `errorName` and `errorMessage` (≤ 500 chars). Deletions made before the error stay deleted. A `ConfigError` from `getConfig()` also answers 500 `internal`.
- **FR-1010 (Must)** — Given a store with no markers, or only markers that are not expired, when the job runs, then it answers 200 `{ gamesDeleted: 0, capReached: false, skippedMarkers: 0 }` and issues no `delete`.
- **FR-1011 (Must)** — Given a key under `index/created/` that is not `index/created/{yyyy-mm-dd}/{gameId}` with a real calendar date and a valid `gameId` (`^[a-z2-7]{26}$`), when the walk meets it before the stop point, then the job skips it, counts it in `skippedMarkers`, never deletes it, and continues with the next key.
- **FR-1012 (Should)** — After a completed run the job writes one `info`-level line `{ route: 'cron/cleanup', status: 200, gamesDeleted, capReached, skippedMarkers, durationMs }`, regardless of `config.logLevel` (a daily line, not per-request noise).

### Wiring, injection, docs

- **FR-1013 (Must)** — `vercel.json` keeps `"framework": "nextjs"` and gains `crons: [{ "path": "/api/cron/cleanup", "schedule": "0 3 * * *" }]`. The route file exports only `GET`.
- **FR-1014 (Must)** — The handler takes its dependencies as an argument: `getConfig`, a store getter, a wall clock returning a `Date`, a log sink, `batchSize` and `pageSize`. The route binds production defaults: `getConfig`, `getStore: createObjectStore` (called with the config), `() => new Date()`, `consoleLog`, `batchSize` 500, `pageSize` 1000.
- **FR-1015 (Must)** — `docs/development.md` §18 "Retention" covers: the route and auth, the cutoff rule with an example, the walk and delete order, the batch cap and `capReached`, failure and resume, skipped markers, the injectable deps, how to run the tests and how to try the job locally (VC-1022). The old §18 becomes §19 and every cross-reference to it is updated. `architecture.md` §7 (route table row) and `development.md` no longer say the route "does not exist" or is "not built yet".

## Business Rules

- **BR-1001 Marker last.** The marker of a game is deleted only after a listing of `games/{id}/` returned no keys; at the moment of the marker `delete`, no key of that game exists. *Rationale:* the marker is the only way to find the game again, so an interrupted run resumes (FR-1007). *Exception:* none.
- **BR-1002 Only expired games are touched.** The job deletes only keys under `games/{id}/` and the one marker of an expired game. Keys of non-expired games, keys outside those two prefixes, and malformed markers are never deleted. *Rationale:* data loss is the only unrecoverable failure here. *Exception:* none.
- **BR-1003 Idempotent and overlap-safe.** Running the job twice, or two runs overlapping, reaches the same final store state as one run and never errors because a key is already gone. *Rationale:* storage deletes are idempotent (spec 05); Vercel may retry a cron call. *Exception:* none.
- **BR-1004 The secret is never exposed and the endpoint fails closed.** `cronSecret` is never logged, echoed in a body, put in an error message or compared with `===`; with no secret configured every call is rejected. *Rationale:* the route deletes data; architecture §8. *Exception:* none.
- **BR-1005 Layering.** The cleanup code reads no game document and does not import `GameService`, `GameStateManager`, the state schemas or anything from `src/engine`, `src/score`, `src/players`, `src/service`; it imports `ObjectStore` types, `createObjectStore`, `Config` and the key builders only. No file under `src/` changes. *Rationale:* retention must keep working for games the engine can no longer load (`GameUnsupported`, a changed `schemaVersion`). *Exception:* none.
- **BR-1006 Creation date only.** A game is deleted by the creation date in its marker, whether finished, in progress or unsupported by the current engine. *Rationale:* architecture §6.5, AD-11. *Exception:* none.

## Non-Functional Requirements

- **NFR-1001 Store-call budget.** For one expired game with `k ≥ 1` keys and page size `p`: `ceil(k/p) + 1` `list` calls on `games/{id}/` (the last returns no keys), `ceil(k/p)` `delete` calls for its keys and exactly 1 `delete` for the marker; no `get`, `exists` or `put`.
- **NFR-1002 Bounded work.** One run deletes at most 500 games, each game takes at most 10,000 `list` rounds (FR-1004), and the marker walk lists `index/created/` once per `pageSize` markers up to the first non-expired marker; a run on a store with no expired game issues only those walk `list` calls and no `delete`.
- **NFR-1003 Clean build.** `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass, and `dependencies` in `package.json` is unchanged.

## Data & Interfaces

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

- **Strictly older than the cutoff day** (user choice): a game lives at least `RETENTION_DAYS` full days; the cutoff day itself is deleted by the next run. Deleting a game early is the worse error.
- **Fixed 500 batch, no new env var** (user choice): no change to `src/config.ts` or its frozen spec; tests pass a small batch through the injected deps.
- **500 on a store error, not a 200 summary** (user choice): Vercel then shows the cron run as failed; progress is kept and the next run resumes (the marker is deleted last).
- **03:00 UTC** (user choice): a quiet hour for the Americas.
- **Marker-driven, no document reads** (BR-1005): retention works for unsupported or corrupt games, and a run costs only `list` and `delete` calls.
- **The cleanup lives in `app/api/_lib`, not in a new `src` layer**: a new layer would change the ESLint layer table for one consumer; `app/api` may already import `src/storage` and `src/state/keys`.
- **Platform default function time limit, no `maxDuration`** (user choice): a run that is cut off by the platform leaves unfinished games with their markers, so the next run resumes (FR-1007). Phase 11 records the real `durationMs` on Blob and revisits the limit only if runs are cut off.
- **A listing that never empties fails the run** (FR-1004): on Blob a listing is a hint (spec 05), so a stale listing must not loop a cron function until its time limit.
- **Skipped markers are never deleted** (FR-1011): the job only deletes what it can prove it created; a malformed marker is reported in the count and the log, for the operator to inspect.

## Verification Criteria

Automated VCs run in `tests/retention/` under `pnpm test`. **Every automated VC in this section is parameterised over `MemoryObjectStore` and `FileObjectStore` (temp directory), except VC-1011, VC-1014, VC-1017, VC-1018, VC-1020 and VC-1021.** Fixtures build games by writing the real key layout (marker, `meta.json`, commits `0…n`, `head.json`, optionally `scores/final.json`) with the store directly; the handler is called with an injected fixed clock.

### Authentication

- **VC-1000:** valid secret, empty store → 200 `{ gamesDeleted: 0, capReached: false, skippedMarkers: 0 }`, `content-type: application/json`, `cache-control: no-store`. *(FR-1000, FR-1008, FR-1010)*
- **VC-1001:** header missing; `Bearer wrong`; `Bearer ` + the secret plus one extra char; `Bearer` + secret without the space; `bearer <secret>`; `Basic <secret>`; and a correct header with `cronSecret` unset → each answers 401 with the spec 08 `unauthorized` body; the store getter is never called (a counting store records zero calls); the log sink receives zero lines; the body contains no secret. With `getConfig` throwing a `ConfigError` and no header → 500 `internal`, not 401. *(FR-1001, FR-1009, BR-1004)*

### Cutoff, walk and deletion

- **VC-1002:** `now` 2026-11-27T03:00Z, N = 365, markers dated 2025-11-25, 2025-11-26, 2025-11-27, 2025-11-28 and 2026-11-27 → only the first two games are deleted. With N = 1 and `now` 2028-03-01T00:00Z (a leap year), cutoff is 2028-02-29: the marker dated 2028-02-28 is deleted and 2028-02-29 is kept. `now` 2026-11-27T23:59:59.999Z and 2026-11-27T00:00:00.000Z give the same result. *(FR-1002, BR-1006)*
- **VC-1003:** 6 expired markers on 3 days then 2 non-expired, page size 1 → `index/created/` is listed 7 times (6 expired + the first non-expired) and never again; the markers are met in ascending key order. *(FR-1003, NFR-1002)*
- **VC-1004:** an expired finished game (with `scores/final.json`), an expired in-progress game, one non-expired game, one non-expired game whose id shares a prefix with an expired one, and an unrelated key `other/x` → afterwards both expired games have no key under `games/{id}/` and no marker; every key of the other games and the unrelated keys is byte-identical to before. *(FR-1004, FR-1005, BR-1002, BR-1006)*
- **VC-1005:** a wrapping store records every call; for each deleted game, at the moment its marker `delete` is called the inner store holds no key under `games/{id}/`, and a `list` of that prefix returned no keys before it. *(BR-1001, FR-1005)*
- **VC-1006:** 5 expired games with batch size 2 → run 1: `gamesDeleted` 2, `capReached` true, the two with the earliest markers deleted, the other three and their markers untouched; run 2: 2, true; run 3: 1, `capReached` false; run 4: 0, false. With exactly 2 expired games and batch size 2 → `gamesDeleted` 2, `capReached` true, and the next run answers 0, false. *(FR-1006)*
- **VC-1007:** one expired game with 4 keys and one non-expired game, page size 1, a wrapping store that throws on the second `list` of `games/{id}/` (the first `delete` of that game's keys has succeeded) → the route answers 500 `internal`; exactly 3 of the game's keys and its marker remain; the next run (no fault) answers 200 `gamesDeleted: 1` and afterwards the store holds only the non-expired game's keys and marker. *(FR-1007, FR-1009, BR-1001)*
- **VC-1008:** after VC-1007's failure, the log sink received exactly one `error` line with `route` `'cron/cleanup'`, `gamesDeleted` (the count of games fully deleted before the error, here 0 for the failing game), `errorName`, `errorMessage` ≤ 500 chars; the response body deep-equals the spec 08 `internal` body; neither contains the secret or a game id. *(FR-1009, BR-1004)*
- **VC-1009:** only non-expired markers, and separately an empty store → 200 with zeros and no `delete` call. *(FR-1010, NFR-1002)*
- **VC-1010:** with `now` 2026-11-27 and N = 365, markers `index/created/2024-12-31/{idA}` and `index/created/2025-03-01/{idC}` (valid, expired), `index/created/2025-01-01/SHORT`, `index/created/2025-02-30/{idB}` and `index/created/2025-13-01/{idE}` (malformed, all sorting before the stop point), `index/created/2026-11-27/{idF}` (valid, not expired) and `index/created/not-a-date/{idD}` (malformed, sorting after every date) → 200 `gamesDeleted: 2`, `skippedMarkers: 3`; the three malformed keys before the stop point and the `not-a-date` key are still present; `not-a-date` is not counted because the walk stopped at `2026-11-27/{idF}` before reaching it. *(FR-1011, BR-1002)*
- **VC-1011:** a store whose `list('games/{id}/')` always returns the same key (the delete is accepted but the listing never empties) → the route answers 500 `internal` after `MAX_LIST_ROUNDS_PER_GAME` rounds (that number of `list` calls, no more); the marker is still present. *(FR-1004)*
- **VC-1012:** two handler calls started together on a store with 3 expired games → both answer 200; the final store state equals the state after a single run; `gamesDeleted` of the two responses adds up to at least 3 and each is ≤ 3. *(BR-1003)*
- **VC-1013:** after a successful run with the log level set to `error`, the sink received exactly one `info` line with exactly the fields `route` (`'cron/cleanup'`), `status` 200, `gamesDeleted`, `capReached`, `skippedMarkers`, `durationMs`. *(FR-1012)*

### Wiring and static checks

- **VC-1014:** `vercel.json` parses to an object whose `crons` deep-equals `[{ path: '/api/cron/cleanup', schedule: '0 3 * * *' }]` and whose `framework` is `'nextjs'`; `app/api/cron/cleanup/route.ts` exports exactly `GET`; `pnpm build` lists `/api/cron/cleanup` as a dynamic (ƒ) route. *(FR-1013)*
- **VC-1015:** `defaultCleanupDeps.batchSize === 500`, `pageSize === 1000`, and `now()` returns a `Date` within 1 s of the system clock; with an injected clock fixed in the past, the handler uses that clock and not the system one. *(FR-1014)*
- **VC-1016:** one expired game with 25 keys, page size 10, counting store → 4 `list` calls on `games/{id}/` (the last empty), 3 `delete` calls for the game's keys, 1 `delete` call for the marker, 0 `get`/`exists`/`put`. *(NFR-1001)*
- **VC-1017: Real layout end to end.** Create a game through the real `GameService` on a `MemoryObjectStore` (via the spec 08 create handler), then run the cleanup handler with a clock fixed two years after the creation and `retentionDays` 365 → `gamesDeleted` 1; the game's `GET` through the spec 08 handler answers 404 `game_not_found`; the store holds no key. This proves the marker and key layout of spec 06 match what the job walks. *(FR-1004, FR-1005, BR-1006)*
- **VC-1018:** a static test over `app/api/_lib/cleanup.ts` and `app/api/cron/**` → (a) imports resolve only to `@/src/storage`, `@/src/config`, `@/src/state/keys`, `@/src/storage/object-store`, sibling `_lib` modules and Node built-ins, none to `game-state-manager`, `schemas`, `service`, `engine`, `score` or `players`; (b) the secret check uses `timingSafeEqual` from `node:crypto`, and no `===`, `!==`, `==`, `!=`, `startsWith` or `includes` is applied to the secret or to the `Authorization` value; and `git diff main -- src` is empty at verify time. (`pnpm lint` does not constrain `app/api/**`, so this test is the enforcement.) *(BR-1005, BR-1004, FR-1000)*
- **VC-1019:** a marker whose game has no keys left (a previous run deleted the keys and failed before the marker) → 200 `gamesDeleted: 1`; the marker is gone; exactly one `delete` call was made (for the marker) and no `delete` was called with an empty list. *(FR-1004, FR-1005)*

### Docs and build

- **VC-1020:** `docs/development.md` has `## 18. Retention` covering the FR-1015 topics and `## 19. Known limitations`; `grep -rn '§18' docs README.md` shows no reference that still means Known limitations; `docs/architecture.md` §7 no longer contains `Not built yet` for the cron row, and `docs/development.md` no longer contains `does not exist yet` for the cron route. *(FR-1015)*
- **VC-1021:** CI runs `pnpm typecheck`, `pnpm lint`, `pnpm test` (including `tests/retention/**`) and `pnpm build`, all green; `package.json` `dependencies` is unchanged. *(NFR-1003)*

### Manual (local, `pnpm dev`, file store)

- **VC-1022:** start `pnpm dev` with `FILE_STORE_DIR=/tmp/podrida CRON_SECRET=local-test-secret RETENTION_DAYS=1`; create a game with `curl` (spec 08); rename its marker folder `index/created/<today>/` to `index/created/2020-01-01/`; call `curl -H 'Authorization: Bearer local-test-secret' localhost:3000/api/cron/cleanup` → 200 `{"gamesDeleted":1,…}`, `/tmp/podrida/games/<id>` no longer exists, and the game's `GET` answers 404 `game_not_found`; the same call without the header answers 401. *(FR-1000, FR-1001, FR-1004, FR-1005)*

## Open Questions

None.

## Assumptions

- Vercel Cron calls the route with `GET` and `Authorization: Bearer ${CRON_SECRET}` when `CRON_SECRET` is set in the project (architecture §6.5). Vercel Cron schedules are in UTC and invoke production deployments only, and on the Hobby plan a job fires at some point within its scheduled hour (so "03:00" means 03:00–03:59). Phase 11 verifies all of this on the real project.
- A store's `list` returns keys in ascending order across pages (spec 05 contract). For Blob this is not yet verified against a real store (spec 05 known limit; Phase 5b/11); if it is wrong, the early stop in FR-1003 could skip expired markers, and a new spec changes the walk.
- Game ids and marker days follow the formats written by spec 06 (`^[a-z2-7]{26}$`, a real UTC `yyyy-mm-dd`); anything else is skipped (FR-1011).
- `RETENTION_DAYS` is already validated by `loadConfig` as an integer in 1–3650 (spec 00), so the job does not re-validate it.
- A game normally has fewer than a few hundred keys (one commit per move), so 500 games per run and 10,000 list rounds per game are not binding in practice.
