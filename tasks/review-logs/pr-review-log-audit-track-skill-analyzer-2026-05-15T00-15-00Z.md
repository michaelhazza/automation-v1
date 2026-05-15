# PR Review — audit/track-skill-analyzer (Track A3, skillAnalyzerServicePure split audit)

**Reviewer:** pr-reviewer (independent, read-only)
**Timestamp (UTC):** 2026-05-15T00:15:00Z

Blocking: 0 / Should-fix: 0 / Consider: 1 (cosmetic, applied)
**Verdict:** APPROVED

---

## Evidence verification (caller asks A-E)

### A. SA4 — `boss.work` bypass at `server/index.ts:691` (CONFIRMED)
- Reproduces verbatim: `await boss.work('skill-analyzer', async (job) => { ... })` — no `createWorker` wrapper.
- `server/jobs/skillAnalyzerJobWithIncidentEmission.ts` does NOT open `withOrgTx`.
- `grep withOrgTx|withAdminConnection|getOrgScopedDb server/jobs/skillAnalyzerJob.ts` returns ZERO matches.
- The bypass is real and material.

### B. SA2 — line counts (CONFIRMED)
- `skillAnalyzerService.ts` = 2,642 LOC; `skillAnalyzerServicePure.ts` = 3,727 LOC. Total 6,369. Pure module 1.41× the impure shell. Verbatim correct.

### C. SA1 — `skill_analyzer_results` lacks RLS (CONFIRMED)
- `grep skill_analyzer_results migrations/*.sql | grep -iE "POLICY|ENABLE ROW|FORCE ROW"` returns ZERO matches.
- Not in `rlsProtectedTables.ts` either.
- Mitigation accurate — `server/routes/skillAnalyzer.ts:28-29` applies `requireSystemAdmin` to every route.

### D. Severity calibration for SA1 (medium/high)
- Defensible. WF1's parent table is reached by org members; SA1's table requires system_admin. Smaller attack surface. medium/high (vs WF1's critical/high) is the right calibration. The "single migration sprint" pairing of WF1 + SA1 in Recommended Next Steps is the right framing.

### E. KNOWLEDGE.md calibration
- Both new patterns carry `**Detection:**` one-liners (matches the post-Track-A2 R1 calibration bar).
- The `boss.work` pattern cross-references the WF4 cousin pattern (line 1537) — meaningful extra signal.

---

## Findings

### 🔴 Blocking — none.

### 🟡 Should-fix — none.

### 💭 Consider

[💭] **C1 — Duplicate `## Pass 2 Changes Applied` H2 heading in the audit log** (lines 74 and 82). Cosmetic but a future markdown TOC would produce two anchors with the same slug. **APPLIED in this PR — second occurrence (the `_(populated below)_` placeholder I left during the chunked-write workflow) removed.**

---

## Files NOT read

- `architecture.md` — too large; cited conventions re-verified directly against source files.
- `server/jobs/skillAnalyzerJob.ts` body — only grepped for withOrgTx/withAdminConnection/getOrgScopedDb (zero matches) which is the evidence SA4 needs.

---

## Specific things checked

- [PASS] Audit log conforms to framework v1.4 structure.
- [PASS] Every Pass 1 finding has Justification + Confidence + Proposed fix + Pass routing.
- [PASS] Six Pass 3 items routed to `tasks/todo.md` with `[origin:audit:skill-analyzer:...]` tags.
- [PASS] Six prevention proposals with `[target:...]` tags.
- [PASS] KNOWLEDGE.md appends carry `**Detection:**` one-liner.
- [PASS] Cross-track consistency — SA1↔WF1 and SA4↔WF4 named so the next migration sprint can batch fixes.

---

**Verdict:** APPROVED — ready to open PR.
