# Spec Review HITL Checkpoint — Iteration 3

**Spec:** `docs/memory-and-briefings-spec.md`
**Iteration:** 3 of 5
**Timestamp:** 2026-04-16T03:48:40Z

This checkpoint blocks the review loop. Resolve by editing each `Decision:` line, then re-invoking the spec-reviewer agent.

---

## What was applied mechanically in iteration 3

The following 6 findings were classified as mechanical and applied to the spec without HITL.

| Finding | What was fixed |
|---|---|
| 3.1 | Section 4.1 wording contradiction: "only explicit deletion removes them" contradicted the pruning pass. Fixed to: "decay alone never reduces a score to zero — separate pruning may still soft-delete entries that fall below the pruning threshold" |
| 3.2 | HITL tier table (Section 5.3): "Auto-apply" was ambiguous for block proposals vs belief supersessions. Fixed to distinguish: belief supersessions → immediately active; block proposals → auto-create at `status: draft`. |
| 3.12 | Section 5.7: Added explicit schema migration note — `status text` (enum: `active \| draft \| pending_review \| rejected`, default `'active'`) and `source text` (enum: `manual \| auto_synthesised`) must be added to `memory_blocks` in Phase 1. |
| 3.13 | Phase 1 in the phasing plan (Section 3): Added `memory_blocks` schema migration as a Phase 1 item — required by S6 in Phase 2. Sequencing bug resolved. |
| 3.14 | Section 5.7 invariant wording: Clarified that activation occurs via two valid paths (approval OR passive aging), and stated the enforcement invariant explicitly: "no block with `status != 'active'` is ever surfaced by S6." |
| 3.17 | Section 8.7: Resolved the "configuration file or database record" ambiguity — named the primitive as `onboarding_bundle_configs` database table, consistent with Open Question 8's recommended default. |

The following 3 findings were **rejected** (not file inventory drift — they are new files being specified):
- 3.7: `weekly-digest.playbook.ts` — new file to be created, correctly described
- 3.8: `intelligence-briefing.playbook.ts` and `.schema.ts` — new files being specified
- 3.9: `server/skills/request_clarification.md` — new skill file being specified

## Findings requiring HITL

### Finding 3.3 — Section 7.1: no migration checklist for old slug references

**Classification:** directional
**Signal matched:** Pre-production framing — adding a verification/migration checklist changes what the implementation must do.
**Spec section:** Section 7.1 (S18)

**Codex's finding (verbatim)**

> "Rename to `intelligence-briefing.playbook.ts`. Update all references..." — The repo still uses old naming in live surfaces (`server/routes/portal.ts` exposes `/daily-brief-card` with slug `daily-intelligence-brief`). Add an explicit migration checklist and a verification step.

**Tentative recommendation (non-authoritative)**

Add a bullet under Section 7.1: "Migration checklist: run `rg 'daily-intelligence-brief|daily-brief'` after the rename and resolve all non-comment references. Portal route `/daily-brief-card` must be updated or tombstoned."

**Decision**

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

### Finding 3.4 — Section 4.4: no implementation contract for "cited or used" detection

**Classification:** directional
**Signal matched:** Load-bearing claims without contracts — S12/S4 self-tuning depends on detecting "cited or used" signal, but no named service, event source, parser, or storage shape is specified.
**Spec section:** Section 4.4 (S12)

**Codex's finding (verbatim)**

> "compare the memory entries that were injected into context against what the agent actually cited or used in its output." — No contract for how "cited or used" is detected, where it is stored, or which service computes it.

**Tentative recommendation (non-authoritative)**

