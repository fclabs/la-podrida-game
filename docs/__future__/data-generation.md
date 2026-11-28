# Proposal: self-play data generation for training the AI

> Status: phases 1–2 of §8 are implemented (`pnpm generate-data`, see [`development.md`](../development.md) §19); phases 3–6 are still a proposal · Scope: offline tooling only. No change to the game rules, the HTTP API or the UI.
> Related: [`architecture.md`](../architecture.md), [`design.md`](../design.md), [`game_rules.md`](../game_rules.md), `specs/04-players-frozen.md`.

## 1. Goal

Play **100,000 all-AI games with 5 players**, record every decision together with the state it was taken in and how it turned out, and store the result as a dataset. The dataset is the input for a later step that trains a better AI than the current `random` strategy. Training itself is out of scope here. This document only covers producing the data.

The dataset must let us ask, later:

- *Imitation:* "what did a good player do in this situation?" (state → move).
- *Value:* "how good was this situation?" (state → expected tricks, bid made, points, final place).
- *Bidding calibration:* "given this hand and trump, how many tricks does it usually win?"

## 2. What exists today

| Piece | Where | Relevance |
|---|---|---|
| Pure, deterministic engine | `src/engine/*` | Safe to run at scale in a plain Node process. |
| `runAiLoop(state, players, { onTransition })` | `src/service/ai-loop.ts` | Plays a whole game. `onTransition(prev, transition)` is called after every move and gives access to the full `GameState`, so hidden hands are available to a recorder. |
| `AIStrategy.choose(view, legalMoves, rng)` | `src/players/player.ts` | The seam where a better AI plugs in. Training data should be shaped like this function's input and output. |
| Registry of strategies | `src/players/registry.ts` | Only `random` exists. New strategies register here. |
| `pnpm simulate` | `scripts/simulate.ts` | Runs N games, prints four summary lines, stores nothing. Game *i* uses seed `<prefix>-<i>`. |
| Seeded RNG (separate deal and per-seat AI streams) | `src/engine/rng.ts` | Any game can be replayed exactly from its seed. |

Measured on this machine with the default preset (`argentina-fidepo`, 5 players, `random` everywhere): **200 games in 6.6 s ≈ 33 ms per game**, 17 hands per game, about **635 decisions per game** (85 bids and 550 card plays). `random` makes its bid in only **14.6 %** of the hands.

## 3. Main design decisions

### 3.1 The data is only as good as the players that produced it

All five seats playing `random` produce a valid dataset, but a poor one. It shows what random play does, not what good play does, and a model trained on it can at best learn to avoid obvious blunders. So the generator must be built around a **population of strategies of increasing quality**, not around the current one.

