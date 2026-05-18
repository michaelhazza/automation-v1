# ChatGPT Spec Review Session — new-task-modal-overhaul — 2026-05-18T03-41-57Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md
- Branch: builds/new-task-modal-overhaul
- PR: #352 — https://github.com/michaelhazza/automation-v1/pull/352
- Mode: manual
- Started: 2026-05-18T03:41:57Z

---

## Round 1 — 2026-05-18T03:53:59Z

### ChatGPT Feedback (raw)

1. Spec marked "Open Questions: None" while permission migration remains conditional
Severity: high | Category: implementation readiness
The BRIEFS_WRITE → TASKS_WRITE DB storage question is still unresolved and may add Migration F during plan authoring. That is a real open decision, not merely a deferred item. The spec says no open questions remain, which is internally inconsistent.

2. Hard cutover relies on unverified "no external consumers" assumption
Severity: high | Category: architecture
The spec assumes no external /api/briefs/* consumers and chooses hard cutover, but the verification method is not specified. Add a required scan/check for docs, Postman collections, API clients, partner integrations, logs, or route telemetry before implementation.

3. Migration D down script conflicts with "rollback supported" wording
Severity: medium | Category: clarity
Migration D is intentionally non-reversible, but rollback is described as supported for reversible migrations. That is acceptable, but the spec should explicitly state that a full build rollback after Migration D is not semantically complete unless a forward-fix or timestamped rollback is authored.

4. Advisory attachment posture may weaken the product goal
Severity: medium | Category: architecture
The goal says the modal captures files so the task can be useful immediately, but advisory upload allows execution before attachments land. This is a valid decision, but the operator-facing consequence should be made explicit: attachments are context enrichment, not guaranteed execution context.

5. tasks.description NOT NULL may affect existing non-intake paths
Severity: medium | Category: bug
Migration E makes tasks.description NOT NULL, and POST /api/subaccounts/:id/tasks is updated, but the spec does not prove all other task insert paths already provide description. Add a mandatory repo-wide insert audit for tasks creation paths before Migration E.

6. description = '' backfill undermines the new min-1 contract for old rows
Severity: low | Category: improvement
Existing rows with null descriptions become empty strings. That is acceptable for legacy data, but it creates historical rows that violate the new semantic requirement. Spec should state legacy rows are exempt from the min-1 invariant.

7. Task title requirement is inconsistent between UX and API
Severity: low | Category: clarity
Modal requires Title, but /api/task-intake accepts missing title and derives it from instructions. That defensive behavior is reasonable, but it should be called out as API compatibility behavior, not part of the normal product contract.

8. Route naming may create future ambiguity
Severity: low | Category: architecture
/api/task-intake separates AI-augmented intake from kanban task CRUD, which is reasonable. But the spec should explicitly document why this is not /api/tasks/intake, because future developers may recreate the route-family ambiguity.

9. Gate 1 may miss camelCase and type-level remnants
Severity: medium | Category: implementation readiness
The automated grep checks portal_briefs and /api/briefs, but does not catch portalBriefs, BriefCreationEnvelope, briefId, or renamed service/type remnants. Some are covered manually, but for a 300+ file rename, more automated coverage is warranted.

10. Manual gates are heavy for a major rename
Severity: medium | Category: improvement
Accessibility, stable identifier preservation, semantic rename review, and runnable-state confirmation are manual. That may be acceptable under the stated testing posture, but the PR template/checklist must be explicit enough to avoid hand-wavy compliance.

11. In-flight branch conflict check is missing from the spec body
Severity: low | Category: implementation readiness
The brief had a concurrent safety note. This spec does not include a concrete pre-launch scan for other active builds touching /api/briefs, NewBriefModal, portalBriefs, or tasks.description. Add that to phase sequencing or execution safety.

12. Permission rename could become user-facing access regression
Severity: high | Category: bug
If roles currently grant BRIEFS_WRITE, changing guards to TASKS_WRITE without a confirmed role/permission data migration will lock users out. This is related to finding 1 but severe enough to call out separately. The permission storage decision must be resolved before route rename work.

Overall verdict: CHANGES_REQUESTED

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — "Open Questions: None" inconsistent with conditional Migration F | technical | apply | **escalated (pending user)** | high | Severity-high carveout — surfacing because the framing of "open question" vs "deferred item" is a directional call. |
| F2 — Hard cutover relies on unverified "no external consumers" assumption | technical | apply | **escalated (pending user)** | high | Severity-high carveout. Adds a concrete verification step before cutover. |
| F3 — Migration D down conflicts with "rollback supported" wording | technical | apply | auto (apply) | medium | Pure internal-clarity fix to §6.3 — added "Whole-build rollback caveat" paragraph. |
| F4 — Advisory attachment posture: make operator-facing consequence explicit | **user-facing** | apply | **escalated (pending user)** | medium | "Attachments are context enrichment, not guaranteed execution context" is operator-facing expectation copy. |
| F5 — `tasks.description` NOT NULL may affect non-intake insert paths | technical | apply | auto (apply) | medium | Added mandatory plan-authoring audit of every `tasks` insert path before Migration E ships. |
| F6 — `description = ''` backfill undermines new min-1 contract for legacy rows | technical | apply | auto (apply) | low | Added explicit statement: min-1-character invariant applies to new writes only; legacy backfilled rows exempt. |
| F7 — Title requirement inconsistent between UX and API | technical | apply | auto (apply) | low | Added note framing the divergence as API-compatibility behaviour, not the product contract. |
| F8 — Route naming `/api/task-intake` vs `/api/tasks/intake` | technical | apply | auto (apply) | low | Added rationale paragraph in §5.1 explaining why the path is flat-sibling, not nested. |
| F9 — Gate 1 may miss camelCase and type-level remnants | technical | apply | auto (apply) | medium | Extended Gate 1 to two passes; Pass 2 catches camelCase identifiers, type names, import-symbol remnants, and service-file names. |
| F10 — Manual gates need explicit PR-template checklist | technical | apply | auto (apply) | medium | Added §13.1 with a paste-into-description checklist block covering gates 2, 4, 6, 8, 9. |
| F11 — In-flight branch conflict check missing | technical | apply | auto (apply) | low | Added §12.1 with two concrete bash + gh scans recorded in `progress.md`. |
| F12 — Permission rename could lock users out | **user-facing** | apply | **escalated (pending user)** | high | Access-policy / permission storage decision — operator-facing if mis-shipped. Severity-high carveout. |

### Integrity check
Integrity check: 0 issues found this round (auto: 0, escalated: 0). New sub-section anchors (§12.1, §13.1) checked against the §17 self-consistency pass — the existing "§12.1 of spec-authoring-checklist" reference is unambiguously external (different document) and does not collide with the new in-spec §12.1.

### Applied (auto-applied technical)
- [auto] F3 — Added "Whole-build rollback caveat" paragraph to §6.3 making the post-Migration-D rollback semantics explicit.
- [auto] F5 — Added mandatory plan-authoring audit of every `tasks` insert path as a Migration E pre-condition.
- [auto] F6 — Added an explicit exemption for legacy backfilled rows from the new min-1-character invariant (in §6.3 Migration E).
- [auto] F7 — Added a note framing the Title UX-vs-API divergence as API-compatibility behaviour in §7.1.
- [auto] F8 — Added a "Why `/api/task-intake` and not `/api/tasks/intake`?" rationale paragraph to §5.1.
- [auto] F9 — Extended Gate 1 to a two-pass grep: Pass 2 catches camelCase identifiers, type names, import-symbol remnants.
- [auto] F10 — Added §13.1 with the paste-into-PR-description checklist block for manual gates 2, 4, 6, 8, 9.
- [auto] F11 — Added §12.1 with two pre-launch concurrent-branch scans.

### Pending user decision (escalated)
- F1 (high) — Restore an `## Open Questions` entry for the conditional Migration F (permission DB storage)?
- F2 (high) — Add a concrete external-consumer verification step (route-telemetry / partner-integration / docs grep) before hard cutover?
- F4 (medium, user-facing) — Add explicit operator-facing framing ("attachments are context enrichment, not guaranteed execution context")?
- F12 (high, user-facing) — Promote the permission storage decision from §14 deferred-item to a pre-Chunk-4 blocker?

### Operator decision (2026-05-18, end of Round 1)
All 4 pending findings: **apply as recommended.**

### Applied (user-approved, after operator decision)
- [user] F1 — Added §18 OQ1 ("Permission key DB storage") with explicit pre-Chunk-4 blocker semantics; recorded resolution paths (a) code-only / (b) DB-persisted; cross-linked to §6.1, §6.3, §8.1, §10, §14.
- [user] F2 — Added "External-consumer verification (pre-Chunk-4 mandatory check)" block to §6.1 with four concrete checks: repo grep for `/api/briefs`, Postman/OpenAPI/Insomnia scan, 30-day route-telemetry query, partner-integration / webhook docs scan. Result recorded in `progress.md`.
- [user] F4 — Added "Operator-facing framing" paragraph to §7.4 declaring attachments are "context enrichment, not guaranteed execution context"; required this expectation to surface in the modal's lifecycle notice copy and forbade misleading "all files received before start" phrasing in operator-facing copy.
- [user] F12 — Promoted permission DB-storage resolution to a **pre-Chunk-4 BLOCKER** in §6.1; rewrote the §14 deferred-item entry to be a cross-reference pointer rather than a deferral; added explicit pre-Chunk-4 gate language to §12 Chunk 4 ("both gates [OQ1 + external-consumer verification] must be cleared before this chunk commits").

### Integrity check (post-edit)
Integrity check: 0 issues found this round (auto: 0, escalated: 0). Verified §18 OQ1 anchor exists; §14 → §18 OQ1 / §6.1 cross-link resolves; §12 Chunk 4 → §18 OQ1 + §6.1 cross-links resolve; §7.4 "two-sentence lifecycle notice" anchor exists at line 373.

---
