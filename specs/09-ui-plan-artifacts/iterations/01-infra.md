# Iteration 1 — Branch, test infrastructure, small pure modules

Commit: this commit, on `spec/09-ui` (created from `main` at `7eb81ae`).

## Criteria results

| Criterion | Command | Result |
|---|---|---|
| Branch + freeze | `git branch --show-current`; `git show --stat HEAD` | PASS: `spec/09-ui`; stat lists `specs/08-http-api-frozen.md` added and the 08 working files deleted |
| VC-961 part: no peer warnings | `pnpm install --frozen-lockfile` (and the earlier `pnpm add -D -E ...`) | PASS: no peer-dependency warnings (only the engine WARN for local Node 26 and the pre-existing esbuild build-script notice) |
| `dependencies` unchanged | `node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies).sort().join())"` | PASS: `@noble/hashes,@vercel/blob,next,react,react-dom,zod`, identical to `main` |
| New devDeps exact | `grep -E '"(jsdom\|@testing)' package.json` | PASS: 4 entries, none with `^`/`~` |
| Both projects run; smoke | `pnpm test`; `pnpm vitest run --project ui` | PASS: 85 files + 1 skipped, 1496 tests + 30 skipped; ui: 7 files, 28 tests; smoke covers JSX, presets 200, create 201 (26-char `gameId`, 43-char `seatToken`) |
| VC-904 slot | `pnpm vitest run --project ui tests/ui/slot.test.ts` | PASS |
| VC-924 id part | `... tests/ui/ids.test.ts` | PASS (1,000 distinct v4 ids without `randomUUID`) |
| VC-944 label part | `... tests/ui/cards.test.ts` | PASS |
| Copy verbatim | `... tests/ui/copy.test.ts` | PASS (FR-903, 905, 907, 908, 917, 918, 928 and more) |
| VC-947 | `... tests/ui/boundaries.test.ts`; temporarily added `import '@/app/api/_lib/http';` to `app/_client/tmp-bad.ts` | PASS: passes clean; with the bad file it failed with `app/_client/tmp-bad.ts: @/app/api/_lib/http: imports from app/api`; file removed again |
| Typecheck / lint / test | `pnpm typecheck`; `pnpm lint`; `pnpm test` | PASS / PASS / PASS (also `pnpm build` PASS) |
| Artifacts | this directory | PASS |

## Files

- Added: `specs/08-http-api-frozen.md` (staged from untracked), `specs/09-ui-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-infra.md}`, `tests/ui/{setup.ts,smoke.test.tsx,slot.test.ts,ids.test.ts,cards.test.ts,copy.test.ts,kept-update.test.ts,boundaries.test.ts}`, `tests/ui/support/in-process-api.ts`, `app/_client/{slot,ids,cards,copy,kept-update}.ts`, `app/globals.css`.
- Changed: `package.json`, `pnpm-lock.yaml`, `vitest.config.ts`, `tsconfig.json`, `app/layout.tsx`.
- Deleted: `specs/08-http-api.md`, `specs/08-http-api.review.md`, `specs/08-http-api-plan.md`, `specs/08-http-api-plan-artifacts/**`.
- Untouched and untracked: `specs/09-ui.md`, `specs/09-ui.review.md`, `specs/09-ui-plan.md`.

## Deviations

- `Card` is derived from `PlayerView` instead of imported from `@/src/domain/types` (not exported there): D-008.
- Extra `kept-update.test.ts` (P-4 behaviour), not listed in the plan's Touches.
- `RecordedCall` has a `status` field beyond the plan's list; `failNext` takes an optional `match` second argument.
- No `@vitejs/plugin-react` (not needed).
- No copy for markers/labels the spec does not give (CONTEXT Known gaps).

## Gotchas

- jsdom does not replace Node's `Request`/`Response`; the only global to watch is `AbortSignal` (never hand jsdom's signal to Node's `Request`).
- Testing Library auto-cleanup is off without Vitest globals; `tests/ui/setup.ts` registers it.
- `pnpm test` forks one worker per file; the `ui` project adds ~0.7 s.
- `tests/ui/boundaries.test.ts` treats `import { type X } from '@/src/domain/types'` as a value import (must be `import type`).

## For the next iteration

- Run only UI tests: `pnpm vitest run --project ui [file]`.
- `makeInProcessApi(opts?: MakeApiOptions)` -> `{ fetch, api, calls, failNext }`; `failNext(mode, match?)` with modes `'reject-before'`, `'reject-after'`, `'hang'`, `{ status, body }`; `api.store`/`api.service` give the server tip for VC-925/VC-945. Pass `fetch` as `ClientDeps.fetch`.
- devDependency versions: jsdom 31.0.1, @testing-library/react 16.3.3, @testing-library/dom 10.4.2, @testing-library/user-event 14.6.13.
- Iterations 2 and 3 may run in parallel; neither may touch config, fixtures or `copy.ts`'s existing keys (add new keys only if needed and say so).
- Import `Card` via `PlayerView['yourHand'][number]` (D-008).
