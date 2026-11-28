# DECISIONS

## D-001: CLI-spawn test helper runs `node --import tsx` (Iteration 1)
Context: tests must run the CLI as a real process (and later kill it, set env vars).
Decision: `runCli` spawns `process.execPath` with `--import tsx scripts/generate-data.ts`, from the repo root, using `child_process.spawn` and collecting stdout/stderr as strings; returns `{ code, stdout, stderr }`.
Rejected: `pnpm generate-data` (slow, pnpm warnings on stderr, harder to SIGKILL the real process); `tsx` binary (adds a wrapper process, so killing it may not kill the node child).
Consequences: the child PID is the node process itself, so later kill tests can SIGKILL it directly; stderr is exactly the CLI's.

## D-002: `UsageError` carries the message without the prefix (Iteration 1)
Context: FR-1202 requires one stderr line `generate-data: <problem>`.
Decision: `UsageError.message` is the problem text only; `scripts/generate-data.ts` adds the `generate-data: ` prefix and newline. Same shape as `simulate.ts`. `parseArgs` errors keep their first line only. Parsers take argv after the subcommand and return plain objects (`RunOptions`, `ValidateOptions`, snake_case fields).
Rejected: putting the prefix in the error (would double when wrapped later).
Consequences: later iterations (resume guard, validate) can throw/print their own lines with the same prefix convention.

## D-003: Parsers have no I/O (Iteration 1)
Decision: `parseRunArgs` reads only `os.availableParallelism()`; it never touches `--out`, so a usage error cannot create files.
Consequences: directory checks (FR-1220) belong to `run`, after parsing.
