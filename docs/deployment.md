# La Podrida — Deployment and Launch Runbook

> For the operator who deploys the game to Vercel. How the system is built and run: [`architecture.md`](./architecture.md) (§6 storage, §9 configuration and secrets, §11 testing and measurements). The scripts used here are summarised in [`development.md`](./development.md) §19.

This runbook takes the project from "builds on Vercel, no storage" to "running in production on Vercel Blob, with recorded evidence". Run the steps in order. Each step says what to run, what to expect, and when to stop. The launch record (section 5) is where every result is written, exactly as printed.

Rules that apply to every step:

- **Secrets stay out of files, chat and logs.** A Blob token, `CRON_SECRET`, a bypass secret or an OIDC token is never committed, pasted into the launch record, or printed. Keep them in the shell of the run (section 1). `.env.local` and `.vercel/` are git-ignored.
- **Record results as measured.** A failing run is recorded as failed, with its JSON line. Do not repeat a run to get a better number; the only allowed repeat is the one in step 3.
- **Production latency is never benchmarked.** The benchmarks run against a Preview deployment and its store, which is the proxy for production. Nothing in this runbook writes test data to the production store except the production `smoke` run (one game, which expires under normal retention).
- **Test games expire normally.** Benchmark and smoke runs leave games in the store; the daily cleanup deletes them like any other game.

---

## 1. Prerequisites and secrets handling

### 1.1 Tools and access

- Vercel CLI, logged in: `vercel login`. Check with `vercel whoami`.
- The Vercel project `la-podrida-game` under your team. Link the checkout to it once with `vercel link` (this writes the git-ignored `.vercel/` folder), and pick the team with `vercel switch` if needed.
- Node 24 and pnpm 10 locally (`nvm use`, then `pnpm install --frozen-lockfile`), as in the [README](../README.md).
- `openssl` to generate secrets.

### 1.2 Where each secret lives

| Secret                                      | Where it lives                                                             | Who uses it                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `CRON_SECRET` (Preview)                     | Vercel env var, Preview environment only                                   | The cleanup route on Preview; `smoke` run against that Preview                                 |
| `CRON_SECRET` (Production)                  | Vercel env var, Production environment only, a different value than above  | The cleanup route on Production; Vercel Cron; `smoke` run against Production                  |
| `BLOB_READ_WRITE_TOKEN` (local, preview)    | The shell of the run only. Never an env var in Vercel, never in a file     | `blob-checks`, `bench-moves --scenario stale`, the contract suite, against the preview store   |
| `VERCEL_PROTECTION_BYPASS`                  | The shell of the run only (the secret is created in the Vercel dashboard)  | `bench-moves` and `smoke` against a Preview protected by Vercel Authentication                 |
| OIDC token (`VERCEL_OIDC_TOKEN`)            | Issued by Vercel to the deployment; you never handle it                    | The deployed app, to reach its Blob store (architecture §9)                                    |

The deployed app has **no** `BLOB_READ_WRITE_TOKEN`: Connecting a store to the project sets `BLOB_STORE_ID` and the app authenticates with the project's OIDC token. The only Blob token that exists is the local one below.

### 1.3 Put a secret in the shell without printing it

Use a silent prompt and paste the value; never write `NAME=value` on a command line (it ends up in shell history):

```sh
read -rs BLOB_READ_WRITE_TOKEN
export BLOB_READ_WRITE_TOKEN
```

Paste the value, press Enter, and nothing is echoed. Remove it when the run is over:

```sh
unset BLOB_READ_WRITE_TOKEN
```

The same pattern applies to `CRON_SECRET` and `VERCEL_PROTECTION_BYPASS`. Close the terminal when the launch is over so no value stays in the session.

### 1.4 Create the preview store's local read-write token

In the Vercel dashboard open **Storage**, open the preview store (created in step 1), and create a read-write token for local use. Copy it straight into the silent prompt of section 1.3. This token is separate from the connection, grants access to the preview store only, and is the reason the deployed app can stay on OIDC. Delete or rotate it when the launch is over.

### 1.5 Create the Protection Bypass for Automation secret

Preview deployments are protected by Vercel Authentication, so a script gets the sign-in page instead of the app. In the dashboard open the project, **Settings**, **Deployment Protection**, and create the **Protection Bypass for Automation** secret. Copy it into the silent prompt (`read -rs VERCEL_PROTECTION_BYPASS`, then `export VERCEL_PROTECTION_BYPASS`). The scripts send it as the `x-vercel-protection-bypass` header, and only when the variable is set. Without it, a call to a protected Preview answers 401 or 403 with the Vercel Authentication page, which is expected and tells you the protection is on.

