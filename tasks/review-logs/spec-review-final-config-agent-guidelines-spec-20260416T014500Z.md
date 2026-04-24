# Spec Review — Final Report

**Spec:** `docs/config-agent-guidelines-spec.md`
**Spec commit at start:** `7054e4d0a5a11199abf0c705572504be7e444fe2`
**Spec-context commit at start:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iterations completed:** 4 of 5 (cap not reached)
**Stopping condition:** Two consecutive mechanical-only rounds (iterations 3 and 4)
**Final report timestamp:** 2026-04-16T01:45:00Z

---

## Stopping condition met

The loop exited early per the stopping heuristic: iterations 3 and 4 both produced zero directional findings, zero ambiguous findings, and zero reclassifications. Two consecutive mechanical-only rounds — stop before the cap.

---

## Summary by iteration

### Iteration 1 — 6 mechanical (applied), 1 mechanical (rejected), 5 HITL findings

**Mechanical (applied):**

| ID | Section | Fix |
|----|---------|-----|
| C1 | §3.4 step 3 | Added `permission: 'read'` and `source: 'manual'` to join table row insertion |
| C2 | §3.5 | Changed `isReadOnly: true` assertion to `permission: 'read'` (matches actual return shape) |
| C3 | §4 | Test path `server/services/__tests__/` → `server/jobs/__tests__/` |
| C4 | §3.2, §3.5 | Join table corrected to `memory_block_attachments` in both sections |
| C5 | §3.6 | Permission contradiction resolved — content edits allowed for org (agency) admins |
| C6 | §3.4 intro | Seeder intro sentence corrected — create-if-absent does NOT propagate canonical updates on redeploy |

**Mechanical (rejected):**

| ID | Section | Reason |
|----|---------|--------|
| — | §3.3 canonical text | Self-acknowledged open question (§3.3 Notes, §6 item 1, §7). Pre-kickoff state is intentional. |

**HITL findings (all resolved):**

| Finding | Classification | Decision |
|---------|---------------|---------|
| 1.1 — Attachment detach endpoint unguarded | Directional | Apply — add DELETE attachment guard to §3.6 (`PROTECTED_MEMORY_BLOCK_ATTACHMENT`) |
| 1.2 — PATCH guard: `isReadOnly`/`ownerAgentId` unprotected | Directional | Apply-with-modification — guard those two fields specifically; do NOT restrict PATCH to content-only |
| 1.3 — Route-level 409 test conflicts with `api_contract_tests: none_for_now` | Directional | Apply — replace `server/routes/__tests__/memoryBlocks.test.ts` with static gate `scripts/verify-protected-block-names.sh` |
| 1.4 — "Staging environment" in §3.8 ambiguous | Ambiguous | Apply — replace with "local development environment (or any environment with the block seeded and the Configuration Assistant running)" |
| 1.5 — Confidence bands > 0.85 and 0.6–0.85 produce identical behavioral outcome | Directional | Reject — transparency-only distinction is adequate for pre-production. Added §3.8 note to add confidence-boundary scenario at kickoff. |

---

### Iteration 2 — 4 mechanical (applied), 1 HITL finding

**Mechanical (applied):**

| ID | Section | Fix |
|----|---------|-----|
| C2-1 | §3.6 | Added demote-path guard (POST demote → 409); closes bypass around DELETE protection |
| C2-3 | §8 item 4 | Stale `agent_memory_blocks` → `memory_block_attachments` with `permission: 'read'` |
| C2-4 | §8 item 8 | Stale "all six / in staging" aligned with updated §3.8 acceptance bar |
| R2-1 | §4 | Added `scripts/run-all-gates.sh` and `server/routes/knowledge.ts` to file inventory |
| R2-2 | §4 | `server/routes/memoryBlocks.ts` description updated to reflect full 7-rule guard scope |

**HITL finding (resolved):**

| Finding | Classification | Decision |
|---------|---------------|---------|
| 2.1 — Protected block name not reserved on CREATE | Directional | Apply — add POST (create) guard to §3.6: name in `PROTECTED_BLOCK_NAMES` → 409 `PROTECTED_MEMORY_BLOCK` |

---

### Iteration 3 — mechanical only (stopping heuristic clock: 1/2)

**Mechanical (applied):**

| ID | Section | Fix |
|----|---------|-----|
| C3-1 | §3.4 step 5 (repair path) | Added `permission: 'read'` and `source: 'manual'` — repair path had same fields as step 3 but they were missing |
| C3-2 | §7 step 7 | "all six must pass" → "all must pass (including confidence-boundary scenario once added at kickoff)" |
| C3-3 | §4 | `scripts/verify-protected-block-names.sh` description updated to reflect dual-file coverage (memoryBlocks.ts AND knowledge.ts demote handler) |
| C3-4 | §8 item 6 | Expanded from single DELETE check to four specific 409 checks: POST create, DELETE block, DELETE attachment, POST demote |

No directional or ambiguous findings.

---