Two options: (a) Post-run LLM pass — after each run, a lightweight LLM call produces a `citedEntryIds[]` array stored as JSONB on `agent_runs`. Named service: `memoryCitationDetector`. (b) Agent-instrumented — agent calls `mark_memory_cited(entry_id)` during the run. Option (a) adds LLM cost per run; option (b) requires agent cooperation.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option (a) — post-run detection. Named service: `memoryCitationDetector`. Stores `citedEntryIds[]` as JSONB on `agent_runs`. First implementation uses text-matching heuristic (check whether the entry's key phrases appear in the agent's tool calls or generated output) — no LLM cost. Graduated to a lightweight LLM pass only if text-matching proves insufficient. The spec should document the service name and storage shape; it should not mandate the LLM pass as the initial implementation.
Reject reason (if reject): <edit here>
```

---

### Finding 3.5 — Section 6.1: no enforcement primitive named for portal feature gate-checks

**Classification:** directional
**Signal matched:** Load-bearing claims without contracts — the two-layer gate-check is described but no named helper, middleware, or file is specified.
**Spec section:** Section 6.1 (S15)

**Codex's finding (verbatim)**

> "Each UI surface declares which tiers it can render in and registers a key in the `portalFeatures` schema." — No registry file, helper, decorator, or enforcement path is named.

**Tentative recommendation (non-authoritative)**

Name a `canRenderPortalFeature(subaccountId, featureKey)` server-side helper (e.g., `server/lib/portalGate.ts`) that consults both `visibility_tier` and `portalFeatures`. All portal-scoped routes call it. Resolve Finding 3.18 first (what `visibility_tier` storage looks like) as it constrains this option.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Name the helper `server/lib/portalGate.ts` exporting `canRenderPortalFeature(subaccountId, featureKey)`. It reads minimum tier from `server/config/portalFeatureRegistry.ts` (static code registry — see 3.18) and runtime override from the subaccount's `portalMode` + `portalFeatures` JSONB. All portal-scoped API routes call this helper.
Reject reason (if reject): <edit here>
```

---

### Finding 3.6 — Section 5.5: upload trust state has no named storage primitive

**Classification:** directional
**Signal matched:** Load-bearing claims without contracts — the 5-upload trust model is behaviorally specified but has no named table, column, or service.
**Spec section:** Section 5.5 (S9)

**Codex's finding (verbatim)**

> "for the first 5 uploads from a new client ... The 5-upload threshold resets if a filing is rejected." — No counter/state primitive named for tracking approvals, resets, or per-client trust level.

**Tentative recommendation (non-authoritative)**

Add a `clientUploadTrustState` JSONB column on `subaccounts` with shape `{ approvedCount: number, trustedAt: string | null, resetAt: string | null }`. Owning service: `portalUploadService`. JSONB column avoids a new table.

**Decision**

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

### Finding 3.10 — Section 4.3: `entityKey` not defined relative to `beliefKey`

**Classification:** directional
**Signal matched:** Schema conflict — the spec introduces `entityKey` as a new indexed column on `agent_beliefs` for conflict detection, but does not state its relationship to the existing `beliefKey` unique identity column.
**Spec section:** Section 4.3 (S3)

**Codex's finding (verbatim)**

> "query existing active beliefs for the same `subaccountId` + `entityKey` (a new indexed column, derived from the belief's subject)." — The existing unique index is on `(organisationId, subaccountId, agentId, beliefKey)`, not `entityKey`. This changes the identity model for beliefs.

**Adjudicator note:** After reading `agentBeliefs.ts`, the existing unique constraint is `(organisationId, subaccountId, agentId, beliefKey)`. The spec's conflict detection is cross-agent (different agents writing contradictory facts about the same entity). `entityKey` is a cross-agent identifier — distinct from `beliefKey` which is per-agent. The relationship must be stated explicitly.

**Tentative recommendation (non-authoritative)**

