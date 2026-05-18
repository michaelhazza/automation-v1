# ChatGPT Spec Review Session — new-task-modal-overhaul — 2026-05-18T03-41-57Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-18-new-task-modal-overhaul-spec.md
- Branch: builds/new-task-modal-overhaul
- PR: #352 — https://github.com/michaelhazza/automation-v1/pull/352
- Mode: manual
- Started: 2026-05-18T03:41:57Z
- Finalised: 2026-05-18T05:10:00Z
- **Verdict:** APPROVED (3 rounds)

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

## Round 2 — 2026-05-18T04:30:00Z

### ChatGPT Feedback (raw)

1. Open question remains in a "reviewing" spec
Severity: medium | Category: implementation readiness
OQ1 is now correctly called out and blocked before Chunk 4, but the spec is not fully implementation-ready until that is resolved. This is acceptable for plan authoring, but not for execution past Chunk 3.

2. ABCd Build sizing still says 5 migrations
Severity: low | Category: clarity
The ABCd block says "5 schema/data migrations," but Migration F may make it 6. Either say "5, or 6 if permission storage is DB-backed" or leave migration count out of the lifecycle estimate.

3. Self-consistency section still says "5 migrations" without conditional caveat
Severity: low | Category: clarity
Numeric reconciliation states 5 migrations, but OQ1 may introduce Migration F. Add the same conditional note there.

4. Framing assumption still states "No external API consumers" too strongly
Severity: low | Category: clarity
§6.1 now adds a mandatory verification gate, which is good, but §3 still states no external consumers as fact. Change it to "assumed, pending mandatory verification before Chunk 4."

5. Operator-facing attachment framing may create expectation mismatch
Severity: low | Category: product clarity
The spec now correctly says files are context enrichment, not guaranteed execution context. That should also be reflected in success criteria or PR checklist copy review, otherwise modal copy could drift.

Overall verdict: NEEDS_DISCUSSION

The remaining issues are not architectural blockers. Resolve OQ1 before Chunk 4 and clean up the conditional migration wording.

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — OQ1 remains open in a "reviewing" spec | technical | reject (no-op) | auto (reject) | medium | The spec already documents OQ1 as a pre-Chunk-4 blocker in §18 + §6.1 + §12 Chunk 4 gates. ChatGPT's note ("acceptable for plan authoring, not for execution past Chunk 3") is exactly what the spec already encodes; no new text needed. Verdict NEEDS_DISCUSSION is driven by the open question existing, not by missing language. |
| F2 — ABCd Build sizing should carry conditional Migration F caveat | technical | apply | auto (apply) | low | Pure internal-clarity fix — added "or 6 if §18 OQ1 resolves to DB-persisted permissions (adds conditional Migration F)" to the ABCd Build row. |
| F3 — Self-Consistency numeric reconciliation should carry the same caveat | technical | apply | auto (apply) | low | Added matching conditional note to §17's "File inventory ↔ prose consistency" sentence AND to the "5 migrations" line of §17 Numeric reconciliation. |
| F4 — §3 "No external API consumers" framing still too strong | technical | apply | auto (apply) | low | Softened §3 framing line to "assumed, pending mandatory verification before Chunk 4" with explicit cross-reference to §6.1's four-check block. Also swept the matching overconfident phrasing in §6.1 ("No external consumers confirmed" → "No external consumers are assumed to exist; this assumption is verified before Chunk 4 by the mandatory check block below"). |
| F5 — Operator-facing attachment framing should be enforced via PR checklist to prevent modal-copy drift | technical | apply | auto (apply) | low | The operator-facing copy itself ("context enrichment, not guaranteed execution context") was already approved in Round 1 F4. F5 is purely a copy-review enforcement mechanism — a PR-template item the operator has no judgement to add on top of the already-decided copy. Added a new "Operator-facing copy review (modal lifecycle notice)" subsection to §13.1 with three tick-boxes: (1) lifecycle notice communicates context-enrichment framing, (2) no forbidden "all files received before start" phrasing, (3) final copy pasted into PR description for auditability. Updated §13.1 intro to mention the new subsection. |

### Integrity check
Integrity check: 1 issue found this round (auto: 1, escalated: 0).
- §6.1's "No external consumers confirmed" sentence (line 168) carried the same overconfident framing that F4 critiqued in §3. Swept to a softer pre-verification statement in the same edit pass as F4 — purely mechanical follow-through, no directional decision needed.
- Also swept §12.1's "5 migrations" mention (line 749) to add the conditional Migration F caveat, matching F2/F3 for surface-consistency.

Post-integrity sanity: §17 cross-references resolve (§6.1, §6.3, §8.1, §18 OQ1); §18 OQ1 anchor exists; §13.1 internal subsection naming consistent; no broken section anchors introduced; no empty sections.

