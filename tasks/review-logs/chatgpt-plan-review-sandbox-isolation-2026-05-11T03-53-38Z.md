# chatgpt-plan-review — sandbox-isolation

**Date:** 2026-05-11
**Plan:** tasks/builds/sandbox-isolation/plan.md
**Mode:** manual

## Session info

- **Build slug:** sandbox-isolation
- **Spec status:** accepted, locked 2026-05-11 (1679 lines, read-only context for ChatGPT)
- **Plan author:** architect (Opus, feature-coordinator playbook)
- **Plan shape:** 16 chunks (C1a, C1b, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11a, C11b, C12, C13, C14); ~55 files total; dependency graph per spec §23.1
- **Phase 1 prior history:** 3 rounds of chatgpt-spec-review on the spec (30 findings, all technical/auto-applied, zero user-facing decisions). Spec-review log: `tasks/review-logs/chatgpt-spec-review-sandbox-isolation-2026-05-11T02-09-36Z.md`
- **Pre-flight notes from architect (resolved by operator):**
  - Spec §19.3 cites `server/jobs/index.ts`; actual registration site is `server/services/queueService.ts`. Plan binds to actual file. Operator confirmed leaving spec as-is.
  - Spec uses `is_active boolean` for soft-delete; codebase has both `is_active` and `deletedAt` shapes. Plan follows spec.

---

## Round 1

**Operator feedback summary:** ChatGPT-web returned `NEEDS_REVISION` with 5 required fixes (F1-F5) + 5 recommended tightenings (R1-R5). Verdict was directionally solid but unlocked.
**Findings:** 10 total (technical: 8, technical-with-judgement: 2, user-facing: 0)

### Decisions

| # | Finding | Triage | Decision | Rationale |
|---|---|---|---|---|
| F1 | C5 has undeclared dependency on C1b (lease columns + inferred row types) | technical | ACCEPT | Auto-applied. Added C1b → C5 to dependency graph (§4.2 ASCII + linear), chunk overview table (C5 row), and C5 detail section. |
| F2 | C8 imports C11a's job module → backwards dependency | technical | ACCEPT | Auto-applied. C8's `withSandboxProvider` declares an enqueue seam (`enqueueSandboxHarvestReconciliation`); C11a wires the concrete pg-boss registration. Hard ban on C8 importing `sandboxHarvestReconciliationJob.ts`. Updated §4.2 linear graph + C8 detail. |
| F3 | C9 (and C10) depend on C12 for template_digest / parser, but graph said no | technical | ACCEPT | Auto-applied. Added C12 → C9 and C12 → C10 to dependency graph + chunk overview + C9 / C10 detail sections. |
| F4 | OpenClaw scaffolding under-specified (only `.gitkeep` planned, spec calls for placeholders) | technical-with-judgement | ACCEPT (attached to C12) | Auto-applied per operator triage note: placeholder files (`Dockerfile`, `entrypoint.sh`, `CURRENT_VERSION`, `README.md`) attached to C12 alongside `synthetos-sandbox` (template-build infra), NOT C1a (types scaffolding). C1a's `.gitkeep` removed; C12 file count rises to 12. CI publish workflow's tag-name guard explicitly excludes openclaw-session until activation. |
| F5 | "Manifest entries in migrations" wording is imprecise (manifest is TS, not SQL) | technical | ACCEPT | Auto-applied. Rewrote C1b prose: each migration block now reads "...RLS policy. **Same chunk / same commit:** matching `rlsProtectedTables.ts` entry appended in this chunk." Manifest is now correctly framed as TypeScript application file outside the SQL migration. |
| R1 | C1b file count understated (says 9, actually 10) | technical | ACCEPT | Auto-applied. Chunk overview C1b row updated to 10; new posture note in C1b detail section explains paired `.down.sql` files are excluded by convention; cohesive ≤1-logical-responsibility justification added. |
| R2 | C12 over file-limit (suggests 3-way split) | technical-with-judgement | ACCEPT (do not split, justify exception) | Auto-applied per operator triage note: C12 represents ≤1 logical responsibility (template-build infrastructure that C9 / C10 / C11a / C13 / C14 all depend on). Chunk-size posture box added to C12 detail explaining the OR-clause justification. Splitting would force partial template state across multiple PRs which is strictly worse. |
| R3 | C14 over file-limit (suggests 2-way split) | technical-with-judgement | ACCEPT (do not split, justify exception) | Auto-applied per operator triage note: C14 represents ≤1 logical responsibility (build-closeout sweep). Splitting gates from doc-sync would create two PRs that must land together anyway (gates without docs = unmergeable; docs without gates = no enforcement). Chunk-size posture box added to C14 detail. |
| R4 | `server/jobs/index.ts` drift treated as open question, should be plan correction | technical | ACCEPT | Auto-applied. §3 retitled "Plan corrections + remaining open questions". 3.1 rewritten as a plan correction (binding spec intent to actual `queueService.ts`); operator decision no longer required. |
| R5 | C7 plans `sandboxHarvestService.test.ts` for pure helpers, violates Pure-only stance | technical | ACCEPT | Auto-applied. C7 no longer creates `sandboxHarvestService.test.ts`. Pure helpers extracted in C7 are tested in C6's `sandboxHarvestServicePure.test.ts` (extended). C7 file count drops from 3 to 2. Updated C7 "Files to create or modify", "Testing requirements", chunk overview table. |

