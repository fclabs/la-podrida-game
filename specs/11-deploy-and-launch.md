# Spec 11 — Deploy and launch

Status: READY (review-spec, see 11-deploy-and-launch.review.md) · Phase 11 of `docs/implementation.md` (milestone M4) · Parents: frozen specs 05 (storage), 06 (state), 08 (HTTP API), 09 (UI), 10 (retention). New requirement IDs use the 1100s range.

## Purpose

The game is complete and tested on the memory and file stores, but it has never run on Vercel Blob. The Vercel project `la-podrida-game` exists and builds, but has no Blob store connected, no `CRON_SECRET`, and runs Node 26.x although the repo and CI pin Node 24. Three claims the architecture depends on are unverified: a create-only `put` is exclusive under concurrency (architecture §6.3, AD-4), a Blob listing is ascending across pages (spec 10 known limit), and a move completes in < 500 ms p95 (architecture §1.2, open question 1; spec 08 BR-806). Phase 5b, which should have measured the first one early, never ran. This spec delivers the launch: three scripts that measure those claims and play a full game over HTTP, the Vercel configuration, a runbook, a production deployment gated on the measurements, and a first successful cron run. Success means every gate is recorded as passed (or a latency miss or an unordered listing as `WAIVED`), the production smoke test passes and the first cron run answers 200; otherwise the spec ends `BLOCKED` or stays open (BR-1102, BR-1105). It benefits the operator, who launches with recorded evidence instead of assumptions, and every later phase, which builds on a store whose behaviour is known.

## Scope

**In**

- Vercel project configuration: Node 24.x, Next.js framework, GitHub preview deployments, production from `main`.
- Two new **private** Blob stores (preview, production), each connected to its own environment only, authenticated by OIDC.
- `CRON_SECRET` for Preview and Production.
- Scripts `scripts/blob-checks.ts`, `scripts/bench-moves.ts`, `scripts/smoke.ts` and their `package.json` entries (no new dependencies).
- The storage contract suite run once against the preview store (the Phase 5b re-run).
- A manual browser checklist.
- `docs/deployment.md` (runbook and launch record); updates to `docs/architecture.md` (§1.2, §9, §11, open question 1), `docs/development.md` (new §19; Known limitations becomes §20) and `README.md` (script list).
- Production deployment, a smoke test on it, and verification of the first scheduled cron run.

**Out**

- Any change under `src/`, `app/` or `vercel.json`, and any change to frozen specs. A failed latency check does not trigger code changes here; see BR-1105.
- Running Blob checks in CI, and adding the Blob token to CI secrets.
- A custom domain, analytics, alerting, rate limiting, and a browser E2E tool.
- Changing the repo to Node 26.
- Deleting the unconnected `testing` Blob store (it is left untouched).
- Cleaning up games created by the benchmark and smoke runs (they expire under the normal retention rule).

## Actors

| Actor | Description | Permissions |
|---|---|---|
| Operator | The repo owner, logged in to the Vercel CLI and dashboard | Creates stores, sets env vars, runs scripts, merges, approves every production-affecting step, may waive a latency result |
| Scripts | `blob-checks`, `bench-moves`, `smoke`, run from the operator's machine | Call a deployed URL over HTTP; `blob-checks` and the stale scenario of `bench-moves` also write to the preview store with a token |
| Vercel Cron | Platform scheduler | Calls `GET /api/cron/cleanup` on the production deployment with `Authorization: Bearer ${CRON_SECRET}` |
| Player | A human in a browser | Plays on the deployed site |

## Functional Requirements

### Vercel configuration

