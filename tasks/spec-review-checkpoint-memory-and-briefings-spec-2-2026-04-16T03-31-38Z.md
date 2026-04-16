# Spec Review HITL Checkpoint — Iteration 2

**Spec:** `docs/memory-and-briefings-spec.md`
**Iteration:** 2 of 5
**Timestamp:** 2026-04-16T03:31:38Z

This checkpoint blocks the review loop. The loop will not proceed to iteration 3 until every finding below is resolved. Resolve by editing this file in place and changing the `Decision:` line for each finding, then re-invoking the spec-reviewer agent.

---

## What was applied mechanically in iteration 2

The following 7 findings were classified as mechanical and applied to the spec without HITL. No action needed on these.

| Finding | What was fixed |
|---|---|
| F1 | Scope table S14 label updated to "Memory health data (per-subaccount data-generation step, included as a section within the Weekly Digest)"; Section 10.5 stale "health digest job" reference replaced with a parenthetical clarifying S14 is gathered inline by the weekly digest |
| F2 | Phase 3 note added: S19 memory health section ships as a stub until S14 lands in Phase 4. Phase 4 S14 note clarifies it fully populates the stub |
| F3 | Section 6.2 Collaborative row updated: "uploads filed by agency approval" replaced with "uploads require agency approval for first 5, then auto-filed with notification — see Section 5.5" |
| F9 | `deliveryChannels` type added to `ConfigQuestion.type` union with inline note on how it decomposes in the async document path |
| F11 | Section 4.2 clarified: `getRelevantMemories()` named as the internal helper called by public entry point `getMemoryForPrompt()` |
| F13 | Clarification routing config named as `clarificationRoutingConfig` JSONB on `subaccounts` with explicit key schema (`defaultRecipientRole`, `blockingEscalationRole`, `clientDomainTopics`) |
| F15 | Section 4 intro qualified — "largely invisible" with S24 noted as the UI exception, cross-referencing Phase 5 |

## Findings requiring HITL

### Finding 2.1 — Draft auto-synthesised blocks not excluded from S6 relevance retrieval

**Classification:** directional
**Signal matched:** Scope signals — the fix requires deciding where draft-block exclusion is enforced (query filter vs. block status field vs. scope definition), which constrains the block data model and S6 query contract.
**Spec sections:** Section 5.2 (S6), Section 5.7 (S11)

**Codex's finding (verbatim)**

> Section 5.7 says draft auto-synthesised blocks are "not auto-attached to agents until reviewed." Section 5.2 (S6) says the relevance engine "scores all blocks in scope" and attachment is no longer the default path. So draft blocks would be retrieved by S6 despite the stated invariant. The stated invariant is not enforced by the described implementation.

**Tentative recommendation (non-authoritative)**

Add an explicit exclusion: in Section 5.2, add a bullet stating that the relevance engine filters out blocks where `source = 'auto_synthesised'` AND status is `draft` or `pending_review`. In Section 5.7, name the status field explicitly (e.g., a `status` enum on `memory_blocks`: `active | draft | pending_review | rejected`). This is marked tentative because the implementer must decide whether exclusion is at query time or scope definition time.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Add a `status` enum to `memory_blocks` with values `active | draft | pending_review | rejected`. In Section 5.2, add a bullet stating the relevance engine excludes blocks with status `draft` or `pending_review` — exclusion is at query time (WHERE status = 'active'). In Section 5.7, reference this enum explicitly when describing draft block flags.
Reject reason (if reject): <edit here>
```

---

### Finding 2.2 — Two persistence models for visibility (visibility_tier vs portalFeatures)

**Classification:** directional
**Signal matched:** Scope signals — two incompatible storage models for the same concern; choosing one constrains schema and gate-check code path.
**Spec sections:** Section 6.1 (S15), Section 6.3 (S17)

**Codex's finding (verbatim)**

> Section 6.1 proposes a `visibility_tier` enum/JSONB column on relevant tables. Section 6.3 proposes a `portalFeatures` JSONB on `subaccounts`. These are in tension — one puts visibility on the feature record, one puts it on the subaccount. Two different persistence models for the same visibility concern, with no rule for which is authoritative.

**Tentative recommendation (non-authoritative)**

The two can be complementary: (a) `visibility_tier` in a code registry (or enum column on feature-bearing tables) is the static system-defined minimum tier — a build-time concern. (b) `portalFeatures` JSONB on `subaccounts` is the per-client runtime override — a run-time concern. The spec should state this split explicitly so implementers know which layer governs each gate-check. Marked tentative because this two-layer model is an architecture decision.

**Decision**

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

### Finding 2.3 — Portfolio artefact delivery target undefined (org-level inbox does not exist)

**Classification:** directional
**Signal matched:** Scope signals — defining the org-level delivery target requires a product decision (new org inbox entity, agency-owner user inbox, or HQ subaccount) with schema implications.
**Spec sections:** Section 10.2, Section 11.2, Section 11.6, Success Criteria F5

**Codex's finding (verbatim)**

> Section 10.2 guarantees inbox delivery for "the relevant subaccount inbox." Portfolio artefacts (Section 11) are org-level — no subaccount inbox applies. The delivery target is undefined. Success criterion F5 says "one inbox item for the agency owner" but no such inbox entity is described.

**Tentative recommendation (non-authoritative)**

Two options: (a) Portfolio artefacts go to the agency owner's user-level inbox — requires defining a user inbox entity or extending `agent_inbox` with a `userId` scope. (b) Portfolio artefacts go to a designated "agency HQ" subaccount (an org-level subaccount created for this purpose) — no new inbox entity, but requires defining the HQ subaccount concept. Marked tentative because both are architecturally valid with different schema implications.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Use the existing org subaccount (the subaccount in which the Configuration Assistant already runs in org-admin mode). Portfolio artefacts route to the org subaccount's inbox — no new inbox entity, no schema changes. Update Section 11.2, 11.6, and Success Criterion F5 to state that portfolio artefacts are delivered to the org subaccount's inbox. The org subaccount ID is available on every organisation record.
Reject reason (if reject): <edit here>
```

