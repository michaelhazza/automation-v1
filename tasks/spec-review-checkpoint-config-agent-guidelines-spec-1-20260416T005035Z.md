# Spec Review HITL Checkpoint — Iteration 1

**Spec:** `docs/config-agent-guidelines-spec.md`
**Spec commit:** `7054e4d0a5a11199abf0c705572504be7e444fe2`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Iteration:** 1 of 5
**Timestamp:** 2026-04-16T01:10:00Z

This checkpoint blocks the review loop. Resolve by editing each `Decision:` line below, then re-invoke the spec-reviewer agent.

**Mechanical fixes already applied** (no action needed):
- C3: Seeder join table row now includes `permission: 'read'` and `source: 'manual'` (§3.4)
- C4: Verification assertion changed from `isReadOnly: true` to `permission: 'read'` (§3.5)
- R1: Test file path updated to `server/jobs/__tests__/` in §4 file inventory
- R2: Join table name corrected to `memory_block_attachments` in §3.2 and §3.5
- CR1: Content-edit permission contradiction resolved — agency admins can edit; platform gating is delete + rename only (§3.6)
- CR2: Seeder intro sentence corrected — canonical updates do NOT auto-propagate on redeploy (§3.4)

---

## Finding 1.1 — Attachment detach endpoint unguarded

**Classification:** directional
**Signal matched:** Architecture signals — "Change the interface of X" (the protection interface)
**Source:** Codex run 1
**Spec section:** §3.6

### Codex's finding (verbatim)

> The protection model here only blocks block DELETE and rename, but the runtime loads guidelines solely through the attachment row. In the current API, `DELETE /api/memory-blocks/:blockId/attachments/:agentId` remains available to any `AGENTS_EDIT` caller, so an org admin could detach `config-agent-guidelines` from the Configuration Assistant and silently disable the guidelines until the next deploy-time reseed. The protected-block guard needs to cover detaching the protected block from its required agent as well.

### Tentative recommendation (non-authoritative)

Add a third rule to §3.6's list: "**DELETE** of the attachment row linking a protected block to its owning agent → return `409 Conflict` with `errorCode: 'PROTECTED_MEMORY_BLOCK_ATTACHMENT'`." This requires checking `PROTECTED_BLOCK_NAMES` in the attachment delete route handler.

### Reasoning

The spec currently relies on the seeder's step-5 recovery path to heal accidental detachment. The question is whether active prevention at the API layer is also needed, or whether passive seeder recovery is sufficient for the pre-production context. Tradeoff: active prevention (one less recovery window, simpler for operators) vs. passive recovery (fewer route guards, consistent with the spec's minimal-code philosophy and the fact that deliberate detachment is an edge case in pre-production).

### Decision

```
Decision: apply
Modification (if apply-with-modification): n/a
Reject reason (if reject): n/a
```

---

## Finding 1.2 — PATCH guard scope: isReadOnly and ownerAgentId unprotected

**Classification:** directional
**Signal matched:** Architecture signals — "Change the interface of X" (the protection interface scope)
**Source:** Codex run 1
**Spec section:** §3.6

### Codex's finding (verbatim)

> This section only special-cases rename and delete, but the existing PATCH route also accepts `isReadOnly` and `ownerAgentId`. Leaving those mutable means a caller can turn the protected guidelines block into a normal agent-writable block without renaming or deleting it, which defeats the spec's stated protection model. The contract should explicitly forbid changing those fields for protected blocks (or limit PATCH to content-only).

### Tentative recommendation (non-authoritative)

Add to §3.6's guard rules: "**PATCH** that changes `isReadOnly` or `ownerAgentId` on a protected block → return `409 Conflict`." This prevents an admin from silently un-protecting the block via `isReadOnly: false`, which would allow the Configuration Assistant's next run to overwrite the guidelines.

### Reasoning

The spec scoped protection to "delete + rename only." Setting `isReadOnly: false` via PATCH would allow the Configuration Assistant to overwrite the guidelines on its next run — a meaningful bypass. The question is whether this is a realistic threat in pre-production and whether extending the guard is within scope of this spec or should wait until the governance UI work. Extending the guard is low-cost code-wise but does widen the spec scope beyond its stated decision.

### Decision

```
Decision: apply-with-modification
Modification (if apply-with-modification): Extend §3.6 guard to: PATCH that sets isReadOnly: false or changes ownerAgentId on a protected block → 409. Do NOT restrict PATCH to content-only — agency admins must still be able to edit content. Specifically protect the two fields that could silently un-protect the block.
Reject reason (if reject): n/a
```

---

