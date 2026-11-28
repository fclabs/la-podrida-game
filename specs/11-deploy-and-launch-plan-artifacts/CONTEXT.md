# CONTEXT (state after Iteration 2)

Launch state: not started. Scripts built so far: `blob-checks` only (bench-moves and smoke are Iterations 2 and 3). No Vercel work yet. Nothing under `src/`, `app/`, `vercel.json` has changed and none may.

## Commands

- `pnpm blob-checks [--rounds <1-1000, default 100>] [--writers <1-1000, default 10>]`, env `BLOB_READ_WRITE_TOKEN` (required). Exit 0 passed, 1 check failed or runtime error, 2 usage. stdout: one JSON line. stderr: `blob-checks run <runId>` before the checks; one line on usage errors (`blob-checks: <message>`).
- `pnpm bench-moves --base-url <https url> --scenario warm|stale|cold [--samples <1-1000, default 100; not allowed with cold>] [--p95-limit-ms <1-600000, default 500>]`, env `VERCEL_PROTECTION_BYPASS` (optional), `BLOB_READ_WRITE_TOKEN` (required for `stale`). Exit 0 passed, 1 failed/aborted, 2 usage (one stderr line `bench-moves: <message>`). stdout: one JSON line; on an abort one extra stderr line `bench-moves: run aborted: <Name>: <message>` (secrets redacted).
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
| `package.json` | scripts: `blob-checks`, `bench-moves` added (only `simulate` existed before) |

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

## In-process fetch (reuse in Iteration 3)

`tests/unit/scripts/helpers/in-process-fetch.ts`: `inProcessApi({ store? })` returns `{ fetch, store, deps, requests }`. `fetch` builds a `Request` and routes by method and pathname (origin ignored) to the real `createGameHandler` (POST /api/games), `presetsHandler` (GET /api/presets), `submitMoveHandler` (POST /api/games/{id}/moves), `getGameHandler` (GET /api/games/{id}); anything else answers 404. Service from `makeService(store)` (tests/unit/service/support/service-fixtures), config `loadConfig({STORAGE_DRIVER:'memory', LOG_LEVEL:'error'})`. `requests` records `{method, path, headers}` of every call (use it to assert the bypass header). Not routed yet: `GET /api/cron/cleanup` (smoke must add `cleanupHandler` from `app/api/_lib/cleanup.ts` with a CRON_SECRET; extend the helper, keep it backward compatible). Share a store with a script by passing the same `store`; pass a different one to model a wrong token.

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

Real-store runs of VC-1107..VC-1109 belong to Iteration 5. Real-URL bench runs (VC-1113..VC-1115 on a Preview) belong to Iteration 5. smoke, docs and all Vercel steps are later iterations. Decisions: see `DECISIONS.md`.
