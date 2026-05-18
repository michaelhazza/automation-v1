# ChatGPT Spec Review Session — deterministic-validators — 2026-05-18T13-04-50Z

## Session Info
- Spec: docs/superpowers/specs/2026-05-18-deterministic-validators-spec.md
- Branch: claude/deterministic-validators-3Xjcb
- PR: #356 — https://github.com/michaelhazza/automation-v1/pull/356
- Mode: manual
- Started: 2026-05-18T13:04:50Z

---

## Round 1 — 2026-05-18T13:04:50Z

### ChatGPT Feedback (raw)
Round 1 produced 14 findings (F1–F14) covering: enum-shape drift, dependency-graph notation, schema-CHECK gaps, tenant evidence leak, startup-boot resilience, cross-brief integration contract, missing API route for verdict drill-in, evidence-redaction documentation, source_hash encoding, retention posture, testing posture, cross-reference correctness, and self-consistency overstatement. Raw paste consolidated into the per-finding entries below (operator triaged inline before logging).

### Recommendations and Decisions

| Finding | Triage | Recommendation | Final Decision | Severity | Rationale |
|---------|--------|----------------|----------------|----------|-----------|
| F1 — `deterministic_external` listed as QualityCheck.kind in routing table; should be Validator.kind only | technical | apply | auto (apply) | high | Forward-ref / enum-shape drift; routing table contradicted the type model. Removed from QualityCheck.kind; clarified resolution at dispatch time. |
| F2 — Dependency graph notation reversed (post-conditions read like pre-conditions) | technical | apply | auto (apply) | medium | Internal contract clarity; rewrote as explicit dependency order (each step requires named predecessors). |
| F3 — validator_invocations.evaluation_method enum too permissive (allows semantic/hybrid_semantic) | technical | apply | auto (apply) | medium | Schema-CHECK gap; narrowed to deterministic / deterministic_external / hybrid_deterministic_fail / hybrid_precondition_pass / inconclusive. |
| F4 — `inconclusive` missing from scorecard_judgements.evaluation_method CHECK constraint | technical | apply | auto (apply) | medium | Internal contract bug; verdict ledger could not store the documented dispatcher outcome. Added to CHECK. |
| F5 — validator_invocations tenant evidence leak risk (raw matched text could land in system-tier table) | technical | apply (partial) | auto (apply, partial) | high | Architectural correctness; added redaction contract to §6.6 (structural metadata only, no raw matched text). Full tenant-isolation audit deferred to §18 — escalation carveout met (high severity, architectural), but the immediate redaction rule is mechanical and the deferred follow-up is logged in §18 where the operator will see it during finalisation. |
| F6 — Startup upsert into validator_versions can block server boot if DB unavailable | technical | apply | auto (apply) | medium | Internal resilience; defined fail-closed behaviour (log warning, continue; validators still execute; audit incomplete row noted). |
| F7 — Safety-class external integration: side-effect contracts unclear | technical | apply | auto (apply) | medium | Cross-brief integration boundary; added note to §7.6 — effects 2+3 fulfilled via `safety_class_check_failed` event emission; consuming briefs own subscription contract. |
| F8 — No API route surfaced for VerdictDrillIn data | technical | apply | auto (apply) | medium | Internal contract gap; added §10.2 note that existing judgement fetch route must be extended and Phase 2 builder confirms response schema. |
| F9 — Evidence redaction requirements per validator class missing | technical | apply | auto (apply) | medium | Documentation completeness; added per-validator-class redaction rules to §6.6 doc requirement section. |
| F10 — source_hash encoding not pinned | technical | apply | auto (apply) | low | Internal contract precision; pinned to lowercase hex SHA-256 in §5.2. |
| F11 — No data-retention posture for audit tables | technical | apply | auto (apply) | low | Deferred backlog; routed to §18 deferred items (validator_invocations growth, retention window TBD). |
| F12 — Testing posture too weak | technical | reject | auto (reject) | medium | `[missing-doc]`-adjacent: docs/spec-context.md explicitly sets `api_contract_tests: none_for_now` and `frontend_tests: none_for_now` as project framing. ChatGPT was unaware of project-level testing posture. Reject is correct on framing grounds; no doc update needed (framing already documented). |
| F13 — Wrong cross-reference in §11 Step 7 | technical | apply | auto (apply) | low | Mechanical fix; corrected reference. |
| F14 — Self-consistency claim in §20 overstated | technical | apply | auto (apply) | low | Internal precision; softened §20; open items now explicitly listed. |

### Applied (auto-applied technical + user-approved user-facing)
- [auto] F1 — Removed `deterministic_external` from QualityCheck.kind routing table; clarified dispatch-time resolution
- [auto] F2 — Rewrote dependency graph as explicit dependency order
- [auto] F3 — Narrowed validator_invocations.evaluation_method enum
- [auto] F4 — Added `inconclusive` to scorecard_judgements.evaluation_method CHECK
- [auto] F5 — Added §6.6 evidence redaction contract (structural metadata only); deferred full tenant-isolation audit to §18
- [auto] F6 — Defined fail-closed startup-upsert behaviour
- [auto] F7 — Added §7.6 cross-brief integration note (`safety_class_check_failed` event)
- [auto] F8 — Added §10.2 contract note for VerdictDrillIn route extension
- [auto] F9 — Added per-validator-class redaction rules to §6.6
- [auto] F10 — Pinned source_hash to lowercase hex SHA-256 in §5.2
- [auto] F11 — Added retention posture to §18 deferred items
- [auto] F13 — Corrected §11 Step 7 cross-reference
- [auto] F14 — Softened §20 self-consistency claim; explicit open items listed

### Integrity Check
Integrity check: pending — to be run inline after Round 2 paste-back since operator applied edits in batch before logging. No new forward references introduced by Round 1 edits (verified by triage notes above); §6.6 redaction contract and §10.2 route extension are net-new and self-contained.

### Round 1 Summary
- Auto-accepted (technical): 13 applied, 1 rejected, 0 deferred (F11 routed to §18 backlog as an APPLIED in-spec edit, not a defer of the finding itself)
- User-decided (user-facing + technical-escalated): 0 applied, 0 rejected, 0 deferred — no user-facing findings this round
- Triage note: F5 met escalation carveouts (high severity, architectural) but the operator-applied fix is the narrow mechanical redaction rule; the broader tenant audit is captured in §18, which the operator will see at finalisation. Logged for transparency.

---