## Finding 1.3 — Route-level 409 test conflicts with testing posture

**Classification:** directional
**Signal matched:** Testing posture signals — beyond the pure-function + static-gate + 3-integration-test envelope
**Source:** Rubric — testing posture
**Spec section:** §4 File inventory

### Rubric finding

The file inventory includes `server/routes/__tests__/memoryBlocks.test.ts` to cover new 409 responses for protected-block delete and rename. This is a route-level API test. The spec-context has `api_contract_tests: none_for_now`. The seeder idempotency test in the same table is borderline (idempotency is a carved-out integration test category), but the route-level 409 test clearly exceeds the allowed envelope.

### Tentative recommendation (non-authoritative)

Remove `server/routes/__tests__/memoryBlocks.test.ts` from the §4 file inventory. Replace with a static gate: `scripts/verify-protected-block-names.sh` — a script that greps the route file for the `PROTECTED_BLOCK_NAMES` check pattern and fails CI if absent.

### Reasoning

Route-level 409 tests are API contract tests. The spec-context defers these (`api_contract_tests: none_for_now`). The protection is simple enough (a Set lookup + conditional 409) that a static gate verifying the guard pattern exists may be sufficient. However, the human may prefer a real integration test here because the 409 guard is a security-adjacent feature. This is a testing posture decision.

### Decision

```
Decision: PENDING
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): n/a
Decision: apply — replace server/routes/__tests__/memoryBlocks.test.ts with a static gate scripts/verify-protected-block-names.sh in §4 file inventory.
```

---

## Finding 1.4 — "Staging environment" in §3.8 is ambiguous

**Classification:** ambiguous
**Signal matched:** Ambiguous — could be informal shorthand for local dev, or imply separate staging infrastructure
**Source:** Rubric — ambiguous language
**Spec section:** §3.8

### Rubric finding

§3.8 says "Run the following scenarios against the Configuration Assistant in a staging environment." In a pre-production project with `staged_rollout: never_for_this_codebase_yet` and no separate staging infrastructure, this is ambiguous. Read literally, it implies infrastructure that may not exist.

### Tentative recommendation (non-authoritative)

Replace "in a staging environment" with "in your local development environment (or any environment with the block seeded and the Configuration Assistant running)." Removes ambiguity without changing intent.

### Reasoning

"Staging environment" is likely informal shorthand for "somewhere the agent can run." The fix is trivial wording if that's all it is. Becomes directional if the spec actually intends a separate staging deploy.

### Decision

```
Decision: PENDING
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): n/a
Decision: apply — replace "in a staging environment" with "in your local development environment (or any environment with the block seeded and the Configuration Assistant running)."
```

---

## Finding 1.5 — Confidence bands produce identical behavioral outcome

**Classification:** directional
**Signal matched:** Architecture signals — "Change the interface of X" (the confidence threshold model)
**Source:** Codex run 2
**Spec section:** §3.3 canonical text §7

### Codex's finding (verbatim)

> The proposed "confidence-tiered action policy" does not actually change behavior between the top two bands: `> 0.85` still requires the normal plan approval flow, and `0.6–0.85` also stops for explicit approval. Because §3.1 presents this as an additive contract with explicit thresholds, leaving the bands behaviorally identical makes the feature impossible to verify and undermines the main rationale for adding the policy at all.

### Tentative recommendation (non-authoritative)

Add a harder gate at 0.6–0.85: require an explicit uncertainty acknowledgement ("I understand the agent is not fully confident — proceed anyway?") as a separate step before plan execution. This creates a distinct second interaction for the middle band, making the threshold verifiable. Also add a §3.8 scenario that specifically tests the 0.6–0.85 confidence boundary.

### Reasoning

Both bands currently end at "user approves plan." The difference is only whether an uncertainty note is included. Whether this transparency-only distinction is adequate, or whether the middle band needs a harder gate, is a product design question. The §3.8 verification scenarios don't test the confidence boundary at all, so the spec has no way to confirm the threshold behaves as intended. This is the deepest open question in the spec's behavioral model — resolving it may also require adding a verification scenario.

### Decision

```
Decision: PENDING
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): Transparency-only distinction (uncertainty note in plan) is adequate for pre-production. A harder gate adds friction without proportionate benefit. The real gap is a missing §3.8 verification scenario for the 0.6-0.85 band — add during kickoff when canonical text is finalized.
Decision: reject
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer: `spec-reviewer: review docs/config-agent-guidelines-spec.md`
3. The agent will honour each decision and continue to iteration 2.

Set any decision to `stop-loop` to exit immediately after applying already-resolved decisions.