- **FR-1101 (Must)** Given the Vercel project, when its settings are inspected, then Node.js Version is `24.x`, the framework is Next.js, the Git repository is `fclabs/la-podrida-game` and the production branch is `main`.
- **FR-1102 (Must)** Given a pull request on the repository, when Vercel builds it, then it creates a Preview deployment whose build succeeds on Node 24.
- **FR-1103 (Must)** Given the preview Blob store `la-podrida-preview`, when it is created, then its access is private and it is connected to the Preview environment of the project and to no other environment.
- **FR-1104 (Must)** Given the Preview environment (and, after FR-1123, the Production environment), when its environment variables are listed, then `BLOB_READ_WRITE_TOKEN` is absent and `BLOB_STORE_ID` is present (the deployed app authenticates by OIDC, architecture §9). The token the operator needs for local runs is a separate read-write token for the preview store created in its dashboard, kept only in the shell.
- **FR-1105 (Must)** Given the Preview environment, when `CRON_SECRET` is set, then it holds a random value of at least 32 hex characters, created with `openssl rand -hex 32`, never printed to a log or committed. Production's secret is set in FR-1123, with its own value.
- **FR-1106 (Must)** Given Preview deployments are protected by Vercel Authentication, when a script sends the header `x-vercel-protection-bypass: <value of env VERCEL_PROTECTION_BYPASS>`, then the request reaches the deployment; the header is sent only when the variable is set.

### `scripts/blob-checks.ts` (`pnpm blob-checks`)

Env: `BLOB_READ_WRITE_TOKEN` (required, the preview store's token). Options: `--rounds <n>` (default 100), `--writers <n>` (default 10); both a decimal integer 1–1000. A bad option or a missing token exits 2 with one stderr line (the line names the variable, never a value). Before the checks start it prints `blob-checks run <runId>` to stderr. It uses `VercelBlobObjectStore` directly and writes only under the prefix `checks/<runId>/`.

- **FR-1107 (Must)** Exclusivity. Given `rounds` rounds, when `writers` create-only `put`s with distinct bodies run concurrently to one new key, then the round is a violation if more than one resolves, or if the stored body is not byte-equal to one writer's body, or if the one that resolved is not the writer whose body is stored. Every writer that does not resolve must reject with `ObjectExistsError`; any other error fails the run. Rounds with zero resolved writers are counted as `zeroWinnerRounds`, not violations (the SDK-retry caveat, architecture §6.1).
- **FR-1108 (Must)** Consistent reads. Given `rounds` rounds each, when a key is created and read at once, then a `get` never returns `null`; and when a key is overwritten and read at once, then the `get` returns the new body, never the old one.
- **FR-1109 (Must)** Listing and delete. Given 25 keys under `checks/<runId>/list/`, when they are listed with page size 10 following the cursor, then the concatenated keys are strictly ascending with no duplicate (`listing.ordered`). When all 25 are deleted, then `exists` is false for every one.
- **FR-1110 (Must)** Output. When the run ends, then one JSON line is written to stdout and the exit code is 0 iff `passed` is true (1 when false, 2 for usage errors). The line is `{ check: 'blob-checks', runId, startedAt, rounds, writers, exclusivity: { violations, zeroWinnerRounds, passed }, consistency: { createThenGet: { n, falseMissing }, overwriteThenGet: { n, stale }, passed }, listing: { keys, pageSize, ordered, passed }, delete: { remaining, passed }, passed, durationMs }`. `exclusivity.passed` is `violations === 0`; `consistency.passed` is `falseMissing === 0 && stale === 0`; `listing.passed` is `ordered`; `delete.passed` is `remaining === 0`; `passed` is the AND of the four. An unexpected error (anything other than a counted violation or an `ObjectExistsError` from a losing writer) ends the run with `passed: false` and an `error` field holding the error name and a message of at most 200 characters. No token appears in stdout, stderr or any error text.
- **FR-1111 (Must)** Cleanup. When the run ends, including by SIGINT or SIGTERM, then every key under `checks/<runId>/` is deleted, repeating list-and-delete until a listing is empty or 20 rounds have run. (After SIGKILL the keys stay; the operator deletes the `checks/` prefix by hand.)

### Contract suite

- **FR-1112 (Must)** Given `BLOB_READ_WRITE_TOKEN` of the preview store, when `pnpm test tests/contract` runs, then the Blob run is not skipped and every test passes.

### `scripts/bench-moves.ts` (`pnpm bench-moves`)

Options: `--base-url <https url>` (required), `--scenario warm|stale|cold` (required), `--samples <n>` (default 100, decimal integer 1–1000, for `warm` and `stale`; not accepted for `cold`, which always takes 1), `--p95-limit-ms <n>` (default 500). Env: `VERCEL_PROTECTION_BYPASS` (optional), and `BLOB_READ_WRITE_TOKEN` (required for `stale`, which writes to the preview store). Invalid usage exits 2 with one stderr line.

A **sample** is the elapsed time, measured with `performance.now()`, from sending a `POST /api/games/{id}/moves` request to reading its full response body, for a request that answers 200. The script creates games with `humanName` `bench`, `aiCount` 2 and the default preset, and plays the first entry of `legalMoves` each time; when a game ends it creates a new one.

- **FR-1113 (Must)** Warm. Given `--scenario warm`, when samples are taken, then each is a move request sent right after the previous response, in sequence, on a deployment that has served the script's own earlier requests (the script first makes 3 untimed move requests).
- **FR-1114 (Must)** Stale hint. Given `--scenario stale`, when each sample is taken, then immediately before it the script overwrites the game's `head.json` with a valid head document (spec 06) pointing to `version − 1`, where `version` is the last version it received, so the move request starts from a hint exactly one commit behind. The script first makes the game's first move untimed, so `version ≥ 1`, and before each overwrite reads the game's `head.json` with a consistent `get`: if it is missing or does not hold `version`, the run ends with exit 1 (this catches a token for a different store than the deployment's). After each overwrite it reads `head.json` back the same way; if it does not hold `version − 1` the run ends with exit 1.
- **FR-1115 (Must)** Cold. Given `--scenario cold`, when the script runs, then it creates a game with no preceding warm-up request and times the first move request, once (the operator leaves the deployment idle for at least 15 minutes before each run).
- **FR-1116 (Must)** Baseline. When any scenario runs, then after the timed samples the script takes 20 timings of `GET /api/presets` (no storage call) and reports their median as `baselineMedianMs`; it documents the operator's network distance and is not part of `passed`.
- **FR-1117 (Must)** Output. When the run ends, then one JSON line `{ check: 'bench-moves', scenario, baseUrl, startedAt, n, minMs, p50Ms, p95Ms, maxMs, baselineMedianMs, limitMs, passed }` is written (percentiles by nearest rank on the sorted samples; milliseconds rounded to integers). `passed` is `p95Ms < limitMs` for `warm` and `stale`, and always true for `cold` (recorded, not judged). The exit code is 0 iff `passed`. A non-200 response to a timed request, or a network error, ends the run with exit 1 and `passed: false`. The bypass value and the token never appear in the output.