Two options: (a) `entityKey` is a new column on `agent_beliefs` — it identifies the real-world entity the belief describes (e.g., `contact:john-doe@acme.com`). `beliefKey` remains the per-agent unique key; `entityKey` enables cross-agent deduplication. (b) `entityKey` is a derived normalisation of `beliefKey` — same `beliefKey` across agents implies same entity. Option (a) is more expressive; option (b) is simpler.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option (a). `entityKey` is a new nullable indexed column on `agent_beliefs` that identifies the real-world entity being described (e.g., `contact:alice@acme.com`, `client:acme-corp`). `beliefKey` remains the per-agent unique key (existing unique constraint unchanged). `entityKey` enables cross-agent conflict detection: query active beliefs by `(subaccountId, entityKey)` across all agents. Add an explicit statement of this relationship to Section 4.3.
Reject reason (if reject): <edit here>
```

---

### Finding 3.11 — Section 5.3: `memory_review_queue` not justified as separate from `review_items`

**Classification:** directional
**Signal matched:** Schema conflict — the codebase has a `review_items` table; the spec introduces `memory_review_queue` without justifying the separation.
**Spec section:** Section 5.3 (S7)

**Codex's finding (verbatim)**

> "persisted in a `memory_review_queue` table" — The codebase already has `review_items`/`review_audit_records`. Creates a second incompatible queue model for the same concept.

**Adjudicator note:** After reading `reviewItems.ts`: the existing table requires a non-null `actionId` FK (references `actions` table) — it is scoped to plan-approve-execute action review. The proposed `memory_review_queue` is for belief conflicts, block proposals, and clarification events — memory system events with no `actionId`. The purposes are distinct. However the spec should explicitly state why a new table is needed rather than extending `review_items`.

**Tentative recommendation (non-authoritative)**

Two options: (a) Keep `memory_review_queue` as a new table and add a sentence to Section 5.3 explaining: "A new table is required because `review_items` is action-scoped (requires `actionId` FK) and cannot accommodate memory-system events." (b) Extend `review_items` with a nullable `actionId` and a `category` discriminator (`action | memory_event`). Option (a) is simpler; option (b) consolidates queue infrastructure.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option (a). Keep `memory_review_queue` as a new table. Add a justification sentence to Section 5.3: "A new table is required because the existing `review_items` table enforces a non-null `actionId` foreign key — it is scoped to plan-approve-execute action review. Memory-system events (belief conflicts, block proposals, clarification requests) have no action ID and cannot be stored there without weakening existing constraints."
Reject reason (if reject): <edit here>
```

---

### Finding 3.15 — Section 10.2: inbox delivery guarantee has no server-side enforcement

**Classification:** directional
**Signal matched:** Pre-production framing — specifying enforcement patterns (guards, lint rules, tests) changes the implementation contract.
**Spec section:** Section 10.2, 10.5 (S22)

**Codex's finding (verbatim)**

> "Inbox is implicit and always-on... it is a system guarantee." — Nothing prevents producers from bypassing `deliveryService`. The guarantee is stated, not enforced.

**Tentative recommendation (non-authoritative)**

Add to Section 10.5: "All playbook deliver steps must call `deliveryService.deliver(...)`. Direct inbox writes are not supported. A TypeScript type or lint rule enforces this at build time."

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Add to Section 10.5: "All playbook deliver steps must route through `deliveryService.deliver(...)`. Direct writes to inbox outside this service are prohibited — the service is the enforcement boundary for the inbox guarantee." Drop the TypeScript type / lint rule specificity — too prescriptive for a spec.
Reject reason (if reject): <edit here>
```

---

### Finding 3.16 — Section 6.3: no server-side enforcement for portal feature gating

**Classification:** directional
**Signal matched:** Pre-production framing — specifying backend gate helpers and which routes use them changes the implementation contract.
**Spec section:** Section 6.3 (S17)

**Codex's finding (verbatim)**

> "When portal mode is Hidden or Transparency, all Collaborative-only features are automatically off regardless of the JSONB values." — Only a UI toggle grid is described. No server-side enforcement contract.

**Tentative recommendation (non-authoritative)**

Add to Section 6.3: "Server-side enforcement: all portal-scoped API routes call the gate helper (see Section 6.1). The gate reads both `portalMode` and `portalFeatures` and returns 403 if the feature is gated. Client-side toggle grid is UX convenience only — the server is authoritative."

**Decision**

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

### Finding 3.18 — Section 6.1: `visibility_tier` storage model left ambiguous

**Classification:** directional
**Signal matched:** Scope signals — choosing code registry vs enum column constrains the schema and future feature registration process.
**Spec section:** Section 6.1 (S15)

**Codex's finding (verbatim)**

> "A code registry (or enum column on feature-bearing tables)" — Left ambiguous between two very different implementations.

**Tentative recommendation (non-authoritative)**

Two options: (a) Code registry: `server/config/portalFeatureRegistry.ts` — a static map from feature key to minimum tier. Simple, no DB reads, reviewable in code. (b) Enum column on feature tables. Option (a) is simpler and more auditable. Resolve this before Finding 3.5 (enforcement primitive), as the storage choice constrains the gate helper implementation.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Option (a). Update Section 6.1 to name the registry explicitly: `server/config/portalFeatureRegistry.ts` — a static map from feature key to minimum required portal tier. No DB column, no migrations per new feature. Future features register themselves here. This is the build-time layer; `portalFeatures` JSONB on `subaccounts` remains the run-time layer.
Reject reason (if reject): <edit here>
```

