# Spec 12 — Self-play data generation (recorder, shards, resume)

Status: Draft
Source proposal: `docs/__future__/data-generation.md` (phases 1–2 of its §8)
Parent context: `specs/04-players-frozen.md` (players, `runAiLoop`, `pnpm simulate`), `specs/02-engine-frozen.md`, `specs/03-score-engine-frozen.md`, `specs/00-project-scaffold-frozen.md` (lint layers). Requirement numbers use the 12xx range.

## Purpose

The project's only AI is `random`, and nothing records what AI players decide. A later step will train a better AI, and it needs a large dataset of decisions with the state they were taken in and how each hand and game turned out. This spec delivers an offline generator, `pnpm generate-data`, that plays many seeded all-AI games, records every bid and card play as a row with its player view, its oracle (hidden) state and its outcome labels, writes the rows as gzip-compressed JSONL shards, and can be killed and resumed. It also delivers a `validate` command that checks a dataset and prints a distribution report. The first target is a 100,000-game, 5-player `argentina-fidepo` dataset played by five `random` seats. The people who benefit are the developers who will build the heuristic strategy and the training pipeline in later specs.

## Scope

**In**
- `pnpm generate-data run` and `pnpm generate-data validate`.
- A recorder that observes games played by `runAiLoop` and produces three tables: `games`, `hands`, `decisions`.
- Outcome labels filled after each game, and per-game checks, including a sampled replay check.
- Shards of a configurable number of games, written as three gzip JSONL files per shard, with a run manifest and SHA-256 checksums.
- A worker pool (`worker_threads`), atomic shard writes, resume of an interrupted run, and refusal to resume with different parameters.
- Any preset and any player count the preset allows; seats given as an explicit list of strategy names (today only `random` exists).
- A 1,000-game measurement run, and updating the numbers in the proposal's §4.4 and §5.1 from it.
- A full 100,000-game `random` run, done locally and recorded in the PR (as spec 04 did for its long sweep).

**Out**
- The `heuristic-v1` strategy, and the optional `AIStrategy.explain?()` method (policy probabilities are `null` for every row in this spec). Both come with the first strategy that needs them.
- Mixed tables, per-game seat shuffling, exploration noise, model strategies and the self-play loop (proposal phases 3, 4, 6).
- Parquet output and any loader for the training side (proposal phase 5).
- The proposal's separate `shard` and `merge` subcommands. `run` creates shards, and resume covers re-running one.
- Monte Carlo rollout labels.
- Syncing datasets to a bucket or Blob store, and any network access.
- The evaluation harness and a `--strategies` option on `pnpm simulate` (proposal §9).
- Any change to files under `src/` or `app/`, to the output of `pnpm simulate`, or to the `random` strategy.
- Graceful handling of SIGINT/SIGTERM. A killed run is recovered by resume (FR-1214).

## Actors

| Actor | Description | Permissions |
|---|---|---|
| Developer | Runs the CLI locally or on a batch machine. | Runs `run` and `validate`; chooses run id, parameters and output directory; deletes datasets by hand. |
| Worker | A `worker_threads` worker started by `run`. | Plays the games of one shard at a time and writes that shard's temporary files. Never writes the manifest. |
| Training pipeline (future) | Reads the finished dataset. | Read-only. Must not use columns prefixed `hidden_` as features (BR-1202). |

## Functional Requirements

Priorities: M = Must.

**Command line**

- **FR-1201 (M)** — Given valid arguments, when the developer runs `pnpm generate-data run --run-id <id>`, then the generator plays `--games` games, writes the dataset under `<out>/<run_id>/` and prints the run summary (Data & Interfaces) to stdout once every shard has finished.
- **FR-1202 (M)** — Given an invalid command line, when any subcommand starts, then it prints one line `generate-data: <problem>` to stderr, exits 1, writes nothing to stdout and creates no files. The invalid cases are:
  - no subcommand or an unknown subcommand;
  - an unknown option, or a positional argument;
  - a `--run-id` that is missing, does not match `^[a-z0-9]+(-[a-z0-9]+)*$`, is longer than 64 characters, or starts with `eval` (BR-1209);
  - a `--preset` that is not one of the known preset ids;
  - `--players` outside the preset's range, `--games`, `--shard-size`, `--workers` or `--replay-every` that is not a positive decimal integer;
  - a `--strategies` list whose length differs from the player count, that has an empty item, or that names an unknown strategy.
- **FR-1203 (M)** — Given no optional arguments, when `run` starts, then it uses preset `argentina-fidepo`, the preset's minimum player count, `--games 1000`, `--shard-size 1000`, `--strategies` = `random` for every seat, `--workers` = `os.availableParallelism()`, `--replay-every 100` and `--out .data/datasets`. The same defaults apply when `run` resumes an existing run (FR-1219).

**Games and seeds**

- **FR-1204 (M)** — Given run id `R`, shard `s` (0-based) and game index `i` (0-based within the shard), when the game is created, then its engine seed and its `game_id` are both the string `R-s-i`, and its seats are `ai-<k>` with the strategy name of seat `k` set in `SeatInfo.strategy`.
- **FR-1205 (M)** — Given `--games G` and `--shard-size S`, when the run is planned, then there are `ceil(G / S)` shards; shard `s` holds game indices `0 … min(S, G − s·S) − 1`, so all shards but the last hold `S` games.