Proposed stages (each stage's data is a separate dataset version):

| Stage | Seats | Purpose |
|---|---|---|
| **S0: random baseline** | 5 × `random` | Check the pipeline end to end. Gives the "floor" for evaluation. |
| **S1: heuristic** | Hand-written strategy (bid = estimated tricks from high cards and trump; play = standard trick-taking heuristics, aware of its own bid) | First useful signal. Cheap to run, fully explainable. |
| **S2: mixed table** | Seats drawn from {heuristic, heuristic + ε-noise, random, previous model} per game | Diversity: states that a single strategy would never reach, and learning against different opponents. |
| **S3: model self-play** | Latest trained model, with exploration (softmax temperature or ε) | Expert-iteration loop. Each round trains on the previous round's games. |

The first deliverable is S0 + S1; S2/S3 reuse the same pipeline with different strategies.

### 3.2 Record two views of every decision

For every decision, record both:

1. **The player view**: exactly what `AIStrategy.choose` received (`PlayerView` + legal moves). This is the model input at inference time. It is the only thing a deployable model may use.
2. **The oracle state** (columns prefixed `hidden_`): the other seats' hands, the unplayed stock. This is never available to the AI at play time, but it is useful for analysis, for building teacher signals (for example "what was the best card knowing every hand") and for debugging. Training pipelines must treat `hidden_*` as forbidden features by default.

### 3.3 Outcomes are attached after the game

A decision's value is only known when the hand (and the game) ends. The recorder buffers a game's decisions in memory, and when the game is over, fills in the outcome columns for each of them (§4.3), then writes them. Games are small (about 635 rows), so buffering is trivial.

### 3.4 Determinism and provenance

A game is fully determined by `(preset, seats and strategies, seed)`. Each game record stores these, plus the git commit and a `generator_version`. Any row can then be regenerated and checked. Seeds are `<run_id>-<shard>-<index>`, so shards can be rerun independently and never collide.

## 4. Data model

Three logical tables, written as columnar files (§6). IDs join them.

### 4.1 `games` (100,000 rows)

| Column | Notes |
|---|---|
| `game_id`, `run_id`, `shard`, `seed` | `seed` is the engine seed string. |
| `preset`, `n_players`, `n_hands` | `argentina-fidepo`, 5, 17 for the first run. |
| `strategy_by_seat` | e.g. `["heuristic-v1","heuristic-v1","random","heuristic-v1","random"]`. |
| `final_total_by_seat`, `final_place_by_seat` | From `evaluate(state)`. |
| `generator_version`, `git_commit`, `created_at` | Provenance. |

### 4.2 `hands` (about 1.7 M rows)

One row per (game, hand): `game_id`, `hand_index`, `cards_dealt`, `dealer`, `trump_card`, `trump_in_dealer_hand`, plus per seat `bid`, `tricks_won`, `made`, `points`. Useful on its own for bidding studies and cheap to scan.

### 4.3 `decisions` (about 63.5 M rows)

One row per bid or card play.

| Group | Columns |
|---|---|
| Keys | `game_id`, `hand_index`, `step` (0-based order in the game), `seat`, `decision_type` (`bid` \| `play`) |
| Player view (model input) | `cards_in_hand`, `dealer`, `trump_card`, `trump_in_dealer_hand`, `your_hand` (card codes, e.g. `QH`), `bids_so_far` (per seat, `null` if not bid yet), `tricks_won_so_far` (per seat), `current_trick` (ordered plays), `cards_played_this_hand` (convenience, derivable), `score_totals` (per seat), `trick_number` |
| Action | `legal_move_ids`, `chosen_move_id` (`bid:3`, `play:QH`), `chosen_index` |
| Policy info | `strategy`, `policy_probs` (aligned with `legal_move_ids`, `null` for strategies that cannot report it, such as `random` which is uniform by definition), `explore` (bool: was this a deliberate exploratory move) |
| Oracle (`hidden_*`) | `hidden_hands` (every seat's remaining cards at decision time), `hidden_stock_left` |
| Outcome labels (filled after the game) | `hand_bid`, `hand_tricks_won`, `hand_made`, `hand_points` (this seat); `won_this_trick` (for `play`); `final_place`, `final_total` (this seat) |

Card and move encodings reuse the engine's string ids (`QH`, `play:QH`, `bid:3`), so rows can be fed back into `applyMove` for verification. Dense numeric feature encodings (one-hot planes, etc.) are **not** stored: they belong in the training pipeline, so they can change without regenerating data.

### 4.4 Size estimate

| Item | Estimate | Measured |
|---|---|---|
| Decisions | 100,000 × ~635 ≈ **63.5 M rows** | 63,500,000 (635 per game, 5 players) |
| Raw JSONL (~400 B/row with the oracle fields) | ≈ 25 GB | not stored uncompressed |
| JSONL + gzip | not estimated | **26,179 B per game, 2,617.9 MB for 100,000 games** (26.2 MB for 1,000 games) |
| Parquet + zstd | ≈ **2–4 GB** (small repeated vocabulary: cards, ids, strategy names) | not built (phase 5) |

The JSONL + gzip figures are measured: 1,000 games of 5 players weigh 26,224 B per game, and the full 100,000-game run weighs 2,617.9 MB (the `decisions` table is about 98 % of it). With 3 players a game has 981 decisions and weighs 41,942 B. The Parquet row is still an estimate.

## 5. Generator architecture

New code, all outside the production request path:

```
scripts/generate-data.ts        CLI entry: run and validate subcommands (shard and merge were not needed)
scripts/datagen/                (as built; not imported by app/ or src/)
  recorder.ts                   builds rows from onTransition + the strategy decorator
  labels.ts                     fills outcome columns once the game is over
  sinks.ts                      JSONL shard writer (and Parquet writer in a later step)
  worker.ts                     worker_threads worker: plays a range of seeds
  manifest.ts                   run manifest + shard checksums
src/players/strategies/
  heuristic.ts                  S1 strategy (registered in registry.ts)
```

How a game is recorded:

1. `createGame` with the seats and seed, as `simulate.ts` does.
2. Wrap each seat's strategy with a **recording decorator**. It calls the inner strategy, then stores `(view, legalMoves, chosen move, policy probs)` for that decision. Strategies that can report probabilities do so through an optional `AIStrategy.explain?()` method (an additive, backwards-compatible change to the interface); `random` does not need it.
3. Call `runAiLoop(state, players, { onTransition })`. The hook receives the full `prev` state, from which the recorder reads the oracle columns for the decision just made.
4. When the game reaches `game-over`, `evaluate(state)` gives the per-hand scores. `labels.ts` joins them onto the buffered rows and flushes the game.

The decorator and hook only observe; they never change a decision or consume RNG draws, so a recorded game is identical to the same game without recording. This is checked by a test (§7).

### 5.1 Parallelism

Single-threaded `random` play is about 33 ms/game, so 100,000 games is roughly 55 minutes before recording overhead (assume 2–3×). Heuristic and model strategies cost more per decision. The run is split into **shards of 1,000 games** (100 shards). A pool of `worker_threads` (one per CPU core) takes shards from a queue, so the full run takes minutes to tens of minutes. Each shard writes its own files, so there are no shared writers and no locking.

Measured with recording, shard writing and the replay checks (10-core macOS laptop; timings differ on other hardware): **44.0 ms per game** with 5 players and 72.1 ms with 3 players, on one worker (1.3× a plain `pnpm simulate`, not the 2–3× assumed above). The full 100,000-game run with 5 players took **650 s (about 11 minutes) with 10 workers**, about 6.5 ms of wall-clock time per game. A run killed at 40 complete shards finished on resume in 396 s. `validate` of the full dataset takes about 11.5 minutes because it is single-threaded.

### 5.2 Resumability

A run has a `run_id` and a manifest listing every shard with its status and checksum. A shard is written to a temp name and renamed when finished, so an interrupted run resumes by skipping completed shards. Rerunning a shard overwrites the same file with identical bytes (determinism).

### 5.3 Where data lives

Datasets are **not** committed to git and **not** stored in the production Vercel Blob store (architecture §3 keeps preview and production stores for game data only). Default location: `.data/datasets/<run_id>/` locally (already git-ignored with `.data/`; to be confirmed), optionally synced to a separate object-storage bucket or Blob store dedicated to ML data. Only the manifest (a few KB) may be committed.

## 6. Storage format

| Format | Verdict |
|---|---|
| **JSONL (gzip)** per shard | Phase 1. Zero new dependencies, human-readable, easy to debug, convertible. |
| **Parquet (zstd)** per shard | Phase 2. Columnar and compressed, 5–10× smaller and fast to load in pandas, Polars, DuckDB or PyTorch. Added through a small Node Parquet writer, or by a one-off Python conversion step. |

Start with JSONL so the first dataset exists quickly, and convert to Parquet once the schema has settled. The schema is versioned (`schema_version` in the manifest) and defined once with Zod, like the persisted game documents.

## 7. Validation

| Check | When |
|---|---|
| Every game ends in `game-over`; hands per game equals the preset's plan (17). | Every game. |
| Rows per game equal the number of moves applied by the loop. | Every game. |
| **Replay check**: re-run a game from `(seeds, strategies)` and compare every `chosen_move_id` and final score to the recorded ones. | Sampled (1 % of games) in generation, 100 % in CI on a small run. |
| **Observer-effect test**: a game with recording and without recording produce identical states. | CI. |
| Labels: Σ over seats of `hand_tricks_won` equals `cards_dealt`; `hand_points` matches `evaluate`. | Every hand. |
| Distribution report per run: made-bid rate, average score by strategy and seat position, bid histogram per `cards_dealt`, decisions per game. Seat-position bias should be near zero with random seating. | Per run (`validate` subcommand). |
| No `hidden_*` column is referenced by the feature code in the training pipeline. | Training-side lint. |

## 8. Phased plan

| # | Deliverable | Done when |
|---|---|---|
| 1 | Recorder + JSONL sink + `generate-data run` for S0 (random) at 1,000 games. | Dataset validates (§7), size and time per game measured, estimates in §4.4 and §5.1 updated. |
| 2 | Worker pool, shards, manifest, resume. Full 100,000-game S0 run. | Run completes and can be resumed after a kill. |
| 3 | `heuristic-v1` strategy, registered, with `explain()`. Unit tests and a benchmark against `random` using `pnpm simulate`. | Heuristic's made-bid rate and average score clearly beat random (target to be fixed by the benchmark, not guessed now). |
| 4 | S1 / S2 datasets: 100,000 games with the mixed table. | Dataset published with its distribution report. |
| 5 | Parquet output and a loader snippet for the training side. | Dataset loads in the chosen training environment. |
| 6 | (Later) S3 self-play loop: train → register model strategy → generate → repeat. | Each round beats the previous one in a head-to-head run. |

Phases 1–2 are mechanical and low-risk. Phase 3 decides how good the dataset can be.

## 9. Evaluating the AI later

Dataset quality is not model quality. Reserve **evaluation seeds** (a fixed prefix such as `eval-*`, never used for training) and compare any new strategy to the baselines head-to-head over the same deals with the seats rotated. The metric is average final score and made-bid rate per strategy. `pnpm simulate` already does the all-AI loop and can be extended with a `--strategies` option for this.

## 10. Risks and open questions

| Risk / question | Notes |
|---|---|
| **Low-quality teachers** | A model cannot become much better than the data's players unless trained on outcomes (value or policy-gradient targets) rather than pure imitation. Hence stages S2/S3 and the outcome labels. |
| **Credit assignment** | A card play is judged by the hand's final result, which depends on all five players. Noisy per-decision. Mitigate with volume, and optionally with Monte Carlo rollout labels (below). |
| **Rollout / oracle labels** | For each decision, estimating the value of every legal move by simulating the rest of the hand many times would give much cleaner labels, at a large compute cost (×50–×500). Proposed as an optional later enrichment on a subset of games, not part of the first run. |
| **Dealer restriction** | In `argentina-fidepo` the dealer cannot bid so that bids sum to the hand size. The state/legal-move representation already encodes it (legal moves exclude it); models must read `legal_move_ids`, not assume all bids are possible. |
| **One preset only?** | The first run uses `argentina-fidepo` with 5 players, as asked. The schema stores `preset`, so other rule sets can be added without a format change. A model trained on one preset may not transfer to another. |
| **Coverage by hand size** | 100,000 games is about 1.7 M hands, but hands of each size (1 to 10 cards) get different shares, and the state space of large hands is huge. Check from the distribution report whether large hands are covered well enough. |
| **Language of the trainer** | Node output is training-ready through Parquet. Whether training happens in Python (likely) or TypeScript is undecided and affects only Phase 5. |
| **Privacy** | The data is entirely synthetic (no human games). Human games stored in production Blob are **not** used. Using them later would need a separate decision. |

## 11. Non-goals

- Training or serving the model, and choosing its architecture.
- Using real players' games from production.
- Changing `random` or the existing `pnpm simulate` output (its format is covered by spec 04).
- Running anything on Vercel. Generation is a local or batch-machine job.