### 1.6 Generate `CRON_SECRET`

Generate one value per environment (they must differ), each at least 32 hex characters:

```sh
openssl rand -hex 32
```

Copy the output straight into the `vercel env add` prompt of the step that needs it, and into the silent prompt when you run `smoke`. Do not save it in a file. If you must read it again later, take it from the Vercel dashboard (the env var value is shown on request).

---

## 2. Launch runbook

Each step is recorded in the launch record (section 5) before the next one starts.

### Step 1. Configure Vercel for Preview

1. **Project settings.** In the dashboard, **Settings**, **General**: Node.js Version is `24.x` and the framework preset is Next.js. The Git repository is `fclabs/la-podrida-game` and the production branch is `main`. Cross-check with `vercel project inspect`.
2. **Create the preview store.** In **Storage**, create a Blob store named `la-podrida-preview` with **Private** access.
3. **Connect it to Preview only.** In the connection dialog, tick the **Preview** environment and no other. Choose OIDC authentication if the dialog offers a choice.
4. **Set Preview `CRON_SECRET`.** Generate a value (section 1.6), then:

   ```sh
   vercel env add CRON_SECRET preview
   ```

   Paste the value at the prompt. Leave the branch field empty so it applies to every Preview branch.

5. **Check the variables.** Run `vercel env ls` and read the Environments column:
   - `BLOB_READ_WRITE_TOKEN` is **absent** for Preview.
   - `BLOB_STORE_ID` is **present** for Preview.
   - `CRON_SECRET` is present for Preview and **absent** for Production.
6. **Redeploy the pull request's Preview.** Environment changes apply to new builds only: in the dashboard open the Preview deployment and choose **Redeploy** (or push an empty commit to the PR branch). Expect the build to succeed on Node 24 and the deployment to be Ready. Note its URL; it is the `<preview-url>` below.

**Stop and ask the operator if** connecting the store adds a `BLOB_READ_WRITE_TOKEN` variable and the dialog offers no OIDC option. Do not work around it: the deployed app must not hold a long-lived Blob token. Record the launch `BLOCKED` with this step.

### Step 2. Preview checks

Run these on the pull request's Preview deployment, in this order, and record every JSON line in the launch record, verbatim.

**Before starting, compare the quota (Hobby plan).** Blob usage must fit the plan's allowances shown in the dashboard (Storage, Usage). Planned operations: about 3 per create-only write in `blob-checks` (100 rounds with 10 writers is on the order of a few thousand operations), and about 8 per move in the benchmarks (100 samples is on the order of a thousand per scenario). Both scale with `--rounds`, `--writers` and `--samples`; lower them if the allowance is tight. If the store is blocked by a quota during the launch, stop and record `BLOCKED`.

Set the secrets in the shell (section 1.3): `BLOB_READ_WRITE_TOKEN` of the preview store, `CRON_SECRET` of Preview, and `VERCEL_PROTECTION_BYPASS`. Every request the scripts make is aborted after 30 seconds and counted as a failure.

**2.1 Blob checks.** Needs `BLOB_READ_WRITE_TOKEN`.

```sh
pnpm blob-checks
```

Options: `--rounds <1-1000>` (default 100) and `--writers <1-1000>` (default 10). Expect exit 0 and one JSON line on stdout:

```text
{ check:'blob-checks', runId, startedAt, rounds, writers,
  exclusivity:{violations,zeroWinnerRounds,passed},
  consistency:{createThenGet:{n,falseMissing},overwriteThenGet:{n,stale},passed},
  listing:{keys,pageSize,ordered,passed}, delete:{remaining,passed},
  passed, durationMs, error? }
```

Expected: `exclusivity.violations` 0, `falseMissing` 0, `stale` 0, `listing.ordered` true with `keys` 25, `delete.remaining` 0, `passed` true, `durationMs` at most 600000. Exit codes: 0 passed, 1 a check failed or a runtime error, 2 usage (one stderr line naming the option or variable, never a value). Stderr shows `blob-checks run <runId>` before the checks. The script writes only under `checks/<runId>/` and deletes it at the end, also on Ctrl-C or SIGTERM. After SIGKILL the keys stay: delete the `checks/` prefix by hand in the dashboard's store browser.

On `passed: false` the line carries an `error` field (name and a message of at most 200 characters); sections not reached show zero counts, which is not a measurement.

**2.2 Contract suite.** Needs `BLOB_READ_WRITE_TOKEN`.

```sh
pnpm test tests/contract
```