### `scripts/smoke.ts` (`pnpm smoke`)

Options: `--base-url <https url>` (required). Env: `CRON_SECRET` (required, the secret of the target environment), `VERCEL_PROTECTION_BYPASS` (optional). Missing input exits 2 with one stderr line naming the option or variable, never a value.

- **FR-1118 (Must)** Steps. When run, then the script performs these steps in order, each recorded as `{ name, ok }`, and stops at the first failure:
  1. `presets`: `GET /api/presets` answers 200 with a `defaultPresetId` that is one of its `presets`.
  2. `create`: `POST /api/games` (`humanName` `smoke`, `aiCount` 2) answers 201.
  3. `auth`: `GET /api/games/{id}` without `Authorization` answers 401.
  4. `conflict`: two move requests with different legal moves, different `moveId` and `clientRequestId`, both for the version returned by `create`, sent concurrently, answer one 200 and one 409 whose body has an `update`. If `create`'s `legalMoves` has fewer than 2 entries, the step fails.
  5. `play`: the script plays the first legal move until the view says the game is finished, in at most 2,000 moves, and the final view has a score for every seat.
  6. `resume`: `GET /api/games/{id}` answers 200 with the version of the last move response; `GET /api/games/{id}?since=0` answers 200 with a non-empty `events` array.
  7. `retry`: re-sending the first accepted move request unchanged answers 200 with a body deep-equal to its original response.
  8. `no-leak`: across all response bodies of the run, no object has a key named `seed`, and the seat token appears only in the `create` response.
  9. `cron-auth`: `GET /api/cron/cleanup` without `Authorization` answers 401.
  10. `cron-run`: `GET /api/cron/cleanup` with `Authorization: Bearer ${CRON_SECRET}` answers 200 with integer `gamesDeleted`, boolean `capReached` and integer `skippedMarkers`.
