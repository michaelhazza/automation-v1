# Spec Review Iteration 1 — Wave 5 Session M (LAEL Phase 1+2 + Hermes Tier 1)

- **Spec:** `tasks/builds/wave-5-lael-phase-1-and-2/spec.md`
- **Spec commit at start:** `4c4213dce9d5f173bad9b741e2ec923b605db1e5`
- **Spec-context commit at start:** `62497257bb53bc99cf55b9f442af951cf4ddd318`
- **Iteration:** 1 of 5 (lifetime)

---

## Codex findings (7)

### FINDING #1 — §4 / §4.4 emission-pattern contradiction
- **Source:** Codex
- **Description:** §4 blanket-states all emissions go through `tryEmitAgentEvent`, §4.4 requires awaited `appendEvent` for critical `handoff.decided`.
- **Classification:** mechanical (contradiction inside spec; §7.2 already supports the carve-out).
- **Disposition:** auto-apply

### FINDING #2 — §5.2 / §8 file inventory drift for edit services
- **Source:** Codex
- **Description:** §5.2 says edit *services* own the audit-row write; §8 lists only route files.
- **Classification:** mechanical (file inventory drift).
- **Disposition:** auto-apply — add service files with chunk-0 hedge.

### FINDING #3 — §5.3 banner scope ambiguity
- **Source:** Codex
- **Description:** Banner claims "edited since run start" but the audit table only records edits with a `triggeringRunId` — outside-the-run edits are invisible.
- **Classification:** mechanical (load-bearing claim without precise mechanism; narrowing-only fix matches the data the table holds).
- **Disposition:** auto-apply — narrow to "edits triggered from this run".

### FINDING #4 — §5.3 endpoint projection lacks source-of-truth
- **Source:** Codex
- **Description:** Endpoint projection introduces fields without naming LAEL §5.8 as authoritative; `editSummary` mapping undefined; banner copy mentions "by Y" but projection omits editor.
- **Classification:** mechanical (Contracts section omission + projection completeness).
- **Disposition:** auto-apply — add explicit projection-from-LAEL §5.8 statement; include `editedByUserId` to support banner.

### FINDING #5 — §6.1 H1 test wording inconsistency
- **Source:** Codex
- **Description:** Render text "Successful: $X.XX" vs test (c) "$0.00 successful"; tests (a) and (c) edge-case collision when total=0 and successful=0.
- **Classification:** mechanical (string + edge-case consistency).
- **Disposition:** auto-apply.

### FINDING #6 — §8 vague "equivalent rule + data-source routes" row
- **Source:** Codex
- **Description:** Four edit surfaces collapsed into one row.
- **Classification:** mechanical (file inventory drift).
- **Disposition:** auto-apply — explicit rows with chunk-0 hedge.

### FINDING #7 — §8/§10 missing shared response type for /edits endpoint
- **Source:** Codex
- **Description:** No shared response type or pure helper for the new endpoint.
- **Classification:** mechanical (file inventory completeness + execution-model clarity).
- **Disposition:** auto-apply — state inline-only execution; add shared response type to §8.

---

## Rubric findings (3)

### R-CHECKLIST — Lifecycle Declaration + ABCd Estimate don't match `docs/spec-authoring-checklist.md` §12 canonical shape
- **Source:** Rubric (checklist compliance)
- **Description:** Lifecycle Declaration uses non-canonical fields; ABCd is free-text one-liner rather than 4-row S/M/L table; frontmatter missing `Spec date` / `Last updated` / `Build slug`.
- **Classification:** mechanical (checklist compliance; defaults are stable).
- **Disposition:** auto-apply.

### R-CHUNK-COUNT — §2 / §10 disagree with the labelled chunk list
- **Source:** Rubric (numeric-count reconciliation per checklist §8)
- **Description:** §2 says "6–10 chunks"; §10 says "Six chunks if H3/§6.8 clean, eight to ten otherwise"; but chunks labelled 0–10 = 9 always-on + 1 conditional + 1 doc-sync = 9 min, 10 max.
- **Classification:** mechanical (numeric-count drift).
- **Disposition:** auto-apply.

### R-BANNER-EDIT-SCOPE / R-BANNER-AUTHOR-FIELD — merged into FINDING #3 / #4 fixes.

---

## Edits applied (mechanical)

1. **[ACCEPT] Frontmatter (R-CHECKLIST):** added `Spec date`, `Last updated`, `Build slug`; switched `Status: Draft for spec-reviewer` → `Status: reviewing`.
2. **[ACCEPT] §2 Lifecycle Declaration (R-CHECKLIST):** rebuilt to canonical 5-field shape per `docs/spec-authoring-checklist.md §12.1`; `Lifecycle state on launch = Growth`, `Risk surface = None.` with rationale, `Review cadence = on-incident-only`, `Capability owner = main-session` placeholder.
3. **[ACCEPT] §2.1 ABCd Estimate (R-CHECKLIST):** new 4-row S/M/L table per checklist §12.2 replacing the one-line free-text estimate.
4. **[ACCEPT] Table of contents:** updated to reflect new §2.1.
5. **[ACCEPT] §4 emission pattern (FINDING #1):** explicit critical-vs-non-critical split with the awaited-appendEvent carve-out for `handoff.decided`; cross-references §4.4 and §7.2.
6. **[ACCEPT] §5.3 banner scope + API projection (FINDING #3 + #4):** narrowed banner to "edits with triggeringRunId = this run"; added explicit "Scope limitation (deliberate)" callout; added explicit API-projection block with LAEL §5.8 as authoritative; included `editedByUserId` so the banner copy "edited by Y" is supported.
7. **[ACCEPT] §6.1 H1 (FINDING #5):** standardised display string as literal `Successful: $X.XX`; rewrote test cases to remove the all-zero edge-case ambiguity (case (a) covers `total === successful` including both zero; case (c) is `successful === 0 AND total > 0`).
8. **[ACCEPT] §8 Files table (FINDING #2 + #6 + #7):** expanded the four edit-route group into four explicit route rows + four explicit edit-service rows (with chunk-0 hedges on three filenames); added `shared/types/agentExecutionLogEdits.ts` for the API-projection type; tagged the new `/edits` endpoint as inline-only.
9. **[ACCEPT] §10 chunk plan + count (R-CHUNK-COUNT):** updated chunk count reconciliation to "minimum 10, maximum 11"; chunk 6 description now mentions routes + edit services + shared type; chunk 0 marked "no production code change" explicitly. ABCd Build rationale aligned to "10–11 chunks".

## Iteration 1 counts (final)

- Mechanical findings accepted: 9 (7 Codex + 2 rubric net; R-BANNER-EDIT-SCOPE / R-BANNER-AUTHOR-FIELD absorbed into Codex #3 + #4)
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions: 0
- AUTO-DECIDED items routed to tasks/todo.md: 0

## Iteration 1 Summary

- Mechanical findings accepted:  9
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing):    0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED:             0
- Spec commit after iteration:   (set after commit)

---
