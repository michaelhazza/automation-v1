# ChatGPT PR Review Session — wave-4-architectural-and-duplication — 2026-05-16T06:05:54Z

## Session Info
- Branch: claude/wave-4-architectural-and-duplication
- PR: #331 — https://github.com/michaelhazza/automation-v1/pull/331
- Mode: manual
- Started: 2026-05-16T06:05:54Z

---

## Round 1 — 2026-05-16T06:05:54Z

### ChatGPT Feedback (raw)
I'll review this as a PR diff against the accepted spec and plan, prioritising correctness regressions and spec-conformance gaps over style.

F1 — DUP1 is not actually implemented
Spec/plan require a HistoryRender default component and all 3 call sites to import/use it. The PR only extracts CheckOption and FilterActions, so the main duplicated rendering bodies likely remain.

F2 — DUP5 does not match the locked contract
Spec/plan require named export TemplateGrid and both pages to import TemplateGrid. The PR exports/imports TemplateSlotRow instead. This may reduce duplication, but it fails the accepted contract.

F3 — Architecture doc is now stale
architecture.md documents HandlerContext.workflowEngine without startWorkflowRun, but the actual interface and tests include startWorkflowRun. Update the doc shape so future builders do not copy the wrong contract.

Verdict: READY_AFTER_FIXES.

### Pre-triage diff-misread checks
- F1: verified live files — `HistoryRender.tsx` exports `CheckOption` + `FilterActions`; all 3 call sites import from the new module. Spec §6.1 was updated at Chunk 5 remediation (2026-05-16) with note "spec originally specified 'default export HistoryRender' but the builder correctly extracted the actual shared surface." ChatGPT read plan.md (not updated), not the canonical spec.
- F2: verified live files — `TemplateGrid.tsx` exports `TemplateSlotRow`; both call sites import it. Spec §6.5 was updated at Chunk 9 remediation (2026-05-16) with the same pattern. ChatGPT read plan.md, not the canonical spec.
- F3: verified against `server/services/handlerContextTypes.ts` — actual interface has `startWorkflowRun` in intersection type; architecture.md code block omitted it. Real gap.

### Recommendations and Decisions
| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 DUP1 not implemented | technical | reject | auto (reject) — diff-misread | low | Spec §6.1 updated at build time to accept CheckOption+FilterActions; plan.md (read by ChatGPT) was not updated but spec is canonical. All 3 call sites confirmed importing from new module. |
| F2 DUP5 wrong export name | technical | reject | auto (reject) — diff-misread | low | Spec §6.5 updated at Chunk 9 remediation to accept TemplateSlotRow. ChatGPT read stale plan.md. Both call sites confirmed importing TemplateSlotRow. |
| F3 architecture.md stale HandlerContext shape | technical | implement | auto (implement) | medium | Real gap — code block missing startWorkflowRun from workflowEngine intersection type. Future builders would copy the wrong contract. |

### Implemented (auto-applied technical)
- [auto] Updated architecture.md HandlerContext shape to include startWorkflowRun (commit 5898b63c)

---

## Round 2 — 2026-05-16T06:05:54Z

### ChatGPT Feedback (raw)
F4 — definePruneJob accepts unvalidated string identifiers for table and cutoffColumn
Both fields flow directly into sql.raw() without an identifier guard. If a caller passes attacker-controlled input, this is SQL injection. Add a simple regex gate (`/^[a-z][a-z0-9_]*$/`) before the sql.raw() call, or use a closed union type listing every allowed table/column.

Verdict: READY_AFTER_F4.

### Pre-triage diff-misread checks
- F4: verified against `server/jobs/lib/definePruneJob.ts` — table and cutoffColumn were passed to sql.raw() with no validation. Real gap.

### Recommendations and Decisions
| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F4 definePruneJob unvalidated sql.raw() identifiers | technical | implement | auto (implement) | medium | Real security gap — identifier validation (`/^[a-z][a-z0-9_]*$/`) added at factory creation time. Runtime guard matches all 5 confirmed callers (valid identifiers). Closed-union alternative rejected: requires API changes and all-caller updates for no additional safety benefit when guard fires at factory time. |

### Implemented (auto-applied technical)
- [auto] Added identifier validation for table and cutoffColumn before sql.raw() in definePruneJob (commit eb2c1398); also updated PruneJobConfig JSDoc to document the constraint.
- [auto] Verified all 5 live callers (agentObservationsPruneJob, fastPathDecisionsPruneJob, sandboxEgressAuditPruneJob, sandboxLogsPruneJob, sandboxTelemetryPruneJob) pass valid identifiers — zero API changes needed.

---

## Final Summary — 2026-05-16T06:05:54Z

| Round | Finding | Decision | Action |
|-------|---------|----------|--------|
| 1 | F1 DUP1 not implemented | auto-reject (diff-misread) | none — spec §6.1 updated at build time |
| 1 | F2 DUP5 wrong export name | auto-reject (diff-misread) | none — spec §6.5 updated at build time |
| 1 | F3 architecture.md stale HandlerContext | auto-implement | architecture.md updated (5898b63c) |
| 2 | F4 definePruneJob sql.raw() no validation | auto-implement | identifier guard added (eb2c1398) |

**Deferred items:** none

**Doc-sync verdicts:**
- architecture.md: yes — HandlerContext shape fix + handler-injection section already present
- docs/capabilities.md: n/a — internal refactor, no capability surface change
- docs/integration-reference.md: n/a — no integration behaviour changes
- CLAUDE.md / DEVELOPMENT_GUIDELINES.md: no — no stale references introduced
- docs/frontend-design-principles.md: no — no new UI hard rules or patterns
- KNOWLEDGE.md: yes — 3 new patterns appended

**Session outcome:** MERGE_READY after F3 + F4 auto-fixes.
