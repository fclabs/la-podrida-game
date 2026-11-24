# La Podrida

La Podrida is a trick-taking card game, the Hispanic version of _Oh Hell!_, in which each player must predict exactly how many tricks they will take. This project lets you play it in the browser: one human against 2–5 AI players. The backend is authoritative: it holds the game state, computes each player's legal moves and accepts the player's choice, while the browser only renders the view it gets and sends back the chosen move. Every state change is persisted, so a game can be resumed, audited and replayed.

The repository currently holds the project foundation (Next.js app, test runner, lint-enforced architecture rules, validated configuration and CI), the game core (rules engine, scoring, AI players and simulator), persistence, the game service that ties them together, and the HTTP API in front of it. A full game can already be played over HTTP with `curl` against `pnpm dev` (see [HTTP API](docs/development.md#16-http-api) in the development guide). The browser UI is built on top of it in a later phase.

## Prerequisites

- **Node.js 24** (the version is in `.nvmrc`; `nvm use` picks it up).
- **pnpm 10** (the exact version is pinned in `package.json` `packageManager`; with Corepack enabled, `corepack enable` installs it).

## Getting started

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Then open <http://localhost:3000/>. You should see a page titled **La Podrida**.

No environment variables are needed for local development; every setting has a default (see [Configuration](docs/development.md#5-configuration)).

## Commands

| Command          | What it does                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm dev`       | Start the Next.js development server on <http://localhost:3000/>.                                        |
| `pnpm build`     | Production build (`next build`).                                                                         |
| `pnpm typecheck` | Type-check the whole project (`app/`, `src/`, `tests/`, `scripts/`) with TypeScript `strict`.            |
| `pnpm lint`      | Run ESLint (zero warnings allowed) and check formatting with Prettier. Also enforces the layer rules.    |
| `pnpm format`    | Rewrite files to the project format with Prettier.                                                       |
| `pnpm test`      | Run the tests in `tests/unit`, `tests/contract` and `tests/api` with Vitest.                             |
| `pnpm test:sim`  | Run the long-running simulation tests in `tests/sim` (not part of `pnpm test`).                          |
| `pnpm simulate`  | Play batches of all-AI games and print average scores and the made-bid rate (see the development guide). |

Before pushing, run the same checks CI runs:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm test:sim && pnpm build
```

## Documentation

- [Development guide](docs/development.md): project layout, architecture import rules, tests, configuration, CI, conventions, and the HTTP API with a worked `curl` session.
- [Game rules](docs/game_rules.md): how La Podrida is played and its regional variants.
- [System design](docs/design.md): what the system does: components, domain model and game logic.
- [Architecture](docs/architecture.md): how it is built and run: stack, module boundaries, storage, API, security.
- [Implementation phases](docs/implementation.md): the order the MVP is built in, phase by phase.

## License

See [LICENSE](LICENSE).
