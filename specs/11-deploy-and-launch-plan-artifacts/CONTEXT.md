# CONTEXT (state after Iteration 3)

Launch state: not started. All three scripts are built: `blob-checks`, `bench-moves`, `smoke` (package.json has exactly these three new entries, FR-1130). No Vercel work yet. Nothing under `src/`, `app/`, `vercel.json` has changed and none may.

## Commands

- `pnpm blob-checks [--rounds <1-1000, default 100>] [--writers <1-1000, default 10>]`, env `BLOB_READ_WRITE_TOKEN` (required). Exit 0 passed, 1 check failed or runtime error, 2 usage. stdout: one JSON line. stderr: `blob-checks run <runId>` before the checks; one line on usage errors (`blob-checks: <message>`).
- `pnpm bench-moves --base-url <https url> --scenario warm|stale|cold [--samples <1-1000, default 100; not allowed with cold>] [--p95-limit-ms <1-600000, default 500>]`, env `VERCEL_PROTECTION_BYPASS` (optional), `BLOB_READ_WRITE_TOKEN` (required for `stale`). Exit 0 passed, 1 failed/aborted, 2 usage (one stderr line `bench-moves: <message>`). stdout: one JSON line; on an abort one extra stderr line `bench-moves: run aborted: <Name>: <message>` (secrets redacted).
- `pnpm smoke --base-url <https url>`, env `CRON_SECRET` (required: the secret of the target environment), `VERCEL_PROTECTION_BYPASS` (optional). Exit 0 passed, 1 a step failed, 2 usage (one stderr line `smoke: <message>` naming `--base-url` or `CRON_SECRET`, never a value). stdout: one JSON line; on a failure one extra stderr line `smoke: failed: <Name>: <message>` (secrets redacted). Exact step names, in order: `presets`, `create`, `auth`, `conflict`, `play`, `resume`, `retry`, `no-leak`, `cron-auth`, `cron-run`. Line (key order): `{ check:'smoke', baseUrl, startedAt (ISO), steps:[{name,ok}...], passed, durationMs }`; `steps` lists only the steps run (the last is the failed one when `passed` is false).
- Tests: `pnpm vitest run tests/unit/scripts` (also in `pnpm test`). `pnpm typecheck`, `pnpm lint`.

## File map

| Path | Role |
|---|---|
| `scripts/lib/args.ts` | `UsageError`, `parseStrict` |
| `scripts/lib/stats.ts` | `roundInt`, `percentile`, `p95`, `median` |
| `scripts/lib/http.ts` | `request`, `RequestTimeoutError`, `REQUEST_TIMEOUT_MS`, `BYPASS_HEADER`, types |
| `scripts/blob-checks.ts` | `runBlobChecks`, `runCli`, constants; runs `main` only when executed as a script |
| `tests/unit/scripts/args.test.ts`, `stats.test.ts`, `http.test.ts`, `blob-checks.test.ts` | unit tests (node Vitest project, no config change) |
| `tests/unit/scripts/helpers/faulty-store.ts` | `faultyStore` wrapper (not a test file) |
| `scripts/bench-moves.ts` | `runBench`, `runCli`, constants; main only when executed as a script |
| `tests/unit/scripts/bench-moves.test.ts` | bench tests over the real handlers |
| `tests/unit/scripts/helpers/in-process-fetch.ts` | `inProcessApi()`: in-process `fetch` over the real handlers (reused by smoke) |
| `scripts/smoke.ts` | `runSmoke`, `runCli`, `STEP_NAMES`, `MAX_PLAY_MOVES`; main only when executed as a script |
| `tests/unit/scripts/smoke.test.ts` | smoke tests over the real handlers incl. cron |
| `package.json` | scripts: `blob-checks`, `bench-moves`, `smoke` added (only `simulate` existed before) |

## Helper signatures (exact)

```ts
// scripts/lib/args.ts
class UsageError extends Error            // name 'UsageError'; message is ONE line, never an option value
type IntegerOptionSpec = { type: 'integer'; min: number; max: number; default?: number }
type StringOptionSpec  = { type: 'string'; choices?: readonly string[]; default?: string }
function parseStrict<const S extends Record<string, OptionSpec>>(args: readonly string[], spec: S): ParsedOptions<S>
// Unknown option, positional, missing value, non-decimal-integer (regex ^(0|[1-9][0-9]*)$) or out of
// range, string outside choices -> UsageError. Result keys: number|string, or `| undefined` when the
// spec has no `default`. Options are always given as `--name value`. Pass args WITHOUT node/script.

// scripts/lib/stats.ts
roundInt(value: number): number                       // Math.round
percentile(sorted: readonly number[], p: number): number  // nearest rank, ascending list, p in (0,100]; throws RangeError on empty/bad p
p95(sorted: readonly number[]): number
median(values: readonly number[]): number             // any order; mean of the two middle values when even; RangeError on empty

// scripts/lib/http.ts
type FetchFn = typeof fetch
interface RequestOptions { bypass?: string; timeoutMs?: number }   // timeoutMs default 30_000 (tests only)
interface HttpResponse { status: number; body: string }
class RequestTimeoutError extends Error   // 'request timed out after <ms> ms', no URL in it
request(fetchFn: FetchFn, url: string, init?: RequestInit, options?: RequestOptions): Promise<HttpResponse>
```