---

### Finding 3.19 — Section 12 F6: drop zone verification too vague

**Classification:** directional
**Signal matched:** Pre-production framing / testing posture — adding per-confidence-band assertions changes what QA must verify.
**Spec section:** Section 12 (Success Criteria F6)

**Codex's finding (verbatim)**

> "Upload a test doc, verify proposals render" — Does not verify confidence thresholds, pre-ticked behavior, hidden low-confidence items, or multi-destination filing.

**Tentative recommendation (non-authoritative)**

Expand F6 to: "Upload a test doc; verify: (a) destinations >0.8 are pre-ticked, (b) 0.5–0.8 are shown unticked, (c) <0.5 are hidden behind 'Show more', (d) confirming selections files to all ticked destinations in one transaction."

**Decision**

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

### Finding 3.20 — Section 12 F8: HITL verification missing low-confidence and threshold decay

**Classification:** directional
**Signal matched:** Pre-production framing / testing posture — splitting into per-outcome assertions changes testing scope.
**Spec section:** Section 12 (Success Criteria F8)

**Codex's finding (verbatim)**

> "verify routing" — Omits low-confidence discard/re-verify behavior and the trust-threshold adjustment mechanism.

**Tentative recommendation (non-authoritative)**

Expand F8 to: "Generate test items at each confidence tier; verify: (a) >0.85 → auto-applied/draft-created with digest log entry, (b) 0.6–0.85 → in weekly review queue, (c) <0.6 → discarded with no queue entry. After N consecutive approved high-confidence items, verify auto-threshold decreases by 0.05."

**Decision**

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

### Finding 3.21 — Section 12 F11: portal mode test missing per-feature gating

**Classification:** directional
**Signal matched:** Pre-production framing / testing posture — adding per-feature portal assertions changes QA scope.
**Spec section:** Section 12 (Success Criteria F11)

**Codex's finding (verbatim)**

> "Test each mode with a client-role user" — Verifies only mode-level behavior, not per-feature `portalFeatures` gating.

**Tentative recommendation (non-authoritative)**

Expand F11: "Test each mode with a client-role user. Additionally, in Collaborative mode: toggle individual `portalFeatures` and verify each surface appears/disappears; verify server returns 403 for disabled features regardless of client-side state."

**Decision**

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

### Finding 3.22 — Section 12 NF6: "4-week observation" is not an objective test

**Classification:** directional
**Signal matched:** Testing posture — replacing time-based observation with a scripted scenario changes what gets built and tested.
**Spec section:** Section 12 (Success Criteria NF6)

**Codex's finding (verbatim)**

> "Observe a 4-week period with no manual intervention" — Not an objective, repeatable test and has no fixed workload definition.

**Tentative recommendation (non-authoritative)**

Replace NF6 with: "Run a scripted 4-week-equivalent scenario (mocked time) covering: 4 briefing runs, 4 digest runs, 1 decay pass, 1 HITL queue flush, 1 block synthesis run. Count operations requiring unscheduled human intervention. Target: zero."

**Decision**

```
Decision: apply
Modification (if apply-with-modification): <edit here>
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path.
3. The agent will read this checkpoint, honour each decision, and continue to iteration 4.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit immediately after honouring findings already marked `apply` or `apply-with-modification`.

**Resolution order note:** Resolve Finding 3.18 (`visibility_tier` storage) before Finding 3.5 (enforcement primitive) — 3.18's decision constrains 3.5's options. Similarly, resolve Finding 3.11 (`memory_review_queue` justification) before 3.16 (server-side enforcement), as the queue model affects gating implementation.