### Applied (auto-applied technical)
- [auto] F2 — Added conditional Migration F caveat to ABCd Lifecycle Estimate "Build" row.
- [auto] F3 — Added conditional Migration F caveat to §17 "File inventory ↔ prose consistency" sentence AND to the "5 migrations" line of §17 numeric reconciliation.
- [auto] F4 — Softened §3 framing line to "assumed, pending mandatory verification before Chunk 4"; swept matching overconfident phrasing in §6.1 and §12.1 in the same pass.
- [auto] F5 — Added "Operator-facing copy review (modal lifecycle notice)" subsection to §13.1 with three tick-boxes covering the §7.4 framing; updated §13.1 intro to acknowledge the new subsection.

### Pending user decision (escalated)
None this round. All five findings classified as technical; none triggered an escalation carveout (all low/medium severity, all apply-recommendations except F1 which is a no-op reject, none cross architecture.md / docs/spec-context.md in a cross-spec way, no [missing-doc] tag, no low-confidence fixes).

---

## Round 3 — 2026-05-18T05:05:00Z

### ChatGPT Feedback (raw)

No findings. Round 2's conditional Migration F caveats (ABCd Build row, §17 numeric reconciliation, §12.1), the §3 / §6.1 / §12.1 framing softening, and the §13.1 operator-facing copy-review subsection cleanly resolved the five Round 2 items. OQ1 remains an explicit pre-Chunk-4 blocker (correctly scoped per §6.1 and §12 Chunk 4). No new issues surfaced.

Overall verdict: APPROVED

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| (none — clean round) | — | — | — | — | Round 3 returned zero findings; ChatGPT verdict APPROVED. |

### Integrity check
Integrity check: 0 issues found this round (auto: 0, escalated: 0). No edits this round, so no integrity-pass triggers. Pre-existing cross-references (§18 OQ1 anchor, §6.1 verification block, §12 Chunk 4 gates, §13.1 manual-gate checklist, §17 numeric reconciliation with conditional caveat) verified intact via the prior round's post-edit pass; no further verification required.

### Applied
None this round. No changes to the spec; the round was a clean confirmation pass.

### Operator decision (2026-05-18, end of Round 3)
**Done.** Operator confirmed Round 3 verdict is the final state. No further iteration needed. Proceed to finalisation.

---

## Final Summary

- **Rounds:** 3
- **Auto-accepted (technical):** 12 applied | 1 rejected (Round 2 F1 — no-op reject) | 0 deferred
- **User-decided:** 4 applied (Round 1 F1, F2, F4, F12 — all "apply as recommended") | 0 rejected | 0 deferred
- **Index write failures:** 0 (clean)
- **Deferred to tasks/todo.md § Spec Review deferred items / new-task-modal-overhaul:** none — no new defers this session. (Pre-existing spec-reviewer defers NTMO-D1/D2/D3 from `tasks/todo.md § Deferred spec decisions — new-task-modal-overhaul` remain in place from spec-reviewer iteration 1; they are scoped to that prior review and were not re-opened in this session.)
- **KNOWLEDGE.md updated:** no — checked patterns from this session (open-question-vs-deferred-item framing, conditional-migration-count caveats, pre-blocker promotion, operator-facing copy-review checklist for advisory attachment posture); none recur as a sufficiently general pattern to warrant a new entry. Each is documented in-spec where it applies.

### Consistency Warnings
None. No finding was applied in one round and reversed in another. Round 2 F1 ("OQ1 remains open in a reviewing spec") was a no-op reject because the spec already encoded the exact requirement (OQ1 as pre-Chunk-4 blocker per §18 + §6.1 + §12), not a reversal of an earlier decision.

### Implementation Readiness Checklist
- **All inputs defined:** Pass. Modal field set (Title, Instructions, Owner, Attachments, optional Priority) defined in §7.x; API request shapes for `/api/task-intake` and `/api/subaccounts/:id/tasks` defined in §5.1 + §7.1.
- **All outputs defined:** Pass. `TaskCreationEnvelope` and the kanban task object envelopes defined; lifecycle states unchanged (§16).
- **Failure modes covered:** Pass. Idempotency, advisory attachment posture, migration rollback semantics including whole-build rollback caveat (§6.3), and the conditional Migration F branch (§18 OQ1 + §6.1 + §12 Chunk 4 gates) all defined.
- **Ordering guarantees explicit:** Pass. §12 single-phase chunk order with pre-Chunk-4 gates (OQ1 resolution + external-consumer verification) explicit; §12.1 pre-launch concurrent-branch scan defined.
- **No unresolved forward references:** Pass. §18 OQ1 is explicitly scoped as a pre-Chunk-4 blocker resolved during plan authoring, not as a spec-internal unresolved forward reference. All in-spec section cross-references (§5, §6.1, §6.3, §7.x, §8.x, §12, §13, §13.1, §14, §17, §18) resolve.

All five checks pass. The spec is implementation-ready, subject to the explicit OQ1 resolution gate at plan authoring (recorded in §18 + §6.1 + §12 Chunk 4 — this is the intentional design, not a readiness gap).

### Doc Sync Sweep

Investigation procedure: derived grep terms from the session diff (build slug `new-task-modal-overhaul`; route surface `/api/briefs` / `/api/task-intake` / `task-intake`; permission keys `BRIEFS_WRITE` / `TASKS_WRITE`; table/column rename surface `portalBriefs` / `portal_briefs` / `portalCards` / `fastPathDecisions.briefId` / `tasks.description`; component names `NewBriefModal` / `NewTaskModal`; type surface `BriefCreationEnvelope` / `BriefUiContext` / `TaskUiContext`; conditional-migration concept "Migration F"). Greped each candidate against every doc in the registry.