`request` reads the whole body inside the timeout (a bench sample can time it). At the deadline it aborts the fetch signal AND rejects with `RequestTimeoutError` even if `fetchFn` ignores the signal, so nothing hangs. Network errors propagate unchanged. The header `x-vercel-protection-bypass` is set iff `options.bypass` is a non-empty string (callers pass `process.env.VERCEL_PROTECTION_BYPASS`); caller headers in `init.headers` are kept. It never logs. It does not parse JSON (callers `JSON.parse(body)`).

```ts
// scripts/blob-checks.ts
interface BlobChecksOptions { rounds: number; writers: number; runId: string; signal?: AbortSignal; redact?: readonly string[]; now?: () => number }
runBlobChecks(store: ObjectStore, options: BlobChecksOptions): Promise<BlobChecksResult>  // never throws, never prints
interface CliDeps { env; io: { stdout(line); stderr(line) }; makeStore(token): ObjectStore; signal?: AbortSignal; runId?: string }
runCli(args: readonly string[], deps: CliDeps): Promise<number>   // parse, print, return exit code 0|1|2
// constants: DEFAULT_ROUNDS 100, DEFAULT_WRITERS 10, LIST_KEY_COUNT 25, LIST_PAGE_SIZE 10, CLEANUP_ROUNDS 20
```

`main` (only when the file is the entry point) wires SIGINT/SIGTERM to an `AbortController`; abort stops the run between steps (error `InterruptedError`), then cleanup runs, so the line still prints with `passed: false` and exit 1. `redact` replaces the token in error messages with `[redacted]`.

## bench-moves (Iteration 2)

```ts
// scripts/bench-moves.ts
interface BenchDeps { fetch: FetchFn; now: () => number /* performance.now in main */; store?: ObjectStore /* required for stale */;
  bypass?: string; redact?: readonly string[]; randomUUID?: () => string; signal?: AbortSignal; timeoutMs?: number /* tests only */ }
interface BenchOptions { baseUrl: string; scenario: 'warm'|'stale'|'cold'; samples: number; limitMs: number }
runBench(deps, options): Promise<{ line: BenchLine; error?: { name; message } }>   // never throws, never prints
interface CliDeps { env; io: { stdout(line); stderr(line) }; fetch; now; makeStore(token): ObjectStore; signal?; timeoutMs? }
runCli(args, deps): Promise<number>   // 0 | 1 | 2
// constants: DEFAULT_SAMPLES 100, DEFAULT_P95_LIMIT_MS 500, WARMUP_MOVES 3, BASELINE_SAMPLES 20
```

JSON line (key order): `{ check:'bench-moves', scenario, baseUrl, startedAt (ISO), n, minMs, p50Ms, p95Ms, maxMs, baselineMedianMs, limitMs, passed }`, all ms integers (rounded after the nearest-rank pick). `passed = completed && (cold || p95Ms < limitMs)` (rounded p95). An aborted run (non-200 on ANY request incl. create/untimed/presets, network error, 30 s timeout, unparsable body, head mismatch, signal) gives `passed:false`, `baselineMedianMs:null`, `n` = samples taken, stats over those samples (0 when none); the reason goes to stderr, not into the line (D-004).