- **FR-1119 (Must)** Output. When the run ends, then one JSON line `{ check: 'smoke', baseUrl, startedAt, steps: [...], passed, durationMs }` is written, the exit code is 0 iff `passed`, and no token, secret or bypass value appears in the output.

### Manual browser check

- **FR-1120 (Must)** Given the deployed site, when the operator walks the checklist in `docs/deployment.md`, then each item is recorded `pass` or `fail`: (1) `/` creates a game and opens `/game/{id}`; (2) a bid and a card play are accepted and animated; (3) reloading the page resumes the same table and version; (4) with the game open in two tabs, a move in tab A and then a move in stale tab B shows tab B's conflict notice and adopts tab A's state; (5) the score sheet opens; (6) the game is played to the end and the final ranking shows.

### Launch sequence and recording

- **FR-1121 (Must)** Given this spec's pull request, when the launch runs, then the runbook follows this sequence, and each step is recorded before the next starts:
  1. Create the preview store, connect it to Preview, set Preview's `CRON_SECRET`, set Node 24.x, and redeploy the PR's Preview (environment changes apply to new builds only).
  2. On that Preview: `blob-checks` once, the contract suite once, `bench-moves` `warm` and `stale` once each with ≥ 100 samples, `bench-moves` `cold` once (after ≥ 15 idle minutes), `smoke` once, the manual checklist once.
  3. Evaluate the gate (BR-1101); then merge the PR. Merging redeploys Production, which stays without storage until step 4.
  4. FR-1123 and FR-1124 (production), then FR-1125.
  The Production results and the cron result are recorded in a follow-up docs-only pull request.
- **FR-1122 (Must)** Given the recorded preview results, when they are written up, then `docs/architecture.md` §11 replaces the "Pending: preview measurements" paragraph with a table of the results (script, date, deployment URL, key numbers, pass/fail), §1.2 and open question 1 state the measured p95 values and say they were measured on Preview as a proxy for production, and `docs/deployment.md` "Launch record" holds each script's full JSON line verbatim and the regions of the functions and of the preview store.
- **FR-1123 (Must)** Given the preview gate has passed (BR-1101), when the operator creates the production store `la-podrida-production` (private, connected to Production only) and sets Production's `CRON_SECRET`, then the production deployment is redeployed from `main`; Production's `CRON_SECRET` is a random value of at least 32 hex characters, different from Preview's, and Production has no `BLOB_READ_WRITE_TOKEN` (FR-1104).
- **FR-1124 (Must)** Given the redeployed production site, when `pnpm smoke --base-url https://la-podrida-game.vercel.app` runs with Production's `CRON_SECRET`, then it passes, and the manual checklist is walked once on it.
- **FR-1125 (Must)** Given the production deployment, when the first scheduled run of the `0 3 * * *` cron has happened (Hobby plan: any time from 03:00 to 03:59 UTC), then the Vercel cron log shows status 200 for `/api/cron/cleanup` and the function log has the line `route: 'cron/cleanup', status: 200` with its `gamesDeleted`, `capReached`, `skippedMarkers` and `durationMs`, copied into the launch record. If that run answers anything but 200, the launch record says `FAILED`, the operator rolls back per FR-1129 if the cause is the deployment, and the spec stays open.
- **FR-1126 (Must)** Given `blob-checks` ends with `passed: false` and no `exclusivity.violations`, when the cause is an unexpected error (a transient 5xx or network failure), then the operator may run it once more; both lines are recorded (BR-1108) and the gate uses the second. A second failure blocks the launch, except that `listing.ordered: false` follows BR-1102.
- **FR-1127 (Should)** Given the results, when the Blob listing check is recorded, then spec 10's known limit "listing order is assumed, not verified" is replaced in `docs/development.md` by the measured outcome.
- **FR-1128 (Must)** `docs/deployment.md` exists with: the ordered runbook (each command, expected result, and the step at which to stop), the manual checklist, the rollback instructions (below) and the launch record. `docs/development.md` §19 "Deployment and launch checks" summarises it and links to it; Known limitations becomes §20 with its cross-references updated; `README.md` lists the three new scripts.
- **FR-1129 (Must)** Rollback. Given a bad production deployment (including a failed production smoke test), then the runbook gives `vercel rollback` to the previous production deployment and the command to list deployments; production data is never deleted by a rollback. Rollback applies to production deployments only.
- **FR-1130 (Must)** `package.json` gains `blob-checks`, `bench-moves` and `smoke` scripts, each `tsx scripts/<name>.ts`; `dependencies` and `devDependencies` are otherwise unchanged; `pnpm typecheck`, `pnpm lint` and `pnpm test` still pass.