**Recording**

- **FR-1206 (M)** — Given a game, when its seats are built with `createAiPlayer` around recording wrappers of their strategies, then each wrapper captures the `PlayerView`, the legal moves and the chosen move of its decision, the row is completed in `runAiLoop`'s `onTransition(prev, transition)` hook, and every AI decision (bid or card play) produces exactly one `decisions` row, in play order, with `step` counting from 0 across the whole game.
- **FR-1207 (M)** — Given a decision, when its row is built, then the player-view columns come from the `PlayerView` and legal moves that the strategy received (not recomputed), with the columns, types and encodings in Data & Interfaces; the exceptions are `cards_played_this_hand` and `trick_number`, which the view does not carry and which the recorder builds from the `card-played` and `trick-won` events it has observed in the hand. Both are public information, not oracle data.
- **FR-1208 (M)** — Given a decision, when its row is built, then the action columns `legal_move_ids`, `chosen_move_id` and `chosen_index` (the position of the chosen id in `legal_move_ids`) record the move that `runAiLoop` then applies; `strategy` is the seat's strategy name, `policy_probs` is `null` and `explore` is `false`.
- **FR-1209 (M)** — Given a decision, when its row is built, then the oracle columns `hidden_hands` and `hidden_stock_left` are read from `prev`, the game state before the move, in `onTransition`.
- **FR-1210 (M)** — Given a finished game, when it reaches `game-over`, then the outcome columns of every one of its `decisions` rows are filled from `evaluate(state)` and from the trick winners in the game's events, and only then are the game's rows written.
- **FR-1211 (M)** — Given a finished game, when it is flushed, then one `games` row and one `hands` row per hand are written as well, with the columns in Data & Interfaces.

**Per-game checks**

- **FR-1212 (M)** — Given a finished game, when it is flushed, then these checks hold, otherwise the game fails (FR-1217):
  1. the game ended in phase `game-over`;
  2. the number of hands equals `state.handPlan.length`;
  3. the number of `decisions` rows equals the number of moves `runAiLoop` applied;
  4. per hand, the sum over seats of `tricks_won_by_seat` equals `cards_dealt`;
  5. per hand and seat, `bid`, `tricks_won`, `made` and `points` equal `evaluate(state).hands[hand_index].perSeat[seat]`.
- **FR-1213 (M)** — Given a game whose index `i` satisfies `i mod replay_every = 0`, when its rows are complete, then the game is replayed from the same seats, strategies and seed without recording, and every `chosen_move_id` in order and every final total must equal the recorded ones; a difference fails the game (FR-1217).

**Shards, workers, resume**

- **FR-1214 (M)** — Given a started run, when the shards are processed, then each completed shard consists of three files in `<out>/<run_id>/shards/`: `shard-<NNNNN>.games.jsonl.gz`, `shard-<NNNNN>.hands.jsonl.gz` and `shard-<NNNNN>.decisions.jsonl.gz` (`NNNNN` = shard number, zero-padded to 5 digits). Each file is written to `<final file name>.tmp` in the same directory and renamed to its final name when finished, and a shard counts as `complete` in the manifest only after its three renames. On start, `run` deletes every leftover `.tmp` file in the run directory.
- **FR-1215 (M)** — Given a run, when it starts, then a `manifest.json` (Data & Interfaces) is written atomically (temporary file, then rename) before any shard starts, and rewritten atomically after each shard completes or fails. Only the main thread writes it.
- **FR-1216 (M)** — Given `--workers W`, when shards are processed, then at most `W` workers run concurrently, each takes the next unprocessed shard from a shared queue and plays its games one at a time, and a shard is processed by exactly one worker.
- **FR-1217 (M)** — Given a game that fails (an `AiLoopLimitError`, an engine error, a failed check of FR-1212 or FR-1213), or a worker that exits abnormally, when the shard is processed, then the shard stops at its first failing game (its remaining games are not played), no file of that shard is renamed into place and the main thread deletes every file of that shard that exists (final or `.tmp`) once the shard's worker has stopped, before it records the shard as `failed`, the manifest marks the shard `failed` with the failing `seed` (when known) and the error message, the other shards continue, and the run exits 1 at the end after printing the summary with the failed shard count.
- **FR-1218 (M)** — Given an existing run directory with a manifest, when `run` is started again with the same `--run-id`, then it re-runs only the shards that are not `complete`, plus any `complete` shard with a missing file or whose file size or SHA-256 differs from the manifest, and it does not rewrite or rename the files of the other shards; it reads a `complete` shard's files only to check their size and SHA-256.
- **FR-1219 (M)** — Given an existing manifest, when `run` is started, then each of `preset`, `players`, `games`, `shard-size`, `strategies` and `replay-every` is compared with the manifest's `params`, an option that was not passed counting as its default (FR-1203), and the manifest's `schema_version` and `generator_version` are compared with the code's. On the first difference, in that order, it prints one line `generate-data: run "<id>" has a different <name>` to stderr, where `<name>` is the option name without dashes (`shard-size`) or the manifest field (`schema_version`), exits 1 and changes nothing on disk. `--workers` and `--out` do not take part in the comparison.
- **FR-1220 (M)** — Given a run directory that exists, is not empty, and has no manifest, when `run` starts, then it prints one line `generate-data: run directory "<path>" exists without a manifest` to stderr, exits 1 and changes nothing.

