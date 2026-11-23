# La Podrida — Development Guide

> For developers (human or AI) working on the code. Quick start and the command list: [`README.md`](../README.md). What the system does: [`design.md`](./design.md). How it is built and deployed: [`architecture.md`](./architecture.md). Build order: [`implementation.md`](./implementation.md).

This guide explains how the repository is organised, which rules the tooling enforces and why, and how to work within them. Everything described here is checked by `pnpm typecheck`, `pnpm lint` and `pnpm test`, locally and in CI.

---

## 1. Toolchain

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 (LTS) | `.nvmrc` and `package.json` `engines.node` (`>=24 <25`). Other versions print an "Unsupported engine" warning from pnpm; CI always runs 24. |
| pnpm | 10 (exact version in `package.json` `packageManager`) | Always install with `pnpm install --frozen-lockfile`; it must never change `pnpm-lock.yaml`. |
| Next.js | 16 (App Router) | React 19. |
| TypeScript | 6.0 | `strict`, no emit. Pinned below 7, see §8. |
| Vitest | 5 | With Vite 8 as its peer. |
| ESLint | 10 (flat config) | Plus `typescript-eslint`, the Next.js plugin and a local layer-boundary rule. |
| Prettier | 3 | Checked by `pnpm lint`. |
| Zod | 4 | Runtime dependency, used for configuration and the domain schemas (§9). |
| `@noble/hashes` | 2.4.0 (exact) | Runtime dependency, used by the engine's seeded random streams (§10.6). |
| `@vercel/blob` | 2.9.0 (exact) | Runtime dependency, used only by the Vercel Blob storage driver (§13). |