- **architecture.md updated:** no — checked `BRIEFS_WRITE`, `/api/briefs`, `/api/task-intake`, `NewBriefModal`, `NewTaskModal`, `portal_briefs`, `portalBriefs`, `BriefCreationEnvelope`, `BriefUiContext`. Two pre-existing mentions found: (1) line 776 historical PR-feedback list referencing `GET /api/briefs/:briefId/artefacts` — accurately describes the current pre-rename codebase, not stale; (2) line 2951 `portalBriefs` table description — accurately describes the current schema. Both will be updated by the implementation build (Phase 2) when the rename actually lands in code; updating them now would create the opposite stale-doc problem (doc describes a renamed surface that the code has not yet renamed). Spec-only change; no architecture.md edit required at finalisation.
- **docs/capabilities.md updated:** n/a: docs-only change. This is a spec-review finalisation; no merged build, no capability surface change. Capability Registration (the §6.2.1 verdict-format trigger) applies at PR-merge time via `finalisation-coordinator`, not at spec-review finalisation. The capability cluster (`Agent Runtime`) and owner (`owner-resolution-task-board-workspace`) are recorded in the spec's Lifecycle Declaration for the eventual merge-time registration step.
- **docs/integration-reference.md updated:** n/a — no skill, no integration scope, no OAuth provider, no MCP preset, no capability slug, no alias touched by this spec.
- **CLAUDE.md / DEVELOPMENT_GUIDELINES.md updated:** n/a — no build-discipline rule, no agent-fleet change, no review-pipeline change, no locked-rule change. Greped both for the rename/route/permission surface; zero matches.
- **CONTRIBUTING.md updated:** n/a — no lint-suppression-policy or contributor-convention change.
- **docs/frontend-design-principles.md updated:** n/a — no new UI pattern, hard rule, or worked example introduced this session. The spec describes one new modal that re-uses existing patterns; the design principles already cover modal design.
- **KNOWLEDGE.md updated:** no — checked `NewBriefModal`, `BRIEFS_WRITE`, `/api/briefs`, `portalBriefs`. One pre-existing mention at line 1578 referencing `NewBriefModal.tsx` from chatgpt-pr-review on PR #313 (page-splits build) — accurately describes the historical PR-feedback source, not stale. No new entry warranted from this session's patterns (see Final Summary KNOWLEDGE.md row above for rationale).
- **docs/spec-context.md updated:** no — checked framing fields: `pre_production: yes` and `live_users: no` (the spec's `§3 Framing assumptions` block explicitly relies on both and they remain accurate); `last_reviewed_at: 2026-05-11` (within the 120-day staleness gate). No framing assumption introduced or contradicted by this spec.
- **docs/decisions/ updated:** n/a — no durable architectural choice was newly locked here; the route topology / hard-cutover / advisory-attachment / single-canonical-model decisions are all recorded inside the spec under §5, §6.1, §7.8, and §14, which is the appropriate home for build-spec decisions. (ADRs are for cross-spec durable choices; this is intra-build.)
- **docs/context-packs/ updated:** n/a — no `architecture.md` section anchor changed, no new mode introduced.
- **references/test-gate-policy.md updated:** n/a — no test-gate posture change; the spec's §13 invariants and §13.1 PR checklist are build-specific gates, not the local-vs-CI test-gate-policy surface.
- **references/spec-review-directional-signals.md updated:** n/a — `spec-reviewer` is a separate agent from `chatgpt-spec-review`; the signals file is keyed off the former's surface heuristics, and this session is not a `spec-reviewer` run.
- **docs/incident-response.md updated:** n/a — no SEV-matrix or on-call-rotation change.
- **docs/testing-transition-plan.md updated:** n/a — no migration-trigger or test-inventory-sequencing change.
- **.claude/FRAMEWORK_VERSION / .claude/CHANGELOG.md updated:** n/a — repo-specific spec change, not a framework-layer change.
- **scripts/verify-* gates updated:** n/a — no gate added/removed/renamed, no suppression-grammar change, no baseline-expiry-policy change. (`scripts/gates/verify-brief-rename.sh` is referenced by the spec but lands in implementation Chunk 8; it does not yet exist in the codebase, and authoring it now would be premature.)

### PR
- PR: #352 — https://github.com/michaelhazza/automation-v1/pull/352

---

## Operator-facing summary

Spec is approved and ready for the build phase. 3 rounds; 16 total findings (12 auto-applied technical fixes + 4 user-approved escalations + 1 no-op reject — Round 3 was clean). Spec status flipped from `reviewing` to `accepted`. Two explicit pre-Chunk-4 gates remain in the spec by design: (1) permission DB-storage resolution (§18 OQ1), (2) external-consumer verification (§6.1) — these resolve during plan authoring, not now. Next handoff: architect (plan authoring) or invoke writing-plans skill.
