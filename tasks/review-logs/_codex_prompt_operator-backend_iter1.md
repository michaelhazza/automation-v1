You are reviewing a SPECIFICATION DOCUMENT (not code) for implementation-readiness.

The spec is at: `docs/superpowers/specs/2026-05-12-operator-backend-spec.md` (in this repo's working tree).

This spec ships the first concrete autonomous-operator backend (`operator_managed` adapter). It builds on three merged predecessor specs (adapter contract, sandbox isolation, operator-session identity).

Your job: read the spec end-to-end and surface findings that would prevent an implementer from building it correctly. Specifically look for:

1. **Contradictions** between sections (same concept described two different ways).
2. **Load-bearing claims without backing mechanisms.** "X must be idempotent" with no idempotency key named; "Y is the source of truth" with no precedence rule.
3. **File-inventory drift.** Prose references files / migrations / columns / services that are not in the § 5 "File inventory lock" table.
4. **Schema overlaps.** Two tables or columns with adjacent purposes without an explicit source-of-truth statement.
5. **Sequencing bugs.** A chunk in § 14 depends on something created in a later chunk.
6. **Invariants stated in one section but violable in another.** A guarantee in § 3 that § 7 or § 10 could violate.
7. **Missing per-item verdicts.** Items without an explicit BUILD/DEFER/WON'T DO.
8. **Unnamed new primitives.** Generic "a new service handles X" without a concrete file path + function signature.
9. **State-machine holes.** Valid transitions declared but a writer could produce a forbidden transition; or a state-set extension without updating every writer's optimistic predicate.
10. **Idempotency / concurrency holes.** A write path that could race or double-write without a named guard.
11. **Permissions/RLS gaps.** A new tenant-scoped table without RLS policy + manifest entry + route guard + principal-scoped context.
12. **Execution-model contradictions.** Inline call described as queued, or vice versa, or a cache-efficiency claim that contradicts the partition.
13. **Terminal-event guarantees.** Multiple potential terminal events on a chain without a single-terminal-event rule; or paused states leaking into terminal rollup.

For each finding, output:
- Section reference (e.g. "§ 3.7 item 3")
- One-sentence description of the issue
- A concrete suggested fix (verbatim language the implementer should add or change)
- Severity: critical / important / minor / nit

DO NOT:
- Suggest adding feature flags (this codebase is pre-production, no flags for new behaviour modes).
- Suggest staged rollouts or canary deploys (no staged rollouts in this codebase yet).
- Suggest E2E / frontend / API-contract / load / performance / chaos tests (testing posture is static-gates + pure-function only).
- Suggest introducing a new service that duplicates an existing primitive (the spec author has explicitly extended existing primitives).
- Suggest changing the spec's overall framing (pre-production, rapid evolution, no live customers).
- Provide a summary verdict at the end — just the findings list.

Be thorough. Specs are reviewed multiple times; misses are expensive.

Output format: a numbered list of findings, each with the four fields above. No preamble, no conclusion.