**Validation**

- **FR-1221 (M)** — Given `pnpm generate-data validate --run-id <id> [--out <dir>]` (the usage rules of FR-1202 apply to its options), when the run directory or its `manifest.json` does not exist, then it prints one line `generate-data: no run "<id>" in <out>` to stderr and exits 1. When both exist, it checks that:
  1. the manifest parses against its schema;
  2. every `complete` shard has its three files, with the manifest's size, SHA-256 and row counts;
  3. every row of every file parses against its row schema;
  4. every `hands` and `decisions` row has a `game_id` in `games`, and every game has `n_hands` hands;
  5. every game has `n_players × (n_hands + Σ handPlan)` decisions (one bid per seat per hand, one card play per seat per dealt card);
  6. the per-hand label checks 4 and 5 of FR-1212, using the `hands` table, and that each decision's `hand_*` labels match its `hands` row;
  7. the replay check of FR-1213 on the games with `i mod replay_every = 0`.
  It exits 1 and prints the first failing check on stderr when any check fails, and exits 0 otherwise.
- **FR-1222 (M)** — Given a run whose checks pass, when `validate` finishes, then it prints the distribution report (Data & Interfaces) to stdout.
- **FR-1223 (M)** — Given a run that has any `pending` or `failed` shard, when `validate` runs, then it validates the complete shards only, prints `status: INCOMPLETE` in the report and exits 1.

**Documentation**

- **FR-1224 (M)** — Given the 1,000-game run (VC-1230), when the work is done, then `docs/__future__/data-generation.md` §4.4 and §5.1 state the measured size and time per game, and `docs/development.md` has a section for `pnpm generate-data`.

## Business Rules

- **BR-1201** — Recording only observes. The recorder and its strategy wrapper never change a decision, never draw from any RNG, and never alter the state; a recorded game ends in exactly the same state as the same game played by `runAiLoop` with unwrapped strategies. Rationale: the dataset must show what the AI would have done without being watched; consistent with spec 04 BR-402 and BR-403. Exceptions: none.
- **BR-1202** — A column is oracle data if and only if its name starts with `hidden_`. All other columns of `decisions` are built from the `PlayerView` and legal moves the strategy received, from public events observed in the hand (`cards_played_this_hand`, `trick_number`), or are the action or outcome columns. Rationale: a deployable model may use only what `choose` can see. Exceptions: none.
- **BR-1203** — The generator reads and writes only the local filesystem under `--out`. It imports no module from `src/storage`, `src/state` or `src/service/game-service.ts`, uses no network, and never touches production game data. The data is entirely synthetic. Rationale: proposal §5.3 and §10 (privacy).
- **BR-1204** — Generator code lives under `scripts/` (the `generate-data` entry point and `scripts/datagen/`) and its tests under `tests/unit/datagen/` (a folder that `pnpm test` runs for the node project). Tests that spawn the CLI set a per-test timeout of 120 s. No file under `src/` or `app/` is modified, and nothing under `src/` or `app/` imports from `scripts/`. Rationale: `fs` and `worker_threads` are outside the layer matrix of spec 00, so living in `scripts/` leaves the frozen lint configuration unchanged.
- **BR-1205** — For a fixed `(preset, players, strategies, seed)` the rows of a game are identical on every run, so for fixed run parameters the decompressed contents of a shard are identical on every run. Rows contain no wall-clock time, host data or random values from outside the engine's seeded streams.
- **BR-1206** — Only the main thread writes `manifest.json`; workers (entry module `scripts/datagen/worker.ts`) write only the temporary files of the shard they are processing.
- **BR-1207** — Datasets are never committed. The default output directory `.data/datasets/` is under the git-ignored `.data/`. Only a manifest may be copied into git by hand.
- **BR-1208** — Cards, moves and encodings use the engine's string ids (`QH`, `bid:3`, `play:QH`) so that a row can be fed back into `applyMove`. Arrays indexed by seat have length `n_players` and index = seat number.
- **BR-1209** — A `--run-id` starting with `eval` is rejected, so that the `eval-*` seed prefix reserved for evaluation (proposal §9) can never appear in training data. Rationale: seeds are `<run_id>-<shard>-<index>`.
- **BR-1210** — Existing behavior is unchanged: `random` draws exactly as before, `pnpm simulate` prints the same output, and spec 04's tests still pass.
- **BR-1211** — The only test seam in production code is the optional hook module of "Test hooks" (Data & Interfaces). When the environment variable `GENERATE_DATA_TEST_HOOKS` is unset, no hook code runs and the dataset and the manifest are identical to those of a build without the seam. Rationale: games run inside `worker_threads`, where stubs set in the test process cannot reach; the real pool must stay under test.

## Non-Functional Requirements