---

### Finding 2.4 — DeliveryChannels component API is subaccount-scoped but used for org-level rollups

**Classification:** directional
**Signal matched:** Scope signals — extending the component API scope requires a design decision about how integration lookup works for org-level artefacts; downstream of Finding 2.3.
**Spec sections:** Section 10.4, Section 11.6

**Codex's finding (verbatim)**

> The component contract is `<DeliveryChannels subaccountId={subaccountId} .../>`. Section 11.6 says portfolio rollups use this component. The API does not support org-level artefacts — the component queries integrations for a subaccount; for org-level artefacts there is no subaccount to scope against.

**Tentative recommendation (non-authoritative)**

Resolution depends on Finding 2.3: if 2.3 resolves with option (b) (HQ subaccount), the component needs no API change — portfolio artefacts pass the HQ subaccount's ID. If 2.3 resolves with option (a) (user inbox), extend the API with an optional `orgId` prop (mutually exclusive with `subaccountId`) for org-level integration lookup. Resolve 2.3 first.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Since 2.3 resolves to the org subaccount, no API change to DeliveryChannels is needed. Update Section 11.6 to state that the portfolio rollup job passes the org subaccount ID to the DeliveryChannels component. Component contract is unchanged.
Reject reason (if reject): <edit here>
```

---

### Finding 2.5 — Configuration Schema "single source of truth" claim not implementable for OAuth / action steps

**Classification:** directional
**Signal matched:** Scope signals — narrowing vs. extending the schema contract determines the document generation contract and the onboarding engine dispatch logic.
**Spec sections:** Section 8.7, Section 9.1, Section 9.2, Section 8.4 step 4

**Codex's finding (verbatim)**

> Section 9.1 claims the Configuration Schema is "single source of truth for both paths." But Step 4 of the onboarding arc is OAuth initiation — an action, not a question fitting `ConfigQuestion`. The bundle includes `memory-bootstrap`, `integration-setup`, and `portal-config` — none are question schemas. "Single source of truth" is not implementable from the provided `ConfigQuestion` interface.

**Tentative recommendation (non-authoritative)**

Two fixes: (a) Narrow the claim — "Configuration Schema is the single source of truth for question-answer steps only. Action steps (OAuth initiation, block creation, portal config) are handled by the onboarding engine's procedural flow and are not represented in the schema." (b) Extend the schema with an `action` step type. Option (a) is simpler and honest about what the schema covers. Marked tentative because it is an architecture decision.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Apply option (a). In Section 9.1, narrow the claim to "single source of truth for question-answer steps only." Add a sentence: "Action steps (OAuth initiation, block creation, portal mode setting) are handled procedurally by the onboarding engine and are not represented in the Configuration Schema." The `ConfigQuestion` interface and document generation contract remain unchanged.
Reject reason (if reject): <edit here>
```

---

### Finding 2.6 — Three onboarding bundle members have no playbook file, schema, or implementation contract

**Classification:** directional
**Signal matched:** Scope signals — whether `memory-bootstrap`, `integration-setup`, and `portal-config` are real playbooks or conceptual procedural phases determines what gets built and how the bundle manifest is interpreted.
**Spec sections:** Section 8.7

