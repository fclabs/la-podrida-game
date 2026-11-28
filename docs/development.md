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
| Vitest | 5 | With Vite 8 as its peer. UI tests run in jsdom with Testing Library (§17.8). |
| ESLint | 10 (flat config) | Plus `typescript-eslint`, the Next.js plugin and a local layer-boundary rule. |
| Prettier | 3 | Checked by `pnpm lint`. |
| Zod | 4 | Runtime dependency, used for configuration, the domain schemas (§9) and the persisted game documents (§14). |
| `@noble/hashes` | 2.4.0 (exact) | Runtime dependency, used by the engine's seeded random streams (§10.6). |
| `@vercel/blob` | 2.9.0 (exact) | Runtime dependency, used only by the Vercel Blob storage driver (§13). |

**Dependencies.** Runtime `dependencies` are limited to `next`, `react`, `react-dom`, `zod`, `@noble/hashes` (SHA-256 for the engine's random streams, §10.6) and `@vercel/blob` (the Blob storage driver, §13). Everything else is a `devDependency`. All versions in `package.json` are **exact pins** (no `^`/`~`): add packages with an explicit version, e.g. `pnpm add -D some-tool@1.2.3`, so every upgrade is a visible, deliberate change.

---

## 2. Project layout

```
app/                    Next.js App Router: pages, layouts, components (UI)
  api/                  HTTP route handlers; shared code in api/_lib/ (§16); the retention cron (§18)
  _client/              Browser UI: pages' components, API client, state (§17)
  game/[id]/            The game page route (§17)
src/
  domain/               Types, rules presets, pure helpers            ┐
  engine/               Game Engine: state transitions, legal moves   │ core: pure, no I/O
  score/                Score Engine                                  │
  players/              Player / AI strategies                        ┘
  state/                Game State Manager: load/save game state      ┐ I/O
  storage/              ObjectStore drivers (memory, file, Vercel Blob)┘
  service/              GameService: orchestrates core + state; view, AI loop, replay
  config.ts             Validated environment configuration
tests/
  unit/                 Pure logic, lint-rule fixtures, config
  contract/             Cross-module contracts (e.g. every ObjectStore driver)
  api/                  Route handlers
  ui/                   Browser UI in jsdom: modules, components, full game (§17.8)
  retention/            The daily cleanup job on the memory and file stores (§18.10)
  sim/                  Long-running simulations (run by `pnpm test:sim` only)
scripts/simulate.ts     Command-line simulator (`pnpm simulate`)
tools/eslint-rules/     Local ESLint rule that enforces the layer boundaries
docs/                   Design docs (this guide included)
```

`src/domain` (§9), `src/engine` (§10), `src/score` (§11), `src/players` (§12), `src/storage` (§13), `src/state` (§14) and `src/service` (`GameService`, `replayGame` and the two pure helpers `buildPlayerView` and `runAiLoop`, §12 and §15) are built, and so is the HTTP API in `app/api/` (§16), including the daily retention job (§18). So is the browser UI in `app/_client/` (§17): the new-game page at `/` and the game page at `/game/[id]`. The App Router lives in the root `app/` folder, not `src/app`, so that `src/` holds only the layered backend code.

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

Tests are Vitest files named `*.test.ts` (`*.test.tsx` under `tests/ui/`), placed in the folder that matches what they test:

| Folder | Put here | Run by |
|---|---|---|
| `tests/unit/` | Pure logic: domain helpers, engine and score functions, config, lint-rule fixtures. | `pnpm test` |
| `tests/contract/` | Contracts that several implementations must satisfy (e.g. one suite run against every storage driver, §13.6). The Vercel Blob run is skipped unless `BLOB_READ_WRITE_TOKEN` is set. | `pnpm test` |
| `tests/api/` | Route handlers, called directly (§16.8). | `pnpm test` |
| `tests/ui/` | The browser UI in jsdom: pure client modules and React components with Testing Library, against an in-process API (§17.8). | `pnpm test` (`pnpm vitest run --project ui` for only these) |
| `tests/retention/` | The retention cleanup job, run against the memory and file stores (§18.10). | `pnpm test` |
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

**Two Vitest configs.** `vitest.config.ts` (used by `pnpm test`) defines two projects that share the `@` alias: `node` (`tests/{unit,contract,api,retention}`, Node environment) and `ui` (`tests/ui`, jsdom, with `tests/ui/setup.ts` cleaning up Testing Library and `localStorage` after each test); `vitest.sim.config.ts` (used by `pnpm test:sim`) includes only `tests/sim` and allows an empty folder. They are two standalone files because merging configs concatenates the `include` lists (sim would also run everything else) and importing one config from the other is not supported cleanly by Vite's config loader. **Keep the `resolve.alias` and `environment` settings of both files in sync.**

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
- **Persistence types** `GameMeta`, `Commit`, `CommitBody`, `Head` and `FinalScores` and their schemas live in the state layer (`src/state/schemas.ts`, §14.3), which reuses the domain schemas for seats, events and state.
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
- **Not in the engine:** scoring and `live` hand status (Score Engine, §11); `PlayerView`, players, strategies, the AI loop and the simulator (§12); seed generation and setting `version` (`GameService`, §15; the Game State Manager checks it, §14.7). Bid changes, revokes, target-score endings, tie-break hands and special hands are out of scope by design ([`design.md`](./design.md) §1.2, §4.2).

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
- **Not in the score engine:** composing `PlayerView` and `finalRanking` (`buildPlayerView`, §12), persisting the scoreboard with each commit and writing `final.json` (Game State Manager, §14), and target-score endings, tie-break hands, "Pocha" bonuses and suit multipliers ([`design.md`](./design.md) §4.2 and its open questions).

---

## 12. Players, views and simulation

Three pieces sit on top of the engine and the score engine:

- **`src/players`** decides moves: the `Player` and `AIStrategy` shapes, their factories, the first AI (`randomStrategy`) and the strategy registry.
- **Two service helpers** turn a game state into what a seat sees and play the AI turns: `buildPlayerView` (`src/service/player-view.ts`) and `runAiLoop` (`src/service/ai-loop.ts`). `GameService` (§15) calls them, and so do the simulator and the tests.
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
- **Not here:** seed generation, seat tokens, `PlayerUpdate` assembly and versions are `GameService`'s job (§15), and persistence is the Game State Manager's (§14). Only the `random` strategy exists.

---

## 13. Storage

`src/storage` is where game data lives: an `ObjectStore` that keeps **bytes under string keys**, with three drivers (in-memory, filesystem and Vercel Blob) that behave the same, a factory that picks one from the configuration, and two helpers that read and write JSON validated with Zod. Its callers are the Game State Manager (§14) and, later, the retention job. The design, the guarantees and the reasons behind them are in [`architecture.md`](./architecture.md) §6.1; this section is about using, configuring and testing the code.

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
- **On Blob, `ObjectExistsError` from a create-only put may hide your own success.** The SDK retries network errors and 5xx responses (`VERCEL_BLOB_RETRIES`, default 10). If the first attempt landed and only its response was lost, the retry collides with your own object. Where it matters, read the object back and compare it with what you wrote; the Game State Manager does this for every document it creates (§14.5, §14.7).
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

## 14. Game state

`src/state` is the Game State Manager: it knows how a game is laid out in storage and turns the generic `ObjectStore` (§13) into "create a game, find its latest version, load any version, append the next one, read the events a client missed". It works over any driver, so the same code runs on memory in tests, on disk locally and on Vercel Blob in production. The design and the reasons behind it are in [`architecture.md`](./architecture.md) §6.2–§6.3 and the interface in [`design.md`](./design.md) §7; this section is about using and testing the code.

Two rules shape everything here:

- **The commits are the truth.** A game's current version is decided only by which commit keys exist, and its final result only by the terminal commit. `head.json` (the latest version) and `final.json` (the final scores) are caches: they may be stale, missing or ahead, and nothing breaks.
- **Create-only writes are the only ordering guard.** The manager never overwrites a commit, `meta.json`, the index marker or `final.json`; only `head.json` is overwritten. There is no locking and no conditional write. Two requests racing for one version are settled by the storage layer's create-only `put`, where exactly one wins.

The manager **stores and validates documents; it never interprets them**. It imports only `zod`, `@/src/domain/*`, `@/src/storage/object-store` and its own files: no engine, score, players or service, and no `src/config` (it receives a ready store, so it needs no configuration, even though the layer rule, §3, would allow it). It generates nothing either: the caller (`GameService`) supplies the `gameId`, the timestamps, the seat-token hashes and the state to save. Three greps keep it that way (they also match comments):

```sh
grep -rnE "from '@/src/(engine|score|players|service|config)" src/state   # must find nothing
grep -rniwE "ifMatch|lock|locking" src/state                               # must find nothing
grep -rnE "mode: 'overwrite'" src/state                                    # only the head.json write
```

### 14.1 Module map

Import from each module directly (`import { GameStateManager } from '@/src/state/game-state-manager'`); there is no barrel `index.ts`. Inside `src/state`, modules import each other with `./…`.

| Module | Exports | What it does |
|---|---|---|
| `@/src/state/keys` | `MAX_COMMIT_VERSION` (99,999,999), `GAME_ID_PATTERN`, `assertValidGameId`; `gameKeyPrefix`, `metaKey`, `commitsPrefix`, `commitKey`, `headKey`, `finalScoresKey`, `indexCreatedKey`, `indexCreatedPrefix`; `parseCommitKey` | The storage layout (§14.2). |
| `@/src/state/schemas` | `GameMetaSchema`, `CommitSchema`, `HeadSchema`, `FinalScoresSchema`, `ScoreBoardSchema`; types `GameMeta`, `Commit`, `CommitBody`, `Head`, `FinalScores`; `firstIssuePath` | The persisted documents (§14.3). |
| `@/src/state/errors` | `InvalidGameIdError`, `GameNotFoundError`, `GameExistsError`, `CommitNotFoundError`, `CommitConflictError`, `InvalidCommitError` | The manager's errors (§14.10). |
| `@/src/state/game-state-manager` | `GameStateManager` | Creating, loading and committing games over an `ObjectStore` (§14.4–§14.9). |

The retention job (§18) uses the key builders (`indexCreatedPrefix`, `gameKeyPrefix`) and the store directly; it does not need the manager.

### 14.2 Keys

| Builder | Key |
|---|---|
| `gameKeyPrefix(id)` | `games/{id}/` |
| `metaKey(id)` | `games/{id}/meta.json` |
| `commitsPrefix(id)` | `games/{id}/commits/` |
| `commitKey(id, v)` | `games/{id}/commits/{v as 8 digits}.json`, e.g. `…/commits/00000041.json` |
| `headKey(id)` | `games/{id}/head.json` |
| `finalScoresKey(id)` | `games/{id}/scores/final.json` |
| `indexCreatedKey(date, id)` | `index/created/{yyyy-mm-dd}/{id}` |
| `indexCreatedPrefix` | the constant `index/created/` |

- **Game ids.** A `gameId` must match `GAME_ID_PATTERN`, `^[a-z2-7]{26}$`: 128 random bits written in lowercase base32 without padding. `assertValidGameId(id)` throws `InvalidGameIdError` otherwise. Every builder checks the id first, and every manager method rejects a bad id before any I/O, so a request can never make the manager touch a key outside its game (`..`, `/` and upper case are all rejected).
- **Versions** are integers from 0 to `MAX_COMMIT_VERSION`; anything else makes `commitKey` throw `RangeError` (message contains `version`). Eight zero-padded digits make `list` return commits in version order.
- **Index dates** must be a real UTC calendar date written `yyyy-mm-dd` (`2026-02-30` and `2026-1-5` throw `RangeError`).
- **`parseCommitKey(gameId, key)`** returns the version when `key` is exactly `commitKey(gameId, v)`, and `null` for anything else (a head key, a stray file, another game's commit).
- The keys follow the storage key rule (§13.2): one letter case, padded numbers, and no key that is a path prefix of another.

### 14.3 Documents and schemas

The fields of each document are listed in [`architecture.md`](./architecture.md) §6.2. Every schema is a `z.strictObject` with `schemaVersion: z.literal(1)`, so a document with an unknown key, a missing field or another `schemaVersion` is rejected. The types are `z.infer` of the schemas, and `CommitBody` is `Commit` without `schemaVersion` (what a caller passes in; the manager adds `schemaVersion: 1`).

The cross-field rules are part of the schemas (`.superRefine`), so they hold on every read **and** every write:

- **`GameMeta`:** `gameId` matches the id pattern; `seats[i].seat === i`; there is one `seatTokenHashes` entry per seat, 64 lowercase hex characters for a human seat and `null` for an AI seat; `createdAt` is exactly what `Date#toISOString()` returns (`2026-11-23T14:05:00.000Z`: milliseconds and `Z` required, a real date).
- **`Commit`:** `version` is in range; `actorSeat` and `clientRequestId` are both `null` for commit 0 and both set for every later commit; `clientRequestId` has 1–128 characters; `at` has the same format as `createdAt`. The `events`, `state` and `scoreboard` fields reuse the domain schemas.
- **`Head`:** `version` is in range.
- **`ScoreBoardSchema`** matches the domain `ScoreBoard` type field for field (`live` optional). There is no scoreboard schema in the domain, and the state layer cannot import the score layer, so it lives here. `tests/unit/state/types.test-d.ts` makes `pnpm typecheck` fail if the two drift apart: change both together.

On a read, a document that fails its schema is reported by `getJson` as the storage `CorruptObjectError` with `reason: 'schema'` and `issuePath` (for example `schemaVersion`, `seatTokenHashes.1`, `actorSeat`; `''` for an extra top-level key). On a write, the same failure is an `InvalidCommitError` before anything is stored (§14.10). The manager never returns unvalidated data.

### 14.4 Using the manager

This is how `GameService` drives a game, shown on a fresh `MemoryObjectStore` as a test would; the calls are the same on every driver. In the app the store comes from `createObjectStore(getConfig())` (§13.4).

```ts
import { createHash, randomBytes } from 'node:crypto';
import { DEFAULT_PRESET_ID, getPreset } from '@/src/domain/presets';
import type { SeatInfo } from '@/src/domain/types';
import {
  applyMove,
  createGame,
  currentActor,
  ENGINE_VERSION,
  legalMoves,
} from '@/src/engine/engine';
import { evaluate } from '@/src/score/score-engine';
import { CommitConflictError } from '@/src/state/errors';
import { GameStateManager } from '@/src/state/game-state-manager';
import type { CommitBody, GameMeta } from '@/src/state/schemas';
import { MemoryObjectStore } from '@/src/storage/memory-store';

const manager = new GameStateManager(new MemoryObjectStore());

// The caller makes the id, the seed, the seat token and the timestamps; the manager only checks them.
const gameId = 'abcdefghijklmnopqrstuvwxyz'; // in the service: 16 random bytes in lowercase base32
const seats: SeatInfo[] = [
  { seat: 0, playerId: 'p0', name: 'Ana', kind: 'human' },
  { seat: 1, playerId: 'ai-1', name: 'AI 1', kind: 'ai' },
  { seat: 2, playerId: 'ai-2', name: 'AI 2', kind: 'ai' },
];
const seatToken = randomBytes(32).toString('base64url'); // returned to the player, never stored
const start = createGame({ gameId, rules: getPreset(DEFAULT_PRESET_ID), seats, seed: 'secret' });

const meta: GameMeta = {
  schemaVersion: 1,
  gameId,
  presetId: DEFAULT_PRESET_ID,
  engineVersion: ENGINE_VERSION,
  createdAt: new Date().toISOString(),
  seats,
  seatTokenHashes: [createHash('sha256').update(seatToken).digest('hex'), null, null],
};

// Commit 0: no actor and no request id. Writes the index marker, meta.json, commit 0, head.json.
const initial = await manager.create(meta, {
  version: 0,
  at: meta.createdAt,
  actorSeat: null,
  clientRequestId: null,
  events: start.events,
  state: start.state,
  scoreboard: evaluate(start.state),
});

// A request: load meta and the tip together, apply a move, save the next version.
const [storedMeta, tip] = await Promise.all([
  manager.loadMeta(gameId),
  manager.loadLatest(gameId),
]);
const actor = currentActor(tip.state) ?? 0;
const [move] = legalMoves(tip.state, actor);
const transition = applyMove(tip.state, actor, move.id);
const version = tip.version + 1;
const state = { ...transition.state, version }; // the caller sets state.version
const next: CommitBody = {
  version,
  at: new Date().toISOString(),
  actorSeat: actor,
  clientRequestId: 'req-1',
  events: transition.events,
  state,
  scoreboard: evaluate(state),
};
await manager.commit(gameId, next); // resolves to the stored Commit

// Another request that started from the same version loses the race.
try {
  await manager.commit(gameId, { ...next, clientRequestId: 'req-2' });
} catch (error) {
  if (!(error instanceof CommitConflictError)) throw error;
  // error.version === 1: the service runs its retry check, then answers VersionConflict (409).
}

const latest = await manager.loadLatest(gameId); // commit 1
const missed = await manager.eventsSince(gameId, initial.version); // the events of commit 1
const one = await manager.load(gameId, 1); // any version by number

// At game over (hand === null), cache the final scores; the terminal commit stays authoritative.
if (latest.state.hand === null) {
  await manager.writeFinalScores(gameId, latest.version, latest.scoreboard);
}
const final = await manager.readFinalScores(gameId); // null here: this game is not over
```

`storedMeta.seatTokenHashes` is what the service compares a presented token's hash against; `missed` and `one` are what it builds a client update from.

### 14.5 Creating a game

`create(meta, initial)` validates everything first, and rejects with `InvalidCommitError` before any I/O when the meta or commit-0 schema fails, `initial.version` or `initial.state.version` is not 0, `initial.state.gameId` is not `meta.gameId`, or `meta.seats` differs from `initial.state.seats`. It then writes, each step only after the previous one succeeded:

1. the index marker `index/created/{date of createdAt}/{gameId}`, empty, create-only;
2. `meta.json`, create-only;
3. commit 0, create-only;
4. `head.json` `{ schemaVersion: 1, version: 0 }`, overwrite, best-effort (any error is swallowed).

It resolves to commit 0.

- **When a key already exists.** An existing marker counts as success (it is empty, so any copy is identical). For `meta.json` and commit 0, the manager reads the stored bytes back: if they are byte-identical to what it just tried to write, the step counts as success. That is the Blob SDK retrying a write whose response was lost and colliding with itself (§13.7), and it is also why calling `create` twice with identical arguments resolves both times. Different bytes, or an object that vanished before the re-read, reject with `GameExistsError` and nothing further is written. With 128-bit random ids, `GameExistsError` means a bug, not bad luck.
- **Partial creates.** A game exists only when **both** `meta.json` and commit 0 exist. After a failure (or crash) at step 1 or 2, `loadMeta` and `loadLatest` both reject with `GameNotFoundError`. After a failure at step 3, `loadLatest` rejects with `GameNotFoundError` but `loadMeta` still returns the stored meta, because it reads only `meta.json`. After step 3 the game loads normally, with or without `head.json`. Any storage error other than "already exists" propagates unchanged; the leftovers are deleted by retention with the rest of the game.

### 14.6 Loading

| Method | Returns | Store calls |
|---|---|---|
| `loadMeta(gameId)` | The validated `GameMeta`; `GameNotFoundError` if `meta.json` is missing; `CorruptObjectError` (`issuePath 'gameId'`) if it names another game. | 1 `get` |
| `load(gameId, version)` | The validated commit; `CommitNotFoundError` when it is missing but commit 0 exists; `GameNotFoundError` when commit 0 is missing; `RangeError` for a version out of range. Does not read `meta.json`. | `get` of the commit in parallel with `exists` of commit 0 (one `get` for version 0) |
| `loadLatest(gameId)` | The tip commit; `GameNotFoundError` when `meta.json` or commit 0 is missing. Never writes. | 5 in the normal case (below) |

Every commit read also checks that the commit's `version` matches its key and that `state.gameId` is the requested game (`CorruptObjectError` with `issuePath` `version` or `state.gameId` otherwise). Checking commit 0 in `load` means a stray commit with no commit 0 (an orphan, §14.7) is never returned.

**How `loadLatest` finds the tip.**

1. In parallel: `exists(meta.json)`, `exists(commit 0)` and a read of `head.json`. Meta or commit 0 missing → `GameNotFoundError`. A `head.json` that is missing or corrupt counts as "no hint"; any other error from these three calls propagates.
2. **Probe forward from a start `s`:** read commit `s` while checking `exists(commit s+1)` in parallel. If commit `s` is missing, this start is no good. If `s+1` is missing, the tip is `s` and the commit already read is returned. Otherwise check `s+2, s+3, …` one at a time until one is missing, then read the last one that exists.
3. Start at the hint `h`. With no hint, or when commit `h` is missing (the hint is ahead of reality), list `games/{id}/commits/` (every page) and try each listed commit version, highest first, until one exists; if none does, start from 0.

With an exact hint that is **5 calls in two parallel rounds and no `list`**; a hint one behind adds one `exists` and one `get`. `head.json` is a hint only: `loadLatest` never trusts it without reading the commit, and never repairs it (the next `commit` rewrites it). A corrupt commit at the start of the probe propagates as `CorruptObjectError` rather than being skipped.

### 14.7 Committing

`commit(gameId, next)` validates `next` before any I/O and rejects with `InvalidCommitError` when the commit schema fails (including its cross-field rules), `next.version` is 0, `next.state.version` differs from `next.version`, or `next.state.gameId` is not `gameId`. It then writes the commit create-only and, on success, overwrites `head.json` best-effort: **exactly 2 store calls** without a conflict. It resolves to the stored `Commit`.

- **Conflicts.** When the commit key already exists, the manager reads it back. Byte-identical to what it tried to write → success (its own retried write landed; `head.json` is still written). Different bytes, or a commit that vanished before the re-read → `CommitConflictError { gameId, version }`. Of two different bodies racing for one version, exactly one resolves and the other gets `CommitConflictError`; the stored commit is the winner's. This is tested with real races on the memory and file stores; on Blob it rests on the driver's create-only `put` (§14.12).
- **Errors.** Any other storage error from the write or the re-read propagates unchanged. `head.json` errors never propagate: a stale hint only costs extra probes on the next load.
- **No tip or existence check.** `commit` does not check that `next.version` is the tip + 1, nor that the game exists: the create-only write is the only ordering guard, and checking would cost extra calls on every move. The service always loads the tip before it commits, so it always writes tip + 1. A `commit` for a game that was never created is written as an **orphan** key that no load ever returns (the game has no `meta.json` and no commit 0); only a caller bug produces one.
- **What "identical bytes" means.** The manager serializes the document once, as `JSON.stringify` of the caller's validated `{ schemaVersion: 1, ...next }` with the top-level keys in the documented order, and compares exactly those bytes. Nested objects keep the caller's key order. The comparison never spans two calls, so it cannot be fooled by a serializer change. Two copies of one request that happen to produce identical bytes both resolve, which is the right answer for them; any difference at all is a conflict, and the service's `clientRequestId` retry check sorts out the duplicates.

### 14.8 Events since a version

`eventsSince(gameId, version)` returns the events of commits `version + 1 … tip`, concatenated in version order, which is what a client that last saw `version` missed. It finds the tip as `loadLatest` does, returns `[]` when `version` is at or past the tip, and otherwise reads the commits in between **at most 8 at a time** (the tip commit, already read by the probe, is reused). With an exact hint that is `5 + (tip − version − 1)` store calls.

It rejects with `RangeError` (message contains `version`) when `version` is not an integer ≥ 0, `GameNotFoundError` for an unknown game, and `CommitNotFoundError` when a commit inside the range is missing (deleted meanwhile, for example by retention).

### 14.9 Final scores

`final.json` is a small summary written when a game ends, so the final result can be shown without reading the terminal commit. It is a **best-effort cache**: if it is missing, read the terminal commit's `scoreboard`, which is always authoritative.

- **`writeFinalScores(gameId, version, board)`** validates `board` with `ScoreBoardSchema` and `version` as an integer ≥ 0 (`InvalidCommitError` otherwise, before any I/O), then writes `{ schemaVersion: 1, gameId, version, ranking, totals, madeCount, missedCount }` create-only. It resolves whatever the write does: "already exists" and every other storage error are swallowed. Being create-only, the **first** write wins; a later call with another board changes nothing. Pass the terminal commit's version and scoreboard.
- **`readFinalScores(gameId)`** resolves to the validated `FinalScores`, or `null` when the file is missing. A corrupt file rejects with `CorruptObjectError`, and so does a `final.json` whose `gameId` names another game (`issuePath 'gameId'`), the same rule `loadMeta` applies, so one game's result is never returned for another.

### 14.10 Errors

| Error | From | When | What the caller does |
|---|---|---|---|
| `InvalidGameIdError` (`gameId`) | every method and key builder | The id does not match `^[a-z2-7]{26}$`. | No such game can exist: answer "not found" for an id taken from a request; otherwise fix the caller. |
| `GameNotFoundError` (`gameId`) | `loadMeta`, `load`, `loadLatest`, `eventsSince` | `meta.json` or commit 0 is missing (never created, partly created or being deleted). | Not found (404). |
| `GameExistsError` (`gameId`) | `create` | `meta.json` or commit 0 already holds different bytes. | A bug (ids are 128-bit random): report it as an internal error. |
| `CommitNotFoundError` (`gameId`, `version`) | `load`, `eventsSince` | `load`: that version is not committed yet. `eventsSince`: a commit inside the range vanished. | `load`: the version is ahead of the game. `eventsSince`: treat the game as gone. |
| `CommitConflictError` (`gameId`, `version`) | `commit` | Another body already holds that version. | Run the retry check against that commit, then answer `VersionConflict` (409) ([`design.md`](./design.md) §9). |
| `InvalidCommitError` (`reason`) | `create`, `commit`, `writeFinalScores` | The document fails its schema or a consistency check; nothing was written. | A bug in the caller. `reason` names the check (below). |
| `CorruptObjectError` (`key`, `reason`, `issuePath`) — from storage | every read | A stored document is not JSON, fails its schema (an unknown `schemaVersion` included), or names another version or game. | Internal error; log the key. |
| `RangeError` | `load`, `eventsSince`, `commitKey`, `indexCreatedKey` | A version or date out of range. | A bug or a bad request parameter. |
| anything else | any method | Storage errors (network, permissions, quota) propagate unchanged. | Internal error; the request can be retried. |

`InvalidCommitError.reason` is a fixed token, optionally followed by a path: `meta-schema:<path>`, `commit-schema:<path>` and `board-schema:<path>` (the first Zod issue's path joined with `.`, or `(root)`), `initial-version`, `initial-state-version`, `state-game-id`, `seats-mismatch`, `commit-version`, `state-version` and `final-version`. It never includes Zod's message, which can echo values.

Every message holds at most the game id, a version and a reason token (`Game not found: <id>`, `Commit <v> already exists in game <id>`, `Invalid document: <reason>`), never a seed, a hand, a seat-token hash or a document body, so they are safe to log. Each class sets `name` to its class name. All methods are `async`: validation errors arrive as rejected promises, never as synchronous throws.

### 14.11 State tests

Unit tests live in `tests/unit/state/` and run with `pnpm test`; they never touch a real store.

| File | Protects |
|---|---|
| `keys.test.ts` | Accepted and rejected game ids, every key exactly, version and date `RangeError`s, every key valid for storage and none a path prefix of another, `parseCommitKey`, sort order. |
| `schemas.test.ts` | Each schema rejects `schemaVersion: 2`, an extra key and a missing field; each cross-field rule broken once, with its exact `issuePath`; `ScoreBoardSchema` parses `evaluate()` for every state of one all-AI game per preset. |
| `types.test-d.ts` | Compile-time only (`pnpm typecheck`): `ScoreBoardSchema` and `ScoreBoard` stay identical. |
| `create.test.ts` | Bad ids make 0 store calls; the four writes, their order and modes; each validation failure; existing keys, retried writes and `GameExistsError`; a failure at each write step (partial creates). |
| `load.test.ts` | `loadMeta`, `load`; `loadLatest` with `head.json` exact, behind, ahead, missing, not JSON, wrong `schemaVersion`, out of range, and failing; listings that are empty, partial or paged; commit identity checks; the 5-call budget. |
| `commit.test.ts` | Stored bytes and key order, each invalid body, no tip + 1 check, orphans, races (20 rounds each on memory and on the file store), the retry case, error propagation and a failing `head.json`. |
| `events-final.test.ts` | `eventsSince` ranges, errors, a vanished commit, at most 8 reads in flight over 40 commits; `final.json` write, first write wins, errors swallowed, read, corrupt and foreign files. |
| `errors.test.ts` | Every error class provoked on a game whose seed and seat-token hash are known: neither appears in `message`, `String(error)` or `reason`. |
| `io-budget.test.ts` | Store-call budgets: `loadLatest` 5, `eventsSince(g, 2)` with tip 5 → 7, `commit` 2 puts. |

The whole folder takes about 2 s locally, most of it in the file-store races (each file-store put fsyncs). Run it with:

```sh
env -u BLOB_READ_WRITE_TOKEN pnpm vitest run tests/unit/state
```

**Test support** lives in `tests/unit/state/support/` (no `.test.ts` suffix, so not collected):

- `fixtures.ts`: `GAME_ID` and `OTHER_GAME_ID` (two valid ids), `makeMeta(overrides?)` (one human and two AI seats, default preset), `makeInitial(gameId?)` (a commit-0 body from `createGame`), `makeCommitBody(prev, n, events?)` (a valid body for version `n`), `toCommit(body)`, `makeChain(upTo)`, and `storeGame(store, { upTo, head?, meta?, skip?, gameId? })`, which writes a game straight to a store with `putJson` (no manager), optionally without `meta.json`, without some commits or with a given `head.json`.
- `store-wrappers.ts`: `RecordingStore(inner, hooks?)` wraps any store, records every call in `calls` (`{ method, key?, prefix?, keys?, mode? }`, in order, before the hook runs), tracks `maxConcurrentGets`, and lets a hook per method replace the call. Failing stores, retried writes and rewritten listings are all built from hooks. Assert on the raw data through `store.inner`.

A store that fails the third `put` (commit 0 in `create`), and a game stored directly with a stale hint:

```ts
import { expect } from 'vitest';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { GameStateManager } from '@/src/state/game-state-manager';
import { GameNotFoundError } from '@/src/state/errors';
import { GAME_ID, makeInitial, makeMeta, storeGame } from './support/fixtures';
import { RecordingStore } from './support/store-wrappers';

let puts = 0;
const failing = new RecordingStore(new MemoryObjectStore(), {
  put: async ({ key, body, opts }, inner) => {
    if (++puts === 3) throw new Error('boom');
    return inner.put(key, body, opts);
  },
});
const manager = new GameStateManager(failing);
await expect(manager.create(makeMeta(), makeInitial())).rejects.toThrow('boom');
await expect(manager.loadLatest(GAME_ID)).rejects.toBeInstanceOf(GameNotFoundError);
expect(await manager.loadMeta(GAME_ID)).toEqual(makeMeta()); // meta.json was written

const memory = new MemoryObjectStore();
await storeGame(memory, { upTo: 5, head: 2 }); // commits 0…5, head.json two behind
const counted = new RecordingStore(memory);
expect((await new GameStateManager(counted).loadLatest(GAME_ID)).version).toBe(5);
expect(counted.callsOf('put')).toHaveLength(0); // loading never writes
```

Tests on the file store create their folder with `fs.mkdtemp(path.join(os.tmpdir(), 'lp-state-'))` and remove it afterwards; they never write under `.data/`.

### 14.12 Gotchas and limitations

- **Returned documents are the parsed copies, stored bytes are the caller's.** `create` and `commit` write the caller's validated input (top-level keys in the documented order, nested keys in the caller's order) and return what Zod parsed. The content is equal, but Zod puts nested keys in schema order (a scoreboard comes back with `live` before `ranking`, while `evaluate()` builds `ranking` first). So never byte-compare a re-serialized returned document with stored bytes; compare parsed values. The manager's own byte comparison only ever compares the bytes of one call.
- **`head.json` lags after a failed write.** It is never repaired by a load; the next successful `commit` rewrites it. Until then loads cost an extra probe per missing step.
- **Edge cases of tip discovery.** Probing stops at `MAX_COMMIT_VERSION` without a call. A commit that existed during the probe but vanished before it was read rejects with `CommitNotFoundError` instead of silently returning an older tip, and commit 0 vanishing between the checks gives `GameNotFoundError`. All of these need an external delete in the middle of a load (only retention deletes, and only year-old games).
- **Gaps go unnoticed below the probe start.** Commits are never written with gaps (each is create-only and the service writes tip + 1), but a gap left by a partial delete below the starting point is not detected by `loadLatest`; `eventsSince` rejects with `CommitNotFoundError` if the gap is inside its range.
- **Orphan commits are not indexed.** A `commit` for a game that was never created writes a key with no index marker, so retention will not find it. Only a caller bug produces one.
- **`loadMeta` alone does not prove a game exists.** After a create that failed at commit 0, `meta.json` exists but the game does not. Always call `loadLatest` (or `load`) too, as in §14.4, and treat its `GameNotFoundError` as authoritative.
- **`engineVersion` is not checked on load.** The manager returns whatever version is stored; deciding what a mismatch with `ENGINE_VERSION` means is the service's job.
- **`InvalidCommitError` covers every rejected document**, including `meta` in `create` and the board in `writeFinalScores`; read `reason` to tell them apart.
- **No migrations.** A document with any `schemaVersion` other than 1 is reported as corrupt ([`architecture.md`](./architecture.md) §6.4).
- **Exclusivity on Blob is still assumed.** Exactly-one-winner races are proven on the memory and file stores; on Blob they rely on the storage contract and the preview checks ([`architecture.md`](./architecture.md) §11), like the rest of the Blob driver (§13.7).
- **Not in the state layer:** generating ids, seeds and seat tokens, hashing and checking tokens, the `clientRequestId` retry check, mapping errors to `VersionConflict` and HTTP, the AI loop (all `GameService`, §15), and deleting old games (the retention job, §18).

---

## 15. Service

`src/service` is the top of the backend: `GameService` turns what a player does (start a game, look at it, make a move) into calls to the engine (§10), the score engine (§11), the players and the AI loop (§12) and the Game State Manager (§14). It is the only module that combines them, and the only one that generates secrets: the game id, the seed and the seat token. Route handlers are its only production caller. The interface and the step-by-step behaviour are in [`design.md`](./design.md) §9, the request lifecycle and the 409 rules in [`architecture.md`](./architecture.md) §5 and §6.3; this section is about using and testing the code.

Three rules shape it:

- **One request, at most one commit.** `createGame` writes exactly one game (meta + commit 0) and `submitMove` at most one commit. The service never retries a write; a retried *request* that already committed gets its original result and writes nothing.
- **Every move goes through the engine.** The human's move and every AI move are applied with `applyMove`. The service never edits a `GameState` except to set `version` on the state it commits.
- **All I/O, time and randomness come in through the constructor.** `game-service.ts` reads storage only through the `GameStateManager` it is given, the clock only through `now` and random bytes only through `randomBytes`. `replay.ts` uses none of them. Two greps keep that true (they also match comments):

```sh
grep -nE "(^|[^.#[:alnum:]_])randomBytes\(|new Date\(|Math\.random" src/service/game-service.ts   # only the two deps defaults in the constructor
grep -nE "storage|config|node:|Date|Math\.random|crypto" src/service/replay.ts                      # must find nothing
```

### 15.1 Module map

Import from each module directly; there is no barrel `index.ts`.

| Module | Exports | What it does |
|---|---|---|
| `@/src/service/game-service` | `GameService`; types `GameServiceDeps`, `CreateGameRequest`, `CreateGameResult`, `SubmitMoveRequest` | Create a game, get an update, submit a move (§15.3–§15.6). |
| `@/src/service/errors` | `InvalidRequest`, `Unauthorized`, `GameNotFound`, `GameUnsupported`, `NotYourTurn`, `IllegalMove`, `VersionConflict` | The seven typed service errors (§15.7). |
| `@/src/service/replay` | `replayGame(meta, commits)` | Rebuild a stored game from its seed and move events (§15.9). |
| `@/src/service/player-view` | `buildPlayerView(state, seat)` | The only builder of a `PlayerView` (§12). |
| `@/src/service/ai-loop` | `runAiLoop`, `AiLoopLimitError` | Lets the AIs play until a human must act (§12.2). |

The layer rule (§3) lets `src/service` import every layer and `src/config.ts`, but the service does not read the configuration itself: the caller passes what it needs (§15.2). Nothing under `src/` imports `src/service`.

### 15.2 Constructing the service

```ts
interface GameServiceDeps {
  state: GameStateManager;                  // required: all storage goes through it
  defaultPresetId?: PresetId;               // preset for a createGame without rulesPreset; default 'argentina-fidepo'
  now?: () => Date;                         // clock for createdAt and commit `at`; default () => new Date()
  randomBytes?: (n: number) => Uint8Array;  // source of the id, seed and token bytes; default node:crypto
}
```

The constructor only stores its arguments: it does no I/O and reads no configuration, so building one per request is cheap. In the app, the store and the default preset come from the validated configuration (§5, §13.3):

```ts
import { loadConfig } from '@/src/config';
import { GameService } from '@/src/service/game-service';
import { GameStateManager } from '@/src/state/game-state-manager';
import { createObjectStore } from '@/src/storage';

const config = loadConfig({ STORAGE_DRIVER: 'memory' }); // in the app: getConfig()
const appService = new GameService({
  state: new GameStateManager(createObjectStore(config)),
  defaultPresetId: config.defaultRulesPreset,
});
```

In tests, inject a fixed clock, and scripted bytes whenever an id, seed or token must be known in advance. `randomBytes` is called exactly three times per `createGame`, in this order: 16 bytes (game id), 32 (seed), 32 (seat token).

```ts
import { GameService } from '@/src/service/game-service';
import { GameStateManager } from '@/src/state/game-state-manager';
import { MemoryObjectStore } from '@/src/storage/memory-store';

const state = new GameStateManager(new MemoryObjectStore());
const service = new GameService({
  state,
  now: () => new Date('2026-11-23T14:05:00.000Z'), // every createdAt and `at` is this instant
});

const fixed = new GameService({
  state: new GameStateManager(new MemoryObjectStore()),
  randomBytes: (n) => new Uint8Array(n), // all zero bytes
});
const zero = await fixed.createGame({ humanName: 'Ana', aiCount: 2 });
// zero.gameId === 'aaaaaaaaaaaaaaaaaaaaaaaaaa'; the seed is 64 '0's; the token is 43 'A's
```

### 15.3 Creating a game

```ts
createGame(req: { rulesPreset?: string; humanName: string; aiCount: number }): Promise<CreateGameResult>
// CreateGameResult = { gameId: string; seat: number; seatToken: string; update: PlayerUpdate }
```

**Inputs.** Checked before any I/O, in this order; the first failure rejects with `InvalidRequest` whose `reason` names the field:

| Check | `reason` |
|---|---|
| `humanName` is a string of 1–40 characters after `trim()` (UTF-16 code units). The trimmed value becomes the seat's name. | `humanName` |
| `aiCount` is an integer from 2 to 5 (`'3'`, `2.5` and `NaN` fail). | `aiCount` |
| `rulesPreset`, when present, is a string naming a known preset. When absent, `defaultPresetId` is used. | `rulesPreset` |
| `aiCount + 1` is within the preset's `players.min … max`. | `aiCount` |

With today's presets every `aiCount` from 2 to 5 is valid for every preset; the last check protects future presets.

**Seats.** Seat 0 is `{ playerId: 'human-0', name: <trimmed humanName>, kind: 'human' }`, then seat `i` (1 … `aiCount`) is `{ playerId: 'ai-<i>', name: 'AI <i>', kind: 'ai', strategy: 'random' }`. There is always exactly one human, at seat 0.

**Ids and secrets.** From `randomBytes`, in order:

| Value | Bytes | Encoding | Example shape |
|---|---|---|---|
| `gameId` | 16 | lowercase base32, no padding (26 characters, `^[a-z2-7]{26}$`) | `aaaqeayeaudaocajbifqydiob4` (bytes `0x00…0x0f`) |
| `seed` | 32 | lowercase hex (64 characters) | stored in the state, never returned |
| `seatToken` | 32 | base64url, no padding (43 characters) | returned once |

The service stores only the token's SHA-256 (64 lowercase hex characters) in `meta.seatTokenHashes[0]`; AI seats get `null`. The token itself is in `createGame`'s result and nowhere else: not in storage, not in any later response, not in any error. The caller must hand it to the player once (the API returns it in the create response and the browser keeps it) and must never log it. It never accepts a seed, id or token from the caller.

**What is written.** Engine `createGame`, then `runAiLoop`, because the first bidders may be AIs. Commit 0 holds the engine's creation events followed by the AIs' moves, the state where the human must act (or the game is over), and its scoreboard. The meta records the preset id, `engineVersion: ENGINE_VERSION`, the seats and the token hashes; `createdAt` and commit 0's `at` are the same `now()` instant. Both go out in one `state.create` (4 store writes, no reads). The returned `update` is commit 0 for seat 0, with commit 0's events.

Every error from the engine, the AI loop or `state.create` propagates unchanged and nothing else is written. `GameExistsError` would mean two games drew the same 128-bit id, i.e. a bug in the byte source.

### 15.4 Authentication

`getUpdate` and `submitMove` start the same way:

1. **Before any I/O**, first failure wins: a `gameId` that is not 26 lowercase base32 characters → `GameNotFound` (an invalid id names no game); a `seatToken` that is not a non-empty string → `Unauthorized`; then the method's own arguments → `InvalidRequest`.
2. **Load** `meta.json` and the tip commit **in parallel**. A state `GameNotFoundError` from either → `GameNotFound`. Other errors propagate.
3. **Find the seat.** The token's SHA-256 digest is compared with `timingSafeEqual` against **every** non-null entry of `meta.seatTokenHashes`, with no early exit, so the time taken does not reveal which seat matched or whether any did. The matching index is the seat; no match → `Unauthorized`. A game with several human seats works the same way.
4. **Engine version.** `meta.engineVersion !== ENGINE_VERSION` → `GameUnsupported { gameId, engineVersion }`. The check runs after authentication, so only a seat of that game learns it. Nothing is applied or written.

`game-service.ts` imports `createHash`, `randomBytes` and `timingSafeEqual` by name from `node:crypto` (never `import * as` or a default import), so a test can replace one of them with a partial module mock (§15.10).

### 15.5 Getting an update

```ts
getUpdate(gameId: string, seatToken: string, sinceVersion?: number): Promise<PlayerUpdate>
```

Resolves to the tip's `PlayerUpdate` for the authenticated seat. `sinceVersion` decides `events`:

| `sinceVersion` | `events` |
|---|---|
| absent | `[]` (a reload: the client just renders the view) |
| an integer from 0 to `MAX_COMMIT_VERSION` | the events of commits `sinceVersion + 1 … update.version`, in order; `[]` when `sinceVersion` ≥ the tip |
| anything else (`-1`, `1.5`, `'0'`) | `InvalidRequest { reason: 'sinceVersion' }`, before any I/O |

**Missed events end exactly at `update.version`.** The service reads commits `sinceVersion + 1 … tip − 1` with `state.load` (at most 8 at a time) and appends the tip's own events from the commit it already loaded. It never uses `state.eventsSince`, which finds the tip again and could include a commit that landed in the meantime, so events and view always describe the same version. A commit missing inside the range (deleted meanwhile) propagates as `CommitNotFoundError`.

Store calls with `head.json` exact: 6 without `sinceVersion` (1 meta read + 5 for `loadLatest`, the first 4 in flight together), plus 2 for each commit strictly between `sinceVersion` and the tip.

### 15.6 Submitting a move

```ts
submitMove(gameId: string, seatToken: string, req: { version: number; moveId: string; clientRequestId: string }): Promise<PlayerUpdate>
```

- `version` is the version the player saw: an integer from 0 to `MAX_COMMIT_VERSION − 1` (`reason: 'version'`).
- `moveId` is one of that version's `legalMoves[].id`: a string of 1–32 characters (`reason: 'moveId'`).
- `clientRequestId` identifies the attempt: a string of 1–128 characters (`reason: 'clientRequestId'`). The client makes a new one for every move and **reuses it when it resends the same move** (for example after a timeout).

The flow, after validation and authentication (§15.4), with tip `t`:

1. **`req.version` is not `t.version`: retry check.** If `req.version < t.version`, load commit `req.version + 1`. If its `clientRequestId` equals the request's **and** its `actorSeat` is this seat, this request already committed: resolve to that commit's update for this seat, with that commit's events, and write nothing. Later commits do not matter. Otherwise, or when `req.version` is ahead of the tip, reject with `VersionConflict`, whose `update` is the tip for this seat with the events since `req.version`.
2. **Apply** the human's move with `applyMove`. Another seat to act → `NotYourTurn { seat }`. A finished game → `IllegalMove { reason: 'game-over' }`; a move id that is not legal now → `IllegalMove { reason: 'unknown-move' }`.
3. **AI loop:** `runAiLoop(state, createPlayers(state.seats))`. Players, rules and hand plan come from the stored state, never from the preset registry. `AiLoopLimitError` and any error from inside the loop propagate, and nothing is written.
4. **Commit** `req.version + 1` with `state.commit`: `actorSeat` = the seat, the request's `clientRequestId`, `events` = the human move's events then the AIs', `state.version` = the new version and `scoreboard = evaluate(state)`.
5. **Lost race.** `CommitConflictError` means another request committed `req.version + 1` first. The service loads that commit: if it holds this same request from this seat (two copies raced), resolve to its update with its events. Otherwise, including when it cannot be found, reload the tip with `loadLatest` (a game gone by then → `GameNotFound`) and reject with `VersionConflict` carrying that tip and the events since `req.version`. The winner exists, so this tip is at least `req.version + 1` even while `head.json` still names `req.version`. Any other error from `commit` propagates.
6. **Final scores.** When the committed state is `game-over`, await `state.writeFinalScores` (best-effort: it never rejects). A matched retry (step 1 or 5) does not write it again.
7. **Resolve** to the committed update for this seat, with the commit's events. `view.finalRanking` is present only at game over.

A whole session, continuing the example in §15.2:

```ts
import { VersionConflict } from '@/src/service/errors';

const created = await service.createGame({ humanName: '  Ana ', aiCount: 3 });
const { gameId, seatToken } = created; // keep seatToken secret; the player sends it back on every request
// created.update: version 0, the seat-0 view (name 'Ana'), the legal moves, commit 0's events

const req = {
  version: created.update.version,
  moveId: created.update.legalMoves[0].id,
  clientRequestId: 'move-1',
};
const after = await service.submitMove(gameId, seatToken, req);
// after.version === 1; after.events: the human's move, then every AI move up to the human's next turn

const again = await service.submitMove(gameId, seatToken, req);
// the same request resent (a lost response): deep-equals `after`, nothing written

let latest = after;
try {
  await service.submitMove(gameId, seatToken, { ...req, clientRequestId: 'move-1b' });
} catch (error) {
  if (!(error instanceof VersionConflict)) throw error;
  latest = error.update; // version 1 with the events since version 0: show them, then let the player choose again
}

const reload = await service.getUpdate(gameId, seatToken); // version 1, events []
const catchUp = await service.getUpdate(gameId, seatToken, 0); // version 1, the events of commit 1
```

**Store calls** with `head.json` exact: a successful move is **8** (1 meta read and the 5 calls of `loadLatest`, the first 4 in flight together, then 1 commit `put` and 1 `head.json` `put`), plus 1 `put` for `final.json` on the move that ends the game. A stale-version `VersionConflict` is 8 + 2 for each commit strictly between `req.version` and the tip (6 to load, 2 for the retry-check read of commit `req.version + 1`, then the missed commits). Validation failures make no call at all.

### 15.7 Errors

Each service error extends `Error`, sets `name` to its class name and exposes only the fields below. The HTTP column is what the API answers (one mapping function in the route layer, §16.3; [`architecture.md`](./architecture.md) §7 and §10):

| Error (fields) | When | HTTP | What the client does |
|---|---|---|---|
| `InvalidRequest` (`reason`: `humanName`, `aiCount`, `rulesPreset`, `sinceVersion`, `version`, `moveId` or `clientRequestId`) | An argument fails its check (§15.3–§15.6), before any I/O. | 400 `invalid_request` | Fix the request. With the API's own schema checks in front, this means a client bug. |
| `Unauthorized` | The token is empty or matches no seat of the game. | 401 `unauthorized` | The stored token is wrong or lost: the game cannot be resumed from this browser; offer a new game. |
| `GameNotFound` (`gameId`, the caller's input clipped to 64 characters) | Malformed id, or `meta.json` / commit 0 missing (never created, or deleted by retention). | 404 `game_not_found` | Forget the stored id and token; offer a new game. |
| `GameUnsupported` (`gameId`, `engineVersion`) | The game was stored by another `ENGINE_VERSION` (after an engine upgrade). | 410 `game_unsupported` | The game cannot continue; offer a new game. |
| `NotYourTurn` (`seat`) | Valid seat, but another seat must act. | 403 `not_your_turn` | Fetch the current update and wait. |
| `IllegalMove` (`moveId`, `reason`: `game-over` \| `unknown-move`) | The move is not legal in the current state. | 422 `illegal_move` | Fetch the current update and choose from its `legalMoves`. |
| `VersionConflict` (`update`) | Stale or future `version`, or a lost race, and the committed move is not this request. | 409 `version_conflict`, with `update` in the body | Play `update.events`, show `update.view`, and let the player choose again at `update.version`. Do not resend the old request. |
| anything else | Engine, state or storage errors; `AiLoopLimitError`; `GameExistsError`. | 500 `internal` | Retry later. Resending a move with the same `clientRequestId` is always safe. |

Messages are fixed text plus at most those fields: `Invalid request: moveId`, `Unauthorized`, `Game not found: <id>`, `Game <id> was created with engine version <n>, which this server does not support`, `Not your turn (seat 0)`, `Illegal move "bid:99": unknown-move`, `Version conflict: the game is at version 7`.

A sketch of the mapping; the real one is `toErrorResponse` in `app/api/_lib/errors.ts` (§16.3), which also maps the state layer's "not found" errors to 404 and the API's own request errors:

```ts
import {
  GameNotFound,
  GameUnsupported,
  IllegalMove,
  InvalidRequest,
  NotYourTurn,
  Unauthorized,
  VersionConflict,
} from '@/src/service/errors';

function toHttpStatus(error: unknown): { status: number; code: string } {
  if (error instanceof InvalidRequest) return { status: 400, code: 'invalid_request' };
  if (error instanceof Unauthorized) return { status: 401, code: 'unauthorized' };
  if (error instanceof NotYourTurn) return { status: 403, code: 'not_your_turn' };
  if (error instanceof GameNotFound) return { status: 404, code: 'game_not_found' };
  if (error instanceof VersionConflict) return { status: 409, code: 'version_conflict' };
  if (error instanceof GameUnsupported) return { status: 410, code: 'game_unsupported' };
  if (error instanceof IllegalMove) return { status: 422, code: 'illegal_move' };
  return { status: 500, code: 'internal' }; // log it; never serialize it
}
```

### 15.8 Secrets: what must never be serialized

The game's hidden information is the **seed**, the **seat token** and its stored **hash**, **other seats' hands** and the **stock**, and the AI decision counter **`aiDecisionCount`**. The service keeps them out of everything it returns:

- Every `PlayerUpdate` comes from `buildPlayerView` and `legalMoves` for the requesting seat (§12), including the one inside `VersionConflict`. The only card of another seat that can appear is the dealer's publicly shown trump card ([`design.md`](./design.md) §4.5); events carry cards only in `card-played.card` and `hand-dealt.trumpCard`.
- The seven service errors carry only the fields in §15.7. `GameNotFound` and `IllegalMove` echo the caller's own input, clipped to 64 and 32 characters.
- The seat token appears only in `createGame`'s result.

**Any other error is server-only.** `AiLoopLimitError.state` is the full `GameState` (every hand and the seed); engine, state and storage errors may name keys or internal values. The API logs them and answers `500 internal`, never putting them, their message or their fields in a response. Request logs never include a seat token or a hand ([`architecture.md`](./architecture.md) §10; §16.6).

### 15.9 Replay

```ts
replayGame(meta: GameMeta, commits: readonly Commit[]): GameState[]
```

Rebuilds a stored game from its seed and move events, with no players and no AI loop, the way [`design.md`](./design.md) §7 describes. It is pure and synchronous.

- **Guards, in order:** `commits` must be non-empty with `commits[i].version === i` (else `RangeError`, message starting `Invalid commits:`); then `meta.engineVersion` must equal `ENGINE_VERSION` (else `GameUnsupported`). No engine call happens before both pass.
- **Replay:** engine `createGame` with `meta.gameId`, `meta.seats`, and the rules and seed stored in commit 0's state; its own events are skipped (commit 0 already holds them). Then, commit by commit, every `bid-made` event is applied as `bid:<tricks>` and every `card-played` as `play:<cardId>` by its seat. An `IllegalMoveError` (a tampered or corrupt log) propagates.
- **Result:** one state per commit, with `version` set to that commit's version. For an untampered game each equals the stored `state`, `aiDecisionCount` included, and `evaluate` of each equals the stored `scoreboard`.

Use it to debug a stored game or to check a log, continuing the session above:

```ts
import { replayGame } from '@/src/service/replay';

const tip = await state.loadLatest(gameId);
const commits = await Promise.all(
  Array.from({ length: tip.version + 1 }, (_, v) => state.load(gameId, v)),
);
const states = replayGame(await state.loadMeta(gameId), commits);
// states[v] deep-equals commits[v].state for every v
```

### 15.10 Service tests

Unit tests live in `tests/unit/service/` and run with `pnpm test`. All of them use `MemoryObjectStore`, a fixed clock and, where an id must be known, scripted bytes; none touches a real store. The whole folder takes about a second locally.

| File | Protects |
|---|---|
| `errors.test.ts` | Each error's `name`, fields and exact message; `GameNotFound` clips to 64 characters. |
| `replay.test.ts` | Replay of chains built without the service equals every stored state and scoreboard; the guards and their order; a tampered `card-played` → `IllegalMoveError`. |
| `create.test.ts` | Construction makes no call; default and configured preset; every invalid input with its `reason` and 0 calls; boundaries; 100 real games' id, seed, token formats and hash; the known base32 literal; meta and commit 0 contents; AI bids in commit 0; the returned update. |
| `create-preset-mock.test.ts` | (mocks `getPreset`) the player-range check with a narrow preset; a game in progress keeps its stored rules and hand plan after the registry changes. |
| `auth.test.ts` | Input-check order; unknown and half-deleted games; storage errors propagate; wrong and foreign tokens; `GameUnsupported`. |
| `auth-crypto.test.ts` | (mocks `node:crypto`) `timingSafeEqual` is called once per human seat on both match and mismatch. |
| `get-update.test.ts` | `sinceVersion` cases; events end at `update.version` even when a commit lands mid-request; call counts; 4 calls in flight in the first round. |
| `submit.test.ts` | Input checks; `NotYourTurn`, `IllegalMove`; stale and future versions; retries after a lost response and after later commits; a matching id from another seat is a conflict; at most one commit `put` per call. |
| `concurrency.test.ts` | Real races: different moves (one wins, one 409), the same request (both resolve equal), a failing `head.json` write, a phantom conflict, a generic `put` error. |
| `full-game.test.ts` | A full game through `submitMove` to game over: versions, events, `finalRanking` only at the end, `final.json`, a failing `final.json` write, and replay of the stored game. |
| `ai-loop-mock.test.ts` | (mocks `runAiLoop`) `AiLoopLimitError` on create and on a move writes nothing; an id collision → `GameExistsError`. |
| `secrets.test.ts` | Over a full game, the rejections and the conflicts: no other seat's card, seed, token hash or `aiDecisionCount` in any update or service error; the token only in `createGame`'s result. |
| `io-budget.test.ts` | Store-call counts for a move, the final move, a stale 409 and `createGame`; 4 calls in flight in the first round. |
| `player-view.test.ts`, `ai-loop.test.ts` | The two helpers (§12.7). |

**Test support** lives in `tests/unit/service/support/` (not collected as tests):

- `service-fixtures.ts`: `FIXED_NOW`; `makeService(store?, overrides?)` → `{ service, state, store }`, by default over a `RecordingStore` around a fresh `MemoryObjectStore`, with `now = () => FIXED_NOW` and real randomness; `scriptedBytes(seq)` (the k-th call returns `seq[k]`, and throws on a length mismatch or when exhausted); `byteRange(start, n)`; `firstLegalMoveId(update)`; `playToEnd(service, created)` (the human always plays its first legal move; returns every response); `sha256Hex(text)`; `storeHandmadeGame(state, { gameId, seats, tokens, seed, runLoop? })` for games `createGame` cannot make: several human seats, or an AI to act at the tip (`runLoop: false`).
- `gated-store.ts`: `GatedStore(inner)`, an `ObjectStore` that starts **closed** and holds every call until `release()`; `pending` counts held calls, `whenPending(n)` and `settle()` wait for calls to arrive. `barrierOnCommitPut(n)` instead opens the gate and holds only create-only commit `put`s until `n` are waiting, then lets them go together, so two racing requests both load the same tip before either commits.
- `replay-fixtures.ts`: `buildStoredChain(opts)`, a stored human-plus-AI game built with the engine and the AI loop only, to test replay independently of the service.
- From the state tests: `RecordingStore` and `StoreHooks` (`tests/unit/state/support/store-wrappers.ts`, §14.11) record calls and replace them with hooks. Import them; do not copy them.

A race between two different moves, as in `concurrency.test.ts`:

```ts
import { expect } from 'vitest';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { RecordingStore } from '../state/support/store-wrappers';
import { GatedStore } from './support/gated-store';
import { firstLegalMoveId, makeService } from './support/service-fixtures';

const memory = new MemoryObjectStore(); // build the game on the plain store: a closed GatedStore would hang
const setup = makeService(memory).service;
const game = await setup.createGame({ humanName: 'Ana', aiCount: 3 });
let view = game.update;
while (view.legalMoves.length < 2) {
  // a race of different moves needs two legal moves
  view = await setup.submitMove(game.gameId, game.seatToken, {
    version: view.version,
    moveId: firstLegalMoveId(view),
    clientRequestId: `setup-${view.version + 1}`,
  });
}

const gated = new GatedStore(new RecordingStore(memory));
gated.barrierOnCommitPut(2);
const racer = makeService(gated).service;
const outcomes = await Promise.allSettled(
  [0, 1].map((i) =>
    racer.submitMove(game.gameId, game.seatToken, {
      version: view.version,
      moveId: view.legalMoves[i].id,
      clientRequestId: `race-${i}`,
    }),
  ),
);
expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']); // the loser got VersionConflict
```

**Replacing a module function.** Use a partial module mock that delegates to the original, never `vi.spyOn` on an ES module namespace (it cannot redefine the export). `vi.mock` is hoisted to the top of its file and applies to the whole file, so give each mocked module **its own test file**, as `create-preset-mock.test.ts`, `auth-crypto.test.ts` and `ai-loop-mock.test.ts` do:

```ts
import { afterEach, vi } from 'vitest';
import * as aiLoop from '@/src/service/ai-loop';
import { AiLoopLimitError } from '@/src/service/ai-loop';

vi.mock('@/src/service/ai-loop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/service/ai-loop')>();
  return { ...actual, runAiLoop: vi.fn(actual.runAiLoop) };
});
const runAiLoopMock = vi.mocked(aiLoop.runAiLoop);
afterEach(() => runAiLoopMock.mockClear());

// Only the next call fails; later calls run the real loop.
runAiLoopMock.mockImplementationOnce((loopState) => {
  throw new AiLoopLimitError(1000, loopState);
});
```

The mock works because `game-service.ts` imports `runAiLoop` from `./ai-loop`, which resolves to the same module as `@/src/service/ai-loop`. Setup calls count too: `mockClear()` after building the game when a test counts calls.

### 15.11 Gotchas and limitations

- **One human per game from `createGame`, and only the `random` AI.** Authentication and the retry check already handle several human seats (tests build such games with `storeHandmadeGame`), so multi-user games ([`architecture.md`](./architecture.md) §12) need no change here.
- **The API validates first.** The service's input checks (§15.3–§15.6) are a second line of defence: the API checks request shapes with its own strict schemas, reads the token from the `Authorization` header, and rejects any `seed` field (§16.2).
- **A configured default preset that does not exist is a server error**, not `InvalidRequest`: `getPreset`'s `UnknownPresetError` propagates, because the caller did not choose it. (The configuration schema only allows known presets, §5.) A `rulesPreset` that is present but not a string is `InvalidRequest` without a registry lookup.
- **Name and id lengths count UTF-16 code units**, so an emoji counts as two characters toward the 40-character `humanName` limit.
- **External deletes in the middle of a request.** Only retention deletes, and only year-old games. If it happens anyway, the retry-check read in step 1 and the race re-read in step 5 propagate the state error (`CommitNotFoundError` or `GameNotFoundError`, so a 500), except that the race path's `loadLatest` answers `GameNotFound`.
- **Two identical copies of one request usually never reach the race path.** With the same clock and the same request, both write byte-identical commits, and the state layer counts an identical write as success (§14.7), so both resolve with the same result. The race-path match (step 5) handles copies whose bytes differ, for example because their `at` timestamps differ. Tests reach it with two services with different clocks.
- **`head.json` failing still needs the barrier in tests.** To test a race while `head.json` names the old version, keep `barrierOnCommitPut(2)`; without it the loser's `loadLatest` probes past the stale hint, sees the new tip and takes the stale-version path instead of the race path.
- **A move with only one legal choice cannot race against a different move.** The first hands often leave the human a single legal bid; advance the game until there are two, as the race example does.
- **`final.json` is written once, by the request that committed the last move.** If that write fails it stays missing (a matched retry does not write it); readers fall back to the terminal commit ([`design.md`](./design.md) §6.3).
- **An `ENGINE_VERSION` bump abandons games in progress.** They answer `GameUnsupported` until retention deletes them ([`architecture.md`](./architecture.md) §6.4).
- **`getUpdate` with an old `sinceVersion` reads one commit per missed version** (2 store calls each, 8 at a time). A client that has been away for a whole game should reload without `sinceVersion` instead.
- **No rate limiting** and no request logging in the service. The API logs every request (§16.6); there is no rate limiting anywhere yet.

---

## 16. HTTP API

`app/api` is the HTTP entry to `GameService` (§15): four Next.js Route Handlers that read a request, call one service method and write JSON. The contract (routes, request rules, status codes, error bodies) is in [`architecture.md`](./architecture.md) §7 and the log lines in §10; this section is about calling, testing and changing the code.

Three rules shape it:

- **Handlers are thin.** A handler parses the request, calls one service method (none for presets) and serializes the result. Game rules, authentication against stored hashes, retries and conflicts all live in the service. Handlers and route files import nothing from `src/state`, `src/storage` or `src/engine`; the one exception is the service factory, which has to wire the store. A static test (`tests/api/structure.test.ts`) fails the build if that changes.
- **One error mapping.** `toErrorResponse` in `errors.ts` is the only code that turns an error into a status. Handlers throw (`RequestError` for their own checks, or let a service error propagate) and never write an error status. The same structure test rejects **any** number from 400 to 599 in `handlers.ts` and the four `route.ts` files, comments included, so a status cannot slip in as a constant.
- **Everything the handler touches comes in through `deps`.** The service, the configuration, the clock and the log sink are injected, so tests call the handler functions directly, with no server and no network.

### 16.1 Routes

| Method & path | Auth | Request body | Success |
|---|---|---|---|
| `POST /api/games` | – | `{ humanName, aiCount, rulesPreset? }` | 201 `{ gameId, seat, seatToken, update }` |
| `GET /api/games/{id}[?since=v]` | `Authorization: Bearer <seatToken>` | – | 200 `PlayerUpdate` |
| `POST /api/games/{id}/moves` | `Authorization: Bearer <seatToken>` | `{ version, moveId, clientRequestId }` | 200 `PlayerUpdate` |
| `GET /api/presets` | – | – | 200 `{ defaultPresetId, presets: [{ id, name, description, players: { min, max }, deck }] }` |

`seatToken` is returned once, in the 201, and must be kept by the client: it is never shown again and cannot be recovered (only its hash is stored). The human is always seat 0.

How a client uses them:

- **Start:** `GET /api/presets` for the new-game form, then `POST /api/games`. Render `update.view`, play `update.events` (the AIs may already have bid), and offer `update.legalMoves`.
- **Move:** send `{ version: <the version shown>, moveId: <one of legalMoves[].id>, clientRequestId: <new per action> }`. The response's `events` are the human's move followed by every AI move up to the human's next turn. On a network failure, resend the **same** body: the same `clientRequestId` answers 200 with the original response and never applies the move twice.
- **409:** the body's `update` is the current state with the events since the sent `version`. Adopt it and let the player choose again; do not resend the old request.
- **Reload:** `GET /api/games/{id}` (no `since`) gives the current view with `events: []`. To catch up from version `v`, use `?since=v`. Do not poll with `?since=0`: it re-reads every commit of the game.
- **Game over:** `view.phase` is `game-over`, `view.finalRanking` is present, `legalMoves` is `[]`, `view.trumpCard` is `null` and `view.yourHand` is `[]`. Any further move answers 422.

### 16.2 Request rules and errors

Checks run in this order and the first failure wins; nothing reaches the service or storage until all of them pass.

| Step | Routes | Rule | Failure |
|---|---|---|---|
| 1 | `{id}` routes | id is 26 characters of lowercase base32 (`^[a-z2-7]{26}$`) | 404 `game_not_found` |
| 2 | `{id}` routes | `Authorization` matches `^Bearer ([A-Za-z0-9_-]{1,256})$` (scheme case-insensitive, one space) | 401 `unauthorized` |
| 3a | POSTs | `Content-Type` media type is `application/json` (any case, parameters allowed) | 400 `Invalid request: body` |
| 3b | POSTs | body ≤ 16,384 raw bytes | 413 `payload_too_large` |
| 3c | POSTs | valid UTF-8 JSON whose value is an object | 400 `Invalid request: body` |
| 3d | POSTs | strict schema: no unknown field, limits below | 400 `Invalid request: <field>` |
| 3 | `GET /api/games/{id}` | `since` absent, or once, canonical decimal, ≤ `MAX_COMMIT_VERSION` | 400 `Invalid request: since` |
| after the call | `GET /api/games/{id}` | `since` ≤ the returned version | 400 `Invalid request: since` |

Body limits: `humanName` 1–40 characters after `trim()` (the untrimmed string goes to the service, which trims it); `aiCount` an integer 2–5; `rulesPreset` one of the four preset ids; `version` an integer from 0 to `MAX_COMMIT_VERSION − 1`; `moveId` 1–32 characters; `clientRequestId` 1–128 characters. They are the service's own limits; the service checks them again (§15.3–§15.6).

Why the rules look the way they do:

- **Strict schemas reject unknown fields** so a client can never send a `seed` (or a typo) that the server silently ignores. When a body has several problems, the field named is the first one Zod reports.
- **The size cap counts bytes, not `Content-Length` or characters**: the header can lie, and a multi-byte UTF-8 string has fewer characters than bytes. Invalid UTF-8 is rejected, never replaced with `U+FFFD`.
- **`since` must be canonical** (`0`, `7`, never `07`, `1e3`, ` 7` or `since=1&since=2`), so one version has exactly one spelling and a repeated parameter is not silently resolved.
- **The id check comes before auth**, so a malformed id answers 404 with no storage read; **auth comes before the body**, so an anonymous caller learns nothing about body validation.

Errors, and what a client should do:

| Status | `code` | Client action |
|---|---|---|
| 400 | `invalid_request` | Client bug: fix the request. |
| 401 | `unauthorized` | The stored token is wrong or lost; the game cannot be resumed from here. Offer a new game. |
| 403 | `not_your_turn` | Fetch the current update and wait. |
| 404 | `game_not_found` | Forget the stored id and token; offer a new game. Also returned for a game partly deleted by retention. |
| 409 | `version_conflict` | Adopt `update` from the body (§16.1). |
| 410 | `game_unsupported` | The game was stored by an older engine version and cannot continue; offer a new game. |
| 413 | `payload_too_large` | Client bug. |
| 422 | `illegal_move` | Fetch the current update and choose from its `legalMoves`. |
| 500 | `internal` | Retry later. Resending a move with the same `clientRequestId` is always safe. |

The body is `{ error: { code, message } }` (plus `update` on 409) with the fixed messages listed in [`architecture.md`](./architecture.md) §7. Every response has `Content-Type: application/json` and `Cache-Control: no-store`.

### 16.3 Module map

Shared code lives in `app/api/_lib/` (Next.js does not route folders starting with `_`). There is no barrel file.

| Module | Exports | What it does |
|---|---|---|
| `errors.ts` | `ERROR_CODES`, `ERROR_MESSAGES`, `RequestError`, `toErrorResponse`, type `ErrorBody` | The one error → status mapping. `RequestError(status, code, field?)` is what the HTTP checks throw. Matching is by `instanceof`, never by `name` (any error can set a name). |
| `http.ts` | `jsonResponse(status, body)` | Builds every response with the two headers. `Response.json` is not used because it does not set `Cache-Control`. |
| `body.ts` | `MAX_BODY_BYTES`, `readJsonBody(request)` | Steps 3a–3c. |
| `auth.ts` | `parseBearer(headers)`, `assertGameIdFormat(id)` | Steps 1 and 2. |
| `schemas.ts` | `CreateGameBodySchema`, `SubmitMoveBodySchema`, `parseBody`, `parseSince`; `PlayerUpdateResponseSchema`, `CreateGameResponseSchema`, `ErrorResponseSchema`, `PresetsResponseSchema` | Request schemas and parsers (step 3d, `since`), and strict response schemas (§16.7). |
| `presets.ts` | `PRESET_LABELS` | Name and one-sentence description per preset. It is a `Record` over `PresetId`, so adding a preset fails typecheck until it has a label. |
| `log.ts` | `withRequestLog`, `consoleLog`, types `LogSink`, `LogLevel`, `RouteResult`, `RequestLogMeta` | Runs a handler body, maps a throw, writes the log lines (§16.6). |
| `service-factory.ts` | `getService()` | The config-wired, memoised `GameService` (§16.5). |
| `default-deps.ts` | `defaultDeps` | The production `HandlerDeps`. |
| `handlers.ts` | `HandlerDeps`, `GameRouteContext`, `createGameHandler`, `getGameHandler`, `submitMoveHandler`, `presetsHandler` | The route logic. |

`errors.ts` and `schemas.ts` may import from `src/state` (the "not found" errors, `MAX_COMMIT_VERSION`, `ScoreBoardSchema`); `handlers.ts` and the route files may not, which is why the post-call `since` check is written as a schema (`parseBody` with `since` at most the returned version) instead of a status in the handler.

### 16.4 Handlers, deps and route files

```ts
interface HandlerDeps {
  getService: () => GameService;   // production: the memoised factory
  getConfig: () => Config;         // production: getConfig()
  now: () => number;               // milliseconds, for durationMs; production: performance.now()
  log: (level: 'info' | 'error', line: Record<string, unknown>) => void; // production: console
}
createGameHandler(req: Request, deps: HandlerDeps): Promise<Response>
presetsHandler(req: Request, deps: HandlerDeps): Promise<Response>
getGameHandler(req: Request, ctx: { params: Promise<{ id: string }> }, deps: HandlerDeps): Promise<Response>
submitMoveHandler(req: Request, ctx: { params: Promise<{ id: string }> }, deps: HandlerDeps): Promise<Response>
```

Each handler body runs inside `withRequestLog(route, deps, async (meta) => …)`. It returns `{ status, body, update? }` or throws; the wrapper maps a throw with `toErrorResponse`, writes the log lines and builds the response with `jsonResponse`. The `{id}` handlers set `meta.gameId` once the id format passes and `meta.fromVersion` once `version` or `since` is parsed, so a request that fails later still logs them. `deps.getService()` is called only after every check has passed.

Each `route.ts` is two imports and one export binding a handler to `defaultDeps`:

```ts
// app/api/games/[id]/route.ts
import { defaultDeps } from '@/app/api/_lib/default-deps';
import { getGameHandler } from '@/app/api/_lib/handlers';

export const GET = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  getGameHandler(req, ctx, defaultDeps);
```

Route files export only `GET`/`POST`: Next.js treats other exports as route configuration, and tests check the export keys. In Next.js 16 `params` is a `Promise`, so handlers `await ctx.params`; `next typegen` (part of `pnpm typecheck`) checks the route signatures. `pnpm build` lists all four routes as dynamic (`ƒ`).

**Adding a route:** write the handler in `handlers.ts` inside `withRequestLog` with its route pattern string, throw `RequestError` for its own checks, add strict request and response schemas in `schemas.ts`, add a two-line `route.ts`, and add it to the file list in `tests/api/structure.test.ts`. If it needs a new error, add the code to `ERROR_CODES`/`ERROR_MESSAGES` and the mapping to `toErrorResponse`.

### 16.5 Service factory and environment

`getService()` builds `getConfig()` → `createObjectStore(config)` → `new GameStateManager(store)` → `new GameService({ state, defaultPresetId: config.defaultRulesPreset })` on its first successful call and returns the same instance afterwards (one per function instance). It is built lazily, on the first request, not at module load: a bad environment at import time would break `next build` and every route, including presets. A failure (a `ConfigError`, or `STORAGE_DRIVER=blob` without credentials) is thrown to the handler, answered 500 and logged, and **not cached**, so the next request tries again after the environment is fixed.

The API reads the variables of §5. The ones that matter here: `STORAGE_DRIVER` and `FILE_STORE_DIR` (where games go; `pnpm dev` writes to `.data/` by default), `DEFAULT_RULES_PRESET` (used when `rulesPreset` is absent, and reported as `defaultPresetId`) and `LOG_LEVEL`.

### 16.6 Logging

Every request writes one `info` line through `deps.log`; a 500 also writes one `error` line. The fields, the level gating and what is never logged are in [`architecture.md`](./architecture.md) §10. A request line from `pnpm dev`:

```json
{"route":"POST /api/games/[id]/moves","gameId":"y25ib7awa7366qtges4nxynumm","seat":0,"fromVersion":0,"toVersion":200,"aiMoves":600,"status":409,"durationMs":29,"errorCode":"version_conflict"}
```

Points that are easy to break:

- `seat`, `toVersion` and `aiMoves` describe the update in the response: they are set on 200, 201 and 409 and `null` otherwise (403, 410 and 422 carry no update).
- A path id is logged only after it passes the format check; a malformed one is logged as `null`, so attacker-chosen text of any length never reaches the logs.
- The error line takes only `name`, `message` (clipped to 500 characters) and `stack` from the thrown value. Do not add other properties: `AiLoopLimitError.state` is the full game state, every hand and the seed included.
- Never log a request or response body, a header or the token.

### 16.7 Response schemas

`schemas.ts` holds strict Zod schemas for every response body: `PlayerUpdateResponseSchema`, `CreateGameResponseSchema`, `ErrorResponseSchema` (with the optional `update` of a 409) and `PresetsResponseSchema`. Every object level is strict, so a field added to the view by accident (`seed`, `hands`, `stock`) fails the tests. A compile-time check asserts that `z.infer<typeof PlayerUpdateResponseSchema>` equals the domain `PlayerUpdate`, so `pnpm typecheck` fails if the two drift apart.

They are a **test-time contract**: handlers never parse their own responses, so a schema mismatch is a failing test, not a production 500, and costs nothing per request. Every API test parses the bodies it receives with them.

### 16.8 Writing an API test

API tests live in `tests/api/` and run with `pnpm test`. They call the handler functions with deps from `makeApi` and never start a server or touch a real store.

```ts
import { expect, it } from 'vitest';
import { getGameHandler, submitMoveHandler } from '@/app/api/_lib/handlers';
import { PlayerUpdateResponseSchema } from '@/app/api/_lib/schemas';
import { bearer, createGameVia, ctx, getReq, makeApi, postJson, readJson } from './support/api-fixtures';

it('plays one move and catches up with since', async () => {
  const api = makeApi(); // GameService over a RecordingStore(MemoryObjectStore), fake clock, captured logs
  const { gameId, seatToken, update } = await createGameVia(api); // asserts the 201 and its schema

  const res = await submitMoveHandler(
    postJson(
      `/api/games/${gameId}/moves`,
      { version: update.version, moveId: update.legalMoves[0].id, clientRequestId: 'c-1' },
      { headers: bearer(seatToken) },
    ),
    ctx(gameId),
    api.deps,
  );
  expect(res.status).toBe(200);
  const after = PlayerUpdateResponseSchema.parse(await readJson(res));

  const get = await getGameHandler(getReq(`/api/games/${gameId}?since=0`, bearer(seatToken)), ctx(gameId), api.deps);
  expect((await readJson<{ version: number }>(get)).version).toBe(after.version);
  expect(api.logs.filter((l) => l.level === 'info')).toHaveLength(3); // create, move, get
});
```

Helpers in `tests/api/support/api-fixtures.ts`:

- `makeApi({ store?, service?, logLevel?, defaultPreset? })` → `{ deps, store, service, logs }`. `deps` fields are plain properties: reassign `api.deps.getService` or `api.deps.getConfig` to inject a failure. The fake clock advances 1 ms per call, so a request line has `durationMs: 1`.
- `postJson(path, body, { headers?, rawBody?, contentType? })` always sends bytes; `contentType: null` sends no `Content-Type` at all (a string body would get `text/plain` from `Request`). `getReq(path, headers?)`, `ctx(id)`, `readJson(res)`, `bearer(token)`.
- `createGameVia(api, body?)`, `playToEndVia(api, ids)` (plays the first legal move to game over and returns every update).
- `wrapService(service, { submitMove: () => Promise.reject(new NotYourTurn(0)) })` delegates to the real service except for the overridden method. `GameService` has private fields, so the wrapper is cast; do not use `Object.create(service)`.
- `api.store` is a `RecordingStore` (§14.11): `api.store.reset()` after setup, then `callsOf()` proves a rejected request made no storage call.

How to reach each status: 403 needs a `wrapService` override (the service only answers it for games with several humans); 409 is a stale `version` with a new `clientRequestId`; 410 is `meta.json` rewritten with `engineVersion: ENGINE_VERSION + 1`; 404 for a partly deleted game is a `store.delete` of `meta.json` or a commit; 500 is a `getService` that throws.

### 16.9 The no-leak check

`tests/api/no-leak.test.ts` plays two full games over the handlers to game over — `argentina-fidepo` with 4 seats (whose first hand deals the whole deck) and `spain-ludoteka` with 3 — and checks every body: the 201, every move response, a GET with and without `?since=0` after every move, a provoked 409 and a provoked 422 (about 1,200 bodies). The oracle, `assertNoLeak` in `tests/api/support/leak-oracle.ts`, reads the real state from the store and checks:

- `view` contains no card of another seat's current hand and no card of the stock (the deck minus every card dealt in the current hand), outside the public fields below; `view.yourHand` equals the seat's hand and `view.trumpCard` the hand's trump card.
- `events` carry cards only in `card-played.card` and `hand-dealt.trumpCard`; `legalMoves` only cards in the player's own hand.
- No body has a `seed`, `seatTokenHashes` or `aiDecisionCount` key, the seed or a token hash as a value, or an array of card arrays (the shape of the stored hands); the seat token appears only in the 201.

**Allowed on purpose**, so do not "fix" them:

- `view.trumpCard` is public. It is the turned-up stock card, or, when a hand deals the whole deck (`trumpCardInDealerHand: true`, e.g. 4 × 13 French or 3 × 12 Spanish cards), the dealer's last card, which then stays in the dealer's hand.
- `currentTrick`, `lastTrick`, `card-played.card` and `hand-dealt.trumpCard` are cards everyone has seen.
- A `?since=` GET replays earlier hands' events, so a card shown in an earlier hand can appear while the same card is now in another seat's hand or the stock. The oracle compares against the current hand only.

The check must run right after the response it checks: it compares the body with the store's tip. Its own tests feed it 14 tampered bodies, one per kind of leak, that it must reject.

### 16.10 A `curl` session against `pnpm dev`

Start the server (games go to `.data/` by default; set `FILE_STORE_DIR` to keep a session elsewhere):

```sh
pnpm dev     # or: FILE_STORE_DIR=/tmp/podrida pnpm dev
```

In another shell (`jq` is optional; without it, copy the values by hand):

```sh
API=http://localhost:3000/api

curl -s $API/presets | jq '.defaultPresetId, [.presets[].id]'

curl -s -X POST $API/games -H 'Content-Type: application/json' \
  -d '{"humanName":"Ana","aiCount":3}' > game.json        # 201
GAME=$(jq -r .gameId game.json); TOKEN=$(jq -r .seatToken game.json)
jq '.update | {version, phase: .view.phase, moves: [.legalMoves[].id]}' game.json

curl -s $API/games/$GAME -H "Authorization: Bearer $TOKEN" > cur.json   # 200, events []
jq '{version, phase: .view.phase, hand: .view.yourHand}' cur.json

curl -s -X POST $API/games/$GAME/moves -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"version\":$(jq .version cur.json),\"moveId\":\"$(jq -r '.legalMoves[0].id' cur.json)\",\"clientRequestId\":\"move-1\"}" \
  > cur.json                                                              # 200, version + 1
jq '{version, events: [.events[].type], phase: .view.phase}' cur.json

curl -s "$API/games/$GAME?since=0" -H "Authorization: Bearer $TOKEN" | jq '.events | length'
```

To play to the end, always choosing the first legal move:

```sh
N=1
while [ "$(jq -r .view.phase cur.json)" != game-over ]; do
  N=$((N+1))
  curl -s -X POST $API/games/$GAME/moves -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"version\":$(jq .version cur.json),\"moveId\":\"$(jq -r '.legalMoves[0].id' cur.json)\",\"clientRequestId\":\"move-$N\"}" \
    > cur.json
done
V=$(jq .version cur.json)
curl -s "$API/games/$GAME?since=$((V-1))" -H "Authorization: Bearer $TOKEN" | jq '.view | {phase, finalRanking}'
ls .data/games/$GAME/commits | wc -l   # V + 1 files: 00000000.json … the tip
```

A 4-seat `argentina-fidepo` game takes about 200 human moves and a few seconds this way. Each commit is a file under `games/<id>/commits/`, plus `meta.json`, `head.json` and, at the end, `scores/final.json` (§13.5, §14.2). Every POST needs `-H 'Content-Type: application/json'`: without it `curl -d` sends `application/x-www-form-urlencoded` and the API answers 400 `Invalid request: body`. The server prints one JSON request line per call.

### 16.11 API tests

| File | Protects |
|---|---|
| `errors.test.ts` | Every row of the mapping, the fixed messages, and that a 500 body carries nothing from the thrown error. |
| `body.test.ts`, `auth.test.ts`, `schemas.test.ts` | The request rules at unit level: size cap at 16,384/16,385 bytes and with multi-byte text, media types, invalid UTF-8, bearer syntax, every field limit, unknown fields, `since` syntax; the response schemas reject extra fields; preset labels. |
| `create.test.ts`, `get-update.test.ts`, `submit-move.test.ts`, `presets.test.ts` | Each route end to end through its handler: statuses, bodies, `since`, idempotent retry, 403/409/410/422, partly deleted games → 404, route export keys. |
| `check-order.test.ts` | The check order, with no store call and no `getService` call when a check fails. |
| `factory.test.ts` | A failed `getService()` is not cached; later calls return the same instance. |
| `logging.test.ts` | Request-line fields for every route and outcome, level gating, the error line, malformed ids logged as `null`. |
| `headers.test.ts` | One real response for each of the 11 statuses has both headers; every error body parses with `ErrorResponseSchema`. |
| `secrets.test.ts` | No token, `Bearer`, hash, seed, hand or card in any log line over a full game; a 500 from `AiLoopLimitError` leaks nothing. |
| `structure.test.ts` | No 4xx/5xx number and no `src/state`/`storage`/`engine` import in `handlers.ts` and the route files. |
| `no-leak.test.ts` | §16.9. The two full games take most of the folder's ≈ 8 s, each with an explicit 60 s timeout. |

### 16.12 Gotchas and limitations

- **`?since=0` costs one storage read per commit** (§15.5). A 200-move game read that way after every move is quadratic; that is why the no-leak games dominate the API test time. Clients should poll with `since=<last version seen>`.
- **Configuration is validated on the first request**, not at server startup (§16.5).
- **`application/json` only.** `+json` media types such as `application/merge-patch+json` are rejected.
- **Lengths count UTF-16 code units** (`humanName`, `moveId`, `clientRequestId`); the 16,384 cap counts bytes.
- **No rate limiting, CORS or accounts** ([`architecture.md`](./architecture.md) §12); the cron route `GET /api/cron/cleanup` is not one of the four game routes and is described in §18.
- **No move-latency measurement yet.** Timings from `pnpm dev` (the `durationMs` field) use the file store and say nothing about Vercel Blob; the preview benchmark is pending ([`architecture.md`](./architecture.md) §11).

---

## 17. UI

The browser UI is two pages, both client components. `/` is the new-game form (plus a link to continue the remembered game). `/game/[id]` is the table: bidding, playing, the replay of events, the score sheet and the final ranking. All text is Spanish (`<html lang="es">`), and the UI has no CSS framework and no runtime dependency of its own.

**The server is the only rules authority.** The UI never decides what is legal, whose turn it is, who won a trick, the scores or the ranking. It shows `legalMoves`, `toAct`, `trick-won.seat`, `scoreboard` and `finalRanking` exactly as the API sent them. The only arithmetic it does is display bookkeeping while replaying events (§17.5) and the running totals on the score sheet (sums of points the server already gave). It uses the HTTP API of §16 and nothing else; there is no polling or push, because the AI moves arrive inside the response to the human's own move.

### 17.1 Pages and modules

| File | What it is |
|---|---|
| `app/page.tsx` | Renders `NewGamePage`. |
| `app/game/[id]/page.tsx` | Server component: awaits `params` (a `Promise` in Next 16) and renders `<GamePage key={id} id={id} />`. It reads nothing else. |
| `app/layout.tsx`, `app/globals.css` | `<html lang="es">`; colour tokens, base font and `box-sizing` (§17.7). |
| `app/_client/` | Everything below. Next ignores `_`-prefixed folders for routing. |

Pure modules in `app/_client/` (no React; `fetch`, storage, the id source and timers are passed in, so tests call them directly):

| Module | Role |
|---|---|
| `slot.ts`, `memory-slot.ts` | The stored-game slot and its in-memory fallback (§17.2). |
| `ids.ts` | `newClientRequestId`: `crypto.randomUUID()` when it exists, otherwise a version-4 UUID built from `crypto.getRandomValues` (works outside secure contexts such as `http://<LAN IP>:3000`). |
| `api.ts`, `api-types.ts`, `shape.ts` | One function per call (`getPresets`, `createGame`, `getUpdate`, `submitMove`), the local types of the presets, create and error bodies, and the response shape checks (§17.3). |
| `game-state.ts` | `shouldAdopt` (version guard), `captureAction`, `isAnimated`. |
| `display.ts` | The display model and `applyEvent` / `eventDelayMs` (§17.5). |
| `cards.ts` | `cardLabel(card, deck)`: rank, suit, accessible name and colour for `french-52` and `spanish-40`. |
| `kept-update.ts` | Hands the 201 update from the new-game page to the game page (§17.2). |
| `copy.ts` | Every Spanish string, as one `COPY` constant. |

React components: `new-game-page.tsx`, `game-page.tsx` (the state machine: loading, adoption, moves, queue), `table.tsx`, `hand.tsx`, `bid-bar.tsx`, `card-view.tsx`, `banner.tsx`, `score-sheet.tsx`, `game-over.tsx`, `notice.tsx`, each with a `*.module.css` next to it. `deps.tsx` provides `ClientDeps` through a React context: `fetch`, `setTimeout`/`clearTimeout`, `storage()`, `newId` and `navigate`. In the browser the default deps use the globals and `next/navigation`'s router; tests wrap renders in `ClientDepsProvider` with fakes, so nothing mocks `next/navigation`.

**Layer rule.** UI code may use only `import type` from `@/src/domain/types` (`PlayerUpdate`, `PlayerView`, `GameEvent`, `LegalMove`, `ScoreBoard`) and never imports anything from `app/api`, so the presets, create and error bodies are typed locally in `api-types.ts`. `Card` is not exported by `types.ts`; `cards.ts` and `display.ts` derive it as `PlayerView['yourHand'][number]`. Lint enforces the `src` part (§3); `tests/ui/boundaries.test.ts` scans `app/**` and enforces the `app/api` part.

### 17.2 The stored-game slot

One `localStorage` key, `la-podrida:game`, holds JSON `{ gameId, seatToken, deck, finished }` (strings, string, string, boolean). The browser remembers one game; creating a new game replaces it.

- **Reading** returns "no slot" when the key is missing, the JSON does not parse or a field has the wrong type. Every read and write is in `try/catch`; a failure is "no slot" on read and ignored on write. Storage is touched only in effects and event handlers, never during render, so the server HTML and the first client render match and no hydration warning appears.
- **In-memory fallback.** If the write after creating a game fails (private mode, blocked storage), the new-game page keeps the slot in `memory-slot.ts` and the game stays playable in that tab. After a reload there is no slot and the game page shows the no-access message. The continue link on `/` reads storage only.
- **Ownership.** A game page changes the slot only when the stored slot's `gameId` equals the page's route `id`, and it re-reads the slot just before changing it. This covers clearing it (401, 404 or 410) and setting `finished: true` when the adopted view reaches `game-over`. A tab showing an old game therefore never damages the slot of a newer game created in another tab; only creating a game replaces a slot that belongs to another game.
- **Kept update.** After a 201 the new-game page stores the update in `kept-update.ts`, tagged with its `gameId`, and navigates to `/game/<id>`. The game page takes it once per instance (cached in a ref, because Strict Mode runs effects twice) only when the `gameId` matches, and then plays its events from the empty table. Any other mount (reload, hard navigation, a different id) loads with `GET /api/games/<id>` instead.

Loading `/game/[id]`:

| Situation | What happens |
|---|---|
| No slot, or the slot belongs to another game | `No tenés acceso a esta partida.` and a `Nueva partida` link; no API call. |
| Matching slot, matching kept update | Adopt it and animate its events; no GET. |
| Matching slot, no kept update | `GET /api/games/<id>` with the bearer token (no `since`); the view appears at once. |
| Load answers 401, 404 or 410 | The slot is cleared (if owned) and a message with a `Nueva partida` link is shown: access no longer valid, game no longer exists, or the game cannot be continued with this version. |
| Load fails in transport or with 5xx | The slot is kept; `No se pudo cargar la partida.` and `Reintentar`. A load is deduplicated per attempt, so Strict Mode does not send two GETs. |

### 17.3 Calls, timeouts and transport failures

`api.ts` functions never throw: they return `ok`, `conflict` (a 409 on a move, with its `update`), `error` (a 4xx handled for that call; decide by `status`, `code` may be empty) or `transport`. Every call is aborted after 20 s, and the request is also raced against the abort so a hung `fetch` or `json()` still settles. All requests use `cache: 'no-store'`; the seat token travels only in the `Authorization` header, is never put in a URL or a log, and is never rendered.

An outcome is a **transport failure** when `fetch` rejects, the 20 s abort fires, the status is 500 or more, a 2xx body fails the shape check, a 409 has no valid `update`, or the status is not one that call handles. The shape checks are deliberately shallow (a `PlayerUpdate` has a numeric `version` and the expected arrays and objects; deeper fields are trusted). A presets body without an entry for `defaultPresetId` also fails, so a new game cannot be created from it.

**New game.** `GET /api/presets`, then `POST /api/games` with `{ humanName: <trimmed name>, aiCount, rulesPreset: defaultPresetId }`. The preset is always the server's default (the UI offers no preset choice); its `deck` is stored in the slot. Any failure leaves the user on `/` with `No se pudo crear la partida. Probá de nuevo.` (a 400 shows `Revisá los datos de la partida.`); nothing is retried and nothing is stored.

### 17.4 Updates, versions and moves

**Adoption and the version guard.** The page keeps the latest *adopted* `PlayerUpdate`. A received update is adopted only if none is adopted yet or its `version` is greater than the adopted one; otherwise it is ignored (its events are not queued). The adopted version never decreases, which matters because retried requests can answer out of order.

**What animates and what jumps.** Only a 201 (create) and a 200 move response queue their `events` for replay. Every other adoption (page load, 409, recovery GET) empties the queue and shows the adopted view immediately. Controls and legal moves always come from the adopted update; the table shows either the display model (while events play) or the adopted view.

**One action, one request body.** On a bid or card click the page captures `{ version: <adopted version>, moveId: <the legal move's id>, clientRequestId: <new id> }` exactly once, then sends it. A new `clientRequestId` is generated only for a new click. Bid buttons (one per legal bid, ascending, so the dealer's forbidden value has no button) and clickable cards (only cards that are the `card` of a legal play; the rest are dimmed; hand order is the server's) are shown only when no events are playing and `legalMoves` is non-empty, and are enabled only while no request is in flight or waiting to retry.

**Why a retry is safe.** The server deduplicates by `clientRequestId` (§15): a repeated request with the same id answers 200 with the original response and never applies the move twice. After a transport failure the page therefore resends the *identical* body after 1 s, 2 s and 4 s. If all three fail it shows `No se pudo enviar la jugada.` and `Reintentar`; each click sends the same body once more, with the same 20 s timeout.

**Move responses.**

| Response | What the UI does |
|---|---|
| 200 | Adopt it and animate its events. |
| 409 | Adopt the body's `update` (no animation) and show `La partida avanzó; se actualizó la mesa.` |
| 403, 422 | `GET /api/games/<id>?since=<version sent>`, adopt the result (no animation), show `Esa jugada ya no es válida.` |
| 400, 413 | Same recovery as above, with `Error inesperado.` |
| 401, 404, 410 | Clear the slot (if owned) and show the corresponding message, as when loading. |
| Transport failure | Retry at 1, 2, 4 s, then `Reintentar`. |

If the recovery GET itself fails in transport or with 5xx, the page shows the load-failure message and `Reintentar` repeats that GET (not the plain load); a 401, 404 or 410 on it is handled as above. A notice disappears after 4 s or when the next action starts.

**Game over.** When the adopted view's `phase` is `game-over`, the page sets `finished: true` in the slot (also when a game loads already finished), so `/` stops offering to continue it.

### 17.5 The event display model

Events are replayed one at a time on a **display model** (`DisplayModel` in `display.ts`: the table-view fields the table renders plus the hand banner, the highlighted seat and a `dealt` flag). `applyEvent(model, event, target)` is pure and returns a new model; `target` is the adopted view and is used only to take the human's hand at a deal. The model starts from the view that was shown before the adoption (200) or from an **empty table** (201: the seats with 0 cards, no bids, no tricks, no trump, empty tricks and hand).

Each event's effect is applied when it starts, then held for its delay; the next event starts when the delay ends:

| Event | Effect | Delay |
|---|---|---|
| `game-started`, `game-over` | none | 0 ms |
| `hand-dealt` | trump card and `trumpCardInDealerHand`, dealer and hand number; every seat gets `cardsPerPlayer` cards, no bid, 0 tricks; tricks emptied; banner cleared; the human's hand becomes the adopted view's `yourHand` | 600 ms |
| `bid-made` | sets that seat's bid | 600 ms |
| `card-played` | adds the card to the current trick, lowers that seat's card count, removes the card from the shown hand when it is the human's | 600 ms |
| `trick-won` | increments the winner's tricks, moves the current trick to the last trick | 1200 ms |
| `hand-completed` | shows the banner `Fin de la mano <n>` with each seat's bid and tricks; it stays until the next deal or the end of the queue | 1200 ms |

The seat that produced the event being shown is highlighted (`data-highlight="true"`). While the queue is non-empty: no seat shows the turn marker, no bid button or clickable card is shown, and the score sheet, the phase and the game-over screen come from the view shown *before* the adoption (for a 201 there is none: empty sheet, no ranking). They all switch to the adopted view when the queue empties, and the table then renders the adopted view exactly. `Saltar` (shown only while events play) empties the queue and shows the adopted view at once.

The queue lives in the game page's reducer: `queue` holds the events not yet finished (the head is the one being shown) and one timer is armed per head, so `Saltar` and unmounting cancel cleanly. `finished: true` stays keyed on the adopted view, not the shown one.

### 17.6 Table, score sheet, game over, cards and copy

- **Table.** Per seat: name, `(vos)` on the human's seat, card count, bid (`—` when none), tricks, a dealer marker and a turn marker; the trump card (with `En mano del repartidor` when it is in the dealer's hand); the current trick with each card's seat; the last trick and its winner; `Mano <n> de <total> · <cards> cartas`; the human's hand.
- **Score sheet.** The `Planilla` button opens a full-screen panel (`role="dialog"`) at every width; `Cerrar` closes it. One row per entry of `handPlan`: hand number, cards, and per seat bid, tricks and points for hands in `scoreboard.hands`; completed rows also show each seat's running total; a totals row shows `scoreboard.totals`. While `scoreboard.live` is present the current hand's row shows each seat's live bid, tricks and status (`En camino`, `Cumplida`, `Pasada`).
- **Game over.** When the shown view's phase is `game-over`, a ranking from `finalRanking` (place, name, total, ascending; ties share a place) and a `Nueva partida` link to `/`. No input is shown.
- **Cards.** A card is a CSS box with rank and suit from the slot's `deck` (unknown or missing falls back to `french-52`). `french-52` uses ♠ ♥ ♦ ♣ (hearts and diamonds red); `spanish-40` shows the suit word in a colour per suit and ranks `R`, `C`, `S` as `12`, `11`, `10`. Each card has an accessible name such as `10 de picas`, `Rey de copas`, `As de oros`; a clickable card is a `<button>`.
- **Copy.** Every string is in `COPY` (`copy.ts`). Components and tests import it, so a test asserts `COPY.loadFailed` rather than retyping the sentence; `tests/ui/copy.test.ts` checks the specified texts verbatim once. A few labels have no prescribed text and use minimal Spanish: table labels (`Repartidor`, `Turno`, `Cartas`, `Pedido`, `Bazas`, `Triunfo`, `Baza actual`, `Última baza`, `Tu mano`), the score-sheet headings (`#`, `Puntos`, `Total`) and the game-over title `Fin de la partida`. Bid buttons have no prompt text. Change them in `COPY` freely.

### 17.7 Styling

One global stylesheet, `app/globals.css`, holds the colour tokens (`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, `--accent-text`, `--danger`, `--highlight`, one `--card-*` per card colour), the font and `box-sizing`. Each component has its own `*.module.css`; inline `style` is used only for runtime values. The conventions below make the layout work at 375 px width, and `tests/ui/tap-targets.test.ts` checks them statically, so renaming a class is a deliberate test change:

- Mobile first; one breakpoint, `@media (min-width: 768px)`.
- Tap targets (bid buttons, cards, `Saltar`, `Reintentar`, `Planilla`, `Cerrar`, the game-over link) declare `min-width` and `min-height` of at least 44px.
- Lists of cards, bid buttons and seats wrap (`flex-wrap: wrap`) instead of scrolling the page sideways.
- The score sheet is a fixed full-screen panel; its table sits in a `.scroll` box with `overflow-x: auto` and `max-width: 100%`, so only the table scrolls sideways, never the page.

### 17.8 UI tests

UI tests are `tests/ui/**/*.test.{ts,tsx}`, run in jsdom by their own Vitest project (§4). `pnpm test` runs them with everything else; `pnpm vitest run --project ui` runs only them (a few seconds); `pnpm vitest run --project ui tests/ui/slot.test.ts` runs one file. `tests/**/*.tsx` is in `tsconfig.json` `include`, and Vitest compiles JSX without a React plugin. The dev dependencies are `jsdom`, `@testing-library/react`, `@testing-library/dom` and `@testing-library/user-event`, pinned like every other package.

**The in-process API.** `tests/ui/support/in-process-api.ts` exports `makeInProcessApi()`, which returns `{ fetch, api, calls, failNext }`. Its `fetch` parses the URL and calls the real route handlers of §16 over a `MemoryObjectStore` (through `makeApi()` from `tests/api/support/api-fixtures.ts`), so the UI is tested against the real contract, not a hand-written mock.

- `calls` records `{ method, path, headers, body, status }` per request (`status` is `null` when the call rejected, hung or was aborted).
- `failNext(mode, match?)` injects one failure on the next matching call: `'reject-before'` (the handler does not run), `'reject-after'` (the handler runs, then the response is dropped: the retry case), `'hang'` (never resolves unless aborted), or a fixed `{ status, body }` (the handler does not run).
- It honours `init.signal` (aborts with an `AbortError`). The handler `Request` is built without jsdom's `AbortSignal`, and the handler `Response` is copied into a plain `Response`.

**Helpers.** `tests/ui/support/render.tsx`: `renderWithDeps(ui, { api?, overrides?, strict? })` (wraps in `ClientDepsProvider`, returns RTL's result plus `{ api, deps, navigated }`), `makeDeps`, `createStoredGame` (creates a real game and stores its slot) and `resetClientState()`. Call `resetClientState()` in `beforeEach`: the kept update and the memory slot are module variables. `tests/ui/support/fixtures.ts` has `makeView`, `makeUpdate`, `makeScoreboard` and `card` for hand-built views (a test that overrides `seats` must supply all four); `tests/ui/support/moves.ts` has `bid`, `play`, `armLoad`, `armMove`, `moveCalls` and `flush`.

**Writing a test.**

- Wrap the page or component with `renderWithDeps`; never mock `next/navigation`. Assert texts through `COPY`.
- Under `vi.useFakeTimers()` use `fireEvent` and advance with the `flush(ms)` helper (`act` plus `vi.advanceTimersByTimeAsync`). `userEvent` hangs under Vitest's fake timers. Without fake timers, `userEvent` is fine.
- **One `flush(ms)` fires at most one queue tick**: React renders and re-arms the timer only after the `act` ends. Step the clock once per event; `flush(60_000)` does not drain the queue.
- A real 200 from the in-process API animates, so a test that needs the next legal action clicks `Saltar` first. When counting game controls, filter out the page's own `Planilla`, `Saltar` and `Reintentar` buttons.
- To test a failure, arm it: `api.failNext('reject-after', { path: /moves/ })`, or use `armLoad` / `armMove` to answer with a fixture.
- `tests/ui/full-game.test.tsx` plays one whole 2-AI game through `NewGamePage` and `GamePage` on real timers, clicking `Saltar` whenever it shows, and then checks the record: every request answered 200 or 201, every enabled control and every sent `moveId` was a legal move of the adopted update, the token appeared only in `Authorization` headers, and no card name was rendered that no update contained. It takes about 3 s.

### 17.9 Manual play-through

Automated tests cannot cover real browsers, real phones or a real network, so play at least one game by hand when you change the UI. These steps use the file store, which is the default outside Vercel; games are files under `FILE_STORE_DIR` (default `.data/`).

1. Start the server with a scratch store and keep the browser console open (any React error or hydration warning is a failure):

   ```sh
   FILE_STORE_DIR=/tmp/podrida pnpm dev
   ```

   Open <http://localhost:3000/>. To start clean, stop the server, `rm -rf /tmp/podrida`, delete the `la-podrida:game` key in the browser's Local Storage and restart.

2. **Full game.** Enter a name, choose 5 rivals, press `Empezar partida`. Bid with the buttons, play any enabled card; use `Saltar` to skip the replay. Open `Planilla` mid-game and at the end. Expect: the `Fin de la partida` ranking appears, its totals match the sheet's totals row, and no notice or error text appears in normal play.
3. **Reload mid-hand.** Bid, play a card, then reload. Expect the same hand number, hand, bids and tricks, and play continues. `/` in a new tab shows `Continuar partida`.
4. **Offline retry.** The game id is in the URL; count the server's commits with `ls /tmp/podrida/games/<gameId>/commits | wc -l`. In DevTools, Network, set `Offline` and click a card. (a) Back to `No throttling` within about 3 s: the move applies. (b) Stay offline until `No se pudo enviar la jugada.` and `Reintentar` appear (about 7 s), go online and click `Reintentar`. Both times the commit count rises by exactly 1 and the table moves on.
5. **Phone layout.** In the DevTools device toolbar choose 375 × 667 and check `/` and the game with the score sheet closed and open. Two worst cases of the default preset: 5 rivals (6 seats, 8-card first hand, bid buttons 0 to 8) and 2 rivals (3 seats, 17-card first hand, bid buttons 0 to 17, a 29-row score sheet). The page must never scroll sideways (the sheet's table may scroll inside its box), every bid button and card must be visible, and each tap target must measure at least 44 × 44 px.
6. **Other browsers.** Repeat step 2 for one hand in Firefox and in Safari on iOS. Over plain `http://<LAN IP>:3000` `crypto.randomUUID` is unavailable, so this also exercises the id fallback.

**Reaching the dev server from a phone.** Put the phone on the same network, find the computer's address (`ipconfig getifaddr en0` on macOS) and start the server on all interfaces with that address allowed:

```sh
DEV_ALLOWED_ORIGINS=<LAN IP> FILE_STORE_DIR=/tmp/podrida pnpm dev --hostname 0.0.0.0
```

Then open `http://<LAN IP>:3000` on the phone (allow incoming connections for Node if a firewall asks). Next 16 blocks cross-origin dev requests (the `/_next/` dev resources and the hot-reload websocket) from any host other than `localhost`, so without the variable the page loads but live reload fails and the console shows `Blocked cross-origin request`. `next.config.ts` passes `DEV_ALLOWED_ORIGINS` to `allowedDevOrigins`: a comma-separated list of **hosts only** (no scheme, no port). It affects `pnpm dev` only; builds ignore it.

### 17.10 Gotchas and limitations

- **No polling, one remembered game.** The page fetches only on load, after a move and for recovery. To see changes made elsewhere, reload. A second tab playing the same game gets a 409 or a recovery GET on its next move, which jumps to the current state with a notice.
- **Strict Mode.** In development React runs effects twice. The kept 201 update is cached in a ref and the load is deduplicated per attempt, so a new game still plays its events and a load still sends one GET. A new `GamePage` instance per route id (`key={id}`) is what makes navigating between games reload.
- **`Reintentar` has two jobs.** After a failed load it repeats the load; after a failed recovery GET it repeats that GET; after exhausted move retries it resends the captured move.
- **Only a 200 or 201 animates.** A game that loads at any point never replays its past; a `game-over` response need not fold to exactly the final view, so the page shows the adopted view when the queue empties.
- **The display model has no turn marker or legal moves.** The page takes both from the adopted update once the queue is empty.
- **Score sheet details.** The live row is the shown view's current hand, and its total cell is empty. Tied seats in the ranking keep the server's order.
- **Hand order and dimming.** Cards keep the order of `yourHand`; during bidding they are plain, and when no legal move exists they are dimmed.
- **Browsers.** Latest two versions of Chrome, Edge, Firefox and Safari (macOS and iOS); there are no polyfills.
- **Not automated.** There is no real-browser test; layout at 375 px is checked by the static CSS test and by hand (§17.9).

---

## 18. Retention

`GET /api/cron/cleanup` is the daily job that deletes every game created more than `RETENTION_DAYS` days ago, finished or not. This section covers what it does and why, how to run and test it, and what it cannot do. The policy itself (one year, creation date only) is in [`architecture.md`](./architecture.md) §6.5; the route row is in §7.

### 18.1 What the job does

Every game is stored as `games/{id}/…` keys plus one empty marker `index/created/{yyyy-mm-dd}/{id}` that is written first when the game is created (§14.5). Without a job, Vercel Blob would keep all of them forever. Once a day, Vercel Cron calls the route; the job lists the markers in date order, deletes each expired game's keys page by page, deletes its marker last, and stops after 500 games. It answers a small JSON summary and writes one log line.

Four properties shape the design:

- **It works from the markers only and never reads a game.** It works this way because retention must also delete games the engine can no longer load (`GameUnsupported`, a changed `schemaVersion`), and because a run then costs only `list` and `delete` calls.
- **It is driven by creation date alone.** A game is deleted whether it is finished, in progress or unsupported, because "last activity" tracking would add a write to every move for no real gain (architecture AD-11).
- **It is idempotent.** Running it twice, or two runs overlapping, ends in the same store state and never fails because a key is already gone, because storage deletes are idempotent (§13.4) and Vercel may retry a cron call.
- **It only touches what it can prove it created:** the keys under `games/{id}/` and the one marker of an expired game. Keys of newer games, other prefixes and malformed markers are never deleted.

### 18.2 The route, authentication and responses

| Method & path | Auth | Success | Failure |
|---|---|---|---|
| `GET /api/cron/cleanup` | `Authorization: Bearer ${CRON_SECRET}` | 200 `{ gamesDeleted, capReached, skippedMarkers }`, `Content-Type: application/json`, `Cache-Control: no-store` | 401 `unauthorized`; 500 `internal` |

The route file exports only `GET`, so Next answers any other method with its default 405.

The handler runs in a fixed order: **`getConfig()`, then the authentication check, then `getStore`**. Consequences:

- **It fails closed.** With no `CRON_SECRET` configured (possible only locally, §5) every request is rejected with 401. It works this way because the route deletes data; nothing may run it by accident.
- **A 401 is silent.** It uses the usual `unauthorized` body (the text `Missing or invalid seat token` is reused as is), writes no log line and never builds the store, so a scanner learns nothing and causes no storage call.
- **A configuration error answers 500 even for an unauthenticated call**, because the configuration is read before the caller is checked. It carries the usual fixed `internal` body and one `error` log line.
- **The header must be exactly `Bearer <secret>`**: one space, the scheme in that case, nothing after the secret. The check hashes both sides with SHA-256 and compares the digests with `timingSafeEqual`. It works this way so the compare is constant-time and never needs `timingSafeEqual`'s equal-length precondition, and so no `===`, `startsWith` or `includes` is ever applied to the secret or the header. The secret is never logged, echoed or placed in an error message.

**Logging.** After a completed run the handler writes one `info` line, regardless of `LOG_LEVEL` (it is a daily line, not per-request noise):

```json
{"route":"cron/cleanup","status":200,"gamesDeleted":3,"capReached":false,"skippedMarkers":0,"durationMs":412}
```

`durationMs` covers the store build to the end of the walk, not authentication. Any failure writes one `error` line with only `route`, `gamesDeleted` (games fully deleted before the error), `errorName` and `errorMessage` (the original store error's name and message, cut to 500 characters). The 500 response is always the fixed `internal` body and carries nothing from the error.

### 18.3 Which games expire

The cutoff day is the **UTC calendar date of `now − RETENTION_DAYS × 86,400,000 ms`**. A game is expired if its marker's day is **strictly earlier** than the cutoff day.

Worked example: `now` is 2026-11-27T03:00Z and `RETENTION_DAYS` is 365, so the cutoff day is 2025-11-27. Markers dated 2025-11-26 and earlier expire; a marker dated 2025-11-27 is kept and goes with the next day's run. The time of day does not matter: 00:00:00.000Z and 23:59:59.999Z on the same date give the same cutoff, and leap years follow the calendar.

It works this way, strictly older, because a game then lives at least `RETENTION_DAYS` full days, and deleting a game early is the worse error. The cutoff is always UTC because the marker's day is the UTC creation date. `RETENTION_DAYS` is already validated by `loadConfig` (an integer from 1 to 3650, §5), so the job does not check it again.

### 18.4 The walk and the delete order

1. **Walk the markers.** List `index/created/` in ascending key order, page by page with the returned `cursor`. Keys sort by date, so the expired games come first.
2. **Stop early.** The first valid marker whose day is not expired ends the run. No page beyond the one holding it is listed, so a run with nothing to do costs one `list` call per page of markers read and no `delete`.
3. **Delete a game's keys.** Repeatedly list `games/{id}/` from the start (no cursor), and `delete` the keys of that page; stop when a listing returns no key. A `delete` is never called with an empty list.
4. **Delete the marker last.** Only after a listing of `games/{id}/` came back empty is `index/created/{day}/{id}` deleted, and the game counts as deleted.

For one game with `k ≥ 1` keys and page size `p` that is `ceil(k/p) + 1` `list` calls, `ceil(k/p)` `delete` calls for the keys, one `delete` for the marker, and no `get`, `exists` or `put`.

**The marker goes last** because it is the only way to find the game again. If the run dies halfway, the marker still exists and the next run finishes the job (§18.6); with the marker gone first, the leftover keys would be orphans no one could find.

**Each page is listed again from the start** instead of following a cursor, because the keys just deleted are no longer there, so the first page is always the next batch to delete.

### 18.5 The batch cap and `capReached`

One run deletes at most **500 games**, to stay within the function time limit; the remainder is handled by the next day's run. The cap is a constant (`DEFAULT_BATCH_SIZE`), not an environment variable, because that keeps `src/config.ts` unchanged. Tests pass a small batch through the injected deps instead (§18.8).

`capReached` is `true` exactly when the run stopped because it deleted 500 games. It is `true` **even if nothing is left to delete**: the job does not look ahead, so with exactly 500 expired games the run answers `true` and the next one answers `{ gamesDeleted: 0, capReached: false }`. Read it as "the run stopped at its cap", not as "more work remains".

### 18.6 Failure, resume and the round limit

Any error from the store stops the run. The route answers the fixed 500 `internal` and writes the `error` line with the games deleted so far (§18.2). **Nothing is rolled back**: games deleted before the error stay deleted. It works this way, a 500 instead of a 200 with a summary, because Vercel then shows the cron run as failed.

**Resume.** If a run fails or is cut off after deleting only some keys of a game, that game's marker is still there. The next run finds it, deletes the remaining keys and then the marker. A marker whose keys are already all gone (the keys were deleted and the run died before the marker) costs one `delete` for the marker alone.

**The 10,000-round guard.** A game's keys are deleted in at most 10,000 `list` rounds (`MAX_LIST_ROUNDS_PER_GAME`). If the listing is still not empty after that, the run fails like any other store error and the marker is kept. It works this way because on Blob a listing is a hint (§13.7): a stale listing that never empties must not keep a cron function looping until the platform kills it. A game normally has a few hundred keys, so the guard never binds in practice.

Option errors (`batchSize` not an integer ≥ 1, `pageSize` not an integer from 1 to 1000) are `RangeError`s thrown before any store call. The production deps cannot trigger them.

### 18.7 Skipped markers

A key under `index/created/` that is not exactly `index/created/{yyyy-mm-dd}/{gameId}`, with a real calendar date (`2025-02-30` is not one) and a valid game id (`^[a-z2-7]{26}$`), is **skipped**: counted in `skippedMarkers`, never deleted, and the walk continues. It works this way because the job only deletes what it can prove it created; a malformed marker is reported in the count for the operator to inspect.

Only malformed keys met **before the stop point** are counted: the walk ends at the first valid, non-expired marker, so a malformed key sorting after it (such as `index/created/not-a-date/…`) is never reached and never counted.

### 18.8 Where the code lives and what is injectable

| File | What it holds |
|---|---|
| `app/api/_lib/cleanup.ts` | `runCleanup(options)`, `CleanupFailedError`, the constants, `CleanupDeps`, `cleanupHandler(req, deps)` and `defaultCleanupDeps`. |
| `app/api/cron/cleanup/route.ts` | `export const GET = (req) => cleanupHandler(req, defaultCleanupDeps)`, the only export. |
| `vercel.json` | The cron schedule (§18.9). |

```ts
interface CleanupDeps {
  getConfig: () => Config;
  getStore: (config: Config) => ObjectStore;
  now: () => Date;        // the wall clock
  log: LogSink;
  batchSize: number;      // integer >= 1
  pageSize: number;       // integer 1-1000, the ObjectStore limit
}
```

`defaultCleanupDeps` binds `getConfig`, `createObjectStore`, `() => new Date()`, `consoleLog`, `batchSize` 500 and `pageSize` 1000. Tests call `cleanupHandler` with their own deps (a fixed clock, a counting store, a batch of 2, a page size of 1), so they need no sleeping, no Vercel and no 500-game fixtures. `runCleanup` takes `store`, `now`, `retentionDays`, `batchSize` and `pageSize` and returns `{ gamesDeleted, capReached, skippedMarkers }`; on any store error it throws `CleanupFailedError`, which carries `gamesDeleted` and keeps the original error as `cause`.

**Layering.** The cleanup code imports only the `ObjectStore` type, `createObjectStore`, `Config`, the key builders (`@/src/state/keys`) and the sibling `_lib` modules. It does not import the Game State Manager, the schemas, the service or the engine, and no file under `src/` changed to build it. It lives in `app/api/_lib` rather than in a new `src` layer because a new layer would change the lint layer table for a single consumer, and `app/api` may already import `src/storage` and `src/state/keys`. `pnpm lint` does not constrain `app/api/**`, so `tests/retention/structure.test.ts` enforces the import list and the secret handling.

### 18.9 The schedule and Vercel Cron

`vercel.json` has one cron: path `/api/cron/cleanup`, schedule `0 3 * * *`, 03:00 UTC every day, a quiet hour for the Americas. It works this way (a fixed constant, not configurable) because a second knob buys nothing for a once-a-day job.

What Vercel Cron does, and what to know when you deploy:

- Schedules are in **UTC**.
- Cron invokes **production deployments only**: previews never run the job.
- It calls the route with `GET` and, when `CRON_SECRET` is set in the project, with `Authorization: Bearer ${CRON_SECRET}`. Set `CRON_SECRET` in every environment where the job should run; it is required on preview and production (§5).
- On the **Hobby plan** the job fires at some point within its hour, so "03:00" means 03:00 to 03:59.
- No `maxDuration` is set, so the platform's default function time limit applies. A run cut off by it leaves the unfinished game with its marker and resumes the next day (§18.6).

The first run on a real Blob store, the real `durationMs` and Blob's list order (§20) are verified when the app is deployed.

### 18.10 Running the tests

```sh
pnpm vitest run --project node tests/retention
pnpm vitest run --project node tests/retention --reporter=verbose   # shows the memory and file runs
```

`pnpm test` and CI include the folder. Fixtures write the real key layout (marker, `meta.json`, commits, `head.json`, optionally `scores/final.json`) straight into the store. The store-level suites run against both `MemoryObjectStore` and `FileObjectStore` (a temporary directory).

| File | Protects |
|---|---|
| `core.test.ts` | The cutoff table (365 days, leap year, time of day), the marker walk and its early stop, deletion of exactly the expired games, marker deleted last, no `delete` when nothing expired, skipped markers, the store-call budget for one game, a marker with no keys left. |
| `limits.test.ts` | The batch cap (runs of 2, 2, 1, 0 and the exact-cap case), failure then resume, the 10,000-round guard (memory only), option `RangeError`s. |
| `handler.test.ts` | Authentication (six bad headers, secret unset), the check order, the 500 and its log line, overlapping runs, the `info` line, the default deps and the injected clock. |
| `end-to-end.test.ts` | A game created through the real service is found, deleted and answers 404 afterwards, so the key layout the manager writes is the layout the job walks. |
| `structure.test.ts` | `vercel.json`, the route's exports, the import list and the secret handling of the cleanup code. |

`tests/retention/support/fixtures.ts` holds the helpers: `storeMatrix`, `gameId(n)`, `makeGameKeys`, `snapshot`, `wrap`, and the fault injectors `failOnNthList` and `staleListing`.

### 18.11 Trying the job locally

This walks the whole cycle on the file store: create a game, make it look old, call the job and check that it is gone. It needs `curl` and `jq`, and port 3000 free. The marker's day is the UTC date, hence `date -u`.

1. In one terminal, start the server on a fresh directory with a short retention:

   ```sh
   DIR=/tmp/podrida
   rm -rf $DIR && FILE_STORE_DIR=$DIR CRON_SECRET=local-test-secret RETENTION_DAYS=1 pnpm dev
   ```

2. In a second terminal, create a game and keep its id and seat token:

   ```sh
   DIR=/tmp/podrida
   curl -s -X POST localhost:3000/api/games -H 'Content-Type: application/json' \
     -d '{"humanName":"Ana","aiCount":3}' > /tmp/create.json
   ID=$(jq -r .gameId /tmp/create.json); TOKEN=$(jq -r .seatToken /tmp/create.json)
   find $DIR -type f
   ```

   The listing shows `games/$ID/meta.json`, `games/$ID/head.json`, `games/$ID/commits/00000000.json` and `index/created/<today, UTC>/$ID`.

3. Make the game look old by renaming its marker folder:

   ```sh
   mv $DIR/index/created/$(date -u +%F) $DIR/index/created/2020-01-01
   ```

4. Call the route without the secret. It answers `401` with `{"error":{"code":"unauthorized","message":"Missing or invalid seat token"}}`:

   ```sh
   curl -i localhost:3000/api/cron/cleanup
   ```

5. Call it with the secret. It answers `200` with `{"gamesDeleted":1,"capReached":false,"skippedMarkers":0}`, and the server prints one `{"route":"cron/cleanup","status":200,…}` line:

   ```sh
   curl -i -H 'Authorization: Bearer local-test-secret' localhost:3000/api/cron/cleanup
   ```

6. Check the store. No file remains. The file store leaves the empty folders behind (for example `games/$ID/commits/`), so "no file remains" is the check, not "the folder is gone":

   ```sh
   find $DIR -type f      # prints nothing
   ```

7. Read the game. It answers `404` with `{"error":{"code":"game_not_found","message":"Game not found"}}`:

   ```sh
   curl -i -H "Authorization: Bearer $TOKEN" localhost:3000/api/games/$ID
   ```

8. Optional: repeat step 5. The answer is `{"gamesDeleted":0,…}`, because the job is idempotent.
9. Stop the server with Ctrl-C and check that nothing listens on port 3000 (`lsof -i :3000`).

### 18.12 Gotchas and limitations

- **Blob's list order is assumed, not yet verified.** The early stop relies on `list` returning keys in ascending order across pages (§13.7). If a real Blob store orders them differently, the job could stop before an expired marker; it would then need a different walk. This is checked on the real store at deployment.
- **A partly deleted game answers 404.** Retention does not fence requests in flight, so a client that touches a game while the job deletes it can get `game_not_found` (§16.2). It takes activity on a year-old game, so it is accepted.
- **A game without a marker is never deleted.** Only a caller bug writes one (§14.12); the job finds games through the markers and does not scan `games/`.
- **A logged store error may contain key paths.** The `error` line carries the original error's message, and a store message names the key, so it can contain a game id. The response body never carries it.
- **The cap, the schedule and the cutoff timezone are constants.** There is no dry run, manual trigger, admin page or alert; a failed run shows up as a failed cron run in Vercel's logs.
- **A throw from the log sink after a completed run** is reported as a 500 even though the deletions are done.

---

## 19. Deployment and launch checks

Three scripts check a deployment against a real Vercel Blob store. They are run by the operator, not in CI, and all read their secrets from the shell (never from a file). The full runbook, the manual checklist, the rollback steps and the launch record are in [`deployment.md`](./deployment.md).

| Script                | What it checks                                                                                                                                                                                  | Needs                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm blob-checks`    | Against the store itself: a create-only `put` is exclusive under concurrent writers, reads are consistent right after a write, a paged listing is ascending, and a delete removes the keys.      | `BLOB_READ_WRITE_TOKEN` (required)                                                  |
| `pnpm bench-moves`    | Move latency over HTTP on a deployed URL: p95 against a limit (default 500 ms) for the `warm` and `stale` scenarios, and one timed first move for `cold`.                                         | `--base-url`, `--scenario`; `BLOB_READ_WRITE_TOKEN` for `stale`; bypass if protected |
| `pnpm smoke`          | A whole game played over HTTP on a deployed URL (ten steps: create, auth, a move conflict, play to the end, resume, retry, no secret leaks, cron auth and run).                                   | `--base-url`; `CRON_SECRET` of that environment; bypass if protected                |

Each prints one JSON line on stdout, and its exit code is 0 when it passed, 1 when it failed and 2 for a usage error. `blob-checks` writes only under `checks/<runId>/` and deletes it. The `stale` scenario of `bench-moves` also writes `head.json` into the store. Benchmark and smoke games expire under the normal retention rule (§18).

The scripts are tested without a network. `tests/unit/scripts/` runs them over the real route handlers and a memory store, and over a store wrapped to misbehave, so a broken store makes the checks fail. The helpers (`scripts/lib/`: strict option parsing, the 30-second request guard, percentiles) are shared. `scripts/` is not layer-restricted.

---

## 20. Known limitations

- **Configuration is validated on the first API request, not at server startup.** The service factory calls `getConfig()` lazily (§16.5), so a misconfigured deployment starts, and its first request answers 500 with a `ConfigError` error line in the logs. Building at module load would break `next build` instead.
- **Blob credentials are checked by `createObjectStore`, not by `loadConfig`** (§13.3), so a `blob` configuration without them is reported when the store is first built, not at startup.
- **The Vercel Blob driver has not run against a real store yet**; it is tested against a mocked SDK, and the behaviours it assumes are listed in §13.7.
- **The layer rule does not check dynamic `import()` or `require()`.** Use static `import` statements.
- **The UI has no automated real-browser test.** Layout at phone width and play in Firefox and Safari are checked by hand (§17.9); the rest of the UI is tested in jsdom (§17.8).
- **No move-latency measurement on Vercel Blob yet** ([`architecture.md`](./architecture.md) §11).
- **Retention runs under the platform's default function time limit.** The cleanup route sets no `maxDuration` (§18.9). A run that is cut off leaves the unfinished game with its marker, and the next day's run resumes it.
- **The cleanup walk assumes Vercel Blob lists keys in ascending order.** This is the same assumption as the storage limit in §13.7, unverified on a real store until the app is deployed; if it is wrong, the early stop could skip expired markers (§18.12).
- **Orphan games without an index marker are never deleted by retention.** The job finds games only through their markers (§18.4, §14.12).
- **A game that retention is deleting answers 404** while it is partly deleted (§18.12).
- **The file store leaves empty folders after a delete.** After a cleanup, `games/<id>/commits/` can remain on disk with no file in it; no key remains (§18.11).
- **A store error message logged on a cleanup 500 may contain key paths**, hence game ids (§18.2). The response never contains it.
- **Engine limitations** are listed in §10.8, **score limitations** in §11.7, **player, AI-loop and simulation limitations** in §12.8, **storage limitations** in §13.7, **game state limitations** in §14.12, **service limitations** in §15.11, **HTTP API limitations** in §16.12, **UI limitations** in §17.10, **retention limitations** in §18.12.
