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
