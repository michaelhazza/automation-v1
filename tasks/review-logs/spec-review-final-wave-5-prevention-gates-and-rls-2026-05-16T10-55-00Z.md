# Spec Review Final Report

**Spec:** `tasks/builds/wave-5-prevention-gates-and-rls/spec.md`
**Spec commit at start:** `86730eea38c1f2ca628f16175093b079a8616ec5`
**Spec commit at finish:** `d5521993ccb4581cac7c230101c77def06e0871f`
**Spec-context commit:** `docs/spec-context.md` (last reviewed 2026-05-11, age 5 days, well under 60-day warn)
**Iterations run:** 5 of 5
**Exit condition:** iteration-cap (loop hit MAX_ITERATIONS; finding count was on a strong decreasing trend — 19, 9, 6, 7, 1)
**Verdict:** READY_FOR_BUILD

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 16 | 3 | 14 mechanical | 0 | 0 | 0 | 2 — both accepted |
| 2 | 9 | 0 | 8 mechanical | 0 | 0 | 0 | 1 — accepted |
| 3 | 6 | 0 | 6 mechanical | 0 | 0 | 0 | 0 |
| 4 | 7 | 0 | 7 mechanical | 0 | 0 | 0 | 0 |
| 5 | 1 | 0 | 1 mechanical | 0 | 0 | 0 | 0 |

**Totals: 36 mechanical fixes applied, 0 rejected, 3 AUTO-DECIDED (all accepted, routed to `tasks/todo.md`).**

---

## Mechanical changes applied (by section)

### §1 Scope / §2 Goals / §3 Non-Goals
- Reframed prevention-gate inventory as "5 still-open + 1 already-closed verify-only" (PP-MC2 is `[status:closed:pr:332]`).
- Distinguished "Track A file set" (~231 files) from raw-`db` callsite count (chunk 0 produces the per-callsite number).
- Restated knip work as extending the existing `knip.json`, not authoring it.
- Goal 2 anchored on conditional Tier-1 migration: only callsites with chunk-0-verified upstream `withOrgTx` migrate; blocked callsites escalate.
- Goal 4 clarified: org-scoped transaction is primary; app-layer predicate stays as belt-and-braces.
- Primitive-changes explicitly out of scope (`getOrgScopedDb`, `withOrgTx`, `withAdminConnection`, P2 guard analyser); if chunk 0 finds a query-pattern gap, the spec pauses.

### §4 Framing assumptions
- Corrected `getOrgScopedDb` signature: takes `(source: string)`, not `(orgId, source)`; returns the in-flight ALS-bound tx handle and throws `failure('missing_org_context')` otherwise.
- Named the HTTP `authenticate` middleware (`server/middleware/auth.ts`) as the upstream entry that opens `withOrgTx` and issues `set_config('app.organisation_id', ...)`. Removed the fabricated "HTTP `orgScoping` middleware".
- Corrected `withAdminConnection`: helper does NOT acquire BYPASSRLS; caller must `SET LOCAL ROLE admin_role` inside the callback. Emission is a structured stderr `console.warn` (FK / recursive-tx constraints on `audit_events`).
- Enumerated the three accepted `guard-ignore` forms documented by the existing P2 gate (ADR / `reason="..."` / `guard-ignore-next-line`). Removed the fabricated `guard-ignore: rls-intentional-bypass` annotation.

### §5 Prevention gates (full rewrite)
- **§5.1 PP-CD1**: `verify-no-new-cycles.sh` exists; `circular-deps.txt` seeded 2026-05-14 at `cycle-count:0`; promoted to error 2026-05-15. Delta is wiring verification only.
- **§5.2 PP-DUP1**: gate exists as `verify-duplicate-blocks.sh` with `--min-tokens 15` over `server/ client/ shared/ worker/`. Baseline `duplicate-blocks.txt` seeded 8769 on 2026-05-14, promotion-revert tracked. Delta: re-seed + promote to error.
- **§5.3 PP-SK1**: net-new; baseline `mismatch-count:0` in `skill-registry-alignment.txt`; scans only `server/skills/` with explicit ignore list (no fabricated `docs/methodologies/`).
- **§5.4 PP-SK2**: `verify-universal-skill-sync.sh` already bidirectional. Two grandfathered baseline entries (`read_codebase` / `search_codebase`); delta is source alignment plus baseline cleanup.
- **§5.5 PP-FE2**: reuses existing `verify-frontend-design-budget.sh` + `docs/frontend-design-allowlist.json`. Removed fabricated parallel gate and fabricated `// frontend-design: admin-only-acceptance` annotation.
- **§5.6 PP-MC2**: gate exists; schema gate with no baseline; already `[status:closed:pr:332]`; delta is wiring verification only.

### §6 Migration pattern
- Replaced wrong `await getOrgScopedDb(orgId, 'caller')` example with the actual contract.
- Stated explicitly: `withOrgTx` is upstream (middleware / worker); migration does NOT introduce new `withOrgTx` call sites.
- Kept app-layer `where(eq(orgId))` predicate as defence-in-depth (removal out of scope; needs separate spec).
- Anchored "intended RLS contract" on `RLS_PROTECTED_TABLES` correctly: manifest carries `{tableName, schemaFile, policyMigration, rationale}` only; tenant keys derived from schema + policy migration by chunk 0.

