# Phase 2 (BUILD) Handoff — phase-1-showcase-mvps

**Build slug:** phase-1-showcase-mvps
**Branch:** feat/phase-1-showcase-mvps
**Spec:** tasks/builds/phase-1-showcase-mvps/spec.md (LOCKED)
**Plan:** tasks/builds/phase-1-showcase-mvps/plan.md (10 chunks)
**Phase 2 closed:** 2026-05-10T13:15:18Z
**Status at handoff:** REVIEWING — ready for `launch finalisation`
**Commits ahead of main:** 26 (start `b0fda916`, head `eb15c14b`)

---

## Scope shipped

Two MVPs across 10 chunks plus 5 review-driven fix batches.

### Chunks 1-5 — 42 Macro production hardening + run-artifact pipeline

| # | Chunk | Files |
|---|---|---|
| 1 | File delivery service | migration 0313 + `fileDeliveryService.ts` + Pure version |
| 2 | Run artifact read surface | `server/routes/runArtifacts.ts` + `server/routes/internal/runArtifactsFinalize.ts` + integration test |
| 3 | PDF report generation | PDF render integrated into `agentRunFinalizationService.ts` + `ieeRunCompletedHandler.ts` |
| 4 | 42 Macro Run Trace UI | `RunTraceArtifactsPanel`, `RunTraceHeadline`, `MacroFailureRenderers` |
| 5 | 42 Macro stuck-run detector | `staleMacroRunDetector.ts` + Pure + tests |

### Chunks 6-10 — Support Agent

| # | Chunk | Files |
|---|---|---|
| 6 | classify_ticket skill | `supportClassifyTicket.ts` + Pure + Zod runtime contract |
| 7 | Support Agent install + record + master prompt | 3 schema files + `supportAgentInstallRoute.ts` + `supportAgentInstallService.ts` + migration 0314 |
| 8 | Execution loop | `supportAgentExecutionService.ts` + Pure + atomic-claim integration test + `supportAgentRunJob.ts` |
| 9 | Eval harness + CI gate | `supportEvalHarness.ts` + Pure + `verify-support-agent-eval-thresholds.sh` + `supportEvalDailyJob.ts` + migration 0315 |
| 10 | UI surfaces | `SupportAgentDashboard.tsx` + `InboxAgentConfigTab.tsx` + Run Trace event renderers |

### Review-driven fix batches