**Dependencies.** Runtime `dependencies` are limited to `next`, `react`, `react-dom`, `zod`, `@noble/hashes` (SHA-256 for the engine's random streams, §10.6) and `@vercel/blob` (the Blob storage driver, §13). Everything else is a `devDependency`. All versions in `package.json` are **exact pins** (no `^`/`~`): add packages with an explicit version, e.g. `pnpm add -D some-tool@1.2.3`, so every upgrade is a visible, deliberate change.

---

## 2. Project layout

```
app/                    Next.js App Router: pages, layouts, components (UI)
  api/                  HTTP route handlers (added later)
src/
  domain/               Types, rules presets, pure helpers            ┐
  engine/               Game Engine: state transitions, legal moves   │ core: pure, no I/O
  score/                Score Engine                                  │
  players/              Player / AI strategies                        ┘
  state/                Game State Manager: load/save game state      ┐ I/O
  storage/              ObjectStore drivers (memory, file, Vercel Blob)┘
  service/              GameService: orchestrates core + state
  config.ts             Validated environment configuration
tests/
  unit/                 Pure logic, lint-rule fixtures, config
  contract/             Cross-module contracts (e.g. every ObjectStore driver)
  api/                  Route handlers
  sim/                  Long-running simulations (run by `pnpm test:sim` only)
scripts/simulate.ts     Command-line simulator (`pnpm simulate`)
tools/eslint-rules/     Local ESLint rule that enforces the layer boundaries
docs/                   Design docs (this guide included)
```

`src/domain` (§9), `src/engine` (§10), `src/score` (§11), `src/players` (§12) and `src/storage` (§13) are built, and `src/service` holds the two pure helpers `buildPlayerView` and `runAiLoop` (§12) but not `GameService` yet. `src/state` is still empty (it holds a `.gitkeep` so git tracks it). The App Router lives in the root `app/` folder, not `src/app`, so that `src/` holds only the layered backend code.

**Import alias.** `@/` maps to the **project root**, so imports read `@/src/engine/...` or `@/app/...`. It works in TypeScript, Next.js, Vitest and `tsx`.

---

## 3. Layer import rules

The architecture is layered so that the game logic stays pure and testable, and I/O stays isolated. `pnpm lint` enforces the rules below; breaking one is a lint error, not a review comment.

A **layer** is a folder directly under `src/`. The **core** is `domain`, `engine`, `score` and `players`. A file may always import from its own layer.

| Rule | What is enforced | Why |
|---|---|---|
| **Core purity** | Core files may import only `zod` and `@noble/hashes` (and their subpaths) from outside `src/`. Every Node built-in (`fs`, `node:crypto`, …), `next`, `react`, `@vercel/blob` and any other package is an error, **including `import type`**. Core files may not import `src/config.ts`. | The core must run unchanged in tests, the command-line simulator and serverless functions. |
| **Inward dependencies** | `domain` imports no other layer. `engine`, `score` and `players` import only `domain` (not each other). `state` imports only `storage` and `domain`. `service` may import every other layer. | Dependencies point inwards, so the core can be tested without I/O and each layer can be replaced without touching the ones it depends on. |
| **Nothing imports `service`** | No file under `src/` outside `service` may import from `src/service`. | `service` is the top of the backend; only route handlers call it. |
| **Only `storage` touches the filesystem or Blob** | `fs`, `fs/promises`, `node:fs`, `node:fs/promises` and `@vercel/blob` (and subpaths) may be imported only under `src/storage`. | Storage is the one place bound to a concrete backend, so swapping memory / file / Blob drivers never touches other code. |
| **The UI imports types only** | Files under `app/` (except `app/api/`) may use only `import type` from `src/`, and only from `src/domain`. Value imports from any `src` module, and any import of other layers or `src/config.ts` (even `import type`), are errors. | The browser never runs engine logic and never receives server internals; it renders the per-player view it gets from the API. |
| **Configuration access** | `src/config.ts` may be imported by `state`, `storage`, `service` and route handlers, not by the core or the UI. | Configuration is a runtime concern of the I/O and orchestration layers. |

`app/api/**`, `tests/**` and `scripts/**` are not restricted.

Full matrix (✓ allowed, ✗ lint error, "own" = same folder):

| Importer ↓ / target → | domain | engine, score, players | state | storage | service | `src/config` | packages | `fs` / `@vercel/blob` |
|---|---|---|---|---|---|---|---|---|
| `src/domain` | own | ✗ | ✗ | ✗ | ✗ | ✗ | `zod`, `@noble/hashes` only | ✗ |
| `src/engine`, `src/score`, `src/players` | ✓ | own only | ✗ | ✗ | ✗ | ✗ | `zod`, `@noble/hashes` only | ✗ |
| `src/state` | ✓ | ✗ | own | ✓ | ✗ | ✓ | any | ✗ |
| `src/storage` | ✓ | ✓ | ✓ | own | ✗ | ✓ | any | ✓ |
| `src/service` | ✓ | ✓ | ✓ | ✓ | own | ✓ | any | ✗ |
| other files in `src/` (e.g. `src/config.ts`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | any | ✗ |
| `app/**` except `app/api/**` | `import type` only | ✗ | ✗ | ✗ | ✗ | ✗ (even type) | any | any |

**How matching works.** The rule looks at every `import …`, `import type …` and `export … from …` statement. It resolves the specifier — relative at any depth (`../../engine/x`) or via `@/` — to a path and checks which layer folder that path falls in. The target file does not have to exist. An `import { type A, type B }` in which every name is marked `type` counts as a type-only import. Dynamic `import()` and `require()` are **not** checked; the codebase uses static ESM imports only.

**Why a local rule.** The rules are implemented by a small project-local ESLint rule (`tools/eslint-rules/layer-boundaries.mjs`) rather than `no-restricted-imports` or `eslint-plugin-boundaries`. The same relative specifier means different things at different depths (`../storage/y` is the storage layer from `src/engine/x.ts` but `src/engine/storage/y` from `src/engine/a/b.ts`), which pattern-based rules cannot express, and resolver-based plugins cannot classify imports of files that do not exist yet. The local rule resolves paths itself and needs no extra dependency.

**Changing the rules.** The matrix is data, not code: edit `LAYER_BOUNDARIES` (and `CORE_EXTERNALS` for packages the core may use) in `eslint.config.mjs`, not the rule itself.

- *Add a layer:* add `<name>: { layers: [...], config: true|false }` to `LAYER_BOUNDARIES.layers`, and add `<name>` to the `layers` list of each existing layer that may import it.
- *Allow a package in the core:* append its name to `CORE_EXTERNALS` (subpaths are allowed automatically).
- Every change gets a fixture row in `tests/unit/layer-boundaries.test.ts` (see §4).

---

## 4. Tests

Tests are Vitest files named `*.test.ts`, placed in the folder that matches what they test:

| Folder | Put here | Run by |
|---|---|---|
| `tests/unit/` | Pure logic: domain helpers, engine and score functions, config, lint-rule fixtures. | `pnpm test` |
| `tests/contract/` | Contracts that several implementations must satisfy (e.g. one suite run against every storage driver, §13.6). The Vercel Blob run is skipped unless `BLOB_READ_WRITE_TOKEN` is set. | `pnpm test` |
| `tests/api/` | Route handlers, called directly. | `pnpm test` |
| `tests/sim/` | Long-running simulations (many full games). | `pnpm test:sim` only |

Test files anywhere else (for example next to the code in `src/`) are **never run**. The simulation suite, its `SIM_SEEDS` setting and its helpers are described in §12.5.

Example:

```ts
// tests/unit/example.test.ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@/src/config';

describe('loadConfig', () => {
  it('defaults the log level to info', () => {
    expect(loadConfig({}).logLevel).toBe('info');
  });
});
```

Run a single file with `pnpm vitest run tests/unit/example.test.ts`.

**Two Vitest configs.** `vitest.config.ts` (used by `pnpm test`) includes `tests/{unit,contract,api}`; `vitest.sim.config.ts` (used by `pnpm test:sim`) includes only `tests/sim` and allows an empty folder. They are two standalone files because merging configs concatenates the `include` lists (sim would also run everything else) and importing one config from the other is not supported cleanly by Vite's config loader. **Keep the `resolve.alias` and `environment` settings of both files in sync.**

**Layer-rule fixture tests.** `tests/unit/layer-boundaries.test.ts` runs ESLint's `lintText` on inline source strings with a virtual file path (e.g. `src/engine/x.ts`) and asserts whether a `layer-boundaries/imports` error is reported. There are no fixture files on disk, so neither `pnpm lint` nor `pnpm typecheck` sees them. Add a row `[label, virtualPath, code, expectError]` to the `rows` table for each new case.

**Tests that need a fresh `getConfig()`.** `getConfig()` caches its result in the module. To test it from a clean state, call `vi.resetModules()` and import the module dynamically (`await import('@/src/config')`); restore any `process.env` keys you change, and don't replace `process.env` as a whole. There is deliberately no exported "reset" function, to keep the public API minimal.

---

## 5. Configuration

All runtime configuration comes from environment variables, validated by `src/config.ts`:

```ts
loadConfig(env: Record<string, string | undefined>): Config  // validate a map; returns a frozen object
getConfig(): Config                                          // loadConfig(process.env), cached after the first success
class ConfigError extends Error                              // thrown on any invalid configuration
```

| Variable | `Config` field | Allowed values | Default |
|---|---|---|---|
| `STORAGE_DRIVER` | `storageDriver` | `memory`, `file`, `blob` | `blob` if `VERCEL` = `1`, else `file` |
| `FILE_STORE_DIR` | `fileStoreDir` | any non-empty string | `.data/` |
| `BLOB_STORE_ID` | `blobStoreId` | any string; optional | unset |
| `VERCEL_OIDC_TOKEN` | `vercelOidcToken` | any string; optional (secret) | unset |
| `BLOB_READ_WRITE_TOKEN` | `blobReadWriteToken` | any string; optional (secret) | unset |
| `DEFAULT_RULES_PRESET` | `defaultRulesPreset` | `argentina-fidepo`, `spain-ludoteka`, `gamerules`, `mexico-bazas` | `argentina-fidepo` |
| `LOG_LEVEL` | `logLevel` | `debug`, `info`, `warn`, `error` | `info` |
| `RETENTION_DAYS` | `retentionDays` | decimal integer from 1 to 3650 | `365` |
| `CRON_SECRET` | `cronSecret` | non-empty string (secret); **required when `VERCEL_ENV` is `preview` or `production`** | unset |
| `VERCEL_ENV` | `vercelEnv` | `development`, `preview`, `production`; optional | unset |
| `VERCEL` | (only picks the `STORAGE_DRIVER` default) | any | – |

Rules:

- **An empty string counts as unset** for every variable: a variable with a default takes the default, an optional one is `undefined`, and a required `CRON_SECRET` is reported missing.
- **Values are not trimmed.** `RETENTION_DAYS` must be digits only (`"007"` → 7; `" 365"`, `"+5"`, `"1.5"` are invalid).
- **`CRON_SECRET` is optional locally** (no `VERCEL_ENV`, or `development`), so local development and tests start with no variables at all. On preview and production it must be set.
- Only these variables are read; anything else in the environment is ignored.
- **`loadConfig` does not check the Blob credentials.** With `STORAGE_DRIVER=blob`, `createObjectStore` requires `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` and throws `ConfigError` without them (§13.3).

**Errors list every problem at once.** Invalid configuration throws a single `ConfigError` whose message names every invalid variable, one per line:

```
Invalid configuration:
  - LOG_LEVEL must be one of debug, info, warn, error
  - CRON_SECRET is required when VERCEL_ENV is preview or production
```

It works this way because a misconfigured deployment should be fixed in one pass, not one variable per redeploy. Internally the variables are parsed with a Zod schema keyed by variable name, and the `CRON_SECRET` rule (which depends on another variable) is checked separately so it is reported even when other variables are invalid too. The message is built only from fixed descriptions, never from Zod's messages or the received values, so **a `ConfigError` never contains a secret** (`CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`, `VERCEL_OIDC_TOKEN`).

**Adding a variable:** add it to `ENV_VARS`, to the Zod schema, to `PROBLEMS` (if it can be invalid) and to the mapping that builds the `Config` object, then add tests in `tests/unit/config.test.ts`.

---

## 6. Formatting and linting

`pnpm lint` runs `eslint . --max-warnings 0` and then `prettier --check .`. It fails on any ESLint error, **any ESLint warning** (the Next.js rules are warnings, so they block too), or any unformatted file. Run `pnpm format` to fix formatting.

- **Prettier style:** single quotes, semicolons, trailing commas, 2-space indent, 100-character lines. Prettier and ESLint never conflict because `eslint-config-prettier` turns off ESLint's stylistic rules.
- **Prettier scope:** code and config files (`app/`, `src/`, `tests/`, `scripts/`, `tools/`, root config files, `README.md`, the CI workflow). `docs/` is excluded on purpose (see `.prettierignore`): the design docs are hand-written Markdown whose tables and line breaks should not be rewritten. Files in `.gitignore` are skipped too.
- **ESLint scope:** every `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs` and `.cjs` file that is not ignored. Rules: `@eslint/js` recommended, `typescript-eslint` recommended, the Next.js `core-web-vitals` rules for `app/`, and the layer-boundary rule.
- **Linting is syntax-only** (no type-aware rules). Type-aware linting needs a TypeScript program, which would slow `pnpm lint` down and break the layer-rule fixture tests that lint virtual files outside the project. Type errors are caught by `pnpm typecheck` instead.
- We use `@next/eslint-plugin-next` directly rather than `eslint-config-next`, which would bring in several extra plugins we don't need.

---

## 7. Continuous integration

`.github/workflows/ci.yml` runs on pull requests only: when one is opened, and on every push to its branch. Pushing a branch with no open pull request runs nothing. One job on `ubuntu-latest`:

1. Checkout.
2. Set up pnpm (version read from `packageManager` in `package.json`).
3. Set up Node.js from `.nvmrc`, with the pnpm store cached between runs (the cache key is the hash of `pnpm-lock.yaml`).
4. `pnpm install --frozen-lockfile`
5. `pnpm typecheck`
6. `pnpm lint`
7. `pnpm test`
8. `pnpm test:sim` (step "Simulation tests": the seeded all-AI simulation with the default 200 seeds, §12.5; budget < 10 minutes)
9. `pnpm build`

The run fails as soon as one step fails. CI needs no secrets and sets no environment variables: tests pass explicit environment maps to `loadConfig`, and the storage contract run against Vercel Blob is reported as skipped because `BLOB_READ_WRITE_TOKEN` is not set (§13.6). The workflow has read-only access to the repository.

**Why `build` is in CI.** `next build` catches errors that typecheck and lint don't (for example invalid page exports or prerendering failures), and there are no preview deployments yet to catch them.

Every change must keep CI green. Run the same commands locally before pushing:

```sh
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm test:sim && pnpm build
```

---

## 8. Conventions and why they exist

- **`pnpm typecheck` works on a clean checkout.** It runs `next typegen && tsc --noEmit`. `next-env.d.ts` and `.next/` are generated files and are git-ignored, so on a fresh clone (and in CI, where typecheck runs before build) they don't exist. `next typegen` generates them, including typed routes, without a full build. As a side effect, `typecheck` writes `.next/` and `next-env.d.ts`; both are ignored. Keep `next-env.d.ts`, `.next/types/**/*.ts` and `.next/dev/types/**/*.ts` in `tsconfig.json` `include`.
- **TypeScript stays on 6.0.x.** `typescript-eslint` supports TypeScript only below 6.1, so upgrading to TypeScript 7 would break linting. Upgrade TypeScript only within the range `typescript-eslint` supports.
- **`@types/node` stays on the 24 line**, matching the Node.js runtime.
- **Exact version pins** (see §1): the lockfile fixes versions anyway; exact pins in `package.json` make every upgrade an explicit change.
- **`agentRules: false` in `next.config.ts`.** Without it, `next dev` writes an `AGENTS.md` file into the repository root on every start.
- **Generated files are never committed:** `node_modules/`, `.next/`, `out/`, `.data/` (local file storage), `.env*.local`, `coverage/`, `*.tsbuildinfo`, `next-env.d.ts`.
- **Secrets** go in `.env.local` (git-ignored), never in committed files.
- **pnpm build scripts.** pnpm prints "Ignored build scripts: esbuild" on install. This is expected: esbuild (used by `tsx` and Vite) ships its binary as an optional platform package, so its install script is not needed.

---

## 9. Domain model

`src/domain` is the vocabulary every other layer speaks: cards, decks, rule sets, presets, game state, moves and events. It holds types, Zod schemas, four rule presets and a few pure helpers. There is no game logic here: nothing deals, validates a move or scores.

The domain is **pure**. It imports only `zod` and its own files, and it never uses randomness, I/O or the clock (`Math.random`, `Date`, `crypto`, `fetch`, `process`, …). The layer rule (§3) enforces the imports; the rest is kept by review. A quick check:

```sh
grep -rnE 'Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\.' src/domain   # must find nothing
```

### 9.1 What each module exports

Import from the module directly, e.g. `import { getPreset } from '@/src/domain/presets'`. There is no barrel `index.ts`. UI code may only `import type` (§3).

| Module | Exports |
|---|---|
| `@/src/domain/schemas` | `CardSchema`, `DeckDefinitionSchema`, `BoundSchema`, `SegmentSchema`, `HandSequenceSpecSchema`, `ScoringSpecSchema`, `RuleSetSchema`, `SeatInfoSchema`, `TrickPlaySchema`, `HandStateSchema`, `HandResultSchema`, `GameStateSchema`, `GameEventSchema`; helpers `KNOWN_SUITS`, `KNOWN_RANKS`, `PresetIdSchema` |
| `@/src/domain/cards` | types `Suit`, `Rank`, `Card`; `InvalidCardError`, `cardId`, `parseCard`, `compareRanks` |
| `@/src/domain/decks` | type `DeckDefinition`; `FRENCH_52`, `SPANISH_40`, `buildDeck` |
| `@/src/domain/rules` | types `Bound`, `Segment`, `HandSequenceSpec`, `ScoringSpec`, `PresetId`, `RuleSet` |
| `@/src/domain/presets` | `PRESET_IDS`, `DEFAULT_PRESET_ID`, `UnknownPresetError`, `getPreset` |
| `@/src/domain/types` | types `Phase`, `SeatInfo`, `TrickPlay`, `HandState`, `HandResult`, `GameState`, `Move`, `LegalMove`, `GameEvent`, `Transition`, `Rng`, `HandScore`, `ScoreBoard`, `TableView`, `PlayerView`, `PlayerUpdate`, `DecisionContext`, `Decision` |

The shapes themselves are described in [`design.md`](./design.md) §4 (cards, rule sets, hand sequences, state, moves, events), §5.5 (views), §6.1 (score board) and §8.1 (players).

### 9.2 Cards and decks

- **Card ids.** `cardId(card)` is the rank token followed by the suit letter: `7H`, `10S`, `3O`, `CC` (Spanish *caballo* of *copas*). Two cards are the same card exactly when their ids are equal; move ids such as `play:QH` build on this. `parseCard(id, deck)` reads the **last character as the suit** and the rest as the rank, and throws `InvalidCardError` unless both belong to that deck (so `3O` is invalid for `FRENCH_52` and `KO` for `SPANISH_40`; suit letters are upper case). Error messages quote the offending input, e.g. `Invalid card id "7h" for deck french-52`.
- **Rank order.** `compareRanks(deck, a, b)` returns a positive number when `a` ranks higher, following `deck.ranksHighToLow`. In the Spanish deck the order is `A 3 R C S 7 6 5 4 2`, so the 3 beats the king. A rank outside the deck throws `InvalidCardError`.
- **Decks.** `FRENCH_52` (suits `S H D C`) and `SPANISH_40` (suits `O C E B`: oros, copas, espadas, bastos). `removeRanksForPlayers` maps a player count, written as a decimal string, to the ranks removed for that count: `SPANISH_40` drops the 2s for 3 and 6 players (36 cards); every other case keeps the full deck.
- **`buildDeck(deck, players)`** returns a new array of new card objects, ordered by suit (deck order) and then rank high to low, so `buildDeck(FRENCH_52, 4)` starts `AS KS QS`. It throws `RangeError` unless `players` is an integer ≥ 1. It does not shuffle; shuffling belongs to the engine's seeded RNG.
- **The deck constants are deeply frozen.** Mutating `FRENCH_52` or anything inside it throws a `TypeError`. When you need a modifiable deck definition, `structuredClone` it (the clone is not frozen).

### 9.3 Rule sets and presets

A `RuleSet` is plain JSON data (no functions, classes or `undefined`) because each game freezes a copy of it into its state and persists it. The engine and the score engine read behaviour from it instead of special-casing presets.

- **Getting a preset.** `getPreset(id)` returns a fresh deep copy every time, so callers may change the result without affecting anyone else. `PRESET_IDS` lists the four ids in canonical order (`argentina-fidepo`, `spain-ludoteka`, `gamerules`, `mexico-bazas`) and `DEFAULT_PRESET_ID` is `argentina-fidepo`. Any other string, including `'__proto__'` or `'toString'`, throws `UnknownPresetError`.
- **Reading a preset.** Every field of every preset is set explicitly; nothing falls back to a default. Some flags only matter when another flag is on: `beatNotRequiredAfterTrumped` qualifies `mustBeatLedSuit`, and `whenCannotOvertrump` qualifies `mustOvertrump`. When the qualified flag is `false` the engine ignores the dependent one, but it still carries a fixed value (marked `// unused` in `presets.ts`) so that presets stay comparable side by side. The values and their sources are in [`design.md`](./design.md) §4.2.
- **Hand sequences** are short lists of `range` and `repeat` segments whose bounds may be a number, `'max'` (cards per player when the whole deck is dealt), `{ min: [n, 'max'] }` (= min(n, max)) or `{ offset: ['max', n] }` (= max + n, with n ≤ 0). The offset bound is how `spain-ludoteka` stops its ramps at `max − 1`, so it plays exactly N hands at `max`. [`design.md`](./design.md) §4.3 lists all four sequences and the number of hands each one gives per player count. Turning a sequence into a list of card counts is the engine's job (`expandHandSequence`, §10.1).
- **Adding or changing a preset** is a design change first: update the preset table in `design.md` §4.2–4.3, then:
  1. add the id to `PresetIdSchema` in `schemas.ts`; that single list feeds the `PresetId` type, `PRESET_IDS` and `RuleSet.id` validation;
  2. add a constant in `presets.ts` with **every** `RuleSet` field spelled out (mark ignored flags `// unused`), using `structuredClone(FRENCH_52)` or `structuredClone(SPANISH_40)` for the deck, and register it in the `PRESETS` map (its `Record<PresetId, RuleSet>` type rejects a missing preset);
  3. add a hand-written expected object to `tests/unit/domain/presets.test.ts`; write it out in full rather than importing it from `presets.ts`, so the test checks the preset independently;
  4. update the literal preset list in `src/config.ts` (`DEFAULT_RULES_PRESET`, §5), which is deliberately not linked to `PRESET_IDS`.

### 9.4 Schemas are the source of truth

Every shape that is persisted or validated (`Card`, `DeckDefinition`, `Bound`, `Segment`, `HandSequenceSpec`, `ScoringSpec`, `RuleSet`, `SeatInfo`, `TrickPlay`, `HandState`, `HandResult`, `GameState`, `GameEvent`) is a Zod schema in `schemas.ts`, and its TypeScript type is `z.infer<typeof …Schema>`. Never write one of these types by hand: one definition cannot drift from the validator that later phases use on stored data. The cost is that editor hovers show the inferred form rather than a named interface.

How the schemas behave:

- **Strict at every level.** Every object, including each variant of a union, is a `z.strictObject`, so unknown keys are rejected. Every field is required except `SeatInfo.strategy` and `HandState.lastTrick`; `GameState.hand` must be present but may be `null`.
- **Cards are validated as strings, not enums.** `CardSchema` refines `z.string()` to the union of both decks' suits (`KNOWN_SUITS`: `S H D C O E B`) and ranks (`KNOWN_RANKS`: `A K Q J 10 … 2 R C S`). Using `z.enum` would turn `Suit` and `Rank` into literal unions; with refined strings they stay `string`, because decks are data, not types. The same check applies to `trumpSuit`.
- **Shape, not game consistency.** `GameStateSchema` checks that a card is a card of *some* deck, that counts and indexes are non-negative integers (`cardsPerPlayer`, `handPlan` entries and `trickNumber` are ≥ 1), that `gameId` and `seed` are non-empty and that `schemaVersion` is `1`. Whether a card belongs to *this* game's deck, whether array lengths match the seat count, or whether the phase agrees with the hand are engine invariants (`checkInvariants`, §10.4).
- **`removeRanksForPlayers` keys** must match `^[1-9][0-9]*$` and are kept as strings (`"03"` and `"0"` are rejected), and every removed rank must be in the same deck.
- **`Phase` is `GameState['phase']`**, so the phase list exists only once, in `GameStateSchema`.
- **Types without a schema.** `Move`, `LegalMove`, `Transition` and `Rng` are never persisted, and `HandScore`, `ScoreBoard`, `TableView`, `PlayerView`, `PlayerUpdate`, `DecisionContext` and `Decision` are computed views; all of these are written by hand in `types.ts`.
- `schemas.ts` may export helpers beyond the schemas themselves (`KNOWN_SUITS`, `KNOWN_RANKS`, `PresetIdSchema`).

**Changing a persisted shape.** Edit the schema; the inferred type follows. `tests/unit/domain/types.test.ts` compares each inferred type with an expected shape written out by hand, so `pnpm typecheck` fails until you update that expected shape too (and the matching listing in `design.md` §4). This is deliberate: a shape change should never slip through unnoticed. The type test runs under `pnpm typecheck`; at runtime Vitest sees only trivial tests.

### 9.5 Imports inside the domain

- `schemas.ts` imports only `zod`.
- The **type modules** (`cards.ts`, `decks.ts`, `rules.ts`, `types.ts`) may import `schemas.ts`. When one type module needs another (e.g. `cards.ts` needs `DeckDefinition`, `decks.ts` needs `Card`), it uses **`import type`**, so there is never a runtime import cycle. Where they only need `z.infer`, they import `zod` and the schemas as types too.
- `presets.ts` is not a type module: it value-imports `decks.ts` (to clone the deck constants) and `schemas.ts` (for `PresetIdSchema`).
- `decks.ts` and `presets.ts` each hold a small private `deepFreeze` helper; keep the two copies identical.

Domain tests live in `tests/unit/domain/<topic>.test.ts`.

### 9.6 Not in the domain yet

- **Engine behaviour** lives in `src/engine` (§10): expanding a hand sequence into the game's `handPlan`, dealing, legal moves, transitions, table views, invariants and the seeded RNG.
- **Scoring** lives in `src/score` (§11), which computes `HandScore` and `ScoreBoard` from the state. **Players and strategies** live in `src/players`, and `PlayerView` is built by `buildPlayerView` in `src/service` (§12); `PlayerUpdate` exists only as a shape.
- **Persistence types** `GameMeta`, `Commit` and `CommitBody` and their schemas (Phase 6, in the state layer).
- No schema checks that a hand sequence makes sense for a player count (for example `range 5→max` when `max` is below 5); `expandHandSequence` checks it, and `createGame` reports it as a setup problem.

---

## 10. Engine

`src/engine` is the Game Engine: pure, deterministic functions that create a game from a rule set, seats and a secret seed, deal every hand from seeded random streams, list the legal bids and plays for the seat to act, apply a move together with every automatic transition that follows (bidding closed, trick won, hand completed, next deal, game over), build a per-seat table view, and check a state's invariants. Every rule difference between presets is read from the game's `RuleSet`; no code branches on a preset id.

The engine **never scores**: no points, totals or rankings appear in its state, events or views. Scoring is the Score Engine's job, which reads `GameState.completedHands` (§11, [`design.md`](./design.md) §6).

The engine is **pure** in the same way as the domain (§9): it imports only `@/src/domain/*`, its own files, `zod` and `@noble/hashes` (enforced by the layer rule, §3), and never uses ambient randomness, the clock or I/O. Check it with:

```sh
grep -rnE 'Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\.|src/score|\.\./score' src/engine   # must find nothing
```

The grep also matches comments, so avoid those words in `src/engine` comments too. `structuredClone` is a language global and is allowed.

### 10.1 Module map

Import from each module directly (`import { createGame } from '@/src/engine/engine'`); there is no barrel `index.ts`. Inside `src/engine`, modules import each other relatively (`./rng`).

| Module | Exports | What it does |
|---|---|---|
| `@/src/engine/rng` | `rngFromSource(next)`, `createXoshiro128ss(words)`, `deriveRng(seed, ...labels)` | Seeded random numbers. `deriveRng` builds an independent `xoshiro128**` stream from a seed and labels (§10.3). `rngFromSource` wraps any `() => uint32` function as an `Rng`, for stub-driven tests. |
| `@/src/engine/sequence` | `maxCardsPerPlayer(deck, players)`, `expandHandSequence(rules, players)` | Turns a rule set's hand sequence into the game's `handPlan` (cards per hand). Throws `RangeError` naming the offending value for a player count outside `rules.players` or a count `< 1` or `> max`. |
| `@/src/engine/bidding` | `legalBids(hand, seat, rules)` | Bids `0 … cardsPerPlayer` ascending, minus the dealer's forbidden value (*sucias*) when the restriction applies ([`design.md`](./design.md) §5.3). |
| `@/src/engine/play` | `legalPlays(hand, seat, rules, deck)` | The cards a seat may play, in hand order, for every combination of the play flags ([`design.md`](./design.md) §5.4). |
| `@/src/engine/trick` | `trickWinner(plays, trumpSuit, deck)` | The seat (not the play index) of the highest trump, else of the highest card of the led suit. |
| `@/src/engine/engine` | `ENGINE_VERSION`, `IllegalMoveError`, `IllegalMoveReason`, `InvalidGameSetupError`, `CreateGameInput`, `createGame`, `currentActor`, `legalMoves`, `applyMove`, `aiRng` | The engine proper: creation and validation, dealing, turn order, legal moves with their ids, applying moves, transitions and events. |
| `@/src/engine/view` | `tableViewFor(state, seat \| 'spectator')` | The per-seat `TableView`: everything a seat may see, nothing it may not. |
| `@/src/engine/invariants` | `checkInvariants(state)` | Returns one message per violated game-state rule (`[]` when valid). |

`legalBids`, `legalPlays` and `trickWinner` are building blocks: they check neither the turn, the phase nor the seat range. Callers outside the engine should use `legalMoves`, which does.

### 10.2 Using the engine

A complete game, from creation to the final view:

```ts
import { getPreset } from '@/src/domain/presets';
import type { GameEvent, SeatInfo } from '@/src/domain/types';
import { applyMove, createGame, currentActor, legalMoves } from '@/src/engine/engine';
import { checkInvariants } from '@/src/engine/invariants';
import { tableViewFor } from '@/src/engine/view';

const seats: SeatInfo[] = [
  { seat: 0, playerId: 'p0', name: 'Ana', kind: 'human' },
  { seat: 1, playerId: 'p1', name: 'Bot 1', kind: 'ai', strategy: 'random' },
  { seat: 2, playerId: 'p2', name: 'Bot 2', kind: 'ai', strategy: 'random' },
];

// Validates the input (throws InvalidGameSetupError) and deals hand 0.
const start = createGame({
  gameId: 'game-1',
  rules: getPreset('argentina-fidepo'),
  seats,
  seed: 'secret-seed', // in the app, generated on the server; never chosen by a client
});

let state = start.state;
const events: GameEvent[] = [...start.events]; // game-started, hand-dealt

// Play to the end, always choosing the first legal move.
for (let seat = currentActor(state); seat !== null; seat = currentActor(state)) {
  const moves = legalMoves(state, seat); // e.g. [{ id: 'bid:0', move: { type: 'bid', seat, tricks: 0 } }, …]
  const next = applyMove(state, seat, moves[0].id); // a move is chosen by its id only
  state = next.state;
  events.push(...next.events);
  if (checkInvariants(state).length > 0) throw new Error('broken state');
}

// state.phase === 'game-over', state.hand === null, state.completedHands has one entry per hand.
const view = tableViewFor(state, 0); // what seat 0 may see; 'spectator' for a seatless viewer
```

**Creating a game.** `createGame({ gameId, rules, seats, seed })` returns a `Transition` (`{ state, events }`). The state holds deep copies of `rules` and `seats`, the expanded `handPlan`, `version: 0`, `aiDecisionCount: 0`, `phase: 'bidding'` and hand 0 dealt; the events are exactly `[game-started, hand-dealt]`. Invalid input throws `InvalidGameSetupError`, whose `problems` array lists **every** problem found, in a fixed order: rules failing `RuleSetSchema` → seat count outside `rules.players` → hand sequence that does not expand for that count (the `RangeError` message verbatim) → per seat, a wrong `seat` index and a `SeatInfoSchema` failure → one problem per duplicated `playerId` → empty `gameId` → empty `seed`. One cause gives one problem: when the rules fail the schema, the checks that read them are skipped, and when the seat count is out of range, the sequence is not expanded. It reports everything at once for the same reason configuration does (§5): fix it in one pass.

**Whose turn it is.** `currentActor(state)` is `state.hand.toAct`, or `null` at game over. Turn order is `next(seat) = (seat + 1) mod N`; *mano* (`next(dealer)`) bids first and leads the first trick, the dealer bids last, the trick winner leads the next trick.

**Listing legal moves.** `legalMoves(state, seat)` returns `[]` for any seat that is not the current actor (and for every seat at game over). For the actor it returns `{ id, move }` entries: `bid:<n>` (decimal, ascending) during bidding and `play:<cardId>` (e.g. `play:10S`, in hand order) during play. A seat that is not an integer in `0 … N − 1` throws `RangeError`, in every phase.

**Applying a move.** `applyMove(state, seat, moveId)` accepts a move **only by the id of a currently legal move**, so revokes and *sucias* bids cannot happen. It checks, in order: the seat range (`RangeError`, even at game over), then `IllegalMoveError` with `reason` `'game-over'`, `'not-your-turn'` or `'unknown-move'` (the error also carries `seat` and `moveId`, and its message names both). A legal move returns a new `Transition`; the input state is never touched. Each call's events come in this order, each only when it happens: `bid-made` or `card-played` → `trick-won` → `hand-completed` → `hand-dealt` or `game-over`. A move by a seat whose `kind` is `'ai'` adds 1 to `aiDecisionCount`; `applyMove` never changes `version` (the persistence layer owns it).

**AI randomness.** `aiRng(state, seat)` returns the AI stream for that seat's next decision, `deriveRng(state.seed, 'ai', seat, state.aiDecisionCount)`. The engine itself never draws from it; it is for the AI player deciding the move. Because `aiDecisionCount` increases with every AI move, each decision gets a fresh stream, and replaying the same moves recreates the same streams.

**Building a view.** `tableViewFor(state, seat)` (or `'spectator'`) returns the viewer's own hand, every seat's card count, bid and tricks won, the current and last trick, the dealer, the trump card and whose turn it is. It never contains another seat's cards, except the trump card when the whole deck was dealt (shown to everyone, still in the dealer's hand), and never the seed, the rules, `aiDecisionCount` or any undealt card. At game over (`hand` is `null`) it has no trump, trick or hand, every seat shows `cardCount 0`, `bid null`, `tricksWon 0`, and `dealer` is the dealer of the last completed hand. Every array and card in a view is a fresh copy (cards are copied field by field as `{ suit, rank }`), so a caller may mutate or extend a view (for example into a `PlayerView` with the scoreboard) without cloning it and without corrupting the state.

### 10.3 Determinism rules

The same `createGame` input followed by the same sequence of `(seat, moveId)` calls always yields deep-equal states and events. That is what makes a game replayable from its seed and its `bid-made` / `card-played` events ([`design.md`](./design.md) §7). Keep these rules when changing the engine:

- **Two kinds of random stream, nothing else.** The deal stream for hand `i` is `deriveRng(seed, 'deal', i)`; the AI stream is `deriveRng(seed, 'ai', seat, aiDecisionCount)`. `deriveRng` seeds `xoshiro128**` with the first 16 bytes (four little-endian uint32) of `SHA-256(UTF-8(JSON.stringify([seed, ...labels])))`. The labels are framed with `JSON.stringify` because it is unambiguous (`('s', 'deal', 1)` never collides with `('s', 'deal', '1')`); do not replace it with string joining. The full algorithm, including how `int` and `shuffle` draw, is in [`design.md`](./design.md) §4.5.
- **What changes a deal.** Hand `i`'s cards depend only on the seed, `i`, the rules, the player count and (for `i > 0`) the first dealer. AI choices, bids and plays never change a deal, so changing an AI strategy never changes the cards. The first dealer is drawn from the hand-0 stream with `int(0, N − 1)` **before** the shuffle; later dealers rotate without drawing. Card `k` of the shuffled deck goes to seat `(dealer + 1 + k) mod N`, and hands are then sorted by suit (deck order) and rank high→low.
- **One clone per move.** `applyMove` makes exactly one `structuredClone` of the input state, mutates that clone in place and returns it. That single step guarantees both that the input is never mutated and that the result shares no object with it; do not "optimise" it into partial copies.
- **Moves and events carry copies.** Cards in `LegalMove`s, events (`card-played`, `hand-dealt`'s trump card, `hand-completed`'s result, `game-started`'s seats and plan) and views are copies, never objects of the returned state. A caller that mutates an event or a move cannot corrupt the game.
- **Fixed event order** per `applyMove`, as listed in §10.2. Clients animate events in that order.
- **No validation cost on the hot path.** `applyMove` does not run Zod parsing; only `createGame` parses its input. That every returned state parses with `GameStateSchema` and every event with `GameEventSchema` is a property checked by the tests.
- **No ambient inputs.** No clock, no `Math.random`, no environment. The seed is the only source of randomness, and it is always supplied by the caller.

### 10.4 Invariants

`checkInvariants(state)` returns a `string[]`: empty for a valid state, otherwise one human-readable message per violation, each starting with its tag. It never throws for a state that parses with `GameStateSchema`, performs no I/O and does not mutate its input.

| Tag | Rule |
|---|---|
| `(s)` | Structure: `handIndex < handPlan.length`; with a hand, `hands`, `bids` and `tricksWon` have one entry per seat, and `toAct`, `dealer` and `currentTrick.leader` are seats. |
| `(a)` | No card appears twice across all hands and the current trick. |
| `(b)` | Every such card belongs to this game's deck (`buildDeck(rules.deck, N)`). |
| `(c)` | Each seat holds `cardsPerPlayer` − completed tricks − (1 if it has played to the current trick) cards. |
| `(d)` | In `playing`, every bid is set. |
| `(e)` | In `playing`, on a hand where the dealer restriction applies, the sum of bids ≠ `cardsPerPlayer`. |
| `(f)` | While the game is not over, `legalMoves(state, toAct)` is not empty. |
| `(g)` | `hand` is `null` exactly when `phase` is `game-over`. |
| `(h)` | `hand.cardsPerPlayer === handPlan[handIndex]`. |
| `(i)` | `completedHands.length` is `handIndex` during the game and `handPlan.length` at game over. |

Some checks are skipped so that no check runs on data it cannot handle, and so that one cause gives one message:

- If any `(s)` check fails, only the `(s)` messages are returned (the other rules would index out of range).
- `(f)` calls `legalMoves`, so it is skipped when `(a)` or `(b)` fails (ranking a card from another deck throws), and also when `cardsPerPlayer` exceeds the deck size (listing the bids of such a "hand" would allocate an enormous array). Neither situation can arise in a real game.
- `(e)` runs only when every bid is set; a missing bid is reported once, by `(d)`.

**When to call it.** In tests and in the simulator, after every move, asserting `[]`; that is how the engine's own tests sweep full games for every preset. It is not called inside `applyMove`: legal moves cannot produce an invalid state, and the engine keeps the move path free of extra work. Card conservation across a whole hand (hands + played cards + stock = deck) needs the history of the hand, so it is not an invariant of a single state; the simulation suite checks it from the event log with its card-conservation ledger (§12.6, [`design.md`](./design.md) §5.6). Tests should assert on the tags, not the full message text.

### 10.5 `ENGINE_VERSION`

`ENGINE_VERSION` (exported from `@/src/engine/engine`, currently `1`) identifies the engine's behaviour. A stored game can only be replayed by the engine version that created it, so the version is saved with each game's metadata ([`architecture.md`](./architecture.md) §6.2).

**Bump it by 1 with any change that alters the deals or move outcomes for an existing seed and move sequence.** For example: the RNG, the stream derivation or its labels; the deck order or `buildDeck`; the dealing order, trump choice or hand sorting; the legal bids or plays; trick resolution; hand-sequence expansion; any transition. Refactors, new exports, error messages and view changes that leave every state and event the same do not need a bump.

**The tripwire.** `tests/unit/engine/golden.test.ts` pins, as literals that are never recomputed, the hand-0 dealer, trump card and hands, and the full `completedHands` of an `argentina-fidepo` 4-seat game with seed `golden-seed` played by first legal move. If a change makes it fail, that change alters behaviour: either it is a bug, or you must bump `ENGINE_VERSION` (and `GOLDEN_ENGINE_VERSION` in the test) and only then update the literals. The fixture covers dealing, sorting and French-deck trick resolution on that path; other paths (Spanish deck, other play flags, other presets) are covered by the tests that recompute expected values and by code review, so a green golden test does not prove a change is behaviour-neutral.

### 10.6 The `@noble/hashes` dependency

`deriveRng` needs SHA-256, and the engine may not use Node's `crypto` (it must run unchanged in browsers, tests, the simulator and serverless functions) or the asynchronous Web Crypto API (the engine is synchronous). `@noble/hashes` is a small, audited, dependency-free pure-JavaScript implementation, so it is the engine's only new runtime dependency, pinned to exactly `2.4.0`; `CORE_EXTERNALS` in `eslint.config.mjs` allows it in the core.

Version 2 is ESM-only and its export map has only `.js` subpaths: import `sha256` from `@noble/hashes/sha2.js` and `utf8ToBytes` from `@noble/hashes/utils.js`. The bare `@noble/hashes/sha2` does not resolve. Hash input is a `Uint8Array`. Changing the hash library is safe only if it produces identical bytes. `rng.test.ts` computes its expected stream with `@noble/hashes` itself, so it would not notice a different library; `golden.test.ts` (§10.5), whose literals depend on every hash, would.

### 10.7 Engine tests

Engine tests live in `tests/unit/engine/<topic>.test.ts`; each file names the requirements it checks in its header comment. Expected values are computed independently of the code under test (for example, the deal is recomputed in the test from `buildDeck` and `deriveRng`, and the RNG is checked against an in-test BigInt reference).

| File | Protects |
|---|---|
| `rng.test.ts`, `sequence.test.ts`, `bidding.test.ts`, `play.test.ts`, `trick.test.ts` | The building blocks. `sequence.test.ts` holds every preset's hand plan as a literal array; `play.test.ts` runs each case under every combination of the play flags. |
| `engine-create.test.ts`, `engine-apply.test.ts` | Creation and validation, dealing, legal moves and ids, move errors, transitions, events, immutability. |
| `determinism.test.ts` | Two runs give identical states and events; replaying the move events reproduces the game; deals do not depend on the moves chosen. |
| `golden.test.ts` | The `ENGINE_VERSION` tripwire (§10.5). |
| `view.test.ts` | View contents, the game-over view, and a leak sweep over every state of a full game for every viewer. |
| `invariants.test.ts` | Valid sweeps over full games for every preset, and one mutation per rule. |
| `perf.test.ts` | One full `argentina-fidepo` 3-player game (29 hands, 981 moves) by first legal move, median of 5 timed runs after a warm-up, must take < 250 ms (it takes about 45 ms locally). Run it with `--silent=false` to see the timings. |

Shared helpers live in `tests/unit/engine/helpers.ts` (not a `*.test.ts`, so not collected): card builders (`card('10S')`, `cards('KS AH 3H')`, `trick(leader, ids)`), `rulesWith(presetId, overrides)`, `makeHand`, `makeSeats(n, kinds)`, `newGame(presetId, players, seed)`, `withHand(state, overrides, phase)` for hand-built positions, and the game driver `playGame(start, policy = firstMove)`. `playGame` returns `{ states, events, moves, final }`, where `states[0]` is the start state, `moves[i]` (`{ seat, moveId, events }`) turned `states[i]` into `states[i + 1]`, and `final` is the game-over state; it throws if an actor has no legal move or a move cap is exceeded. Sweep tests iterate `game.states`; per-move checks use `game.moves`. Policies `firstMove` and `lastMove` pick the first or last legal move.

### 10.8 Gotchas and limitations

- **`firstMove` always bids 0**, so in first-move games the dealer's forbidden bid is `cardsPerPlayer` and every bid is 0 (the golden fixture's bids are all zero). Use `lastMove` when a test needs varied bids or a live dealer restriction.
- **Hand-built positions are not valid games.** `withHand` states use `makeHand` defaults (4 cards, dealer 0) that need not match `handPlan` or the dealt cards: fine for `legalMoves`, but they fail `checkInvariants`.
- **`helpers.ts` imports the engine**, so a broken `engine.ts` breaks every engine test file, not just the engine's own.
- **`hand === null` means game over everywhere.** `currentActor` returns `null`, `applyMove` throws `'game-over'` and `tableViewFor` returns the game-over shape for a `null` hand even if `phase` says otherwise (and the game-over view's `dealer` falls back to 0 if `completedHands` is empty). Such malformed states are reported by `checkInvariants` (`(g)`, `(i)`), not by these functions.
- **The seat-range check exists twice.** `view.ts` has a private copy of `engine.ts`'s private `assertSeatInRange` (same condition, same message), because exporting it would widen the engine's public API. Keep the two in sync, or export one and remove the other.
- **`legalPlays` returns the hand's own card objects** (a new array, but not copied cards); never mutate them. `legalMoves` copies them into its moves.
- **`legalPlays` and `trickWinner` assume the cards belong to `deck`**: `compareRanks` throws `InvalidCardError` otherwise. `trickWinner([])` throws `RangeError` (a trick has at least one play; the engine only calls it with a full trick).
- **`rngFromSource` reads each draw as `next() >>> 0`**, the identity for valid uint32 values, so a stub that returns `-1` is read as `2^32 − 1` instead of producing out-of-range results. Stubs should still return uint32 values.
- **`rng.int(0, 2 ** 32 − 1)` returns raw generator outputs** (nothing is rejected at that range); use it to compare streams in tests. `int` accepts any integer bounds, including unsafe integers beyond 2^53 where results are imprecise; the engine only uses small ranges.
- **`checkInvariants` does not bound `cardsPerPlayer` by the deck.** A state with an oversized `cardsPerPlayer` that still passes `(c)` and `(h)` reports nothing (and `(f)` is skipped for it). It also does not check the `trumpCard` itself in `(a)`/`(b)`; when the trump is in the dealer's hand it is checked as one of the dealer's cards.
- **Not in the engine:** scoring and `live` hand status (Score Engine, §11); `PlayerView`, players, strategies, the AI loop and the simulator (§12); seed generation and setting `version` (GameService and the Game State Manager; see [`implementation.md`](./implementation.md) for when they arrive). Bid changes, revokes, target-score endings, tie-break hands and special hands are out of scope by design ([`design.md`](./design.md) §1.2, §4.2).

---

## 11. Score

`src/score` is the Score Engine: pure functions that turn one seat's bid and tricks into points under the game's `ScoringSpec`, score a completed hand, and turn a whole `GameState` into a `ScoreBoard` — the per-hand score sheet (*planilla*), totals, made/missed counts, the live status of every seat in the hand in progress, and the ranking. The rules it implements are in [`design.md`](./design.md) §6; this section is about using and changing the code.

The score is **derived, never stored**. `evaluate(state)` reads only its argument, so the same state always gives a deep-equal board and the score can never drift from the game. Nothing in the engine's state, events or views holds a point or a total.

The Score Engine is **pure** like the domain and the engine: it imports only `@/src/domain/*` and its own files (the layer rule, §3, forbids `src/engine`), and never uses randomness, the clock or I/O. Check it with:

```sh
grep -rnE 'Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\.|src/engine|\.\./engine' src/score   # must find nothing
```

As in the engine, the grep also matches comments, so keep those words out of `src/score` comments.

### 11.1 Module map

Import from each module directly (`import { evaluate } from '@/src/score/score-engine'`); there is no barrel `index.ts`. `score-engine.ts` imports `handPoints` relatively (`./formulas`). Domain types (`ScoringSpec`, `RuleSet`, `HandResult`, `HandScore`, `ScoreBoard`, `GameState`) come from `@/src/domain/rules` and `@/src/domain/types`.

| Module | Exports | What it does |
|---|---|---|
| `@/src/score/formulas` | `handPoints(scoring, bid, tricks)` | Points for one seat in one hand under a `ScoringSpec`. |
| `@/src/score/score-engine` | `scoreHand(rules, result)` | One `HandScore` row: per seat `{ seat, bid, tricks, made, points }`, in seat order. |
| | `evaluate(state)` | The full `ScoreBoard` of a game state. This is what callers normally use. |
| | `rankSeats(totals, missedCount, tieBreak)` | `{ seat, total, place }[]` with competition places, listed by place then seat. |
| | `liveStatus(bid, tricksWon, tricksLeft)`, type `LiveStatus` | `'on-track' \| 'made-so-far' \| 'busted'` for one seat in the hand in progress. |

`scoreHand`, `rankSeats` and `liveStatus` are the building blocks of `evaluate`, exported so they can be tested and reused on their own.

### 11.2 Using the score engine

Score a game after every move and read the final result:

```ts
import { getPreset } from '@/src/domain/presets';
import type { SeatInfo } from '@/src/domain/types';
import { applyMove, createGame, currentActor, legalMoves } from '@/src/engine/engine';
import { handPoints } from '@/src/score/formulas';
import { evaluate, liveStatus, rankSeats, scoreHand } from '@/src/score/score-engine';

const seats: SeatInfo[] = [
  { seat: 0, playerId: 'p0', name: 'Ana', kind: 'human' },
  { seat: 1, playerId: 'p1', name: 'Bot 1', kind: 'ai', strategy: 'random' },
  { seat: 2, playerId: 'p2', name: 'Bot 2', kind: 'ai', strategy: 'random' },
];
const rules = getPreset('argentina-fidepo');
let state = createGame({ gameId: 'game-1', rules, seats, seed: 'secret-seed' }).state;

const opening = evaluate(state); // hand 0 dealt, nobody has bid
// opening.hands is [], opening.totals is [0, 0, 0], every opening.ranking place is 1,
// and opening.live is [{ seat: 0, bid: null, tricksWon: 0, status: 'on-track' }, …].

for (let seat = currentActor(state); seat !== null; seat = currentActor(state)) {
  const moves = legalMoves(state, seat);
  state = applyMove(state, seat, moves[moves.length - 1].id).state;
  const board = evaluate(state); // recomputed from the state after every move, never stored in it
  const busted = board.live?.filter((row) => row.status === 'busted').map((row) => row.seat);
  // busted: seats that can no longer make their bid in this hand (undefined at game over)
}

const final = evaluate(state); // state.phase === 'game-over'
// final.hands: the score sheet, one { handIndex, perSeat: [{ seat, bid, tricks, made, points }] }
//   per entry of state.handPlan; final.totals / madeCount / missedCount: one number per seat.
// 'live' in final === false.
const winners = final.ranking.filter((r) => r.place === 1).map((r) => r.seat); // shared on a tie

// The building blocks work on plain numbers:
handPoints(getPreset('spain-ludoteka').scoring, 5, 4); // -5 (bid 5, won 4)
scoreHand(rules, state.completedHands[0]).perSeat[0].points; // seat 0's points in hand 0
liveStatus(3, 1, 1); // 'busted': 1 trick won, 1 left, bid 3
rankSeats([30, 25, 30], [2, 1, 1], 'fewest-misses');
// [{ seat: 2, total: 30, place: 1 }, { seat: 0, total: 30, place: 2 }, { seat: 1, total: 25, place: 3 }]
```

### 11.3 The rules in code

The full rules, with the per-preset table, are in [`design.md`](./design.md) §6.1–6.2. In short:

- **`handPoints(scoring, b, t)`.** Made iff `t === b`. `bonus-plus-tricks`: made `bonus + perTrick·t`, missed `missedPerTrick·t`. `bonus-plus-bid`: made `bonus + b`, missed `0`. `spanish`: made `bonus + perTrick·t`, missed `−missPenaltyPerTrick·|t − b|`. Every number is read from the `ScoringSpec` object, never from a constant, and the `switch` on `scoring.kind` ends in a `never` check, so a new scoring kind is a compile error until it is handled.
- **`scoreHand(rules, result)`** returns `{ handIndex, perSeat }` with `made = tricks === bid` and `points = handPoints(rules.scoring, bid, tricks)` per seat.
- **`evaluate(state)`**: `hands` = `scoreHand` of every `completedHands` entry in order; `totals`, `madeCount`, `missedCount` summed from those rows (zeros when there are none); `ranking = rankSeats(totals, missedCount, rules.tieBreak)`; and, only when `state.hand !== null`, `live[s] = { seat, bid, tricksWon, status: liveStatus(bid, tricksWon, cardsPerPlayer − sum(tricksWon)) }`.
- **`liveStatus(bid, tricksWon, tricksLeft)`**, first match wins: `null` bid → `on-track`; `tricksWon > bid` → `busted`; `tricksWon + tricksLeft < bid` → `busted`; `tricksWon === bid` → `made-so-far`; otherwise `on-track`.
- **`rankSeats(totals, missedCount, tieBreak)`**: seat `r` is ahead of seat `s` when its total is higher, or, under `'fewest-misses'`, the totals are equal and `r` has fewer misses. `place = 1 + (number of seats ahead)`, so ties share a place and the next one skips (`1, 1, 3`). Entries are sorted by `place`, then `seat`; the seat number never decides a place. It is O(N²), which is nothing for at most 7 seats. Mid-game and at game over it is the same rule.

### 11.4 How the score relates to the engine

- **The engine hands over raw facts.** Each finished hand becomes a `HandResult` in `GameState.completedHands` (`bids`, `tricks`, `cardsPerPlayer`, `handIndex`, `dealer`, `trumpSuit`); the hand in progress is `state.hand` (bids may still be `null`, `tricksWon` so far). `evaluate` needs nothing else.
- **Neither imports the other.** `src/score` never imports `src/engine` and the engine never imports `src/score` (both purity greps check it). Only `src/service`, the simulator and tests use both.
- **`PlayerView` is composed outside both.** The engine's `tableViewFor` has no scores; `buildPlayerView` in `src/service/player-view.ts` (§12) builds `{ ...tableViewFor(state, seat), scoreboard: evaluate(state) }`, plus `finalRanking = scoreboard.ranking` at game over ([`design.md`](./design.md) §5.5). It is the only caller of `evaluate` in `src` outside `src/score`. The same view goes to AI decisions, so `evaluate` runs on every request and every AI move.
- **No defensive copy.** `evaluate` and `scoreHand` never mutate their input and build every returned array and object fresh (they do not `structuredClone` the state; nothing in the output is taken from it by reference). A caller may mutate a board freely.
- **Engine states never throw.** A state produced by `createGame` / `applyMove` always satisfies the checks below; they exist for hand-built or corrupted states.

### 11.5 Errors

Every error is a `RangeError` and only the first failed check is reported. Messages start with a fixed prefix, so callers and tests can match on it:

| Thrown by | Message shape | Example |
|---|---|---|
| `handPoints`, `liveStatus` | `<function>: <argument> must be a non-negative integer, got <value>` | `handPoints: bid must be a non-negative integer, got -1` |
| `rankSeats` | `rankSeats: totals and missedCount must have equal length, got <a> and <b>` | `… got 1 and 2` |
| `scoreHand` | `scoreHand: handIndex <n>: <check>` | `scoreHand: handIndex 7: tricks[2] must be a non-negative integer, got -1` |
| `evaluate`, completed hand `k` | `state.completedHands[<k>]: <check>` | `state.completedHands[1]: scoreHand: handIndex 1: sum(tricks) must equal cardsPerPlayer 16, got 15` |
| `evaluate`, current hand | `state.hand: <check>` | `state.hand: tricksWon[1] must be a non-negative integer, got -1` |

Check order:

- `scoreHand`: `bids` and `tricks` have equal length → not empty → `cardsPerPlayer` is an integer ≥ 1 → every bid is an integer in `0 … cardsPerPlayer` (a `null` bid fails here) → every trick count is a non-negative integer → `sum(tricks) === cardsPerPlayer`.
- `evaluate`: completed hands first, in index order; for each, `bids` and `tricks` have one entry per seat, then `scoreHand` runs and any `RangeError` it throws is rethrown with the `state.completedHands[k]: ` prefix added in front of the original message (other errors pass through unchanged). Then the current hand: `cardsPerPlayer` is an integer ≥ 1 → `bids` and `tricksWon` have one entry per seat → every `tricksWon` is a non-negative integer → `sum(tricksWon) ≤ cardsPerPlayer` → every non-null bid is an integer in `0 … cardsPerPlayer`. So a state broken in both places reports the completed hand.
- `liveStatus` validates its arguments before looking at the bid, so `liveStatus(null, -1, 0)` throws.

Assert on the full prefix (`state.hand: `, `state.completedHands[0]: `, `scoreHand: handIndex 7: `), never on a bare word such as `hand`, which also appears inside `handIndex`.

### 11.6 Score tests

Score tests live in `tests/unit/score/<topic>.test.ts`; each file names the requirements it checks in its header comment.

| File | Protects |
|---|---|
| `formulas.test.ts` | Every worked example of [`game_rules.md`](./game_rules.md) §3.7 for each preset; custom `ScoringSpec` values change the result (the fields are read); no result is ever `-0`; bad arguments throw. |
| `live-status.test.ts` | Every row of the live-status table and its argument checks. |
| `ranking.test.ts` | Competition places (`1, 1, 3, 4`), the misses tie-break, `'shared'`, an all-zero board and the length check, as full deep-equal arrays. |
| `score-hand.test.ts` | One exact `HandScore`, one row per malformed-input check, and that the input is not mutated. |
| `evaluate.test.ts` | Hand-built boards (score sheet, totals, counts, ranking tie on misses, the empty board), `live` in bidding, playing and game over, and every `evaluate` error prefix. |
| `full-game.test.ts` | Engine-played games: for every state, `evaluate` does not mutate it, repeats exactly and shares nothing with it; for each preset, `evaluate` after every move never throws, `live` is present exactly while a hand is in progress, and totals and counts agree with the score sheet. |
| `perf.test.ts` | `evaluate` on the final state of an `argentina-fidepo` 3-player game (29 hands): median of 101 calls after 10 warm-up calls must be < 1 ms (it takes about 15 µs locally). The bound is a safety ceiling against an accidentally super-linear `evaluate`, not a target. Run it with `--silent=false` to see the median. |

Score-only builders live in `tests/unit/score/helpers.ts` (not collected): `makeState({ players, completedHands, handIndex, hand, phase })` builds a schema-valid `argentina-fidepo` state (3 seats by default) whose current hand is a fresh bidding hand you can partially override, or `hand: null` for game over; `result(handIndex, cardsPerPlayer, bids, tricks)` builds a `HandResult`; `argentinaPlan(players)` gives the hand plan for 3–6 players. Engine-played states come from the engine helpers (`newGame`, `playGame`, `firstMove`, `lastMove`, §10.7), imported as `../engine/helpers`.

### 11.7 Gotchas and limitations

- **Never produce `-0`.** The spanish miss is written `0 - missPenaltyPerTrick * |t − b|`, not with unary minus, which would give `-0` for a zero penalty (and `-0` fails `Object.is` equality and can print as `-0`). Write any future negative formula the same way.
- **No `live` key at game over.** `evaluate` builds the board without `live` and adds it only when `state.hand !== null`, so `'live' in board` is `false` at game over. Do not "simplify" this to `live: hand ? … : undefined`; consumers and tests check for the key.
- **Custom `ScoringSpec`s need a double cast.** `ScoringSpecSchema` uses literal numbers (`bonus: 10`, `perTrick: 5`, …), so a spec with other numbers in a test must be written `{ ...spec, perTrick: 3 } as unknown as ScoringSpec`; a plain `as ScoringSpec` fails `pnpm typecheck`. Likewise a `null` bid in a `HandResult` needs `null as unknown as number`.
- **`makeState` states are shape-valid, not real games.** Their hands hold no cards (the schema accepts empty hands and scoring never reads cards), so they fail `checkInvariants`; never feed them to engine functions that read cards.
- **What `evaluate` does not check.** It does not cross-check the state beyond the checks in §11.5: not that `completedHands[k].handIndex === k`, not `handIndex` against `handPlan`, not `phase` against `hand`. `handPoints` trusts the `ScoringSpec` numbers and `rankSeats` checks only the lengths of its arrays, not that the values are integers. Engine states satisfy all of these by the engine's invariants (§10.4); callers hold schema-valid rule sets.
- **`LiveStatus` is defined twice.** `ScoreBoard.live[].status` in `src/domain/types.ts` is an inline union equal to `LiveStatus`, because the domain may not import the score layer. Change both together.
- **Not in the score engine:** composing `PlayerView` and `finalRanking` (`buildPlayerView`, §12), persisting the scoreboard with each commit and writing `final.json` (Game State Manager), and target-score endings, tie-break hands, "Pocha" bonuses and suit multipliers ([`design.md`](./design.md) §4.2 and its open questions).

---

## 12. Players, views and simulation

Three pieces sit on top of the engine and the score engine:

- **`src/players`** decides moves: the `Player` and `AIStrategy` shapes, their factories, the first AI (`randomStrategy`) and the strategy registry.
- **Two service helpers** turn a game state into what a seat sees and play the AI turns: `buildPlayerView` (`src/service/player-view.ts`) and `runAiLoop` (`src/service/ai-loop.ts`). They are what `GameService` will call; the simulator and the tests call them today.
- **Simulation** proves that the whole core holds together over thousands of games: the `pnpm simulate` command-line simulator (`scripts/simulate.ts`) and the `pnpm test:sim` suite (`tests/sim/`).

The model and the loop's contract are in [`design.md`](./design.md) §8; this section is about using, extending and testing the code.

**Purity.** `src/players` is part of the core (§3): it imports only `@/src/domain/*` and its own files, and never sees a `GameState` (strategies get a `DecisionContext` only). No classes are used there except `Error` subclasses. The two service helpers are pure too: they import only `src/domain`, `src/engine`, `src/score`, `src/players` and each other (`ai-loop.ts` imports `./player-view`), with no storage, state, configuration, clock, I/O or ambient randomness. The layer rule would let `src/service` import `state`, `storage` and `src/config.ts`, so for these two files the rule is kept by this grep, not by the linter:

```sh
grep -rnE 'src/(storage|state)|@/src/config|Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\.' src/service/player-view.ts src/service/ai-loop.ts src/players   # must find nothing
grep -rnE 'src/(engine|score|service)|GameState' src/players                                  # must find nothing
grep -rn 'class ' src/players | grep -v 'extends Error'                                         # must find nothing
grep -rln 'evaluate(' src | grep -v '^src/score/'                                               # only src/service/player-view.ts
```

As in the engine, the greps also match comments, so keep those words out of comments in these files.

### 12.1 Module map

Import from each module directly (`import { runAiLoop } from '@/src/service/ai-loop'`); there is no barrel `index.ts`.

| Module | Exports | What it does |
|---|---|---|
| `@/src/players/player` | types `Player`, `AIStrategy` | The two shapes ([`design.md`](./design.md) §8.1). Types only. |
| `@/src/players/human-player` | `createHumanPlayer(seat, name)` | A player whose `requestDecision` always answers `{ type: 'await' }`. |
| `@/src/players/ai-player` | `createAiPlayer(seat, name, strategy)` | A player that answers `{ type: 'move', moveId: strategy.choose(view, legalMoves, rng).id }`. |
| `@/src/players/strategies/random` | `randomStrategy` | Name `'random'`; one draw `rng.int(0, moves.length − 1)` over all legal moves. Never reads the view. |
| `@/src/players/registry` | `STRATEGY_NAMES`, `UnknownStrategyError`, `getStrategy(name)`, `createPlayers(seats)` | Strategy lookup by name (`undefined` or `''` → `randomStrategy`, unknown → `UnknownStrategyError`, message `Unknown AI strategy "<name>" (known: random)`), and one `Player` per seat of a game. |
| `@/src/service/player-view` | `buildPlayerView(state, seat \| 'spectator')` | The only builder of a `PlayerView`: table view + `scoreboard`, plus `finalRanking` only at game over. |
| `@/src/service/ai-loop` | `runAiLoop(state, players, options?)`, `AiLoopLimitError`, types `AiLoopOptions`, `AiLoopResult` | Plays turns until a human must act or the game ends. |
| `scripts/simulate.ts` | – (a script) | `pnpm simulate`: plays a batch of all-AI games and prints a summary (§12.4). |
| `tests/sim/harness.ts`, `tests/sim/ledger.ts` | Simulation helpers and the card-conservation ledger | Used by the `pnpm test:sim` suite (§12.5, §12.6). Never imported from `src` or `scripts`. |

### 12.2 Running the AI loop

A game with one human and two AIs, played the way `GameService` plays it: run the loop at creation (the first bidders may be AIs), then after every human move.

```ts
import { getPreset } from '@/src/domain/presets';
import type { SeatInfo } from '@/src/domain/types';
import { applyMove, createGame, legalMoves } from '@/src/engine/engine';
import { createPlayers } from '@/src/players/registry';
import { runAiLoop } from '@/src/service/ai-loop';
import { buildPlayerView } from '@/src/service/player-view';

const seats: SeatInfo[] = [
  { seat: 0, playerId: 'p0', name: 'Ana', kind: 'human' },
  { seat: 1, playerId: 'p1', name: 'Bot 1', kind: 'ai', strategy: 'random' },
  { seat: 2, playerId: 'p2', name: 'Bot 2', kind: 'ai' }, // no strategy: plays 'random'
];
const players = createPlayers(seats); // one Player per seat; UnknownStrategyError for an unknown name

const start = createGame({
  gameId: 'game-1',
  rules: getPreset('argentina-fidepo'),
  seats,
  seed: 'secret-seed',
});

// The AIs act until seat 0 must act (or the game is over).
let state = runAiLoop(start.state, players).state;

while (state.phase !== 'game-over') {
  // What the human receives: its view and its legal moves.
  const update = { view: buildPlayerView(state, 0), legalMoves: legalMoves(state, 0) };
  const moveId = update.legalMoves[0].id; // in the app: the moveId the human sent
  state = applyMove(state, 0, moveId).state;
  state = runAiLoop(state, players).state; // the AIs answer
}

const final = buildPlayerView(state, 0);
// final.finalRanking deep-equals final.scoreboard.ranking; before game over the key is absent.
```

Observing every AI move and handling the safety cap:

```ts
import type { GameEvent } from '@/src/domain/types';
import { checkInvariants } from '@/src/engine/invariants';
import { AiLoopLimitError } from '@/src/service/ai-loop';

const events: GameEvent[] = [...start.events]; // runAiLoop's events exclude createGame's own
try {
  const result = runAiLoop(start.state, players, {
    maxMoves: 1000, // the default
    onTransition: (prev, transition) => {
      // Called after each move, before the next decision. Throwing here stops the loop;
      // the move it was called for is already applied.
      if (checkInvariants(transition.state).length > 0) throw new Error('broken state');
    },
  });
  events.push(...result.events); // every applied move's events, in engine order
} catch (error) {
  if (error instanceof AiLoopLimitError) {
    // error.moves moves were applied and an AI is still to act; error.state is where it stopped.
    throw new Error(`AI loop stuck after ${error.moves} moves`, { cause: error });
  }
  throw error; // RangeError (players do not match the seats), IllegalMoveError, …
}
```

`runAiLoop` checks the players against the state before doing anything: the same number as the seats, `players[i].seat === i` and the same `kind` as `state.seats[i]`, else `RangeError` (`players length 3 does not match the game's 4 seats`, `seat 2: …`). Build the players with `createPlayers(state.seats)` and this always holds.

**Who supplies what.** The seed comes from the caller (in the app, `GameService` generates it on the server); the loop adds no randomness of its own: every AI draw comes from `aiRng(state, seat)`, so the same state and players always give the same moves, and replaying the move events reproduces the game without any player (§12.6).

### 12.3 Adding a strategy

1. **Write it** in `src/players/strategies/<name>.ts` as a plain object:

   ```ts
   import type { AIStrategy } from '../player';

   export const cautiousStrategy: AIStrategy = {
     name: 'cautious',
     choose: (view, moves, rng) => { /* return one of `moves` */ },
   };
   ```

   - Return **one of the `moves` objects**, never a move you build yourself; the AI player sends its `id` to `applyMove`, and an id that is not legal throws `IllegalMoveError`.
   - Use **only `rng`** for randomness and only `view` and `moves` for information. The view is what a human in that seat would see; there is no way, and no need, to read the state. `Math.random` and the clock are forbidden by the purity grep, and they would break replay.
   - `moves` is never empty when the loop asks; the view's `scoreboard` has totals and `live` status for the hand in progress.
2. **Register it**: add `[cautiousStrategy.name, cautiousStrategy]` to the `STRATEGIES` map in `registry.ts`. `STRATEGY_NAMES` is built from the map, so it follows. A seat then picks it with `strategy: 'cautious'` in its `SeatInfo`.
3. **Test it** in `tests/unit/players/<name>.test.ts`, and update the `STRATEGY_NAMES` expectation in `registry.test.ts` (it deep-equals the list).

Changing or adding a strategy never changes a deal (the deal streams do not depend on AI choices), so strategies can be compared on the same seeds. The simulator and the simulation suite play `random` on every seat; the random AI's made-bid rate (about 11 % for `argentina-fidepo` with 3 players, §12.4) is the baseline a new strategy should beat.

### 12.4 The simulator: `pnpm simulate`

```sh
pnpm simulate [--preset <id>] [--players <n>] [--games <n>] [--seed <prefix>]
```

| Flag | Default | Accepted values |
|---|---|---|
| `--preset` | `argentina-fidepo` | a preset id (`argentina-fidepo`, `spain-ludoteka`, `gamerules`, `mexico-bazas`) |
| `--players` | the preset's minimum player count | a decimal integer within the preset's player range |
| `--games` | `100` | a positive decimal integer |
| `--seed` | `sim` | any non-empty string; game `i` uses seed `<prefix>-<i>` |

Every seat is an AI playing `random` (seat `i` is `{ seat: i, playerId: 'ai-<i>', name: 'AI <i>', kind: 'ai' }`, `gameId: 'sim'`). Each game is created with `createGame`, played to the end with one `runAiLoop` call and scored with `evaluate`. After the last game it prints four lines to stdout and exits 0:

```sh
$ pnpm --silent simulate --preset gamerules --players 4 --games 5 --seed t
preset: gamerules  players: 4  games: 5  hands/game: 19
average total per seat: 0: 29.0  1: 33.8  2: 40.2  3: 28.2
made-bid rate: 15.5%
duration: 0.2 s
```

- `hands/game` is the number of hands in the game's hand plan.
- `average total per seat` is each seat's final total averaged over the games.
- `made-bid rate` is Σ `madeCount` / (Σ hands × players) × 100, summed over every game and seat (not an average of per-game rates).
- `duration` is the wall-clock time of the games only (not start-up or argument parsing), in seconds.
- Every number has one decimal (never `-0.0`). The same flags always print the same lines except `duration`, so two runs can be diffed.

The default run (`argentina-fidepo`, 3 players, 100 games) takes about 6 seconds locally and prints a made-bid rate of about 11 %.

**Errors.** Arguments are parsed with Node's `util.parseArgs` in strict mode, so an unknown flag, a flag without a value and any positional argument are rejected. Then the values are checked in the order preset → players → games → seed, and the first problem is reported. `--players` and `--games` must be written as plain decimal digits (`2.5`, `abc`, `0`, `+3` and `1e2` are rejected). A repeated flag keeps its last value. Any problem prints exactly one line to stderr, nothing to stdout, plays nothing and exits 1:

```
simulate: unknown preset "nope" (known: argentina-fidepo, spain-ludoteka, gamerules, mexico-bazas)
simulate: --players must be an integer from 3 to 6 for argentina-fidepo, got "9"
simulate: --games must be a positive integer, got "2.5"
simulate: --seed must not be empty
simulate: Unknown option '--bogus'
simulate: Option '--games <value>' argument missing
```

A game that throws (for example `AiLoopLimitError`) or stops before game over prints `simulate: game <prefix>-<i> failed: <message>` to stderr, nothing to stdout, and exits 1.

**Clean output.** `pnpm simulate …` also prints pnpm's own lines (the `> la-podrida-game@0.0.0 simulate …` banner, an "Unsupported engine" warning on other Node versions and, on failure, `ELIFECYCLE …`) to stdout; the script itself writes nothing there on error. Use `pnpm --silent simulate …` (or `pnpm exec tsx scripts/simulate.ts …`) when you pipe, diff or check the output.

**Replaying a simulation-test seed.** The suite's seeds are `sim-<presetId>-<players>-<i>` with the same seats and `gameId`, so `pnpm simulate --preset gamerules --players 4 --seed sim-gamerules-4 --games 18` plays exactly the games of tests `gamerules 4p seed 0` to `17`.

### 12.5 Simulation tests: `pnpm test:sim`

`pnpm test:sim` runs `vitest.sim.config.ts`, which collects only `tests/sim/**/*.test.ts`. For every preset and every valid player count (18 combinations: `argentina-fidepo` and `spain-ludoteka` with 3–6 players, `gamerules` and `mexico-bazas` with 3–7) it plays `S` seeded all-AI games through `runAiLoop`, with seeds `sim-<presetId>-<players>-<i>` for `i = 0 … S − 1`, and every game must reach `game-over`.

**`SIM_SEEDS`** sets `S`:

| `SIM_SEEDS` | Seeds per combination |
|---|---|
| unset or empty | 200 (the default, and what CI runs) |
| a positive integer in decimal digits, e.g. `3`, `2000` | that number |
| anything else, e.g. `2k`, `0`, `1e3` | every sim file fails at load with `SIM_SEEDS must be a positive integer in decimal digits, got "<value>"`, and the run exits 1 |

The value is validated when `tests/sim/harness.ts` is loaded, which every sim file does, so a typo can never silently run 200 seeds (vitest prints the load error once per file).

```sh
pnpm test:sim                                   # 18 × 200 games + the ledger tests: 3,605 tests, about 46 s locally
SIM_SEEDS=3 pnpm test:sim                       # quick smoke run: 59 tests, about 2 s
SIM_SEEDS=2000 pnpm test:sim                    # the long run, before a release or after an engine change
SIM_SEEDS=3 pnpm exec vitest run --config vitest.sim.config.ts --reporter verbose tests/sim/mexico-bazas.sim.test.ts
pnpm exec vitest run --config vitest.sim.config.ts tests/sim/gamerules.sim.test.ts -t "^gamerules 4p seed 17$"
```

The last command reruns one failing game; `-t` is a regular expression, so anchor it (`seed 17` alone also matches seeds 170–179).

**Layout and naming.**

| File | Contents |
|---|---|
| `tests/sim/<presetId>.sim.test.ts` (one per preset) | One line: `defineSimTests('<presetId>')`. One file per preset so vitest runs presets in parallel workers. |
| `tests/sim/harness.ts` | `SIM_SEEDS`, the seed and seat recipes (`simSeed`, `simSeats`, `simInput`), `playSimGame`, the scoreboard check, `replay`, `checkDeterminismAndReplay`, `defineSimTests`. |
| `tests/sim/ledger.ts` | The card-conservation ledger (`createLedger`, `LedgerError`); no vitest import. |
| `tests/sim/ledger.sim.test.ts` | Shows that the ledger fails loudly: a recorded game is accepted unchanged, and a `card-played` changed to another seat's card or to a card never dealt, or a deal with a duplicated card, is rejected with an error naming the hand. |

There is one test per player count and seed, named exactly `<presetId> <players>p seed <i>` (no `describe` wrapper), so the failing seed is always in the name. Each test is one game with its checks, well inside vitest's default 5-second timeout.

**What each test checks.** After every move, from `runAiLoop`'s `onTransition`:

- `checkInvariants(state)` returns `[]` (§10.4);
- `evaluate(state)` does not throw, every seat's total equals the sum of its points, its made and missed counts add up to the hands scored, and the board has a `live` key exactly while a hand is in progress (§11);
- the card-conservation ledger holds (§12.6).

A failure throws out of the loop with the move number: `move 312: invariants: …`, `move 312: scoreboard: …` or `move 312: ledger: hand 9: …`. At the end the game must be at `game-over` and its last event must be `game-over`. For the first `min(S, 10)` seeds of each combination the same test also checks **determinism** (a second run of the same seed gives a deep-equal event log, `createGame`'s events included) and **replay** (§12.6).

**CI and time budget.** CI runs `pnpm test:sim` with the default 200 seeds as the step "Simulation tests", right after "Test" (§7). The budget for that step is **10 minutes**. A local default run takes about 46 seconds (the `argentina-fidepo` file dominates: its 3-player games have 981 moves). If a change makes the local default run take more than about 5 minutes, the CI budget is at risk: make the checks cheaper before pushing. The `SIM_SEEDS=2000` run is local only; there is no nightly workflow.

### 12.6 How the ledger and replay checks work

**The card-conservation ledger** (`tests/sim/ledger.ts`) checks what no single state can show: that every card dealt in a hand is accounted for until the hand ends. It is fed the `createGame` state, then every transition in order:

- **Opening a hand.** Hand 0 is opened from the `createGame` state; each later hand from the state of the transition whose events contain `hand-dealt`. The *dealt set* is every seat's hand right after the deal. It must hold `N × cardsPerPlayer` distinct cards, all from `buildDeck(rules.deck, N)`; the trump card must be in the deck, and in the dealt set exactly when `trumpCardInDealerHand` is true. The ledger also records which seat each card was dealt to.
- **Events, in order.** `card-played`: the card was dealt in this hand, **to the seat that plays it**, and has not been played yet. `hand-completed`: it names the open hand and every dealt card was played exactly once; the hand is closed. `hand-dealt`: no hand is open; the next hand is opened from `transition.state`. `game-over`: no hand is open; nothing is checked after it.
- **After each transition** that has a hand and no `hand-dealt` event: (cards still in hands) ∪ (cards played in the open hand) equals the dealt set, with no card counted twice.

The move that ends a hand produces `hand-completed` and then `hand-dealt` in the same transition, so the ledger closes the old hand and opens the new one in that order, and skips the after-transition check (the new deal was just checked when it was opened). Failures throw `LedgerError` with a message starting `ledger: hand <k>: `, e.g. `ledger: hand 2: card 7H played by seat 1 was dealt to seat 3`.

**Replay** (`replay` in `tests/sim/harness.ts`) rebuilds a game from its events alone, the way a stored game is rebuilt ([`design.md`](./design.md) §7): `createGame` with the same input, then `applyMove(state, event.seat, moveId)` for every `bid-made` (`bid:<tricks>`) and `card-played` (`play:<cardId>`) event in order, with no player or strategy. The test compares the initial state and, after every replayed move, the full state (including `aiDecisionCount`, which `applyMove` increments for AI seats) and `evaluate(state)` with those of the original run.

**Fast deep equality.** Replay compares about a thousand states per game, so the harness compares with `node:util`'s `isDeepStrictEqual` and calls `expect(…).toEqual(…)` only on a mismatch, to get vitest's diff (`expectDeepEqual(actual, expected, label)`; the label names the step, e.g. `replayed state after move 57`). Per-move checks throw a plain `Error` instead of calling `expect`. Keep it that way: an `expect(…).toEqual(…)` per step is slow at this volume.

### 12.7 Players and service tests

Unit tests live in `tests/unit/players/` and `tests/unit/service/` and run with `pnpm test`.

| File | Protects |
|---|---|
| `players/players.test.ts` | Both factories: shapes, `await` for humans, the AI passes exactly its context to the strategy and answers with the chosen move's id; players are plain objects. |
| `players/random.test.ts` | `randomStrategy` returns `moves[rng.int(0, n − 1)]` over 20 seeds, is uniform over 6,000 draws from one stream, and works with a view whose every property access throws. |
| `players/registry.test.ts` | `getStrategy` defaults and errors (including inherited names such as `'constructor'`), `STRATEGY_NAMES`, `createPlayers` kinds, seats and names. |
| `service/player-view.test.ts` | The view equals the table view plus the scoreboard, `finalRanking` only at game over, spectators, and a leak sweep over every state of a 4-player game for every viewer (no other seat's card except the trump card, no seed, rules or `aiDecisionCount`). |
| `service/ai-loop.test.ts` | Stops for the human and resumes, `onTransition` order and errors, the player checks, the cap, illegal moves, and every preset at its minimum and maximum player count played to game over in one call (`argentina-fidepo` with 3 players in exactly 981 moves). |

Test helpers: a stub view needs `{ … } as unknown as PlayerView`; wrap a stub strategy with `createAiPlayer` and count its `choose` calls to prove the loop asked (or did not ask) it. All-AI games use the same seat recipe as the simulator (§12.4). The engine helpers (`newGame`, `makeSeats`, `playGame`, §10.7) can be imported as `../engine/helpers`.

### 12.8 Gotchas and limitations

- **`result.events` holds only the moves the loop applied**, not `createGame`'s `game-started` and first `hand-dealt`. A full event log is `[...start.events, ...result.events]`.
- **`prev` in `onTransition` is the loop's own state object** (for the first move, the state you passed in), not a copy. The engine never mutates states, so keeping it is safe.
- **The cap is checked before each decision, and only for AI seats.** A human to act at the cap is still asked (and answers `await`), and a game that ends on exactly the `maxMoves`-th move returns normally. `AiLoopLimitError.state` is the state after `maxMoves` moves, with an AI to act. `maxMoves` itself is not validated; pass the default or a positive integer.
- **`createPlayers` does not validate.** It maps `seats` in array order and trusts their seat numbers; `runAiLoop` reports a mismatch with `RangeError`. A game's `state.seats` is always in seat order.
- **`randomStrategy` with no moves** throws the RNG's `RangeError`. The loop never asks a player with no legal moves (invariant `(f)`, §10.4).
- **`scripts/` never imports `tests/`.** The simulator re-creates the all-AI seat recipe instead of importing `simSeats`; keep the two identical, or simulator runs stop matching test seeds (§12.4).
- **The simulator has no `--help` and no `--strategy`**, so every seat plays `random`. Its failing-game path (`game <seed> failed`) has no automated test.
- **Memory.** A simulated game keeps every intermediate state for replay (about a thousand for `argentina-fidepo` with 3 players). Fine at today's sizes; stream the comparison if games grow much longer.
- **In `tests/sim/ledger.ts`, failure helpers are function declarations returning `never`**, so TypeScript narrows after them; an arrow function assigned to a `const` does not narrow. Inside callbacks, copy a narrowed `let` into a `const` first.
- **Not here yet:** seed generation, seat tokens, persistence, `PlayerUpdate` assembly and versions are `GameService`'s and the storage layers' job (later phases); only the `random` strategy exists.

---

## 13. Storage

`src/storage` is where game data will live: an `ObjectStore` that keeps **bytes under string keys**, with three drivers (in-memory, filesystem and Vercel Blob) that behave the same, a factory that picks one from the configuration, and two helpers that read and write JSON validated with Zod. Its callers are the Game State Manager and the retention job (both still to come); nothing calls it yet. The design, the guarantees and the reasons behind them are in [`architecture.md`](./architecture.md) §6.1; this section is about using, configuring and testing the code.

**Storage is generic.** It knows nothing about games: key names and document schemas belong to the state layer. Inside `src` it imports only `src/config.ts` (always written `@/src/config`); files in `src/storage` import each other with `./…`. Three greps keep the layer honest (they also match comments, so keep those words out of comments in `src/storage`):

```sh
grep -rnE "from '(@/src|\.\./)" src/storage | grep -v "from '@/src/config'"   # must find nothing: storage stays generic
grep -rniwE "lock|locking|ifMatch|compareAndSwap" src/storage                 # must find nothing: create-only puts are the only concurrency primitive
grep -rnE "access: 'public'|useCache: true" src/storage                        # must find nothing: Blob is private and never read from cache
```

### 13.1 Module map

| Module | Exports | What it does |
|---|---|---|
| `@/src/storage/object-store` | types `ObjectStore`, `StoredObject`, `PutOptions`, `ListOptions`, `ListResult`; `ObjectExistsError`, `InvalidKeyError`, `CorruptObjectError`; `MAX_KEY_LENGTH` (512), `MAX_LIST_LIMIT` (1000); `assertValidKey`, `assertValidPrefix`; `getJson`, `putJson`; `resolveListLimit`, `checkListArgs`, `pageKeys` | The contract every driver implements, its errors, the key rule and the JSON helpers. The last three functions are for driver authors (§13.6). |
| `@/src/storage/memory-store` | `MemoryObjectStore` | Objects in a `Map` owned by the instance. |
| `@/src/storage/file-store` | `FileObjectStore` | Objects as files under a root folder (§13.5). |
| `@/src/storage/vercel-blob-store` | `VercelBlobObjectStore` | Objects in a private Vercel Blob store through `@vercel/blob` (pinned to 2.9.0). |
| `@/src/storage` (`index.ts`) | `createObjectStore(config)` | Builds the driver selected by the configuration (§13.3). |

`index.ts` exports only the factory; import types, errors and helpers from `@/src/storage/object-store` and a driver class from its own module.

### 13.2 Keys

A key is 1–512 characters: one or more segments joined by `/`, each matching `^[A-Za-z0-9_-][A-Za-z0-9._-]*$`.

| Valid | Invalid |
|---|---|
| `a`, `games/abc/meta.json`, `index/created/2026-11-23/x_y-z` | `''`, `/a`, `a/`, `a//b`, `.`, `a/..`, `a/.tmp-1`, `a b`, `a\b`, `é`, anything over 512 characters |

A `list` prefix is valid when it is `''` or when `prefix + 'x'` is a valid key, so `games/`, `games/ab` and `index/created/2026-` work and `/games`, `games//x`, `../` and `games/.t` do not. Every driver applies the rule before doing any I/O and rejects with `InvalidKeyError` (its `key` property holds the rejected string). Call `assertValidKey(key)` or `assertValidPrefix(prefix)` to check a string yourself; they throw the same error synchronously.

When you design key names (the state layer's key builders do this):

- **Never make one key a path prefix of another** (`a` and `a/b`). The file store cannot hold a file and a folder with the same name, and its behaviour for such keys is unspecified.
- **Use one letter case.** On a case-insensitive filesystem (the macOS default, Windows) `A/1` and `a/1` are the same file, so the second create-only put fails with `ObjectExistsError`. Memory and Blob treat them as different keys.
- **Pad numbers** that must sort (`commits/00000042.json`): `list` sorts by code unit, so `a/10` comes before `a/2`.

### 13.3 Choosing a driver

`createObjectStore(config)` reads three groups of settings from `Config` (§5):

| `STORAGE_DRIVER` | Store | Settings | Use it for |
|---|---|---|---|
| `file` (default outside Vercel) | `new FileObjectStore(FILE_STORE_DIR)` | `FILE_STORE_DIR`, default `.data/` (git-ignored), resolved against the working directory; created on the first write | Local development: data survives restarts and can be inspected on disk. |
| `memory` | one `MemoryObjectStore` **shared by the whole process** | – | Tests and throwaway runs. Data is lost when the process exits. |
| `blob` (default when `VERCEL=1`) | `VercelBlobObjectStore` | `BLOB_READ_WRITE_TOKEN`, or `BLOB_STORE_ID` (see below) | Preview and production deployments; running against the preview store from outside Vercel. |

**Blob credentials.** If `BLOB_READ_WRITE_TOKEN` is set, the driver passes it to every SDK call; use it outside Vercel (CI, a local run against the preview store). Otherwise `BLOB_STORE_ID` must be set: Vercel sets it, together with `VERCEL_OIDC_TOKEN`, when a Blob store is connected to the project, and the SDK then authenticates with the OIDC token on its own (from the environment or the request context). If neither variable is set, `createObjectStore` throws:

```
Invalid configuration:
  - BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID is required when STORAGE_DRIVER is blob
```

The check lives in the factory, not in `loadConfig`, because only the Blob driver needs these credentials: `loadConfig` accepts `STORAGE_DRIVER=blob` without them, and the error appears when the store is built. Like every `ConfigError`, the message never contains a value. A missing or invalid OIDC token is reported by the SDK on its first call, not by the factory.

Set the variables in the shell or in `.env.local` (git-ignored, §8). Point local runs at the **preview** Blob store only (with its `BLOB_READ_WRITE_TOKEN` in `.env.local`), never at production.

### 13.4 Using a store

In the app, build the store from the configuration once and pass it to the code that needs it:

```ts
import { getConfig } from '@/src/config';
import { createObjectStore } from '@/src/storage';

const store = createObjectStore(getConfig());
```

The example below uses a fresh `MemoryObjectStore`, as a test would; the calls are the same on every driver.

```ts
import { z } from 'zod';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import {
  CorruptObjectError,
  ObjectExistsError,
  getJson,
  putJson,
} from '@/src/storage/object-store';

const store = new MemoryObjectStore();

// Persisted documents carry a schemaVersion, checked on every read.
const NoteSchema = z.object({ schemaVersion: z.literal(1), text: z.string() });

// putJson is create-only unless told otherwise: the second write of the same key fails.
await putJson(store, 'notes/n1/meta.json', { schemaVersion: 1, text: 'first' });
try {
  await putJson(store, 'notes/n1/meta.json', { schemaVersion: 1, text: 'second' });
} catch (error) {
  if (!(error instanceof ObjectExistsError)) throw error;
  // error.key === 'notes/n1/meta.json'; the stored body is still 'first'.
}

// A mutable document is written with overwrite.
await putJson(store, 'notes/n1/head.json', { schemaVersion: 1, text: 'v1' }, { mode: 'overwrite' });
await putJson(store, 'notes/n1/head.json', { schemaVersion: 1, text: 'v2' }, { mode: 'overwrite' });

// getJson returns the schema's output, or null for a missing key.
const meta = await getJson(store, 'notes/n1/meta.json', NoteSchema); // { schemaVersion: 1, text: 'first' }
const none = await getJson(store, 'notes/n2/meta.json', NoteSchema); // null

// Raw bytes: strings are stored as UTF-8, bodies come back as Uint8Array.
await store.put('notes/n1/raw.txt', 'héllo');
const raw = await store.get('notes/n1/raw.txt');
const text = raw === null ? null : new TextDecoder().decode(raw.body); // 'héllo'

// A body that does not match the schema is reported, not returned.
await store.put('notes/n1/bad.json', '{"schemaVersion":2,"text":"?"}');
try {
  await getJson(store, 'notes/n1/bad.json', NoteSchema);
} catch (error) {
  if (!(error instanceof CorruptObjectError)) throw error;
  // error.reason === 'schema', error.issuePath === 'schemaVersion'
}

// Page through a prefix, then delete everything found (delete is idempotent).
const keys: string[] = [];
let cursor: string | undefined;
do {
  const page = await store.list('notes/', { cursor, limit: 2 });
  keys.push(...page.keys);
  cursor = page.cursor;
} while (cursor !== undefined);
// keys: ['notes/n1/bad.json', 'notes/n1/head.json', 'notes/n1/meta.json', 'notes/n1/raw.txt']
await store.delete(keys);
```

**Errors you can get.**

| Error | From | Meaning and what to do |
|---|---|---|
| `ObjectExistsError` (`key`) | create-only `put` / `putJson` | The key is taken. In the state layer this is the lost-race signal for a commit. On Blob it can also mean your own write landed and the SDK's retry collided (§13.7): read the object back and compare when it matters. |
| `InvalidKeyError` (`key`) | any method, `assertValidKey`, `assertValidPrefix` | A programming error: fix the key builder. |
| `CorruptObjectError` (`key`, `reason`, `issuePath`) | `getJson` | `reason: 'invalid-json'`: the body is not valid UTF-8 JSON. `reason: 'schema'`: it parsed but failed the schema (an unknown `schemaVersion` included); `issuePath` is the first Zod issue's path joined with `.`, or `''` for the root. |
| `RangeError` | `list` | `limit` not an integer from 1 to 1000, or (memory and file) a `cursor` that is not a key under the prefix. |
| `TypeError` | `putJson` | `JSON.stringify` returned `undefined` (the value is `undefined`, a function, a symbol); nothing was written. |
| `ConfigError` | `createObjectStore` | `STORAGE_DRIVER=blob` with no Blob credentials (§13.3). |
| anything else | any method | Filesystem and Blob SDK errors (permissions, network, quota) propagate unchanged. |

Error messages contain the key and a fixed reason (`Object already exists: <key>`, `Invalid key: "<key>"`, `Corrupt object <key>: schema mismatch at <path>`), never a body or a credential, so they are safe to log. Validation errors arrive as rejected promises, never as synchronous throws, so `await` with `try`/`catch` (or `.catch`) catches everything.

### 13.5 The file store on disk

Each key is one file under the root; `/` in the key is a folder separator:

```
.data/                                   ← FILE_STORE_DIR
  games/abc/meta.json                    ← key games/abc/meta.json
  games/abc/commits/00000000.json        ← key games/abc/commits/00000000.json
  games/abc/.tmp-3f0c…                   ← a write in progress (or left by a crash); never a key
```

- **How a write works.** The body goes to a temp file `.tmp-<uuid>` in the target's folder, which is fsynced and closed, then published in one atomic step: `link` for create-only (it fails if the target exists, which is how the conflict is detected), `rename` for overwrite. The temp file is removed in every outcome, and the folder is fsynced so the new name survives a crash. A reader therefore never sees half a file.
- **`.tmp-` files.** Names starting with `.` are never keys, so `list` skips them and they are invisible to callers. A crash in the middle of a put can leave one behind; it is harmless and can be deleted while nothing is running.
- **Folders.** Parent folders are created on demand. `delete` removes files only, so empty folders stay; they never show up in `list`. A path that is a folder reads as a missing key.
- **Plain files.** Bodies are stored as-is (JSON documents are readable with any editor). To start over, stop the server and delete the root folder.
- **Cost.** Each put does two fsyncs (file and folder), about 14 ms on a Mac. That is fine for development; tests that need hundreds of keys should write files directly instead of calling `put` many times.
- **Local disks only.** The atomicity relies on `link` and `rename` being atomic, which holds on APFS and ext4 but not necessarily on network filesystems.

### 13.6 Storage tests

| File | Protects |
|---|---|
| `tests/contract/object-store.contract.ts` | The shared contract suite, `runObjectStoreContract(name, makeStore, { exactCursor })`. Not a `.test.ts` file, so vitest does not run it on its own. |
| `tests/contract/{memory,file,blob}-store.contract.test.ts` | One run of the suite per driver: a fresh store per test (memory), a fresh `os.tmpdir()` folder per test, removed afterwards (file), or a per-test namespace in a real Blob store (Blob, only with a token). |
| `tests/contract/prefixed-store.ts` | The test-only wrapper that gives each Blob test its own `contract/<runId>/<testId>/` namespace. |
| `tests/unit/storage/keys.test.ts`, `json.test.ts` | The key and prefix rule; `getJson`/`putJson` and the exact error messages. |
| `tests/unit/storage/memory-store.test.ts`, `file-store.test.ts` | Body copies; cursor rules; 1,001 keys paged as 1000 + 1; the file layout, hidden `.tmp-` files and no temp files left after a 10-way create race. |
| `tests/unit/storage/vercel-blob-store.test.ts`, `factory.test.ts` | The exact SDK calls and error mapping against a mocked `@vercel/blob`; driver selection and the credentials rule. |

The suite checks key validation, create-only conflicts (including 10 concurrent creates of one key: exactly one wins), overwrite, missing keys, reads during an 8 MiB write (never a partial body), list order and paging, idempotent deletes and the JSON helpers.

```sh
env -u BLOB_READ_WRITE_TOKEN pnpm vitest run tests/contract        # memory + file pass, Blob reported as skipped
env -u BLOB_READ_WRITE_TOKEN pnpm vitest run tests/unit/storage    # storage unit tests, mocked SDK
pnpm vitest run tests/contract/memory-store.contract.test.ts --reporter verbose   # one line per check
```

The first command prints `Test Files 2 passed | 1 skipped (3)`. The memory and file runs take about 1 s together locally; they run on every `pnpm test`, so keep them well under 30 s in CI.

**Running the contract against Vercel Blob.** This talks to a **real store** and creates, overwrites and deletes objects in it. Use the preview store's read-write token, never production's:

```sh
BLOB_READ_WRITE_TOKEN=… pnpm vitest run tests/contract/blob-store.contract.test.ts
```

Every object is written under `contract/<runId>/<testId>/` (random ids), so runs never collide with each other or with game data, and an `afterAll` deletes everything under `contract/<runId>/`. An interrupted run can leave objects under `contract/`; delete them by listing that prefix. On Blob the run skips one check, the cursor at an exact page boundary, because the SDK may report another page when none is left.

**`BLOB_READ_WRITE_TOKEN` in your shell turns on the Blob run inside `pnpm test` too.** If you keep it exported (for example from `.env.local` loaded into the shell), run the normal suite with `env -u BLOB_READ_WRITE_TOKEN pnpm test`.

**Mocking the SDK.** Unit tests replace only the four calls and keep the real error classes:

```ts
vi.mock('@vercel/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vercel/blob')>()),
  put: vi.fn(), get: vi.fn(), list: vi.fn(), del: vi.fn(),
}));
```

Reset with `vi.resetAllMocks()` in `beforeEach` and assert on `vi.mocked(put).mock.calls`. A mocked `get` result needs a stream body, e.g. `{ statusCode: 200, stream: new Response(bytes).body, … }`; type `bytes` as `Uint8Array<ArrayBuffer>`, or `pnpm typecheck` rejects it as a `Response` body.

**Adding a driver.** Implement `ObjectStore` with every method `async`, validating first (`assertValidKey` for each key, every key of a `delete` before deleting any). For `list`, the shared helpers give you the exact semantics of the memory and file stores:

```ts
async list(prefix: string, opts?: ListOptions): Promise<ListResult> {
  const args = checkListArgs(prefix, opts); // prefix, then limit, then cursor; throws before any I/O
  const all: Iterable<string> = /* every stored key, in any order */;
  return pageKeys(all, prefix, args);       // filter, sort by code unit, page; cursor = last key iff more remain
}
```

A driver with opaque backend cursors (like Blob) uses `assertValidPrefix` and `resolveListLimit` instead of `checkListArgs`. Then add `tests/contract/<driver>-store.contract.test.ts` calling `runObjectStoreContract('<driver>', makeStore, { exactCursor: true })`, where `makeStore` returns `{ store, cleanup }` for one test; pass `exactCursor: false` only if the backend cannot tell that a page was the last one.

### 13.7 Gotchas and limitations

- **The Blob driver has not run against a real store yet.** It is tested against a mocked SDK only. Four behaviours are assumed until the Blob contract run and the preview checks (architecture §11) confirm them: a create-only conflict comes back as an SDK error whose message contains `already exists` (the SDK has no error class for it); `get` of a missing key returns `null`; `list` pages come back in ascending order across pages and cover every key; and `del` with missing keys either succeeds or throws `BlobNotFoundError` after deleting the others.
- **On Blob, `ObjectExistsError` from a create-only put may hide your own success.** The SDK retries network errors and 5xx responses (`VERCEL_BLOB_RETRIES`, default 10). If the first attempt landed and only its response was lost, the retry collides with your own object. Where it matters, read the object back and compare it with what you wrote; commits carry a unique `clientRequestId` for this (architecture §6.3).
- **A Blob listing is a hint.** Never decide that something does not exist from `list` alone on Blob; confirm with `get`/`exists`, which are always uncached.
- **Blob reads are never cached**, immutable keys included. This is the safe default; whether cached reads of immutable keys are worth it is to be measured in preview.
- **A large Blob `delete` is not atomic.** Keys go to the SDK in batches of 1000 distinct keys, one batch at a time. If a batch fails with anything but `BlobNotFoundError`, earlier batches are already deleted and later ones are not sent; retry the whole call.
- **Cursors differ by driver.** On memory and file the cursor is the last key of the page, and a cursor that is not a key under the prefix is a `RangeError`; on Blob it is an opaque SDK string. Treat cursors as opaque and pass them back only with the same prefix.
- **The memory store is per process when built by the factory.** Every `createObjectStore` call with `STORAGE_DRIVER=memory` returns the same instance, so tests that use the factory share data within a test file. Use distinct keys, or `new MemoryObjectStore()` for an isolated store.
- **Case-insensitive filesystems and prefix-colliding keys** behave differently on the file store (§13.2).
- **`contentType` is write-only.** Only Blob forwards it (`putJson` sets `application/json`); no driver returns it, and memory and file ignore it.
- **`CorruptObjectError.issuePath` always exists as a property**, even for `'invalid-json'`, where its value is `undefined` (class fields are always defined). Test it with `=== undefined`, not with `in`.
- **Not in the interface:** ETag-conditional writes (`ifMatch`), object metadata (size, timestamps), streaming bodies and content types on reads.

---

## 14. Known limitations

- **Configuration is not validated at server startup yet.** `getConfig()` has no caller; it is wired in by its first user, the GameService factory (Phase 8 in [`implementation.md`](./implementation.md)). Until then a misconfigured deployment would still start.
- **Blob credentials are checked by `createObjectStore`, not by `loadConfig`** (§13.3), so a `blob` configuration without them is reported when the store is first built, not at startup.
- **The Vercel Blob driver has not run against a real store yet**; it is tested against a mocked SDK, and the behaviours it assumes are listed in §13.7.
- **The layer rule does not check dynamic `import()` or `require()`.** Use static `import` statements.
- **No game persistence, `GameService` or API yet:** the game core (`src/domain` §9, `src/engine` §10, `src/score` §11, `src/players` §12), the two pure service helpers (§12) and the storage layer (`src/storage`, §13) exist, but `src/state` is empty, so no game is saved; `GameService` is not written, and `/` is a placeholder page. A game can be played and scored only from code, tests or `pnpm simulate`.
- **Engine limitations** are listed in §10.8, **score limitations** in §11.7, **player, AI-loop and simulation limitations** in §12.8, **storage limitations** in §13.7.
