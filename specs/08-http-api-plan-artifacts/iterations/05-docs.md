# Iteration 5 — Documentation and manual curl session

**Commit**: this commit — `Document the HTTP API and record the manual curl session`. Final iteration of Phase 8.

All commands prefixed with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN`. `SP` = the session scratchpad.

## Criteria results

| Criterion | Result | Command / evidence |
|---|---|---|
| VC-835 (1) server on a scratch store | PASS | `STORAGE_DRIVER=file FILE_STORE_DIR=$SP/curl-store pnpm dev` (background) → `✓ Ready in 213ms`; `.data/` never created (`ls .data` → no such file) |
| VC-835 (2) session to `game-over`, loop posting `legalMoves[0].id` | PASS | `$SP/curl/session.sh` (transcript below): presets 200, create 201, GET 200, 200 × 200 moves, final GET 200 |
| VC-835 (3) statuses, one commit per version, final view | PASS | `ls …/games/<id>/commits` → 201 files, contiguous `00000000…00000200`; last GET `phase: game-over`, `finalRanking` 4 entries, `trumpCard: null`, `yourHand: []`, `legalMoves: []`. Probes: 401, 400 `since`, 409 (`update.version` 200), 422, 404 (`BAD`), 413 (20,000 B), 400 no `Content-Type`, 400 `seed`; `cache-control: no-store`, `content-type: application/json`. Server log: 208 request lines for 208 requests, token and `Bearer` 0 hits |
| VC-835 literal doc run (D-020) | PASS | `sh` blocks of development §16.10 extracted with `awk`, `.data/` → fresh scratch store, new server: 205 requests (1 × 201, 204 × 200), 201 commit files, `game-over` + `finalRanking`, token 0 hits in log |
| VC-835 (4) server stopped | PASS | `TaskStop` both runs; `lsof -iTCP:3000 -sTCP:LISTEN` → nothing; `pgrep -fl "next dev\|next-server\|next/dist"` → exit 1 |
| VC-836 410/413 rows | PASS | `grep -n "game_unsupported\|payload_too_large" docs/architecture.md` → lines 326, 327 (§7 table) |
| VC-836 presets shape in §7 | PASS | `grep -n "defaultPresetId, presets" docs/architecture.md` → line 302 |
| VC-836 §10 log levels | PASS | `grep -n "LOG_LEVEL\` (§9) gates" docs/architecture.md` → line 380 |
| VC-836 §11 pending note, OQ 1 open | PASS | `grep -n "Pending: preview\|^1\. Is the"` → lines 402, 436 |
| VC-836 §16/§17 headings | PASS | `grep -n "^## 16. HTTP API\|^## 17. Known limitations" docs/development.md` → 1797, 2078 |
| VC-836 `§16` cross-references | PASS | `grep -n "§16" docs/development.md` → 17 hits, all added this iteration, all meaning HTTP API (no pre-existing `§16`/anchor reference existed) |
| VC-836 implementation.md deferral | PASS | `grep -n "Phase 8\|bench\|5b/11" docs/implementation.md` → §1 (l.17), M2 row (26), task 7 (237), done-when (243), Phase 11 step 3 (283), §4 (305), decisions 8 and 9 (320, 321), risk row (330) |
| VC-836 / BR-806 no "target met" claim | PASS | `grep -rn "500 ms" docs/` → 4 lines: the §1.2 goal, OQ 1, the struck-through Phase 8 item, the risk row ("not measured yet") |
| Docs standalone | PASS | `git diff -U0 -- docs README.md \| grep "^+" \| grep -nE "VC-\|FR-\|BR-\|D-0\|P-[0-9]\|specs/\|plan\b\|[Ii]teration\|ledger\|artifact"` → no hit (one false positive on `00000000.json`) |
| §16.8 test example compiles and passes | PASS | extracted to a temporary `tests/api/zz-docs-example.test.ts`, `pnpm vitest run` → 1 passed; file deleted (`git status` clean for `tests/`) |
| Gate | PASS | `sh -c 'pnpm typecheck && pnpm lint && pnpm test && pnpm build'` → exit 0; 78 files + 1 skipped, 1468 tests + 30 skipped (8.9 s); 4 `ƒ` API routes |
| Scope | PASS | `git diff main -- package.json pnpm-lock.yaml src tests/unit tests/contract tests/sim` → empty; `git diff HEAD -- app tests src` → empty |
| Artifacts | PASS | `CONTEXT.md` rewritten (shipped system); D-019, D-020 appended; this record |

## Curl transcript (scripted run, tokens redacted)

```
GET /api/presets -> 200   {"defaultPresetId":"argentina-fidepo","ids":["argentina-fidepo","spain-ludoteka","gamerules","mexico-bazas"]}
POST /api/games -> 201    {"gameId":"y25ib7awa7366qtges4nxynumm","seat":0,"seatToken":"<redacted 43 chars>","version":0,"phase":"bidding","legalMoves":["bid:0",…,"bid:13"]}
GET /api/games/y25ib…numm -> 200   {"version":0,"events":0,"phase":"bidding"}
GET without Authorization -> 401   {"code":"unauthorized","message":"Missing or invalid seat token"}
POST …/moves {version:0, moveId:bid:0} -> 200    {"version":1,"events":4,"phase":"playing"}
POST …/moves {version:1, moveId:play:8S} -> 200  {"version":2,"events":6,"phase":"playing"}
POST …/moves {version:2, moveId:play:KC} -> 200  {"version":3,"events":4,"phase":"playing"}
moves posted: 200; statuses: 200 × 200
GET …?since=199 -> 200  {"version":200,"events":6,"phase":"game-over","finalRanking":[{"seat":1,"total":82,"place":1},{"seat":0,"total":77,"place":2},{"seat":3,"total":67,"place":3},{"seat":2,"total":52,"place":4}],"trumpCard":null,"yourHand":[],"legalMoves":[]}
GET ?since=tip+1 -> 400        {"code":"invalid_request","message":"Invalid request: since"}
POST stale version 0 -> 409    {"error":{"code":"version_conflict",…},"updateVersion":200}
POST after game over -> 422    {"code":"illegal_move","message":"That move is not legal now"}
GET /api/games/BAD -> 404 · POST 20,000-byte body -> 413 · POST without Content-Type -> 400 "Invalid request: body" · POST with "seed" -> 400 "Invalid request: seed"
GET /api/presets headers: cache-control: no-store · content-type: application/json
disk: games/y25ib…numm/{meta.json, head.json, commits/00000000…00000200.json (201), scores/final.json}; index/created/2026-11-24/y25ib…numm
```

Literal doc run: game `f6ipm5farvsfxc2hfjnohymjcy`, `version` 200, `finalRanking` seat 0 first (108), `ls …/commits | wc -l` → 201. Wall time ≈ 12 s per game.

## Decisions → docs

| Decision | Where |
|---|---|
| D-001 single mapper, `instanceof` | architecture §7 (error table, "one function"); development §16 intro, §16.3 (`errors.ts`, why not `name`) |
| D-002 `jsonResponse` | architecture §7 (headers); development §16.3 (`http.ts`, why not `Response.json`) |
| D-003 body order, byte cap, strict UTF-8 | architecture §7 request rules; development §16.2 (why bytes, no U+FFFD), §16.12 (`+json` rejected) |
| D-004 strict schemas, first Zod issue named | architecture §7; development §16.2 |
| D-005 `since` syntax, repeated param | architecture §7; development §16.2 |
| D-006 bearer and id format, check order | architecture §7; development §16.2 (order and why). Regex locality in `auth.ts`: internal |
| D-007 preset labels, exhaustive `Record` | architecture §7 (presets); development §16.3 |
| D-008 strict response schemas + type equality | development §16.7 |
| D-009 logging wrapper, mutable `meta` | architecture §10; development §16.4, §16.6 |
| D-010 lazy memoised factory, uncached failure | development §16.5, §17 |
| D-011 presets body from config, no storage | architecture §7 |
| D-012 API test fixtures | development §16.8 |
| D-013 path id logged only after format check | architecture §10; development §16.6 |
| D-014 post-call `since` check via schema | development §16.3 (last paragraph) |
| D-015 handler shape, route file shape | development §16.4 |
| D-016 no-leak oracle | development §16.9 |
| D-017 60 s timeout for the no-leak games | development §16.11, §16.12 (`since=0` cost) |
| D-018 strict structure scan | development §16 intro (rule 2) |
| D-019, D-020 | internal |

## Files

- Changed: `docs/architecture.md`, `docs/development.md`, `docs/implementation.md`, `README.md`, `specs/08-http-api-plan-artifacts/{CONTEXT.md,DECISIONS.md}`.
- Added: this record. Deleted: none.

## Deviations

- Stale lines outside the listed sections fixed too (D-019); README edited (it said the API came "in later phases").
- Session run twice (D-020). The README is Prettier-checked: `pnpm exec prettier --check README.md` passed.

## Gotchas

- `curl -d` without `-H 'Content-Type: application/json'` sends form encoding → 400 `body`. `-H 'Content-Type:'` sends no header at all.
- Kill `pnpm dev` with `TaskStop` on its background task; then check port 3000 and `pgrep` — nothing survived either run.
- `docs/` is not Prettier-checked; README is.

## For the next iteration (Phase 9 — UI)

- Routes, client flow (start, move, 409, reload, game over), request rules and the client action per error: `docs/development.md` §16.1–§16.2; contract: `docs/architecture.md` §7.
- Send every POST with `Content-Type: application/json`; `Authorization: Bearer <seatToken>` on the `{id}` routes. Keep `{ version, moveId, clientRequestId }` **once per action** and resend it unchanged after a transport failure (200 with the original body). On 409 adopt `body.update`.
- Poll/catch up with `?since=<last version>`, never `?since=0` (O(tip) reads). Without `since`, `events` is `[]`.
- The seat token is only in the 201 body; store it (with `gameId`) in `localStorage`, never log it. 401/404/410 → forget the game, offer a new one.
- Typing: use `import type { PlayerUpdate, PlayerView, LegalMove } from '@/src/domain/types'` (the UI layer rule allows type-only domain imports). The response schemas in `app/api/_lib/schemas.ts` match those types exactly (compile-time check) but import `src/state` — do not value-import them into client components; use them in tests. Presets: `{ defaultPresetId, presets: [{ id, name, description, players: { min, max }, deck }] }` (`PresetsResponseSchema`).
- Public cards the UI may show: `view.trumpCard` (turned-up stock card, or with `trumpCardInDealerHand` the dealer's last card, also in the dealer's hand), `currentTrick`, `lastTrick`, `card-played.card`, `hand-dealt.trumpCard`. At game over `trumpCard` is `null`, `yourHand` `[]`, `finalRanking` present.
- The preview move benchmark is still pending (Phase 5b/11); do not claim the 500 ms p95 target is met anywhere.
