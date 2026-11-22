# Review ledger — 00-project-scaffold.md

Original line count: 201 · After pass 1: 206

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-001 | 1 | MUST | Data & Interfaces, empty-string rule | "Optional" undefined; empty-string handling ambiguous, conflicted with VC-024 | fixed | Empty string = unset for every variable; VC-024/026 updated |
| R-002 | 1 | MUST | BR-005 | Startup fail-fast promised, no FR wires it | decided | Operator: defer wiring to Phase 8; BR-005 scoped to `loadConfig`; listed in Out |
| R-003 | 1 | SHOULD | Scope Out / FR-028 | Build not checked anywhere until Phase 11 | decided | Operator: add `pnpm build` to CI |
| R-004 | 1 | SHOULD | BR-006 | Merge gate needs branch protection, untestable | fixed | Reworded to "CI reports failure"; branch protection in Out |
| R-005 | 1 | SHOULD | Layer boundaries preamble | Matching semantics (path vs resolver), import forms | fixed | Path-based, any depth, `import`/`import type`/`export from`, inline type; dynamic import Out |
| R-006 | 1 | SHOULD | FR-019 / BR-004 | `config.ts` not a layer; UI could type-import it | fixed | FR-019 says any `src` module outside `src/domain`; config importers stated |
| R-007 | 1 | SHOULD | FR-002 / FR-021 | File fixtures would break typecheck | fixed | Fixtures are inline `lintText` strings |
| R-008 | 1 | SHOULD | FR-024 / FR-025 | Cross-field CRON_SECRET error may be dropped | fixed | FR-024 + VC-025 mixed-input case |
| R-009 | 1 | SHOULD | FR-029 / VC-029 | `next-env.d.ts` vague; VC incomplete | fixed | Ignored; VC-029 extended |
| R-010 | 1 | SHOULD | NFR-002 / FR-028 | Warm cache never configured | fixed | pnpm store cache in FR-028; measure second run |
| R-011 | 1 | SHOULD | NFR-003 / FR-003 | Warnings not enforced | fixed | `--max-warnings 0` |
| R-012 | 1 | SHOULD | FR-007 | TS runner unnamed | fixed | `tsx` |
| R-013 | 1 | SHOULD | Assumptions | Major versions open | fixed | Minimum majors pinned |
| R-014 | 1 | COULD | FR-022, RETENTION_DAYS format, test glob | getConfig after throw; format; glob | fixed | Addressed incidentally by R-001/R-008 edits (low cost) |
| R-015 | 1 | COULD | Data & Interfaces | Defer Blob pass-through vars to Phase 5 | deferred | |
| R-016 | 1 | COULD | FR-007 | Defer `simulate` stub to Phase 4 | wontfix | Operator chose stub in discovery |
| R-017 | 1 | COULD | NFR-004 | `@noble/hashes` not needed in Phase 0; phase-scope allowlist | deferred | |
| R-018 | 1 | COULD | Scope In | Placeholder wording | fixed | `.gitkeep` |
| R-019 | 2 | SHOULD | Actors table | "Loads configuration at startup" stale vs deferred wiring | deferred | Delta pass; not a blocker |
| R-020 | 2 | SHOULD | FR-028/FR-029 | typecheck before build without Next generated types | deferred | Delta pass; not a blocker |
| R-021 | 2 | SHOULD | Layer preamble / VCs | No VCs for deep relative, export-from, inline type cases | deferred | Delta pass; not a blocker |
| R-022 | 2 | SHOULD | FR-017 | Config-importers sentence misplaced, no VC | deferred | Delta pass; not a blocker |
| R-023 | 2 | SHOULD | FR-003 | Prettier scope may include docs/specs markdown | deferred | Delta pass; not a blocker |
| R-024 | 2 | COULD | FR-012/013, VC-021/022, FR-013 zod subpaths, Files list | Minor wording/edge items | deferred | |

## Passes
- Pass 1 (discovery, 3 reviewers): 2 verified MUST (R-001 fixed, R-002 decided) + 11 SHOULD fixed.
- Pass 2 (delta): 0 MUST; SHOULD/COULD deferred (R-019–R-024).
- Pass 3 (readiness): 0 MUST. **Verdict: READY.** Optional polish noted: Actors row wording, Prettier scope, VC-005 "includes".