- **NFR-1201 (recording overhead)** — With `--workers 1`, the generator's summary `duration` ÷ `games` (it includes recording, the sampled replay checks and gzip output) is at most 3 × the `duration` ÷ `games` printed by `pnpm simulate --games 200` run in the same session on the same machine with the same preset and player count. Baseline from the proposal: about 33 ms per game, argentina-fidepo, 5 players.
- **NFR-1202 (full run)** — The 100,000-game run (argentina-fidepo, 5 players, `random`, default shard size, workers = cores) completes in at most 30 minutes on the reference machine (assumption A-1).
- **NFR-1203 (size)** — The compressed dataset of that full run is at most 8 GB in total (assumption A-6).
- **NFR-1204** — Withdrawn in review (R-035). Streaming rows per game is a design note under "Format choices", not a requirement; NFR-1202 and NFR-1203 bound the real cost.
- **NFR-1205 (resume cost)** — After an interrupted run, resume re-plays none of the games of a shard that is `complete` and valid; its cost for those shards is the file check of FR-1218 only.

## Data & Interfaces

### Command line

```
pnpm generate-data run --run-id <id> [--preset <id>] [--players <n>] [--games <n>] [--shard-size <n>]
                       [--strategies <s0,s1,…>] [--workers <n>] [--replay-every <n>] [--out <dir>]
pnpm generate-data validate --run-id <id> [--out <dir>]
```

`package.json` gets the script `"generate-data": "tsx scripts/generate-data.ts"`. Constants in code: `SCHEMA_VERSION = 1`, `GENERATOR_VERSION = 1`. Exit codes: 0 success; 1 usage error, failed shard, or failed validation.

### Run directory

```
<out>/<run_id>/manifest.json
<out>/<run_id>/shards/shard-<NNNNN>.{games,hands,decisions}.jsonl.gz
```

Each file is UTF-8 JSONL (one JSON object per line, keys in the order below, no trailing spaces) compressed with gzip. Rows are validated against Zod schemas defined once in `scripts/datagen/`, like the persisted game documents.

### Format choices

- JSONL + gzip first, as in the proposal's §6: no new dependency, readable, and the schema is still settling; Parquet is a later spec.
- gzip uses `node:zlib` at its default level; SHA-256 uses `node:crypto`. Nothing is added to `package.json`.
- Zod and tsx are already pinned in `package.json`; Node is the `engines` range (`>=24 <25`).
- Design note (not a requirement): a worker should write each game's rows to its shard's temporary files as the game finishes, so memory does not grow with the shard size. How and when the writes are flushed is the implementer's choice.

### Test hooks

If the environment variable `GENERATE_DATA_TEST_HOOKS` holds a module path, each worker imports that module once at start and uses the optional functions of its default export. A missing function means "no hook". The main thread does not read the variable.

| Hook | Effect |
|---|---|
| `runAiLoop(real) => fn` | Replaces the `runAiLoop` used to play a game (it may return a different state or throw). |
| `replayRunAiLoop(real) => fn` | Replaces the `runAiLoop` used by the replay check only. |
| `transformRows({ games, hands, decisions }) => rows` | Called per game after labels are filled and before the checks of FR-1212; may change or drop rows. |
| `onShard({ shard, phase }) => void` | Called with `phase` `"start"` or `"end"` around a shard; may throw or call `process.exit`. |

### `manifest.json`

| Field | Type / notes |
|---|---|
| `schema_version`, `generator_version` | integers |
| `run_id` | string |
| `params` | `{ preset, players, games, shard_size, strategies: string[], replay_every }` |
| `created_at` | ISO-8601 UTC, set when the run is first created |
| `shards[]` | one per shard, in order: `shard`, `games` (count), `status` (`pending` \| `complete` \| `failed`), and for `complete`: `git_commit` (`git rev-parse HEAD` of the process that wrote it, `"unknown"` if unavailable), `git_dirty` (bool), `completed_at`, `files.{games,hands,decisions}` = `{ path, bytes, sha256, rows }`; for `failed`: `error` = `{ seed: string \| null, message }` |

### `games` row

`game_id`, `run_id`, `shard`, `seed`, `preset`, `n_players`, `n_hands`, `strategy_by_seat` (string[]), `final_total_by_seat` (int[]), `final_place_by_seat` (int[], from `evaluate(state).ranking`), `generator_version`.

### `hands` row

`game_id`, `hand_index`, `cards_dealt` (cards each seat was dealt), `dealer`, `trump_card` (card id), `trump_in_dealer_hand` (bool), `bid_by_seat`, `tricks_won_by_seat`, `made_by_seat` (bool[]), `points_by_seat` (all arrays of length `n_players`).

### `decisions` row

