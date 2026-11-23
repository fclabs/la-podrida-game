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

**Dependencies.** Runtime `dependencies` are limited to `next`, `react`, `react-dom`, `zod` and `@noble/hashes` (SHA-256 for the engine's random streams, §10.6). Everything else is a `devDependency`. All versions in `package.json` are **exact pins** (no `^`/`~`): add packages with an explicit version, e.g. `pnpm add -D some-tool@1.2.3`, so every upgrade is a visible, deliberate change.

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

Apart from `src/domain` (§9) and `src/engine` (§10), the layer folders under `src/` are empty for now (each holds a `.gitkeep` so git tracks it). The App Router lives in the root `app/` folder, not `src/app`, so that `src/` holds only the layered backend code.

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
| `tests/contract/` | Contracts that several implementations must satisfy (e.g. one suite run against every storage driver). | `pnpm test` |
| `tests/api/` | Route handlers, called directly. | `pnpm test` |
| `tests/sim/` | Long-running simulations (many full games). | `pnpm test:sim` only |

Test files anywhere else (for example next to the code in `src/`) are **never run**. `pnpm test:sim` exits 0 when `tests/sim` has no tests.

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

`.github/workflows/ci.yml` runs on every push to any branch and on every pull request. One job on `ubuntu-latest`:

1. Checkout.
2. Set up pnpm (version read from `packageManager` in `package.json`).
3. Set up Node.js from `.nvmrc`, with the pnpm store cached between runs (the cache key is the hash of `pnpm-lock.yaml`).
4. `pnpm install --frozen-lockfile`
5. `pnpm typecheck`
6. `pnpm lint`
7. `pnpm test`
8. `pnpm build`

The run fails as soon as one step fails. CI needs no secrets and sets no environment variables: tests pass explicit environment maps to `loadConfig`. The workflow has read-only access to the repository.

**Why `build` is in CI.** `next build` catches errors that typecheck and lint don't (for example invalid page exports or prerendering failures), and there are no preview deployments yet to catch them. `pnpm test:sim` is not part of CI yet; it is added once the simulations exist.

Every change must keep CI green. Run the same commands locally before pushing:

```sh
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build
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

A `RuleSet` is plain JSON data (no functions, classes or `undefined`) because each game freezes a copy of it into its state and persists it. The engine (and later the score engine) reads behaviour from it instead of special-casing presets.

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
- **Scoring** (Phase 3) and **players and strategies** (Phase 4). `HandScore`, `ScoreBoard`, the view types and `DecisionContext` / `Decision` exist only as shapes.
- **Persistence types** `GameMeta`, `Commit` and `CommitBody` and their schemas (Phase 6, in the state layer).
- No schema checks that a hand sequence makes sense for a player count (for example `range 5→max` when `max` is below 5); `expandHandSequence` checks it, and `createGame` reports it as a setup problem.

---

## 10. Engine

`src/engine` is the Game Engine: pure, deterministic functions that create a game from a rule set, seats and a secret seed, deal every hand from seeded random streams, list the legal bids and plays for the seat to act, apply a move together with every automatic transition that follows (bidding closed, trick won, hand completed, next deal, game over), build a per-seat table view, and check a state's invariants. Every rule difference between presets is read from the game's `RuleSet`; no code branches on a preset id.

The engine **never scores**: no points, totals or rankings appear in its state, events or views. Scoring is the Score Engine's job, which reads `GameState.completedHands` (see [`design.md`](./design.md) §6).

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

**When to call it.** In tests and in the simulator, after every move, asserting `[]`; that is how the engine's own tests sweep full games for every preset. It is not called inside `applyMove`: legal moves cannot produce an invalid state, and the engine keeps the move path free of extra work. Card conservation across a whole hand (hands + played cards + stock = deck) needs the history of the hand, so it is not an invariant of a single state; the simulator checks it from the event log ([`design.md`](./design.md) §5.6). Tests should assert on the tags, not the full message text.

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
- **Not in the engine:** scoring and `live` hand status (Score Engine), `PlayerView`, players, strategies, the AI loop and the simulator, seed generation and setting `version` (GameService and the Game State Manager); see [`implementation.md`](./implementation.md) for when each arrives. Bid changes, revokes, target-score endings, tie-break hands and special hands are out of scope by design ([`design.md`](./design.md) §1.2, §4.2).

---

## 11. Known limitations

- **Configuration is not validated at server startup yet.** `getConfig()` has no caller; it is wired in by its first user, the GameService factory (Phase 8 in [`implementation.md`](./implementation.md)). Until then a misconfigured deployment would still start.
- **Storage credentials for the `blob` driver are not checked** by `loadConfig`; that check arrives with the storage layer (Phase 5).
- **`pnpm simulate` is a stub** that prints `simulate: not implemented until Phase 4` and exits 0. The simulator and the `tests/sim` suite arrive in Phase 4.
- **The layer rule does not check dynamic `import()` or `require()`.** Use static `import` statements.
- **No scoring, players, persistence or API yet:** `src/domain` (§9) and `src/engine` (§10) exist; `src/score`, `src/players`, `src/state`, `src/storage` and `src/service` are empty, and `/` is a placeholder page. A game can be played only from code or tests.
- **Engine limitations** are listed in §10.8.