### Iteration 4 — mechanical only (stopping heuristic clock: 2/2 → exit)

**Mechanical (applied):**

| ID | Section | Fix |
|----|---------|-----|
| C4-2 | §8 item 6 | Wrong API path: `DELETE /api/memory-blocks/:blockId/agents/:agentId` → `DELETE /api/memory-blocks/:blockId/attachments/:agentId` |

**Finding examined and rejected (not a spec change):**

| ID | Section | Disposition |
|----|---------|-------------|
| C4-1 | §3.3 §2–§3 | Priority Order (§3 steps 1–3) revisits Context after Configuration, inverting the Three C's order for those steps. **Rejected** — tentative canonical text; resolve at kickoff when base draft is merged. Added §3.3 Note 5 flagging the tension for kickoff discussion. |

No directional or ambiguous findings. Stopping heuristic threshold reached — loop exits.

---

## Cumulative changes to `docs/config-agent-guidelines-spec.md`

All changes were applied in-place to the spec file. The spec commit listed at top is the pre-review baseline; these changes are unstaged (no new commit during the review loop).

| Section | Net change |
|---------|-----------|
| §3.2 | Join table corrected to `memory_block_attachments` |
| §3.3 Notes | Added Note 5 (Priority Order vs Three C's tension — kickoff item) |
| §3.4 step 3 | `permission: 'read'`, `source: 'manual'` added to join row insertion |
| §3.4 step 5 | `permission: 'read'`, `source: 'manual'` added to repair-path insertion |
| §3.4 intro | Seeder propagation behaviour corrected (create-if-absent, not auto-propagate) |
| §3.5 | Join table corrected; `isReadOnly: true` assertion → `permission: 'read'` |
| §3.6 | Expanded from 2 rules to 8 rules: POST create, DELETE block, PATCH rename, PATCH isReadOnly:false, PATCH ownerAgentId, DELETE attachment, POST demote, PATCH content (allowed) |
| §3.6 | Content-edit permission contradiction resolved |
| §3.7 | Demote-path coverage note (nobody via UI) clarified |
| §3.8 | "staging environment" → "local development environment (…)" |
| §3.8 | Added note to add confidence-boundary scenario at kickoff |
| §3.8 | Acceptance bar updated to cover all scenarios (not fixed count) |
| §4 | Test path corrected (`server/services/__tests__/` → `server/jobs/__tests__/`) |
| §4 | Added `server/routes/knowledge.ts` to file inventory |
| §4 | Added `scripts/run-all-gates.sh` to file inventory |
| §4 | Added `scripts/verify-protected-block-names.sh` (dual-file gate, replaces route test) |
| §4 | Removed `server/routes/__tests__/memoryBlocks.test.ts` (replaced by static gate) |
| §4 | `server/routes/memoryBlocks.ts` description updated to reflect full guard scope |
| §7 step 7 | "all six must pass" → "all must pass (including confidence-boundary scenario once added at kickoff)" |
| §8 item 4 | `agent_memory_blocks` → `memory_block_attachments` with `permission: 'read'` |
| §8 item 6 | Expanded to four specific 409 checks; API path for attachment DELETE corrected |
| §8 item 8 | "All six scenarios / in staging" → "All behavioural-verification scenarios / local development environment" |

---

## What remains open before implementation starts

The review loop has exited. The spec is reviewed and internally consistent. Before the implementation session (Phase 2), the following remain open:

1. **§6 open questions 1–7** must be resolved in the kickoff conversation with the user. In particular:
   - **Base-draft reconciliation** (§6 Q1) — the §3.3 canonical text is a synthesis; the user's original wording takes precedence.
   - **Block name** (§6 Q3) — accept `config-agent-guidelines` or change.
   - **Canonical file path** (§6 Q4) — accept `docs/agents/` or suggest alternative.
   - **Seeder convention** (§6 Q5) — user may have a preferred existing pattern.
   - **Priority Order vs Three C's tension** (§3.3 Note 5) — resolve at kickoff when base draft is merged.

2. **Confidence-boundary scenario** (§3.8) — deferred to kickoff once the canonical text is finalised; add as scenario 7.

3. **Phase 1 doc audit** (`architecture.md` + `docs/capabilities.md`) — ships first, independent branch, before Phase 2 branch is cut. The spec review is a prerequisite for Phase 2; it is now complete.

---

## Loop telemetry

| Iteration | Mechanical | Directional | Ambiguous | Reclassified | HITL? |
|-----------|-----------|-------------|-----------|--------------|-------|
| 1 | 6 applied, 1 rejected | 4 | 1 | 0 | Yes |
| 2 | 5 applied | 1 | 0 | 0 | Yes |
| 3 | 4 applied | 0 | 0 | 0 | No |
| 4 | 1 applied, 1 rejected | 0 | 0 | 0 | No |
| **Total** | **16 applied, 2 rejected** | **5** | **1** | **0** | — |

All 5 directional findings and 1 ambiguous finding were presented for human decision. All were resolved.

Spec is ready for kickoff and implementation.