**Codex's finding (verbatim)**

> `memory-bootstrap`, `integration-setup`, and `portal-config` are listed as default bundle members and the onboarding completion criterion depends on them, but none has a playbook file path, Configuration Schema, or implementation section. The completion criterion is not verifiable without these contracts.

**Tentative recommendation (non-authoritative)**

Two fixes: (a) Remove them from the bundle literal and describe onboarding as orchestrating these phases procedurally — the bundle becomes `[intelligence-briefing, weekly-digest]` (the two playbooks that actually get autostarted). Memory bootstrap, integration setup, and portal config are conversational steps (Sections 8.4 steps 1-5, 8), not playbooks with files. (b) Define each as a real playbook with a named file and schema. Option (a) matches what the onboarding arc actually describes. Marked tentative because it is a product-scope decision.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Apply option (a). In Section 8.7, update the default bundle to `[intelligence-briefing, weekly-digest]` — the two playbooks that actually get autostarted. Replace the existing bundle list sentence with: "The default bundle is `[intelligence-briefing, weekly-digest]`. Memory bootstrap, integration setup, and portal configuration are procedural phases of the onboarding conversation (Sections 8.4 steps 1–5 and 8) — they are not playbooks with files and are not registered in the bundle manifest."
Reject reason (if reject): <edit here>
```

---

### Finding 2.7 — Review queue has no storage model, schema, or owning service

**Classification:** directional
**Signal matched:** Scope signals — defining the queue primitive (new table vs. status column, service ownership, org rollup read paths) is a schema/architecture decision.
**Spec sections:** Section 4.3 (S3), Section 5.3 (S7)

**Codex's finding (verbatim)**

> The review queue is referenced across conflict resolution (S3) and HITL (S7), but no table name, record schema, statuses, or owning service is defined. The queue is load-bearing across both features and the org-level rollup view (Section 5.3), but the implementer has nothing to build against.

**Tentative recommendation (non-authoritative)**

A named primitive: `memory_review_queue` table with fields `id`, `subaccountId`, `itemType` (enum: `belief_conflict | block_proposal | hitl_action`), `payload` JSONB, `confidence`, `status` (enum: `pending | approved | rejected | auto_applied | expired`), `createdAt`, `expiresAt`. Owning service: `memoryReviewQueueService`. Org rollup reads counts grouped by `subaccountId`. Marked tentative because the table name, status set, and service ownership are architecture decisions.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Accept the named primitive but tighten the itemType enum. Use `belief_conflict | block_proposal | clarification_pending` (drop `hitl_action` — it is too vague; S7 confidence-HITL items are either belief conflicts or block proposals). All other fields as per the tentative recommendation. Owning service: `memoryReviewQueueService`. Add this schema to Section 5.3 (S7) and add a cross-reference in Section 4.3 (S3).
Reject reason (if reject): <edit here>
```

---

### Finding 2.8 — Reasoning chain storage undefined, but Natural-Language Memory Inspector depends on it

**Classification:** directional
**Signal matched:** Scope signals — defining or deferring reasoning chain storage is a product-scope decision that determines whether S13 can deliver its stated contract.
**Spec sections:** Section 5.9 (S13), Section 2 (Current State)

**Codex's finding (verbatim)**

> Section 5.9 says the inspector "retrieves the run's injected context, the retrieved memories, the reasoning chain, and the actions taken." The current-state section (Section 2) does not mention persisted reasoning chain storage. The implementer is blocked on what data exists and where it lives.

**Tentative recommendation (non-authoritative)**

Two fixes: (a) Narrow S13's contract — remove "reasoning chain" from what the inspector retrieves and limit it to injected context + retrieved memories + actions taken (all of which have existing storage). (b) Define a `agent_run_traces` table (or equivalent) that persists the reasoning chain per run, and add it to the current-state section and scope table. Option (a) is simpler. Option (b) is more complete but adds a new primitive. Marked tentative because it is a scope decision.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Apply option (a). In Section 5.9, remove "the reasoning chain" from the list of what the inspector retrieves. Replace with: "the run's injected context, the retrieved memories, and the tool calls and actions taken." Add a note: "Reasoning chain (LLM internal chain-of-thought) is not currently persisted — this is out of scope for S13 and deferred."
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint file as its first action, honour each decision (apply, apply-with-modification, reject, or stop-loop), and continue to iteration 3.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring findings already marked `apply` or `apply-with-modification`.

**Note on Finding 2.4:** Resolution depends on Finding 2.3. State your 2.3 decision first in your edit, then state 2.4's decision accordingly.