| Group | Columns |
|---|---|
| Keys | `game_id`, `hand_index`, `step`, `seat`, `decision_type` (`"bid"` \| `"play"`) |
| Player view | `cards_dealt` (int); `dealer` (int); `trump_card` (card id or `null` when the view has none); `trump_in_dealer_hand` (bool); `your_hand` (card ids, in the view's order); `bids_so_far` (per seat, `null` if the seat has not bid); `tricks_won_so_far` (per seat); `current_trick` (`[{seat, card}]` in play order, empty while bidding); `cards_played_this_hand` (card ids of every card played earlier in this hand, in play order, including the current trick); `score_totals` (per seat, from the view's scoreboard); `trick_number` (number of tricks already completed in this hand, 0 while bidding) |
| Action | `legal_move_ids` (string[]), `chosen_move_id`, `chosen_index` |
| Policy | `strategy` (string), `policy_probs` (`null` in this spec), `explore` (bool, `false` in this spec) |
| Oracle | `hidden_hands` (per seat, that seat's remaining card ids at decision time, before the move, including the acting seat), `hidden_stock_left` (card ids of the game's deck that are in no seat's dealt hand for this hand and are not the trump card, in the order of `buildDeck(rules.deck, n_players)`) |
| Outcome labels | `hand_bid`, `hand_tricks_won`, `hand_made` (bool), `hand_points` (all for `seat` in this hand); `won_this_trick` (bool for `play` rows: whether `seat` won the trick its card was played into; `null` for `bid` rows); `final_place`, `final_total` (for `seat`, at game over) |

Expected rows per game: `n_players × (n_hands + Σ handPlan)`; for argentina-fidepo with 5 players the proposal measured about 635 (85 bids + 550 plays).

### Run summary (stdout of `run`)

```
run: <run_id>  preset: <preset>  players: <n>  games: <G>  shards: <K>
shards: <c> complete (<k> skipped, <f> failed)
rows: games <n>  hands <n>  decisions <n>
size: <x.y> MB  duration: <x.y> s
```

Counts are plain integers. `rows` and `size` cover all `complete` shards, including skipped ones (read from the manifest). `size` is the total bytes of those shards' files divided by 1,000,000, one decimal. `skipped` = shards left untouched by FR-1218. Labels and order are fixed.

### Distribution report (stdout of `validate`)

```
validate: <run_id>  status: <OK | INCOMPLETE>
games: <n>  hands: <n>  decisions: <n>
decisions per game: mean <x.y>  min <n>  max <n>
made-bid rate: <x.y>%
average final total by seat: 0: <x.y>  1: <x.y>  …
average final total by strategy: <name>: <x.y>  …
bid histogram, <cards_dealt>: 0:<n> 1:<n> …      (one line per distinct cards_dealt, ascending)
```

`made-bid rate` = made bids ÷ bids over all hands and seats. A histogram line counts bids by value across the `hands` table (values 0 … `cards_dealt`, zero counts shown). Averages have one decimal and never print `-0.0`. Labels and order are fixed.

## Verification Criteria

Unit and integration tests run under `pnpm test` on small runs (20–60 games, tens of shards of size ≤ 10). The measurements and the full run are local runs recorded in the PR.

**Command line**
- VC-1201: `run --run-id t1 --games 20 --shard-size 10 --out <tmp>` → exit 0, `<tmp>/t1/manifest.json` and 6 shard files exist (2 shards × 3), the stdout has the 4 summary lines with `games: 20  shards: 2`, `rows: games 20 …`.
- VC-1202: each invalid case listed in FR-1202 (one case per VC run: no subcommand; unknown subcommand; unknown option; positional; run id missing, `Bad_Id`, `a--b`, 65 characters, `eval-1`; unknown preset; `--players` below min and above max; `--games 0`, `--games 1.5`, `--games abc`; the same for `--shard-size`, `--workers`, `--replay-every`; `--strategies` of wrong length, `random,,random,random,random`, `nope,…`) → exit 1, exactly one stderr line starting `generate-data: `, empty stdout, and `<tmp>` still empty.
- VC-1203: the argument parser given only `--run-id t3` returns `{ preset: "argentina-fidepo", players: <the preset's minimum>, games: 1000, shard_size: 1000, strategies: <that many "random">, workers: <available cores>, replay_every: 100, out: ".data/datasets" }`; and `run --run-id t3 --games 20 --out <tmp>` (the only option besides the run id and output) writes a manifest whose `params` use the same defaults for the remaining fields and has 1 shard.

**Games and seeds**
- VC-1204: a run `R` with `--games 25 --shard-size 10` → shards 0, 1, 2 hold 10, 10 and 5 games; every `games` row has `seed == game_id == "R-<s>-<i>"` for `i` within its shard; no duplicate `game_id` in the dataset.
- VC-1205: `--games 20 --shard-size 20` → 1 shard; `--games 21 --shard-size 20` → 2 shards, the second with 1 game; `--games 1` → 1 shard with 1 game.
- VC-1206: the `games` row of a game has `strategy_by_seat` equal to the `--strategies` list, and its game replayed by hand with `createGame` + `runAiLoop` using seats `ai-<k>` and strategy names from that list reproduces the final totals of the row.

**Recording**
- VC-1207: for a recorded game, `decisions` rows are ordered by `step`, `step` runs 0 … m−1 with no gap, and m equals the `moves` returned by an unrecorded `runAiLoop` of the same game.
- VC-1208: for a `bid` row, `current_trick` is `[]`, `cards_played_this_hand` is `[]`, `trick_number` is 0, and `chosen_move_id` starts with `bid:`; for a `play` row, `chosen_move_id` starts with `play:` and `chosen_move_id.slice(5)` is in `your_hand`.
- VC-1209: for every row, `legal_move_ids[chosen_index] == chosen_move_id`, and the same row's `legal_move_ids` equals the ids of `legalMoves(prevState, seat)` of the state before the move.
- VC-1210: for every row of a 20-game run, `strategy` equals `strategy_by_seat[seat]` of its game, `policy_probs` is `null` and `explore` is `false`.
- VC-1211: for every row, `hidden_hands[seat]` holds the same ids as `your_hand` (as a set), `hidden_hands` has one entry per seat, and the union of all `hidden_hands`, `cards_played_this_hand`, `hidden_stock_left` and the trump card has no card twice and, together, equals the full deck of the game's rule set, except that when `trump_in_dealer_hand` is `true` the trump card is the dealer's last dealt card and is counted once, as that card.
- VC-1212: for the first `play` row of a hand whose trump card is not in the dealer's hand, `hidden_stock_left` does not contain `trump_card`, and its length equals deck size − `n_players × cards_dealt` − 1; when the trump card is in the dealer's hand, the length equals deck size − `n_players × cards_dealt`.
- VC-1213: a `play` row's `won_this_trick` equals `true` exactly when the `trick-won` event that follows the trick containing that play names that row's seat; every `bid` row has `won_this_trick == null`; per hand, the number of `play` rows with `won_this_trick == true` for a seat equals that seat's `hand_tricks_won`.
- VC-1214: no row of the `decisions` table has a key starting with `hidden_` other than `hidden_hands` and `hidden_stock_left`, and a scan of every other column name finds none starting with `hidden_`.

**Observer effect (BR-1201)**
- VC-1215: for each of 50 seeds, a game played with the recorder's strategy wrappers and the same game played with unwrapped strategies end in deep-equal `GameState` (including `aiDecisionCount`) and produce the same `events`.
- VC-1216: a wrapper's `choose` call receives the exact same arguments and returns the same move as the wrapped strategy would return alone (a spy strategy counts one call per decision and one RNG draw as `random` makes it, no extra).

**Labels and tables**
- VC-1217: for a 20-game run, per game, `hands` has `n_hands` rows with `hand_index` 0 … `n_hands − 1`, and `games.n_hands == handPlan.length`.
- VC-1218: for every `hands` row, `Σ tricks_won_by_seat == cards_dealt`, and `bid_by_seat`, `tricks_won_by_seat`, `made_by_seat`, `points_by_seat` equal `evaluate(finalState).hands[hand_index].perSeat`.
- VC-1219: for every `decisions` row, `hand_bid`, `hand_tricks_won`, `hand_made`, `hand_points` equal the same seat's entries in that hand's `hands` row, and `final_total` and `final_place` equal the game's `final_total_by_seat[seat]` and `final_place_by_seat[seat]`.
- VC-1220: for each game, `Σ final_place_by_seat` equals the sum of places of the game's `ranking` (tied seats share the place given by `evaluate`), and `final_total_by_seat[k]` equals `Σ points_by_seat[k]` over that game's `hands` rows.

**Per-game checks and failures**
Failure tests (VC-1221 to VC-1226, VC-1229, VC-1247) spawn the CLI with `GENERATE_DATA_TEST_HOOKS` set to a test module under `tests/unit/datagen/` and use the hooks of Data & Interfaces; the games are played by the real worker pool.

- VC-1221: with the `runAiLoop` hook returning a state whose phase is not `game-over` for one game, that game fails (FR-1212.1): its shard is `failed` with `error.seed` set to the game's seed, no file of that shard exists, and the run exits 1.
- VC-1222: with the `transformRows` hook dropping one `decisions` row of one game, the row-count check fails the game (FR-1212.3), with the shard and the run outcome of VC-1221.
- VC-1223: with the `transformRows` hook changing one `hand_points`, check FR-1212.5 fails the game; with it changing one `tricks_won_by_seat` so the sum differs from `cards_dealt`, check FR-1212.4 fails the game; with it removing one `hands` row, check FR-1212.2 fails the game; each with the same outcome as VC-1221.
- VC-1224: with the `replayRunAiLoop` hook making the replay differ by one move, the replay check fails the game with `error.message` naming the first differing `step`; the `onShard`/`runAiLoop` hooks count replays and show that a game with `i mod replay_every != 0` is not replayed: with the default, replays happen for exactly the game indices 0, 100, 200, …, and with `--replay-every 1` for all.
- VC-1225: in a 3-shard run where shard 1 contains a failing game, shards 0 and 2 are `complete` with their files, shard 1 is `failed` with no `shard-00001.*` file, and the exit code is 1; the summary shows `2 complete (0 skipped, 1 failed)`.
- VC-1226: an `onShard` hook that calls `process.exit(1)` on `phase: "start"` of one shard marks that shard `failed` with `error.seed == null`, and the other shards finish.
- VC-1247: with the `runAiLoop` hook throwing an `AiLoopLimitError`, and in a second run an `IllegalMoveError`, in game 3 of a shard, the shard is `failed` with `error.seed` equal to that game's seed and `error.message` containing the error's message, and games 4 onward of that shard are not played (the hook counts calls).

**Shards, manifest, workers**
- VC-1227: after a successful run, every `complete` shard's manifest entry has three files whose `bytes` equal the file size, `sha256` equals the SHA-256 of the file's bytes, and `rows` equals the number of lines after gunzip; no `.tmp` file exists in the run directory.
- VC-1228: the manifest is parsed after every shard completion by a polling test (while a 10-shard run is in progress) and always parses against its schema, i.e. it is never seen half-written; `shards[i].status` only moves `pending → complete` or `pending → failed` within a run.
- VC-1229: with `--workers 2` and an `onShard` hook recording shard start/end times, no more than 2 shards overlap, every shard is processed once, and the dataset equals (decompressed, byte for byte) the dataset of the same run with `--workers 1`.

**Measurement run and documentation**
- VC-1230: `run --run-id measure-1k --games 1000` on the reference machine → exit 0, the summary printed; the 1,000-game dataset passes `validate` (VC-1233); NFR-1201 holds (the run is repeated with `--workers 1` and the `duration` ÷ `games` is ≤ 3 × that of `pnpm simulate --games 200` in the same session, both values recorded in the PR); the measured size and time per game are written into the proposal's §4.4 and §5.1 (FR-1224); and the projected full-run size, `size ÷ 1000 × 100000`, is recorded and is ≤ 8,000 MB (NFR-1203). If the projection is above 8,000 MB, the full run (VC-1245) does not start until the user has decided how to change NFR-1203 or the row schema, and this spec is updated.
- VC-1231: the file `docs/development.md` contains a section whose heading names `pnpm generate-data` and shows both subcommands with their options (FR-1224).

**Determinism (BR-1205)**
- VC-1232: running the same parameters twice in two different output directories gives, for every shard file, identical decompressed contents; and rerunning one shard (manifest entry set to `pending` by hand) rewrites a file with the same decompressed contents as before.

**Validation**
- VC-1233: `validate` on a fresh 60-game run with `--replay-every 1` → exit 0, `status: OK`, `games: 60`, the report's `decisions per game` mean times 60 equals `decisions`, and the bid histogram has one line per distinct `cards_dealt`.
- VC-1234: for each of these corruptions of a valid run, `validate` exits 1 and names the check on stderr: a shard file deleted; one byte of a shard file changed; a `games` line removed (join check); a `decisions` line removed (rows-per-game check); a `hands.points_by_seat` value changed (label check); a `decisions.chosen_move_id` changed on a sampled game (replay check); `manifest.json` replaced by `{}`.
- VC-1235: `validate` on a run with one `failed` and two `complete` shards → `status: INCOMPLETE`, exit 1, the report is printed for the two complete shards.
- VC-1236: `validate` with a `--run-id` that has no run directory, or a run directory without `manifest.json` → exit 1, one stderr line `generate-data: no run "<id>" in <out>`, empty stdout; a missing `--run-id` → exit 1, one stderr line `generate-data: …`, empty stdout.
- VC-1237: in the report of a 3-player `argentina-fidepo` run, the made-bid rate equals made bids ÷ (`n_hands × 3` per game) computed independently from the `hands` table; `average final total by seat` equals the mean of `final_total_by_seat[k]` over all games.

**Resume**
- VC-1238: in a 20-shard run (`--games 200 --shard-size 10`), a child process running `run` is killed with SIGKILL after the manifest first shows at least 3 `complete` shards; a second `run` with the same `--run-id` exits 0; the manifest then has 20 `complete` shards; no `.tmp` file remains; `validate` exits 0.
- VC-1239: in VC-1238, the files of the shards that were `complete` before the kill have the same inode, size and modification time after the second run, and the second run's summary counts them as `skipped` (NFR-1205).
- VC-1240: a `complete` shard whose file was deleted, truncated, or edited is re-run by resume, and after it the shard's files pass `validate`; a `complete` shard that was not touched is skipped.
- VC-1241: resume with a changed `--preset`, `--players`, `--games`, `--shard-size`, `--strategies` or `--replay-every`, or with that option omitted when the run was created with a non-default value → exit 1, one stderr line `generate-data: run "<id>" has a different <name>` with `<name>` = `preset`, `players`, `games`, `shard-size`, `strategies` or `replay-every`, and the run directory's files are byte-identical to before; with the manifest's `schema_version` or `generator_version` edited to another number → the same line with `<name>` = `schema_version` or `generator_version`; resume with a different `--workers` value → exit 0 and the run completes normally.
- VC-1242: a run directory containing a stray file and no `manifest.json` → exit 1 with the one stderr line of FR-1220, no file changed; an empty existing run directory → the run proceeds.

**Isolation and no regression (BR-1203, BR-1204, BR-1207, BR-1210)**
- VC-1243: `git diff --stat <spec-start-commit>..HEAD -- src app` lists no file; `grep -rE "from '(@/)?(\.\./)*src/(storage|state)|game-service" scripts/datagen scripts/generate-data.ts` prints nothing; `grep -rn "scripts/" src app` prints nothing.
- VC-1244: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:sim` pass; `pnpm --silent simulate --games 200 --seed sim` prints the same four lines (with the same numbers except `duration`) as before the change; `git check-ignore .data/datasets/x/manifest.json` prints that path.

**Full run (NFR-1202, NFR-1203, NFR-1205)**
- VC-1245: `run --run-id s0-full --preset argentina-fidepo --players 5 --games 100000` on the reference machine with `--workers` = cores → exit 0 with `100 complete (0 skipped, 0 failed)` and `rows: games 100000  hands 1700000`; wall time ≤ 30 minutes; `size` ≤ 8,000 MB; `validate` exits 0 with `status: OK`; the figures are recorded in the PR.
- VC-1246: in the full-run directory, killing the process after at least 40 `complete` shards and running the same command again completes the others; the second run's summary shows `skipped` equal to the number of shards that were `complete` before the kill and `0 failed` (recorded in the PR; the automated version is VC-1238/VC-1239).

**Additional coverage**
- VC-1248: for every `decisions` row of a 20-game run, `dealer`, `trump_card`, `trump_in_dealer_hand`, `cards_dealt` equal the values of the `hands` row of that `(game_id, hand_index)`; `bids_so_far` and `tricks_won_so_far` equal the view's per-seat `bid` and `tricks_won` (recomputed by replaying the game with the same seed up to that step); `score_totals` equals the scoreboard totals of that view; on `play` rows `trick_number` equals the number of `trick-won` events seen so far in that hand, and `current_trick` equals the plays since the last `trick-won`.
- VC-1249: every file written has the name `shard-<NNNNN>.<table>.jsonl.gz` with `NNNNN` zero-padded to 5 digits, in `<out>/<run_id>/shards/` (checked on a run of 12 shards, shard 11 included), and no other file is in that directory after a successful run.
- VC-1250: every array-valued per-seat column of the three tables (`strategy_by_seat`, `final_total_by_seat`, `final_place_by_seat`, `bid_by_seat`, `tricks_won_by_seat`, `made_by_seat`, `points_by_seat`, `bids_so_far`, `tricks_won_so_far`, `score_totals`, `hidden_hands`) has exactly `n_players` entries, for a 3-player and a 5-player run; and `chosen_move_id` of a row fed to `applyMove(prevState, seat, chosen_move_id)` is accepted (BR-1208).
- VC-1251: `grep -n "manifest" scripts/datagen/worker.ts` prints nothing, and in a run where an `onShard` hook deletes `manifest.json` during a shard, the worker still finishes the shard and only the main thread's next write recreates the manifest (BR-1206).
- VC-1252: withdrawn with NFR-1204 (R-035).
- VC-1253: with the hook environment variable unset, a 20-game run is byte-identical (decompressed) to the same run made with the variable set to a module that exports no hooks (BR-1211).

## Open Questions

None.

## Assumptions

- **A-1** — The reference machine is the developer's 10-core macOS laptop (`hw.ncpu` = 10) that produced the proposal's 33 ms per game figure. NFR thresholds are measured there and recorded in the PR.
- **A-2** — `worker_threads` workers can load the generator's TypeScript source through `tsx` (pinned in `package.json`), started with `new Worker(file, { execArgv: ['--import', 'tsx'] })`, and resolve the `@/` alias like the CLI does. The first iteration of the plan proves this before anything else is built; if it fails, work stops and the failure goes to the user (gate 3).
- **A-3** — `node:zlib` gzip is deterministic for one Node/zlib version (Node is within `engines`, `>=24 <25`), so file hashes in a manifest are comparable within one environment; determinism across environments is judged by decompressed contents (VC-1232).
- **A-4** — `.data/` is git-ignored (verified: `.gitignore` line 226).
- **A-5** — The proposal's figures (about 635 decisions per game; 17 hands; 200 games in 6.6 s) are close enough for planning; the 1,000-game run replaces them (FR-1224).
- **A-6** — The 8 GB ceiling (NFR-1203) is about 2–3× the proposal's 2–4 GB Parquet estimate. The proposal's row-size estimate (about 400 B before compression) predates the columns `legal_move_ids`, `cards_played_this_hand` and `hidden_stock_left`, so VC-1230 projects the real size from 1,000 games before the full run is started, and a projection above the ceiling halts the work for the user's decision.
- **A-7** — `evaluate(state)` at `game-over` returns, per hand and seat, `bid`, `tricks`, `made`, `points`, plus `totals` and `ranking` with places (spec 03).
- **A-8** — Deviations from the proposal, decided here to keep rows deterministic and to avoid touching frozen code: (1) the games table has no `git_commit` or `created_at` columns; they live in the manifest (per shard and per run) so that rerunning a shard gives identical rows (BR-1205); (2) the proposal's column `cards_in_hand` is named `cards_dealt`, since it is the hand size at the deal and not a count at decision time; (3) the generator lives in `scripts/datagen/` instead of `src/datagen/` (BR-1204); (4) `shard` and `merge` subcommands are dropped.
- **A-9** — With fixed seating, seat-position bias in the report is read by seat index; random seating belongs to the mixed-table spec.