Expected: the Blob tests run (are not reported as skipped) and every test passes. Record the pass and skip counts.

**2.3 Move latency, warm.** Needs the bypass variable if the Preview is protected.

```sh
pnpm bench-moves --base-url https://<preview-url> --scenario warm
```

Options: `--base-url <https url>` (required), `--scenario warm|stale|cold` (required), `--samples <1-1000>` (default 100; not allowed with `cold`), `--p95-limit-ms <1-600000>` (default 500). Run it with 100 samples or more. The script makes 3 untimed moves per game first, then times each move.

**2.4 Move latency, stale hint.** Needs `BLOB_READ_WRITE_TOKEN` of the preview store.

```sh
pnpm bench-moves --base-url https://<preview-url> --scenario stale
```

Before each sample the script overwrites the game's `head.json` in the preview store so the move starts from a hint one commit behind, and checks that the file held the expected version before and after. Exit 1 at the first pre-overwrite read means the token belongs to a different store than the deployment's: stop and fix the token. This scenario is the only one that writes `head.json` into the preview store.

**2.5 Move latency, cold.** Leave the deployment idle for at least 15 minutes (no requests, no browser tab open on it), then:

```sh
pnpm bench-moves --base-url https://<preview-url> --scenario cold
```

It creates a game and times the first move once: `n` is 1 and `passed` is true whatever the time is; the number is recorded, not judged.

The line of every scenario:

```text
{ check:'bench-moves', scenario, baseUrl, startedAt, n, minMs, p50Ms, p95Ms, maxMs,
  baselineMedianMs, limitMs, passed }
```

All times are integer milliseconds (nearest-rank percentiles). `baselineMedianMs` is the median of 20 `GET /api/presets` timings taken after the samples (no storage call): it shows your network distance and is not part of `passed`. For `warm` and `stale`, `passed` is `p95Ms < limitMs`. Exit codes: 0 passed, 1 failed or aborted, 2 usage (one stderr line `bench-moves: <message>`). **A failed or aborted run** (a non-200 answer on any request, a network error, a 30-second timeout, an unparsable body, a `head.json` mismatch) prints `bench-moves: run aborted: <Name>: <message>` on stderr, and its JSON line is shorter: `passed` false, `baselineMedianMs` null, and `n` is the number of samples taken before the abort. Record both the line and the stderr reason.

**2.6 Smoke test.** Needs `CRON_SECRET` of Preview (the secret of the environment you target), and the bypass variable on a protected Preview.

```sh
pnpm smoke --base-url https://<preview-url>
```

Expected: exit 0 and a line with `passed` true and ten steps, all `ok`, in this order: `presets`, `create`, `auth`, `conflict`, `play`, `resume`, `retry`, `no-leak`, `cron-auth`, `cron-run`.

```text
{ check:'smoke', baseUrl, startedAt, steps:[{name,ok}...], passed, durationMs }
```

`durationMs` at most 300000. Exit codes: 0 passed, 1 a step failed, 2 usage (one stderr line naming `--base-url` or `CRON_SECRET`, never a value). **A failed run** stops at the failing step: its `steps` list is shorter, the last entry is the failed one with `ok` false, and stderr has `smoke: failed: <Name>: <message>`. A wrong `CRON_SECRET` fails at `cron-run`.

Also confirm that without the bypass variable the same Preview answers with the Vercel Authentication response (401 or 403), for example `curl -s -o /dev/null -w '%{http_code}\n' https://<preview-url>/api/presets` with the variable unset in that shell. That shows the protection is on and the header is what lets the scripts through.

**2.7 Manual browser checklist.** Walk section 3 on the Preview URL and record each item as pass or fail.