## Business Rules

- **BR-1101 Production gate.** The production Blob store is connected, and Production's `CRON_SECRET` set, only after every preview result of FR-1121 is recorded as passing, or the latency result (BR-1103) or the listing-order result (BR-1102) is recorded `WAIVED` by the operator. Rationale: today nothing connects production to storage, so the order of the steps is the gate; it cannot be bypassed by a merge.
- **BR-1102 Exclusivity is not waivable; listing order is.** An exclusivity violation (FR-1107) blocks the launch; a transient error follows FR-1126. An unordered listing (`listing.ordered` false) also blocks the launch, because spec 10's early stop could then skip expired markers; the operator may waive it as `WAIVED` with the measured values and the operator's name (a listing is only a hint, architecture §6.3), and a follow-up spec is then opened. Resolution of a violation is a new spec that revises architecture §6.3 while keeping versioned commits, `eventsSince`, replay and idempotent retries (a single mutable state blob is not acceptable), then a rerun of the contract, concurrency, idempotency and replay tests and of this spec's preview checks.
- **BR-1103 Latency result.** `warm` or `stale` with `p95Ms ≥ limitMs` fails the check. The operator may waive it for launch; the waiver is recorded as `WAIVED` with the measured values and is never reported as passed, and the docs keep the 500 ms claim marked unmet (BR-1106).
- **BR-1104 Separate private stores.** The preview store is connected only to Preview, the production store only to Production, and both are private.
- **BR-1105 No code change in this spec.** A latency miss is handled by a follow-up spec implementing the mitigations (cache `meta.json` reads, parallelize head and probe reads, then reconsider the probe strategy), after which the benchmark is rerun; this spec stays open until a passing run or a waiver is recorded.
- **BR-1106 No unearned claims (spec 08 BR-806).** No document says the 500 ms p95 target is met except by citing a recorded passing `warm` and `stale` run.
- **BR-1107 Secrets stay out.** No Blob token, `CRON_SECRET`, bypass value or OIDC token is committed, printed by a script, or written to the launch record. Local `.env.local` and `.vercel/` stay git-ignored. The operator's `BLOB_READ_WRITE_TOKEN` lives only in the shell of the run.
- **BR-1108 Results are recorded as measured.** A failing run is recorded as failed with its JSON line, not rerun until it passes without the failure being recorded.

## Non-Functional Requirements