| Commit | Trigger | Coverage |
|---|---|---|
| `910236f0` | spec-conformance NON_CONFORMANT | Closed 7 H/P blockers: REQ #4, #5, #27, #36, #40, #41, #49, #52. Added master-prompt loader, agent_runs run-create site, phase1RunTraceEventEmitter, InboxAgentConfigTab composition, 3 pg-boss worker registrations, internal route mount. |
| `6061c6fd` | pr-reviewer CHANGES_REQUESTED (5 P0 + 7 strong) | Closed 5 P0 (B1 RLS-bypass in supportAgentExecutionService, B2 RLS-bypass in phase1RunTraceEventEmitter, B3 timing-vulnerable secret + tenant-isolation gap, B4 isSystemRun derivation, B5 missing resolveSubaccount) + 3 strong (S1 skill-list mismatch via migration 0316, S2 thread loading for draft step, S6 escalation-pending logger signal). |
| `a86d4caf` | pr-reviewer round-2 regression | One-line `SET LOCAL ROLE admin_role` in verifyRunBelongsToOrg + SAVEPOINT placement inside try block. |
| `bc59aebe` | adversarial-reviewer HOLES_FOUND (8 findings) | Closed all 8: ADV-1 supportEvalHarness org-scoped db, ADV-2 mimeType allowlist (write + read defenses), ADV-3+6 migration 0317 RLS-guard corrective, ADV-4 evals/run org-targeting tightened, ADV-5 per-artifact 10MB cap, ADV-7 placeholder-value escape, ADV-8 explicit org filter in supportDraftReconciliationWorker. |
| `d3026f98` | dual-reviewer Codex (3 iterations, 7 findings) | Closed 5 accepted: classifier non-draft-action handling, eval-fixture intent-enum alignment, retention-sweep S3-outage no-progress break, artifact-list visibility parity, untracked transcript cleanup. 2 rejected with rationale (1 architectural gap deferred to REQ #40, 1 in-place rework). |

### Migrations

| Number | Purpose |
|---|---|
| 0313 | run_artifacts (FORCE RLS, partial unique index, retention sweep target) |
| 0314 | support_agent_install (subaccount_agents.applied_template_slug + partial unique index + system_agents seed for support-agent) |
| 0315 | support_eval_runs (FORCE RLS) |
| 0316 | corrective: swap default_system_skill_slugs (support.set_custom_field → ask_clarifying_question) per spec §5.3.1 |
| 0317 | corrective: support_eval_runs RLS policy aligned with canonical IS NOT NULL AND <> '' guards |

---

## Branch-level review pass — all gates closed

| Reviewer | Verdict | Log |
|---|---|---|
| spec-conformance (initial) | NON_CONFORMANT | `tasks/review-logs/spec-conformance-log-phase-1-showcase-mvps-2026-05-10T10-00-17Z.md` |
| spec-conformance (re-verify) | CONFORMANT_AFTER_FIXES | `tasks/review-logs/spec-conformance-log-phase-1-showcase-mvps-2026-05-10T10-36-38Z.md` |
| pr-reviewer (round 1) | CHANGES_REQUESTED (5 P0 + 7 strong) | Verbal; findings captured in commit `6061c6fd` body |
| pr-reviewer (round 2) | CHANGES_REQUESTED (1 regression + 1 strong) | Verbal; findings captured in commit `a86d4caf` body |
| pr-reviewer (round 3) | APPROVED | Verbal; both round-2 fixes verified |
| adversarial-reviewer | HOLES_FOUND (1 confirmed + 1 likely + 3 worth-confirming + 3 obs) → ALL CLOSED | Verbal; findings captured in commit `bc59aebe` body |
| dual-reviewer (Codex 3 iterations) | APPROVED | `tasks/review-logs/dual-review-log-phase-1-showcase-mvps-2026-05-10T13-12-59Z.md` |

**REVIEW_GAP:** none. Codex CLI was available; dual-reviewer ran 3/3 iterations.

**spec_deviations:** the 9 medium/low spec-conformance gaps (REQ #18 macro lifecycle event emitters, REQ #19 run_stuck emitter location, REQ #28 default skill swap [closed via 0316], REQ #30 install route path mismatch, REQ #33 forbidden-token list, REQ #42 draft_dispatched/draft_blocked_by_policy, REQ #12 PDF xref-sort, REQ #25 system_skills classify_ticket seed, REQ #34 master-prompt eval-gate) remain explicitly deferred to post-merge per operator decision. All logged in `tasks/todo.md` under the spec-conformance section.

---

## Verification at Phase 2 close

| Gate | Result |
|---|---|
| `npm run typecheck` | PASS (both client + server tsconfigs) |
| `npm run lint` | PASS (0 errors, 888 warnings — all pre-existing) |
| `npm run build:server` | PASS |
| `npm run build:client` | not run (deferred to CI) |
| Targeted unit tests | not run (deferred to CI per project posture) |

---

## Open issues for finalisation

### Deferred to post-merge backlog (`tasks/todo.md`)

**From spec-conformance:** 9 medium/low items (see above).

**From pr-reviewer (under "Deferred from pr-reviewer (branch-level) - phase-1-showcase-mvps (2026-05-10)"):**
- PR-S3 — finalize endpoint body cap (10MB JSON limit may reject large worker uploads; needs path-scoped 50mb parser or multipart refactor)
- PR-S4 — phase1RunTraceEventEmitter is a parallel write path; should be unified with canonical `appendEvent`
- PR-S5 — runArtifactsRetentionSweepJob single shared admin tx (per-org tx pattern preferred)
- PR-S6 — escalation paths emit `escalation_action_pending` warn-log only; full `support.add_internal_note + support.assign(human)` skill-handler implementation is missing
- PR-S7 — no integration tests for phase1RunTraceEventEmitter
- PR-N1..N7 — non-blocking improvements (path resolution, cache comment, type tightening, button type, applied_template_id population, artifacts-list comment, dist/ gitignore confirmation)

**From adversarial-reviewer:** all 8 findings closed in this branch.

**From dual-reviewer:** 1 architectural gap deferred — the `support-agent-run` pg-boss queue has no producer in this codebase (job receives `subaccountAgentRunId` from a payload but no enqueuer exists). Tracked as REQ #40 in todo.md; the registration was wired but no caller produces messages yet. This is the same surface called out in REQ #36 (controller_style native enforcement). A follow-up build needs to add the producer (probably a webhook hook on Teamwork ticket.created + a scheduled tick that enqueues per active inbox).

### Doc-sync sweep (deferred to finalisation)

The doc-sync sweep across the full feature change-set has not yet run at Phase 2 — the finalisation-coordinator's Step 6 will execute the `docs/doc-sync.md` checklist against:
- `architecture.md` — likely needs additions for the run-artifact pipeline, file delivery service, support agent surface
- `docs/capabilities.md` — needs entries for the support-agent capability, file-delivery primitive, run-artifact read surface
- `KNOWLEDGE.md` — patterns from the build (RLS bypass via bare-db, MIME allowlist for inline preview, agent_runs run-create site, master-prompt loader, etc.)
- `docs/integration-reference.md` — Teamwork webhook surface (already present from chunk 7)

---

## Phase 3 entry context

- **Active spec:** `tasks/builds/phase-1-showcase-mvps/spec.md`
- **Active plan:** `tasks/builds/phase-1-showcase-mvps/plan.md`
- **Branch:** `feat/phase-1-showcase-mvps` (head `eb15c14b`)
- **No PR open yet** — finalisation-coordinator Step 4 will create one via `gh pr create --fill`
- **dual-reviewer verdict:** APPROVED — no REVIEW_GAP

The branch is ready for `launch finalisation` from a fresh Claude Code session on Opus.
