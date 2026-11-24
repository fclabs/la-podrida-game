# Iteration 4 — No-leak, secrets, structure and header checks

**Commit**: this commit — `Add no-leak, secret-logging, structure and header tests for the HTTP API`.

All commands prefixed with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN`. Tests only: `git diff -- app/` is empty.

## Criteria results

| Criterion | Result | Command / evidence |
|---|---|---|
| VC-831: `no-leak.test.ts` passes for both presets; ≥ 1 game-over body and ≥ 1 non-full-deal body with a stock trump | PASS | `pnpm vitest run tests/api/no-leak.test.ts` → 17 passed. Bodies per preset in the table below; the test asserts the exact tallies |
| VC-829: across a full scripted game (two games' tokens, foreign token, `Basic`, lower-case `bearer`, 409, 422, `since` 400, a 500, GETs), the serialized logs (`debug` level) contain no seat token, `Bearer`, seat-token hash, seed, `"hands"`, `"seed"` or `"suit"` | PASS | `pnpm vitest run tests/api/secrets.test.ts` → 2 passed |
| VC-830: `wrapService` `submitMove` rejects `new AiLoopLimitError(1000, <loadLatest state>)` → 500 body is exactly `{ error: { code: 'internal', message: 'Internal error' } }`, no card of `state.hand.hands`, no seed; one `error` line (`AiLoopLimitError`), no seed/hand/card in any line | PASS | same file |
| VC-832: no 4xx/5xx status in `handlers.ts` + four `route.ts`; no `src/state|storage|engine` import; `service-factory.ts` excluded | PASS | `pnpm vitest run tests/api/structure.test.ts` → 14 passed |
| VC-832 mutation: append `export const _teapot = { status: 418 };` to `handlers.ts` → fails | PASS | same command → `1 failed` (`expected [ 'status: 418', '418' ] to deeply equal []`); `git checkout -- app/api/_lib/handlers.ts`; `git diff -- app/` → empty |
| VC-800: 200, 201, 400, 401, 403, 404, 409, 410, 413, 422, 500 (+ presets 200) → `application/json`, `no-store` | PASS | `pnpm vitest run tests/api/headers.test.ts` → 22 passed |
| VC-801: each of the 9 non-2xx bodies parses with `ErrorResponseSchema`, message = `ERROR_MESSAGES[code]` (`Invalid request: body` for the 400), keys exactly `error` (409: `error`, `update`, update parses), no `stack`, no `secret-xyz` | PASS | same file |
| VC-834: `tests/api` Duration < 20 s | PASS | `pnpm vitest run tests/api` → 15 files, 329 tests, **Duration 8.18 s** |
| Gate | PASS | `sh -c 'pnpm typecheck && pnpm lint && pnpm test && pnpm build'` → exit 0; 78 files passed + 1 skipped, 1468 tests passed + 30 skipped (8.64 s); build lists the 4 `ƒ` API routes |
| Scope | PASS | `git diff main -- package.json` → empty; `git diff main -- pnpm-lock.yaml src tests/unit tests/contract tests/sim` → empty |
| Artifacts | PASS | `CONTEXT.md` rewritten; D-016–D-018 appended; this record |

### Bodies checked (VC-831)

| Preset (seats) | Human moves | Bodies | In progress | Game over | No update (422) | Stock trump | Full deal |
|---|---|---|---|---|---|---|---|
| `argentina-fidepo` (4) | 200 | 603 = 1 + 3 × 200 + 2 | 599 | 3 | 1 | > 0 (asserted) | > 0 (hand 0 = 4 × 13, asserted) |
| `spain-ludoteka` (3) | 193 | 582 = 1 + 3 × 193 + 2 | 578 | 3 | 1 | > 0 (asserted) | 12-card hands deal all 36 cards |

Per move: the move response, GET, GET `?since=0`. The 409 and 422 are provoked after move 1. Timings: ≈ 4.3 s and ≈ 3.5 s.

## Files

- Added: `tests/api/support/leak-oracle.ts`, `tests/api/{no-leak,secrets,structure,headers}.test.ts`, this record.
- Changed: `CONTEXT.md`, `DECISIONS.md`.
- Deleted: none. `tests/api/support/api-fixtures.ts` was not changed (no new helper needed; the token/secret lookups live in the tests and the oracle).

## Deviations

- Oracle extras beyond P-12 (D-016): tip-version, `view.you`, stock-size and trump-in-stock assertions; seed and hash substring checks; a return value for tallies; an immutable-commit event cache.
- Explicit 60 s timeout on the two VC-831 games (D-017).
- `structure.test.ts` bans any 4xx/5xx number token in the five files, not only status positions (D-018).
- Extra tests: the `P-12` negative controls (14 mutations), scanner positive controls, presets 200 in `headers.test.ts`.

## Gotchas

- A VC-831 game is ≈ 4–5 s; Vitest's 5 s default timed out once in a full run. ≈ 85 % is the service re-reading every commit for each `?since=0` GET.
- `assertNoLeak` must run right after the response (it asserts the update is at the tip); an idempotent retry body would fail that check by design.
- `argentina-fidepo` with 3 AIs deals the whole deck in hand 0, so there is no stock: a negative-control fixture needing a stock card uses `spain-ludoteka` (hand 0 = 1 card each).
- In zsh, `E="env -u …"; $E cmd` does not word-split (exit 127): write the prefix literally.

## For the next iteration

- Final `tests/api` files (15): `auth`, `body`, `check-order`, `create`, `errors`, `factory`, `get-update`, `headers`, `logging`, `no-leak`, `presets`, `schemas`, `secrets`, `structure`, `submit-move`, plus `support/{api-fixtures,leak-oracle}.ts`. Duration ≈ 8.2 s.
- Behaviour the docs (development.md §16, "no-leak oracle") must state:
  - Public cards: `view.trumpCard` — the turned-up stock card, or, when the hand deals the whole deck (`trumpCardInDealerHand: true`, e.g. 4 seats × 13 French cards, 3 seats × 12 Spanish cards), the dealer's last card, which also stays in the dealer's hand; `currentTrick`, `lastTrick`, `card-played.card` and `hand-dealt.trumpCard`.
  - A `?since=0` GET replays earlier hands' events, so cards from earlier hands appear even when the same card is now in someone's hand or the stock — allowed.
  - At game over `trumpCard` is `null`, `yourHand` is `[]`, `currentTrick` is `[]`.
  - The seat token appears only in the 201 body; no body has `seed`, `seatTokenHashes`, `aiDecisionCount` or a hands-shaped array.
  - Logs never carry tokens, `Authorization`, hashes, seeds, hands or bodies; a 500 body is always the fixed `Internal error`.
  - `GET ?since=0` costs one read per commit (O(tip)); clients should poll with `since=<last version>`.
- Every `DECISIONS.md` entry D-001–D-018 must be marked "reflected in docs §x" or "internal" in the Iteration 5 record.