- **NFR-1** A full `blob-checks` run with defaults completes in ≤ 10 minutes and a `smoke` run in ≤ 5 minutes, each on the preview deployment from the operator's machine.
- **NFR-2** `warm` and `stale` p95 < 500 ms with ≥ 100 samples each, or a recorded `FAILED` plus `WAIVED` pair (BR-1103); `cold` is recorded once with no threshold; `baselineMedianMs` is recorded with every run so network distance is visible. The numbers are measured on Preview as a proxy for production; no benchmark touches the production store.
- **NFR-3** The first production cron run answers 200 with `durationMs` < 10,000 on a store with no expired games (a sanity bound; the 500-game batch cap is covered by spec 10's tests).
- **NFR-4** Blob usage fits the Hobby allowances. Before step 2 of FR-1121 the operator compares the planned operations (about 3 per create-only write in `blob-checks`, 8 per move in the benchmark; both scale with `--rounds`, `--writers` and `--samples`) with the allowances shown in the Vercel dashboard and may lower those options; if the store is blocked by a quota during the launch, the operator stops and records `BLOCKED`. All scripts abort any HTTP request that takes longer than 30 s and count it as a failure.

## Data & Interfaces

| Item | Definition |
|---|---|
| New files | `scripts/blob-checks.ts`, `scripts/bench-moves.ts`, `scripts/smoke.ts`, `docs/deployment.md` |
| `package.json` scripts | `"blob-checks": "tsx scripts/blob-checks.ts"`, `"bench-moves": "tsx scripts/bench-moves.ts"`, `"smoke": "tsx scripts/smoke.ts"` |
| Env read by scripts | `BLOB_READ_WRITE_TOKEN` (`blob-checks`, `bench-moves --scenario stale`, contract suite), `CRON_SECRET` (`smoke`), `VERCEL_PROTECTION_BYPASS` (all HTTP scripts, optional; the project's "Protection Bypass for Automation" secret) |
| Deployed env vars | `BLOB_STORE_ID` (set by the store connection), `CRON_SECRET` |
| Routes called | `POST /api/games`, `GET /api/games/{id}[?since]`, `POST /api/games/{id}/moves`, `GET /api/presets`, `GET /api/cron/cleanup` (frozen specs 08 and 10, unchanged) |
| Storage keys written | `checks/<runId>/…` (`blob-checks`); `games/{id}/head.json` (`bench-moves` stale, per spec 06 key and schema); everything else only through the API |
| Vercel resources | Blob stores `la-podrida-preview` and `la-podrida-production` (private); env vars `CRON_SECRET` (Preview, Production), Blob store id (set by the connection) |
| Docs touched | `architecture.md` §1.2, §9, §11, open question 1; `development.md` §19 (new), §20 (was §19); `README.md`; spec 10's known limit on listing order, as restated in `development.md` |
| Exit codes (all scripts) | 0 pass, 1 check failed or runtime error, 2 usage error |

## Verification Criteria

- VC-1101: the project's dashboard settings read Node.js Version `24.x`, Git repository `fclabs/la-podrida-game`, Production Branch `main` and framework Next.js (the dashboard is authoritative; `vercel project inspect` is a cross-check where it prints those fields) → FR-1101.
- VC-1102: the PR for this spec gets a Vercel Preview deployment with status Ready, whose build log shows Node 24 → FR-1102.
- VC-1103: the dashboard settings of `la-podrida-preview` read Access `Private` and list only the Preview environment for the project (`vercel blob list-stores` is a cross-check for the connection) → FR-1103.
- VC-1104: `vercel env ls` for Preview (and, after FR-1123, for Production) shows no `BLOB_READ_WRITE_TOKEN` and shows `BLOB_STORE_ID`; a `smoke` run on that deployment passes → FR-1104.
- VC-1105: `vercel env ls` shows `CRON_SECRET` for Preview, and `smoke` on the Preview with that secret gets 200 at `cron-run` while the no-header call gets 401; before FR-1123 `vercel env ls` shows no `CRON_SECRET` for Production → FR-1105, BR-1101.
- VC-1106: `smoke` against the protected Preview URL with `VERCEL_PROTECTION_BYPASS` set passes step 1; the same call without the variable answers the Vercel Authentication response (401 or 403) → FR-1106.
- VC-1107: `pnpm blob-checks` on the preview store → `exclusivity.violations` is 0 over 100 rounds × 10 writers, and `exclusivity.passed` is true.
- VC-1108: the same run → `createThenGet.falseMissing` is 0 and `overwriteThenGet.stale` is 0 over 100 rounds each.
- VC-1109: the same run → `listing.ordered` is true across 3 pages of 10 and `delete.remaining` is 0.
- VC-1110: `pnpm blob-checks --rounds 0` exits 2 with one stderr line; with `BLOB_READ_WRITE_TOKEN` unset it exits 2 with one stderr line naming the variable; a forced error (an invalid token) exits 1 with `passed: false` and an `error` field; stdout and stderr of a normal run contain no substring of the token → FR-1110 (failure and boundary paths).
- VC-1111: after a normal run, and after one stopped halfway with Ctrl-C (its `runId` is in the stderr line `blob-checks run <runId>`), listing `checks/<runId>/` on the store returns no keys → FR-1111.
- VC-1112: `pnpm test tests/contract` with the preview token reports the Blob tests run (not skipped) and zero failures → FR-1112.
- VC-1113: `pnpm bench-moves --base-url <preview> --scenario warm` → `n` is 100 and the output line has `passed` equal to `p95Ms < 500`.
- VC-1114: `--scenario stale` with the token → `n` is 100 and exit is 0, which means `head.json` held `version` before each overwrite and `version − 1` after it; with the token of a different store than the deployment's the run exits 1 at the first pre-overwrite read → FR-1114.
- VC-1115: `--scenario cold` after ≥ 15 idle minutes → `n` is 1 and `passed` is true whatever `p95Ms` is; `--scenario cold --samples 2` exits 2 → FR-1115.
- VC-1116: every bench output line has an integer `baselineMedianMs` computed from 20 `GET /api/presets` timings → FR-1116.
- VC-1117: a bench run against a URL that answers 404 on moves exits 1 with `passed: false`; `--samples 0` and a missing `--scenario` exit 2; `stale` without a token exits 2 → FR-1117 (failure and boundary paths).
- VC-1118: `pnpm smoke --base-url <preview>` → `passed` is true and `steps` lists the ten step names of FR-1118 in order, all `ok`.
- VC-1119: `pnpm smoke` with `CRON_SECRET` unset exits 2 with one stderr line naming `CRON_SECRET`; with a wrong `CRON_SECRET` it fails at `cron-run` with exit 1, and no secret is printed in either case → FR-1119.
- VC-1120: the checklist in `docs/deployment.md` has all six items marked `pass` for Preview and for Production, each with the date and URL → FR-1120.
- VC-1121: the launch record holds the JSON lines of `blob-checks` (1), contract suite result (1), `bench-moves` warm (1), stale (1), cold (1), `smoke` (1) for the Preview deployment → FR-1121.
- VC-1122: `docs/architecture.md` §11 no longer contains "Pending: preview measurements", contains a results table whose numbers equal the launch record, and open question 1 states the measured `warm` and `stale` p95 → FR-1122.
- VC-1123: `vercel blob list-stores` shows `la-podrida-production` connected to the project; its dashboard access reads Private and its environment list shows only Production; a Production deployment dated after the connection exists → FR-1123.
- VC-1124: `pnpm smoke --base-url https://la-podrida-game.vercel.app` passes with Production's `CRON_SECRET`, and the production checklist is recorded → FR-1124.
- VC-1125: after the first scheduled run, `vercel logs` (or the dashboard cron view) shows the `/api/cron/cleanup` call with status 200 and the `cron/cleanup` info line; its `durationMs` is in the record and is < 10,000 → FR-1125, NFR-3.
- VC-1126: a `blob-checks` line with `passed: false` and an `error` field is followed by at most one further run, both lines are in the record, and a second failure leaves the record at `BLOCKED` with no production store connected → FR-1126.
- VC-1138: a recorded `exclusivity.violations` > 0 leaves no production Blob store connected and the record at `BLOCKED`, with no `WAIVED` entry for it; a recorded `listing.ordered: false` does the same unless the record holds a `WAIVED` entry for it → BR-1102.
- VC-1127: `docs/development.md` no longer says the Blob listing order is unverified and states the recorded `listing.ordered` outcome → FR-1127.
- VC-1128: `docs/deployment.md` has the runbook, checklist, rollback and launch record sections; `docs/development.md` has §19 "Deployment and launch checks" and §20 "Known limitations" with every `§19` cross-reference to Known limitations updated (grep finds none pointing to the old number); `README.md` lists the three scripts → FR-1128.
- VC-1129: the runbook rollback section names `vercel rollback`, the deployment-listing command and the production-only limit; `vercel rollback --help` exists and lists the same argument form → FR-1129.
- VC-1130: `git diff main -- package.json` adds exactly the three script entries; `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass → FR-1130.
- VC-1131: a recorded `warm` run with `p95Ms` ≥ 500 → the launch record states `FAILED` for it, and production stays unconnected unless the record also holds a `WAIVED` entry with the measured values and the operator's name → BR-1101, BR-1103.
- VC-1132: with a failing latency run recorded, no document contains a sentence claiming the 500 ms p95 target is met → BR-1106.
- VC-1133: `git diff main --stat -- src app vercel.json specs/*-frozen.md` is empty → BR-1105, Scope/Out.
- VC-1134: `git grep -n -E "BLOB_READ_WRITE_TOKEN=[^ ]|CRON_SECRET=[^ ]|x-vercel-protection-bypass: [A-Za-z0-9]{8}" -- . ":(exclude)specs" | grep -v -E "=(\.\.\.|…)|local-test-secret"` prints nothing (placeholders `...` and `…` and the documented dummy `local-test-secret` are allowed; `specs/` is excluded because it quotes the pattern), and `git check-ignore .env.local .vercel` lists both → BR-1107.
- VC-1135: the launch record contains the JSON line of every run made, including any failed one, in order → BR-1108.
- VC-1136: the dashboards of both stores show Access `Private`; the preview store lists only Preview and the production store only Production (`vercel blob list-stores` as a cross-check) → BR-1104.
- VC-1137 (NFR end-to-end): the recorded `durationMs` of `blob-checks` is ≤ 600,000 and of `smoke` ≤ 300,000; `warm` and `stale` `p95Ms` are < 500, or the record holds a `FAILED` plus `WAIVED` pair for them; the `cold` run and each `baselineMedianMs` are in the record; the record names the preview regions → NFR-1, NFR-2, NFR-4.
- VC-1139 (launch complete): the record holds, in the order of FR-1121, passing (or `WAIVED`) preview results; the production `smoke` line with `passed: true`; the production checklist; and a first cron run with status 200 → the launch is complete, and until all four exist the record says `OPEN` or `BLOCKED`.

## Assumptions

- The operator creates the preview store's local read-write token in the dashboard; it is not the connection's env var and is never deployed.
- Connecting a private Blob store to the project supplies the store id and OIDC authentication as architecture §9 describes. If the connection instead adds a long-lived `BLOB_READ_WRITE_TOKEN` and no OIDC option exists, the operator stops, and architecture §9 is revised in a new decision before launch.
- The operator has access to the `fcastaneda-4717s-projects` Vercel team and can create Blob stores and environment variables.
- Production (`la-podrida-game.vercel.app`) is not behind Vercel Authentication, so `smoke` on it needs no bypass; if it is protected, the same variable is used.
- The Hobby plan allows the daily cron and the project's Vercel Authentication protection of Preview deployments; the bypass secret is created by the operator in the project's Deployment Protection settings.
- `cold` has no threshold: a cold start is recorded, not judged, because architecture §1.2 states a p95 target and a cold start is a rare tail event.
- The benchmark time is client-observed from the operator's machine, so it includes network distance; `baselineMedianMs` documents that distance.
- A game played by the scripts finishes within 2,000 moves of the first legal move; a game of 3 players has far fewer.
- Frozen specs 05, 06, 08, 09 and 10 describe the deployed behaviour; the `legalMoves` entries expose the move id the move route needs (spec 07/08).

## Open Questions

None.