### §7 knip extension
- Reframed as extension of existing `knip.json`; fixed `.claude/hooks/**/*.js` path; corrected "remaining flags genuinely unused" overclaim to "candidate flags pending triage".

### §8 Tier categorisation
- Tier 1 keeps app-layer predicate; migrates to `getOrgScopedDb('<callerName>')` inside upstream `withOrgTx`.
- Tier 2 migrates to `withAdminConnection({ source, reason }, async tx => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); ... })`; residue uses one of the three accepted `guard-ignore` forms.
- Verdict granularity is **per raw-`db` callsite**, not per file (mixed Tier 1+2 files require per-callsite resolution).

### §9 Acceptance criteria
- Criterion 2 narrowed to "Tier 1 with chunk-0-verified upstream `withOrgTx`"; blocked callsites are escalated.
- Static-gates-primary testing posture stated explicitly.
- Blocked-Tier-1 count added to PR Migration summary; Gate verdict summary table added (one row per gate plus knip).
- PP-MC2 removed from to-be-closed list (verify-only).
- F3/F4/F7 closure conditional on blocked-Tier-1 count being zero (otherwise `[status:partial:pr:<num>:remaining=<n>-blocked-callsites]`).

### §10 Chunks
- Chunk 0 artifact records per-callsite verdicts (file:line + tenant key + tier + upstream entrypoint or bypass rationale), file-level rollups as summary metadata.
- Removed fabricated "widen the P2 guard" chunk (existing analyser already per-callsite AST).

### §11 Risk register
- Aligned testing language with §9.8 (no manual-test-coverage handwave).
- Corrected Tier 2 risk row: `withAdminConnection` logs to stderr (not `audit_events`); three guard-ignore forms; no fabricated `rls-intentional-bypass`.
- Tenant-traffic Tier 1 callsites escalate (per §3); silent downgrade to Tier 2 removed.

### §13 File-overlap deconfliction
- Removed "git merge handles this naturally"; chunk 0 produces explicit per-file merge order.
- Added Session K W4AA-DEBT-1 dependency: K's orphan-resolution must merge BEFORE N's chunk 0 seeds PP-SK1.

---

## Rejected findings

None. All 41 findings (34 Codex + 3 rubric + 4 second-order during my fixes) were accepted as mechanical, autonomously accepted (3), or reclassified during the loop. Zero outright rejections.

---

## Directional and ambiguous findings (autonomously decided)

| Iter | Finding | Decision | Rationale |
|---|---|---|---|
| 1 | App-layer `where(eq(orgId))` predicate retention (Codex #3) | AUTO-DECIDED accept | Conservative tenant-isolation default; this very build closes a defence-in-depth gap, so it should not simultaneously remove the second defence. Predicate-removal is a separate follow-up spec. |
| 1 | Gate verdict summary in PR body (Codex #15) | AUTO-DECIDED accept | Symmetric with existing per-service-tier PR summary; minimal addition; prevents "seeded and passing" handwave at merge time. |
| 2 | Per-callsite tier verdict granularity (Codex #2) | AUTO-DECIDED accept | Mixed-posture files are exactly where forgotten Tier 1 callsites hide; per-callsite verdict is the safety-relevant granularity for a defence-in-depth build. |

All three captured in `tasks/todo.md` under `## Deferred spec decisions — wave-5-prevention-gates-and-rls`.

---

## Mechanically tight, but verify directionally

The spec is now mechanically tight against the rubric and against five rounds of Codex review. The directional decisions surfaced were resolved conservatively (keep the predicate, add the verdict summary, use per-callsite granularity).

What the review did not do:

- Did not re-verify the framing assumptions in `docs/spec-context.md`. If product context has shifted (live agencies onboarded, testing posture changed, rollout model changed) since the spec was written, re-read §4 yourself before calling the build implementation-ready.
- Did not catch directional issues neither Codex nor the rubric saw. Automated review converges on known classes of mechanical defect; it cannot generate product judgement from nothing.
- Did not prescribe what to build next. Sprint sequencing, scope trade-offs, and per-domain chunk priorities are still the human's job.
- Did not validate that chunk 0 can actually produce the per-callsite tier categorisation in a reasonable time frame; if 231 service files turn out to be 300+ once chunk 0 re-runs the count, the build may need to split or defer some domains.

**Recommended next step:** read §4 (Framing Assumptions) and §2 (Goals) one more time, confirm the headline framing matches current intent for Wave 5 Session N, then hand the spec to the architect for chunk 0.

**Note for chatgpt-spec-review:** the spec has been heavily corrected against repo state. The biggest reliance is on chunk-0 doing the work this review couldn't (per-callsite inventory + per-file org-context entrypoint mapping + per-table tenant-key derivation). If that work is too large for one chunk, sequencing risk worth surfacing.