### Changes applied

- §4.2 dependency graph: ASCII diagram + linear form updated for F1, F2, F3 edges (C1b → C5, C12 → C9, C12 → C10; C8's seam contract documented for F2).
- §4.4 chunk overview table: C1a (3 → 2 files; OpenClaw moved to C12), C1b (9 → 10 files; cohesive-justification note), C5 (depends on `C1b, C2, C4`), C7 (3 → 2 files), C8 (enqueue-seam contract noted), C9 (depends on `C5, C8, C12`), C10 (depends on `C5, C8, C12`), C11a (concrete-registration role of enqueue seam noted), C12 (9 → 12 files; OpenClaw placeholders + cohesive-justification note), C14 (cohesive-justification note).
- §3 retitled "Plan corrections + remaining open questions"; §3.1 rewritten as plan correction (no operator decision needed).
- C1a detail: dropped `.gitkeep` line; added cross-reference to C12 for OpenClaw placeholders. Acceptance criteria updated.
- C1b detail: file-count posture note added; per-migration prose rewritten to clarify manifest is TypeScript file appended in same chunk / same commit (F5).
- C5 detail: added explicit "Depends on" line citing C1b prerequisite (F1).
- C7 detail: dropped `sandboxHarvestService.test.ts` from "Files to create or modify"; testing requirements rewritten to direct pure-helper tests to C6's `sandboxHarvestServicePure.test.ts`; non-pure orchestrator clarified as having no local test file (R5).
- C8 detail: added enqueue-seam contract + hard ban on importing `sandboxHarvestReconciliationJob.ts` (F2).
- C9 detail: added explicit "Depends on" line citing C12 prerequisite (F3).
- C10 detail: added explicit "Depends on" line citing C12 prerequisite (F3).
- C12 detail: chunk-size posture box added; 4 OpenClaw placeholder files added to "Files to create or modify"; CI workflow's tag guard explicitly excludes openclaw-session (F4 + R2).
- C14 detail: chunk-size posture box added (R3).

### Verdict

ChatGPT verdict was `NEEDS_REVISION`. All 10 findings auto-applied (F1-F5 + R1-R5). Plan now reflects: corrected dependency graph (F1, F2, F3); accurate file counts (R1, R5); precise manifest wording (F5); template scaffolding completeness (F4); explicit chunk-size justifications for the two intentional ≤1-logical-responsibility exceptions (R2, R3); and `server/jobs/index.ts` resolved as plan correction not open question (R4).


---

## Round 2

**Operator feedback summary:** ChatGPT-web returned a build-readiness pass with 4 required fixes (F1-F4) + 2 cosmetic cleanups (R1-R2). Verdict was lock-ready after F1-F4. All findings technical; operator pre-authorised closing the loop.
**Findings:** 6 total (technical: 6, user-facing: 0)

### Decisions

| # | Finding | Triage | Decision | Rationale |
|---|---|---|---|---|
| F1 | C4 resolver cannot compile before C9 / C10 exist (would import non-existent provider modules) | technical | ACCEPT (registration seam) | Auto-applied per operator triage. C4 ships only the resolver seam + inline + validation; concrete providers (e2bSandbox, localDockerSandbox) call `registerSandboxProvider()` at module init in C9 / C10. C4 has a hard ban on importing C9 / C10. Resolver throws fail-fast if a registered provider name is requested but not yet registered. |
| F2 | §7.2 build sequencing was stale (showed C5 → C2,C4 / C9,C10 → C5,C8) | technical | ACCEPT | Auto-applied. §7.2 rewritten to match §4.2 / §4.4: C5 depends on C1b, C2, C4; C9 / C10 depend on C5, C8, C12; C11a depends on C7, C8, C9, C10, C12. Cross-checked §4.3 cross-chunk invariants — no other stale dep references. |
| F3 | OpenClaw `CURRENT_VERSION` placeholder is single-line but spec compels 5-field shape; would fail the gate | technical | ACCEPT (Option A) | Auto-applied per operator triage (Option A). `verify-template-version-coherence.sh` is hard-scoped to `infra/sandbox-templates/synthetos-sandbox/` only in V1; `openclaw-session/` is explicitly excluded until the OpenClaw adapter spec activates the directory. C12 OpenClaw placeholder stays as the single-line `version=0.0.0-placeholder`. C14 gate definition documents the exclusion as a hard-coded scan-path list (not glob). |
| F4 | C8 enqueue seam needed a concrete owner (typed reference vs queue-name string was vague) | technical | ACCEPT (job-name-constants pattern) | Auto-applied per operator triage. C8 now owns `server/lib/sandboxJobNames.ts` exporting `SANDBOX_HARVEST_RECONCILIATION_JOB = 'sandbox-harvest-reconciliation' as const;` C8's `withSandboxProvider` enqueues by job name via `boss.send(...)`; C11a imports the same constant when registering `boss.work(...)`. Hard ban on C8 importing the C11a handler module remains. C8 file count rose 1 → 2. |
| R1 | C12 file count said 12 but actual count was 14-15 | technical | ACCEPT | Auto-applied. C12 chunk overview row updated from `12` to `≈14`. Total file count row at the bottom of §4.4 updated to ≈56 to reflect F4's +1 and R2's −1 net. |
| R2 | `docs/env-manifest.json` was double-touched (C4 partial + C14 final) | technical | ACCEPT | Auto-applied per operator triage. All env-manifest updates consolidated into C14 (single commit, all five Spec B env-vars together). C4 removes `docs/env-manifest.json` from its file list; explanation note added to C4 detail. C4 file count drops 3 → 2. C14 env-manifest line expanded to enumerate `SANDBOX_PROVIDER`, `SANDBOX_ALLOW_INLINE`, `E2B_API_KEY`, `E2B_PROJECT_PROD`, `E2B_PROJECT_STAGING`. |

### Changes applied

- **§4.2 dependency graph:** unchanged (already correct as of Round 1; Round 2 found no new edges to add or remove).
- **§4.4 chunk overview table:** C4 row (3 → 2 files; env-manifest moved to C14; registration-seam role noted), C8 row (1 → 2 files; new `sandboxJobNames.ts` constants module noted), C12 row (12 → ≈14 files; OpenClaw README acknowledged), §4.4 total file-count line updated to ≈56.
- **C4 detail:** new "Compile-order posture" callout box explaining the registration-seam pattern (F1); resolver no longer imports `e2bSandbox` / `localDockerSandbox` (hard ban); added `registerSandboxProvider(name, constructor)` to public interface; resolver throws fail-fast on unregistered-provider lookup; `inlineSandbox` stays imported directly; env-manifest line removed and replaced with deferral note pointing to C14 (R2).
- **C8 detail:** new `server/lib/sandboxJobNames.ts` file added to "Files to create or modify"; module shape extended to expose the constants; contract now specifies `boss.send(SANDBOX_HARVEST_RECONCILIATION_JOB, ...)` enqueue with hard ban on importing the C11a handler module (F4).
- **C9 detail:** added "Module-init side effect" line on `e2bSandbox.ts` calling `registerSandboxProvider('e2b', ...)` (F1).
- **C10 detail:** added "Module-init side effect" line on `localDockerSandbox.ts` calling `registerSandboxProvider('local_docker', ...)` (F1).
- **C11a detail:** `sandboxHarvestReconciliationJob.ts` line updated to import `SANDBOX_HARVEST_RECONCILIATION_JOB` from `server/lib/sandboxJobNames.ts` (C8) and register via `boss.work(...)` against the constant (F4).
- **C12 detail:** OpenClaw `CURRENT_VERSION` line clarified as not-scanned-by-gate-in-V1; placeholder shape unchanged (single-line `version=0.0.0-placeholder`); cross-link to C14 gate scope clarification (F3).
- **C14 detail:** `verify-template-version-coherence.sh` line updated to declare hard-coded scope = `synthetos-sandbox/` only with explicit `openclaw-session/` exclusion (F3); `docs/env-manifest.json` line rewritten as the canonical single-pass entry enumerating all five Spec B env-vars (R2).
- **§7.2 Build sequencing:** rewritten to match §4.2 / §4.4 — C5 step now cites C1b dependency; C9 / C10 step cites C12 dependency and C4 registration-seam side effect; C11a step lists C7, C8, C9, C10, C12 (F2).

### Verdict

ChatGPT verdict was `lock-ready after F1-F4`. All 6 findings auto-applied (F1-F4 + R1-R2). Plan now reflects: registration-seam pattern eliminating the C4 → C9 / C10 forward-reference compile risk (F1); §7.2 sequencing aligned with §4.2 / §4.4 dep graph (F2); OpenClaw placeholder excluded from V1 gate scope (F3); concrete `sandboxJobNames.ts` constants module owned by C8 (F4); accurate C12 file count (R1); single env-manifest commit in C14 (R2).

---

## Final Summary

**Verdict:** APPROVED
**Rounds:** 2
**Auto-applied:** 16 findings total (Round 1: 10, Round 2: 6)
**Operator-approved:** 0 (all findings were technical; no user-facing decisions)
**Deferred to tasks/todo.md:** 0
**Log path:** `tasks/review-logs/chatgpt-plan-review-sandbox-isolation-2026-05-11T03-53-38Z.md`

The plan is locked-in for build. Round 1 closed the dependency-graph and file-inventory drifts; Round 2 closed the compile-order, sequencing-section, OpenClaw-gate-scope, and enqueue-seam concrete-owner gaps. All 16 findings were technical (no user-facing scope decisions needed).
