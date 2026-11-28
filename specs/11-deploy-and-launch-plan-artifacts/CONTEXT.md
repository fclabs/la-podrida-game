# CONTEXT (state after Iteration 1)

Launch state: not started. Scripts built so far: `blob-checks` only (bench-moves and smoke are Iterations 2 and 3). No Vercel work yet. Nothing under `src/`, `app/`, `vercel.json` has changed and none may.

## Commands

- `pnpm blob-checks [--rounds <1-1000, default 100>] [--writers <1-1000, default 10>]`, env `BLOB_READ_WRITE_TOKEN` (required). Exit 0 passed, 1 check failed or runtime error, 2 usage. stdout: one JSON line. stderr: `blob-checks run <runId>` before the checks; one line on usage errors (`blob-checks: <message>`).
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
| `package.json` | scripts: `blob-checks` added (only `simulate` existed before) |

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

## JSON line (key order)

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

Real-store runs of VC-1107..VC-1109 belong to Iteration 5. bench-moves/smoke, docs, and all Vercel steps are later iterations. Decisions: see `DECISIONS.md`.