Behaviour: games are `{humanName:'bench', aiCount:2}` (no rulesPreset); each move is `legalMoves[0].id` at the last received `version` with a fresh `crypto.randomUUID()` `clientRequestId` and `Authorization: Bearer <seatToken>`. warm: 3 untimed moves per game, then timed. stale: 1 untimed move per game, then per sample read head (must be `HeadSchema`-valid and equal `version`), overwrite `{schemaVersion:1, version: version-1}` (mode overwrite), read back (must equal `version-1`), then the timed move. cold: create + one timed move, `n` 1. When a response has `view.phase === 'game-over'` the next sample starts a new game (with that scenario's untimed moves). Baseline: 20 timed `GET /api/presets` after the samples, median rounded. Timing: `now()` before `request(...)` to `now()` after it returns (request reads the whole body).

Facts relied on: a move response is a `PlayerUpdate` (`version`, `view.phase`, `legalMoves`); in a non-game-over state `legalMoves` is non-empty (else the run aborts `BadResponse`); at game over the next game is created; with 2 AIs a game ends in fewer than 400 human moves (a 400-sample warm test creates more than one game); the service writes `head.json` after create and commit (best effort), so the memory store holds `version` before the script's overwrite.

## smoke (Iteration 3)

```ts
// scripts/smoke.ts
interface SmokeDeps { fetch: FetchFn; cronSecret: string; bypass?: string; redact?: readonly string[]; randomUUID?: () => string; timeoutMs?: number; signal?: AbortSignal; now?: () => number }
runSmoke(deps, { baseUrl }): Promise<{ line: SmokeLine; error?: { name; message } }>   // never throws, never prints
runCli(args, { env, io, fetch, now?, signal?, timeoutMs? }): Promise<number>          // 0 | 1 | 2
```

Behaviour: game `{humanName:'smoke', aiCount:2}`; every request through `request` (30 s, bypass header iff set). `conflict` sends `legalMoves[0]` and `[1]` from create's version concurrently (distinct moveId and fresh clientRequestId), needs one 200 and one 409 with `update` (fails when fewer than 2 legal moves); the 200 request/response is kept for `retry`. `play` plays `legalMoves[0]` from the conflict winner's state until `game-over`, max 2000 moves, `finalRanking` must hold seats 0,1,2. `resume` compares `GET` version to the last move response's. `no-leak` walks every response body (JSON) for a key `seed` and checks the seat token occurs only in the create body. `cron-run` sends `Bearer ${CRON_SECRET}`. A step that throws (status mismatch, network, timeout) is `ok:false`; the run stops.

## In-process fetch

`tests/unit/scripts/helpers/in-process-fetch.ts`: `inProcessApi({ store? })` returns `{ fetch, store, deps, requests }`. `fetch` builds a `Request` and routes by method and pathname (origin ignored) to the real `createGameHandler` (POST /api/games), `presetsHandler` (GET /api/presets), `submitMoveHandler` (POST /api/games/{id}/moves), `getGameHandler` (GET /api/games/{id}); anything else answers 404. Service from `makeService(store)` (tests/unit/service/support/service-fixtures), config `loadConfig({STORAGE_DRIVER:'memory', LOG_LEVEL:'error'})`. `requests` records `{method, path, headers}` of every call (use it to assert the bypass header). `GET /api/cron/cleanup` is routed to `cleanupHandler` (Iteration 3) over the same store; pass `inProcessApi({ cronSecret })` to set `CRON_SECRET` in the in-process config (without it the route answers 401 to every request). Share a store with a script by passing the same `store`; pass a different one to model a wrong token.

## blob-checks JSON line (key order)

`{ check:'blob-checks', runId, startedAt (ISO), rounds, writers, exclusivity:{violations,zeroWinnerRounds,passed}, consistency:{createThenGet:{n,falseMissing},overwriteThenGet:{n,stale},passed}, listing:{keys,pageSize,ordered,passed}, delete:{remaining,passed}, passed, durationMs, error?:{name,message<=200} }`. `error` is last and only on failure. Sections not reached show zero counts and `passed:false`. `listing.passed = ordered && keys === 25`. A cleanup that cannot empty `checks/<runId>/` sets `error.name = 'CleanupError'` (and passed false) when no earlier error exists.

Keys written: `checks/<runId>/excl/<round>`, `.../create/<round>`, `.../overwrite/<round>`, `.../list/000..024`. runId is `crypto.randomUUID()`.

## Test layout and the faulty-store wrapper

All script tests live in `tests/unit/scripts/<name>.test.ts`; helpers in `tests/unit/scripts/helpers/` (import with `./helpers/...`; `@/scripts/...` aliases the script modules). Build a misbehaving store with:

```ts
faultyStore(new MemoryObjectStore(), (inner) => ({
  put: (key, body, opts) => inner.put(key, body, { ...opts, mode: 'overwrite' }),  // e.g. never exclusive
}))
```
Methods not returned delegate to the base. For CLI tests `runCli` takes `io` capture arrays and `makeStore`; see `harness` in `blob-checks.test.ts`.

## Gotcha

`.gitignore` ignores `lib/`, so files under `scripts/lib/` need `git add -f` when first added (already tracked after Iteration 1).

## Not yet done

Real-store runs of VC-1107..VC-1109 belong to Iteration 5. Real-URL bench runs (VC-1113..VC-1115 on a Preview) belong to Iteration 5. Real-URL smoke runs (VC-1106 on a protected Preview, VC-1118, VC-1119) belong to Iteration 5. Docs (Iteration 4) and all Vercel steps are later. Decisions: see `DECISIONS.md`.
