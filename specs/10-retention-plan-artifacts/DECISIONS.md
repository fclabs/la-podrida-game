# Decisions

## D-001: Add `retention` to the node project's test include  (Iteration 1)

**Context**: The spec puts retention tests in `tests/retention/`, but the `node` project's `include` was `tests/{unit,contract,api}/**/*.test.ts`, so they would never run under `pnpm test` or CI.
**Decision**: `vitest.config.ts` `node` project `include` is now `['tests/{unit,contract,api,retention}/**/*.test.ts']`; the comment above names `tests/retention`.
**Rejected**: a separate vitest config or project for retention (a second command, and CI runs only `pnpm test`).
**Consequences**: `tests/retention/support/**` is not matched (no `.test.ts`). `pnpm test` collects 100 files plus the existing suites unchanged.

## D-002: `makeGameKeys` takes an optional `final` flag  (Iteration 1)

**Context**: The plan fixes `makeGameKeys(store, { id, day, keys })` but also wants `scores/final.json` optionally.
**Decision**: Extra optional field `final?: boolean`. Key order: `meta.json`, `head.json`, [`scores/final.json` if `final`], then `commits/00000000.json`…; the first `keys` of that list are written. Bodies are `{id}:{key}` strings (distinct per key, so byte comparison is meaningful).
**Rejected**: inferring the final-scores key from `keys` size (implicit, surprising).
**Consequences**: `keys: 0` writes only the marker (VC-1019).

## D-003: One try/catch around the walk keeps `gamesDeleted`  (Iteration 2)

**Context**: FR-1009 needs the failure to carry games fully deleted before the error, for any store error or the round limit.
**Decision**: `runCleanup` wraps the whole marker walk in one `try/catch`; `gamesDeleted` is a local incremented only after a game's marker delete succeeds, so the catch reads it directly and throws `CleanupFailedError(gamesDeleted, error)`. Option validation sits before the `try`, so its `RangeError`s are unwrapped. The round limit throws a plain `Error` that gets wrapped like store errors; `deleteGameKeys` lists exactly `MAX_LIST_ROUNDS_PER_GAME` times before giving up.
**Rejected**: per-call wrapping inside helpers (error-prone, repeated); a `{ gamesDeleted }` side channel passed to helpers.
**Consequences**: `CleanupFailedError.message` copies the cause's message; the original stays in `cause`. A game whose marker delete threw is not counted.

## D-004: Bearer check compares two SHA-256 digests with `timingSafeEqual`  (Iteration 3)

**Context**: FR-1000/BR-1004 need a constant-time compare with no `===`/`startsWith`/`includes` on the secret or header; `timingSafeEqual` throws on unequal lengths.
**Decision**: `isAuthorized(header, secret)` returns false for a null header or unset secret, else `timingSafeEqual(sha256(header), sha256('Bearer ' + secret))`. Scheme, case and spacing are covered by the whole-string compare.
**Rejected**: length check then direct compare (leaks length, needs `!==` on lengths of secret values); parsing the scheme (needs `startsWith`).
**Consequences**: the secret never appears in a comparison operator; every wrong header costs two hashes.

## D-005: 401 is built from `RequestError`, 500 from a fresh `Error`  (Iteration 3)

**Context**: `Unauthorized` is in `src/service/errors`, which cleanup.ts may not import (BR-1005); `toErrorResponse` of an arbitrary thrown value could map a store error to a non-500 status.
**Decision**: 401 = `toErrorResponse(new RequestError(401, 'unauthorized'))` (same body as `Unauthorized`); every failure answers `toErrorResponse(new Error('internal'))`.
**Rejected**: importing `Unauthorized`; hand-writing the bodies (drifts from spec 08).
**Consequences**: bodies always equal the spec 08 `unauthorized`/`internal` bodies and carry nothing from the thrown value.

## D-006: `errorName`/`errorMessage` describe the cause  (Iteration 3)

**Context**: `CleanupFailedError` copies its cause's message but its own name is `CleanupFailedError`; FR-1009 wants the original error.
**Decision**: for a `CleanupFailedError` use `error.cause` (`name` if an `Error`, else `typeof`; message or `String(...)`), else the error itself; message `.slice(0, 500)`. `gamesDeleted` is the wrapper's, else 0.
**Rejected**: logging the wrapper (name always the same, hides the real fault).
**Consequences**: a store error message that includes a key path is logged as is (see CONTEXT Known gaps).

## D-007: `durationMs` brackets only `runCleanup`  (Iteration 3)

**Context**: FR-1012 asks for the run's wall-clock time.
**Decision**: `deps.now()` is read right after `getStore` (start), once for `runCleanup`'s `now`, and once after (end); `Math.round(end - start)`. The `now` passed to `runCleanup` is a separate call, so a clock queue in tests sees three reads.
**Rejected**: timing from the request start (includes auth and config).
**Consequences**: with a fixed clock `durationMs` is 0.

## D-008: VC-1022 is documented as "no key remains", not "directory gone"  (Iteration 4)

**Context**: The manual run showed `FileObjectStore.delete` removes files but leaves empty directories (`games/<id>/commits`), so the spec's wording "`games/<id>` no longer exists" is literally false on the file store.
**Decision**: MANUAL-CHECKS.md checks `find <dir> -type f` is empty and records the deviation; the docs iteration uses the same wording. No `src/` change (out of scope; spec 05 is frozen).
**Rejected**: pruning empty directories (touches `src/storage`); marking VC-1022 FAIL (behaviour is correct, only the wording is off).
**Consequences**: `verify-spec` should accept the recorded deviation or amend the spec text.

## D-009: §18 is organised by reader need; limits live in 18.12 and are mirrored in §19  (Iteration 5)

**Context**: FR-1015 lists topics, not a structure; the build record is by iteration.
**Decision**: `development.md` §18 has 12 subsections (what and why, route and auth with responses and logging, cutoff, walk and delete order, cap, failure and resume, skipped markers, code and deps, schedule, tests, try it locally, gotchas). Each retention limit is stated in 18.12 and also as a bullet in §19 (which points back), so §19 stays the single list of limits.
**Rejected**: one subsection per iteration; limits only in §19 (the module sections each keep their own gotchas, §18 follows that).
**Consequences**: the local try-it steps use a `DIR` variable (default `/tmp/podrida`) so the commands can run unchanged on any fresh directory.
