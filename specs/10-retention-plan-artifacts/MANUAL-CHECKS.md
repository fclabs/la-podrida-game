# Manual checks (Phase 10)

## VC-1022: try the job locally (file store, `pnpm dev`)

Run from the project root. `STORAGE_DRIVER` defaults to `file` outside Vercel, so it is not set. Use a fresh directory for `FILE_STORE_DIR` (below `/tmp/podrida`; any empty directory works).

1. Start the server (leave it running in its own terminal):
   `rm -rf /tmp/podrida && FILE_STORE_DIR=/tmp/podrida CRON_SECRET=local-test-secret RETENTION_DAYS=1 pnpm dev`
2. Create a game and keep the response:
   `curl -s -X POST localhost:3000/api/games -H 'content-type: application/json' -d '{"humanName":"Ana","aiCount":3}' > /tmp/create.json`
3. Read the game id and the seat token:
   `ID=$(python3 -c 'import json;print(json.load(open("/tmp/create.json"))["gameId"])')`
   `TOK=$(python3 -c 'import json;print(json.load(open("/tmp/create.json"))["seatToken"])')`
4. Check the layout: `find /tmp/podrida -type f` lists `games/$ID/{meta,head}.json`, `games/$ID/commits/00000000.json` and `index/created/<today UTC>/$ID`.
5. Make the game look old by renaming its marker folder (the marker day is UTC):
   `mv /tmp/podrida/index/created/$(date -u +%F) /tmp/podrida/index/created/2020-01-01`
6. Call the route without the secret: `curl -i localhost:3000/api/cron/cleanup` -> `401` and `{"error":{"code":"unauthorized","message":"Missing or invalid seat token"}}`.
7. Call it with the secret: `curl -i -H 'Authorization: Bearer local-test-secret' localhost:3000/api/cron/cleanup` -> `200` and `{"gamesDeleted":1,"capReached":false,"skippedMarkers":0}`.
8. Check the store: `find /tmp/podrida -type f` prints nothing (the file store leaves empty directories behind; no key remains).
9. Read the game: `curl -i -H "Authorization: Bearer $TOK" localhost:3000/api/games/$ID` -> `404` and `{"error":{"code":"game_not_found","message":"Game not found"}}`.
10. Optional: repeat step 7 -> `{"gamesDeleted":0,...}` (idempotent). The dev server prints one `{"route":"cron/cleanup","status":200,...}` line per authenticated call.
11. Stop the server (Ctrl-C) and check nothing listens on port 3000.

## Results

| VC | Check | Date | Environment | Result | Notes |
|---|---|---|---|---|---|
| VC-1022 | Local `pnpm dev`, file store, marker renamed to 2020-01-01, route with and without secret, game GET | 2026-11-27 | macOS, Node v26.13.1, `pnpm dev` (Next dev), `FILE_STORE_DIR` under the session scratchpad, `CRON_SECRET=local-test-secret`, `RETENTION_DAYS=1` | PASS | Observed: create 201 (`gameId` 6eyaaacmvltc4lrqmwmpvl3u2q); no header 401 `unauthorized`; with secret 200 `{"gamesDeleted":1,"capReached":false,"skippedMarkers":0}`; `find -type f` empty afterwards; game GET 404 `game_not_found`; second call 200 zeros. Deviation from the spec wording "`games/<id>` no longer exists": the empty directories `games/<id>/commits` remain (`FileObjectStore.delete` removes files, not directories); no key remains. Also ran with `STORAGE_DRIVER=file` set explicitly (same as the default). |
