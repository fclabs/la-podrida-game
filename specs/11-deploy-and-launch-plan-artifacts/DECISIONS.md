# DECISIONS

## D-001: listing.passed requires ordered and keys === 25 (Iteration 1)
Context: spec FR-1110 says `listing.passed` is `ordered`; an empty or short listing is vacuously ordered, which would hide a broken listing.
Decision: `listing.keys` is the number of keys the paged listing returned; `listing.passed = ordered && keys === 25`.
Rejected: following the spec text literally (`passed = ordered`).
Consequences: DEVIATION from the spec text, stricter. Raise with the operator. A short listing on a real store fails the run and is recorded as measured.

## D-002: every section is present on an unexpected error (Iteration 1)
Context: FR-1110 defines the line's fields but not the shape after an unexpected error.
Decision: the line always contains every section; sections not reached keep zero counts and `passed: false`; progress inside the failing section is kept; `error: { name, message <= 200 chars }` is added, token redacted.
Rejected: omitting unreached sections.
Consequences: consumers can parse one shape; zero counts after an error are not a measurement.

## D-003: smaller choices (Iteration 1)
Context: details the spec leaves open.
Decision: (a) cleanup that cannot empty the prefix in 20 rounds, or throws, sets `error.name: 'CleanupError'` and `passed: false` if no earlier error; (b) a signal abort ends the run as `InterruptedError`, exit 1 with the line printed; (c) the script's `main` runs only when executed as the entry point so tests can import it; (d) `parseStrict` integers use `^(0|[1-9][0-9]*)$`, so `007` is rejected; (e) `request` also rejects at the deadline when `fetch` ignores the abort signal.
Rejected: silent cleanup failure; exiting inside the signal handler.
Consequences: later scripts reuse `parseStrict` and `request` unchanged.

## D-004: aborted bench runs carry baselineMedianMs null and n = samples taken (Iteration 2)
Context: FR-1117 says every line has an integer baseline, but a run that aborts (non-200, network error, timeout, head mismatch) never reaches the baseline step; the spec does not define that line.
Decision: the aborted line has `passed: false`, `baselineMedianMs: null`, `n` = number of timed samples taken, and min/p50/p95/max over those samples (0 when none). The abort reason is printed on stderr (`bench-moves: run aborted: <Name>: <message>`, secrets redacted), not in the JSON line. Exit 1.
Rejected: extra `error` field in the line (changes the specified shape); running the baseline after an abort (the server is already misbehaving).
Consequences: DEVIATION in the abort case only. VC-1116 holds for non-aborted lines. Any request failing aborts the run, including untimed ones (create, warm-up) and the presets baseline requests.

## D-005: smaller bench choices (Iteration 2)
Context: details the spec leaves open.
Decision: (a) `passed` compares the ROUNDED `p95Ms` with the limit; (b) `--p95-limit-ms` accepts 1..600000; (c) `--samples` is parsed with no default and rejected for `cold` after parsing (exit 2), `cold` runs with n 1; (d) base URL must parse as `https:`, trailing slashes are stripped for requests but the line keeps the value given; (e) stale pre-read requires a `HeadSchema`-valid document, anything else is `HeadMismatch`; (f) when a game ends mid-run the next game gets that scenario's untimed moves (3 warm, 1 stale) before timing resumes.
Rejected: judging the unrounded p95; a default `--samples` for cold.
Consequences: none for other scripts.

## D-006: smoke failure shape and choices (Iteration 3)
Context: FR-1118/1119 do not define the line after a failed step or how a thrown error is reported.
Decision: `steps` lists only the steps run, the last being the failed one (`ok:false`); the reason goes to stderr (`smoke: failed: <Name>: <message>`, secrets redacted), not into the line (as D-004). Any thrown error in a step (network, 30 s timeout, status mismatch) fails that step. `--base-url` must be https (as bench-moves). `no-leak` checks the seat token by substring in every body other than the create body. `finalRanking` must hold exactly seats 0..2 (1 human + 2 AI). The in-process helper gained an optional `cronSecret`.
Rejected: listing all ten steps with the unreached ones `ok:false`.
Consequences: Iteration 4's runbook should say that a failed run shows a shorter `steps` list.