**2.8 Regions.** In the dashboard, note the **function region** of the deployment (project **Settings**, **Functions**) and the **region of the preview store** (the store's settings page). Record both in the launch record.

**2.9 Check for leftovers.** Open the preview store's browser: no `checks/<runId>/` prefix should remain from a finished `blob-checks` run. The store may hold benchmark and smoke games and, from the `stale` scenario, rewritten `head.json` files; they expire under normal retention and are not cleaned by hand.

### Step 3. The gate

The production store is connected, and the production `CRON_SECRET` set, only when every preview result in step 2 is recorded as passing, or as `WAIVED` where a waiver is allowed. Merging the pull request does **not** open the gate: a merge redeploys Production, which stays without storage until step 4.

| Result                                                                                         | Outcome                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exclusivity.violations` above 0                                                               | **Blocks the launch; not waivable.** Record `BLOCKED` and stop. The fix is a design change, not a configuration one.                                                  |
| `listing.ordered` false                                                                        | Recorded `FAILED`. Blocks unless the operator **waives** it: a `WAIVED` entry with the measured values and the operator's name. A follow-up is then opened.            |
| `warm` or `stale` with `p95Ms` at or above `limitMs`                                           | Recorded `FAILED`. Blocks unless the operator **waives** it: a `WAIVED` entry with the measured values and the operator's name. It is never reported as `PASSED`, and no document may say the 500 ms target is met. |
| `consistency` failure, `delete` failure, a failed `smoke`, a failed contract suite, a checklist item that fails | Blocks. Not waivable.                                                                                                                  |
| `blob-checks` with `passed` false, an `error` field and no violation (a transient 5xx or network failure) | May be run **once more**. Record both lines; the gate uses the second. A second failure blocks, except that `listing.ordered` false follows the waiver rule above. |

Write the evaluation in the launch record: every preview result as `PASSED`, `FAILED`, `WAIVED` or `BLOCKED`, and the line `Gate: OPEN` or `Gate: BLOCKED`.

**Stop points.** Stop, and ask the operator before doing anything else, when: an exclusivity violation appears; `listing.ordered` is false or a latency result fails (ask whether to waive; record `FAILED` first, then `WAIVED` only on an explicit answer); `blob-checks` fails twice; a quota blocks the store; the gate is `BLOCKED`. With `Gate: BLOCKED` no production store is created.

When the gate is `OPEN`, merge the pull request.

### Step 4. Production

1. **Create the production store.** In **Storage**, create a Blob store named `la-podrida-production` with **Private** access, connected to the **Production** environment only. Choose OIDC if offered.
2. **Set Production `CRON_SECRET`.** Generate a new value, different from Preview's (section 1.6), then `vercel env add CRON_SECRET production` and paste it.
3. **Check the variables.** `vercel env ls`: for Production `BLOB_READ_WRITE_TOKEN` is absent, `BLOB_STORE_ID` is present, `CRON_SECRET` is present. `vercel blob list-stores` shows `la-podrida-production` connected to the project; its dashboard Access reads Private and its environment list shows only Production. The preview store lists only Preview.
4. **Redeploy `main`.** Redeploy the latest production deployment from the dashboard (or merge a commit to `main`). Expect it Ready, dated after the store was connected.
5. **Smoke test.** With Production's `CRON_SECRET` in the shell (silent prompt, section 1.3):

   ```sh
   pnpm smoke --base-url https://la-podrida-game.vercel.app
   ```

   Expect `passed` true with the ten steps. Production is normally not behind Vercel Authentication, so the bypass variable is not needed there; if the request answers 401 or 403, set it.

6. **Manual checklist.** Walk section 3 once on `https://la-podrida-game.vercel.app` and record each item.

**Stop and roll back (section 4)** if the production smoke test fails or the site misbehaves; record the run as `FAILED`. Production data is not deleted by a rollback.

Production results and the first cron result are recorded in a follow-up documentation-only pull request, because the first pull request is already merged.

### Step 5. First cron run

`vercel.json` schedules `/api/cron/cleanup` with `0 3 * * *` (UTC), on the production deployment only. On the **Hobby plan** the job runs at some point within its hour: expect it between **03:00 and 03:59 UTC** on the first night after the production smoke test.

Read the result in either place:

- `vercel logs` (see `vercel logs --help` for the filter flags) or the dashboard **Logs** view, filtered on the path `/api/cron/cleanup`.
- The dashboard **Settings**, **Cron Jobs** view for the run's status.

Expect status `200` and, in the function log, a line with `route: 'cron/cleanup', status: 200` and its `gamesDeleted`, `capReached`, `skippedMarkers` and `durationMs`. `durationMs` should be below 10000 on a store with no expired games. Copy that line into the launch record.

If the run answers anything but 200, record it as `FAILED` in the launch record. If the cause is the deployment, roll back (section 4). The launch stays open until a run answers 200.

---

## 3. Manual browser checklist

Walk the six items on the deployed site in a real browser, once for Preview and once for Production. Fill in `pass` or `fail`, the date and the URL.

| #   | Item                                                                                                                                                 | Preview (pass/fail, date, URL) | Production (pass/fail, date, URL) |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------- |
| 1   | `/` creates a game and opens `/game/{id}`.                                                                                                           |                                |                                   |
| 2   | A bid and a card play are accepted and animated.                                                                                                     |                                |                                   |
| 3   | Reloading the page resumes the same table and version.                                                                                               |                                |                                   |
| 4   | With the game open in two tabs, a move in tab A and then a move in the stale tab B shows tab B's conflict notice and adopts tab A's state.           |                                |                                   |
| 5   | The score sheet opens.                                                                                                                               |                                |                                   |
| 6   | The game is played to the end and the final ranking shows.                                                                                           |                                |                                   |

A Preview behind Vercel Authentication needs you to be signed in to Vercel in the browser.

---

## 4. Rollback

Rollback applies to **production deployments only**: it points the production domain back at an earlier production deployment. Preview deployments are not rolled back; fix and redeploy them. A rollback never deletes data: the production store, its games and the `CRON_SECRET` stay exactly as they are.

1. **List the deployments** to find the previous good production deployment (the Production environment, newest first):

   ```sh
   vercel ls --environment production
   ```

   `vercel ls` is an alias of `vercel list`. Add `--limit <number>` (default 20, max 100) to see more, or `--next <cursor>` for the next page. Take the deployment's URL or id from the list.

2. **Roll back** to it, using the deployment id or URL:

   ```sh
   vercel rollback <deployment>
   ```

   Options: `--timeout <time>` (how long to wait, default 3 minutes), `--yes` (accept the prompts), `--json`.

3. **Check the rollback** if it did not finish in the wait time:

   ```sh
   vercel rollback status
   ```

   (`vercel rollback status [project]` also takes a project name.)

4. **Verify** with `pnpm smoke --base-url https://la-podrida-game.vercel.app` and a look at the dashboard's production deployment.

A rolled-back production keeps the same environment variables and store; a deployment that needs a configuration fix is fixed by changing the configuration and redeploying, not by rolling back. After a rollback, Vercel stops auto-promoting new deployments to the production domain until you promote one again (dashboard, or `vercel promote <deployment>`): promote the fixed deployment when it is ready.

---

## 5. Launch record

Fill in as the launch runs. Paste each script's JSON line **exactly as printed**, including failed runs, in the order they were made. Never write a token, `CRON_SECRET`, bypass value or OIDC token here.

**Launch status:** OPEN (one of `OPEN`, `BLOCKED`, `COMPLETE`)

### 5.1 Runs

| #   | Environment | Script                                           | Date | URL | JSON line (verbatim) | Result |
| --- | ----------- | ------------------------------------------------ | ---- | --- | -------------------- | ------ |
|     |             | `blob-checks`                                    |      |     |                      |        |
|     |             | contract suite (`pnpm test tests/contract`)      |      |     |                      |        |
|     |             | `bench-moves --scenario warm`                    |      |     |                      |        |
|     |             | `bench-moves --scenario stale`                   |      |     |                      |        |
|     |             | `bench-moves --scenario cold`                    |      |     |                      |        |
|     |             | `smoke` (Preview)                                |      |     |                      |        |
|     |             | `smoke` (Production)                             |      |     |                      |        |

Result is one of `PASSED`, `FAILED`, `WAIVED`, `BLOCKED`. The contract suite has no JSON line: record its pass and skip counts instead. Add one row for every extra run (the one allowed `blob-checks` repeat, a failed run), in order.

### 5.2 Waivers

| Item (latency or listing order) | Measured values | Operator name | Date | Follow-up |
| ------------------------------- | --------------- | ------------- | ---- | --------- |
|                                 |                 |               |      |           |

An exclusivity violation cannot be waived. No row means no waiver.

### 5.3 Regions

| Resource                | Region |
| ----------------------- | ------ |
| Preview functions       |        |
| Preview store           |        |
| Production functions    |        |
| Production store        |        |

### 5.4 Manual checklist results

The checklist is in section 3. Date and URL are recorded there.

| Environment | All six items `pass` | Date | URL |
| ----------- | -------------------- | ---- | --- |
| Preview     |                      |      |     |
| Production  |                      |      |     |

### 5.5 Gate evaluation

| Preview result | Result (`PASSED`, `FAILED`, `WAIVED`, `BLOCKED`) |
| -------------- | ------------------------------------------------ |
| Exclusivity    |                                                  |
| Consistency    |                                                  |
| Listing order  |                                                  |
| Delete         |                                                  |
| Contract suite |                                                  |
| Warm latency   |                                                  |
| Stale latency  |                                                  |
| Cold latency   | recorded, not judged                             |
| Smoke          |                                                  |
| Checklist      |                                                  |

**Gate:** not evaluated (one of `Gate: OPEN`, `Gate: BLOCKED`)

### 5.6 First cron run

| Date and time (UTC) | Status | Function log line (verbatim) | `durationMs` | Result |
| ------------------- | ------ | ---------------------------- | ------------ | ------ |
|                     |        |                              |              |        |
