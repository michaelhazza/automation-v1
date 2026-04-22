# Spec Review HITL Checkpoint — Iteration 4

**Spec:** `docs/memory-and-briefings-spec.md`
**Iteration:** 4 of 5
**Timestamp:** 2026-04-16T04:11:13Z

This checkpoint blocks the review loop. Resolve by editing each `Decision:` line, then re-invoking the spec-reviewer agent.

---

## What was applied mechanically in iteration 4

The following changes were applied to the spec without HITL:

| Finding | Section | What was fixed |
|---|---|---|
| 4.1 | Section 5.3 | Clarified `clarification_pending` itemType: added note that these are audit/state records; real-time delivery is handled separately by the S8 WebSocket path |
| 4.2 | Section 5.3 | Renamed high-confidence tier action from "Auto-apply" (misleading for block proposals) to "Auto-process with no human gate" with a clearer parenthetical distinguishing belief supersession vs block draft creation |
| 4.3 | Section 5.7 | Removed stale review artifact: "See Finding 3.13 note in sequencing" |
| 4.4 | Section 9.4 | Named the confidence scoring service: `configDocumentParserService`, stated the 0.7 auto-apply threshold (consistent with risk table), and specified that confidence is returned inline in the LLM parser's JSON output |
| 4.9 | Section 4.3 | Added phase note: S8 injection from S3 is a no-op in Phase 1; it activates when S8 lands in Phase 2 |
| 4.11 | Section 4.1 | Named the HNSW re-index job: `memory-hnsw-reindex` (pg-boss, one-shot, per-subaccount) |
| 4.12 | Section 5.2 | Named the embedding backfill job: `memory-blocks-embedding-backfill` (pg-boss, scheduled on deploy in Phase 2) |

The following 2 findings were **rejected**:

| Finding | Reason |
|---|---|
| 4.5 | Section 10.5 enforcement: inbox write guard specificity was intentionally dropped per HITL decision 3.15 — "service is the enforcement boundary" is the correct level of spec detail |
| 4.7 | Section 9.2 `.schema.ts` sidecar files: already adequately named and located in Section 9.2; S21 in Phase 3 covers their creation |

---

## Findings requiring HITL

### Finding 4.6 — Section 11.2: factually incorrect claim about org subaccount ID retrieval

**Classification:** directional
**Signal matched:** Load-bearing claims without contracts — the spec asserts a simpler retrieval path than what actually exists in the codebase.
**Spec section:** Section 11.2 "Design — Two Agency-Level Artefacts"

**Codex's finding (verbatim)**

> "The org subaccount ID is available on every organisation record" to avoid schema changes, but `server/db/schema/organisations.ts` has no such field; the current contract is `subaccounts.isOrgSubaccount`, so the asserted retrieval path is missing.

**Adjudicator note:** Confirmed by reading `organisations.ts`. There is no `orgSubaccountId` column on the `organisations` table. The actual mechanism is `subaccounts.isOrgSubaccount = true` with a uniqueness constraint — which requires a query (`SELECT id FROM subaccounts WHERE organisationId = ? AND isOrgSubaccount = true`) rather than a direct column read. The spec's claim in Section 11.2 is factually incorrect.

**Two options:**

(a) **Correct the claim**: Change "The org subaccount ID is available on every organisation record" to reflect the actual query pattern: "The org subaccount is identified by querying `subaccounts WHERE isOrgSubaccount = true AND organisationId = ?` — a unique constraint ensures exactly one result per org." No schema change required.

(b) **Add a column**: Add `orgSubaccountId uuid` to `organisations` as a denormalisation to make the claim true. Avoids a query at portfolio rollup time but requires a migration and introduces a circular reference risk (orgs → subaccounts → orgs).

Option (a) is lower risk and reflects the existing codebase contract.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Apply option (a). In Section 11.2, replace "The org subaccount ID is available on every organisation record" with: "The org subaccount is identified by querying `subaccounts WHERE isOrgSubaccount = true AND organisationId = ?` — a unique constraint ensures exactly one result per org. No schema change required."
Reject reason (if reject): <edit here>
```

---

### Finding 4.8 — Section 8.7: `onboarding_bundle_configs` not distinguished from `modules.onboardingPlaybookSlugs`

**Classification:** directional
**Signal matched:** Schema overlap — the spec introduces a new table without explaining how it coexists with an existing column that appears to serve a similar purpose.
**Spec section:** Section 8.7 "Onboarding as a Playbook Bundle"

**Codex's finding (verbatim)**

> "The new `onboarding_bundle_configs` table duplicates the onboarding-bundle role already implemented by `modules.onboardingPlaybookSlugs` in `server/db/schema/modules.ts` and migrations `0122_modules_onboarding_playbook_slugs.sql`; the spec does not justify why a second source of truth is needed."

**Adjudicator note:** After reading `modules.ts`: `onboardingPlaybookSlugs` is a `text[]` array on the `modules` table — it declares which playbook slugs a *module* offers during onboarding for any subaccount that enables that module. This is per-module scope, not per-org scope.

The spec's `onboarding_bundle_configs` is described as per-org: "one row per organisation, with a `playbookSlugs` JSONB array and an `order` integer per entry." This is the agency's custom bundle configuration — what the *org* wants in its onboarding flow.

These serve different purposes (module-level declaration vs org-level configuration), but the spec does not state this distinction. Without that distinction, an implementer may treat them as overlapping and avoid creating the new table.

**Two options:**

(a) **State the distinction explicitly**: Add a paragraph to Section 8.7 explaining: "`modules.onboardingPlaybookSlugs` is a module-level declaration of which playbooks a module can offer — it is the source of available playbooks per module. `onboarding_bundle_configs` is an org-level configuration that selects and orders from those available playbooks into a custom bundle. They are two layers of a pull-from-registry model, not duplicates."

(b) **Reconsider the new table**: If `modules.onboardingPlaybookSlugs` already covers what the spec needs, the new table may not be required. This would be a scope reduction.

Option (a) clarifies intent without reducing scope. Option (b) simplifies the schema if the module-level slugs are sufficient for org customisation.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Apply option (a). Add a paragraph to Section 8.7: "`modules.onboardingPlaybookSlugs` is a module-level declaration of which playbooks a module can offer during onboarding — it is the source of available playbooks per module. `onboarding_bundle_configs` is an org-level configuration that selects and orders from those available playbooks into a custom bundle for that agency. They are two layers of a pull-from-registry model: modules declare what is available; orgs configure what they want."
Reject reason (if reject): <edit here>
```

---

### Finding 4.10 — Section 8.4: `portalMode` required by Phase 3 onboarding but defined under S16 in Phase 4

**Classification:** directional
**Signal matched:** Sequencing bugs — Phase 3 onboarding (S5) has a hard dependency on a data model (`portalMode` column on `subaccounts`) that is phased in Phase 4 (S16).
**Spec section:** Section 8.4 "Conversation Arc (Live Path)", Step 8; Section 3 phasing plan

**Codex's finding (verbatim)**

> "Step 8 sets `portalMode` during onboarding, but Section 3 phases onboarding S5 in Phase 3 while the `portalMode` data model belongs to S16 in Phase 4, so the onboarding flow requires a portal primitive that has not shipped yet."

**Adjudicator note:** Confirmed. Section 6.2 specifies `portalMode` as a column added under S16 (Phase 4). Section 8.4 step 8 sets `portalMode` during onboarding (S5, Phase 3). This is a dependency inversion: Phase 3 cannot set a column that doesn't exist until Phase 4.

**Three options:**

(a) **Move `portalMode` column to Phase 1 data layer (S15)**: The `portalMode` column on `subaccounts` is foundational enough that it belongs in the Phase 1 data layer alongside other tier-model primitives. S16 remains in Phase 4 as the UI and activation logic; the column itself ships in Phase 1. This is the cleanest fix.

(b) **Remove portal mode config from Phase 3 onboarding**: Step 8 of the onboarding arc becomes a no-op until Phase 4. Onboarding completes without setting `portalMode` (defaults to Hidden at the DB level). This defers the feature but keeps the phasing clean.

(c) **Move S5 onboarding to Phase 4**: Defers the entire onboarding flow until after portal primitives exist. High cost — onboarding is a Phase 3 priority.

Option (a) is recommended: `portalMode` is a simple text column with a default of `'hidden'` — moving it to Phase 1 as part of the S15 data layer costs one extra migration in Phase 1 and unblocks both Phase 3 onboarding and Phase 4 portal features.

**Decision**

```
Decision: apply-with-modification
Modification (if apply-with-modification): Apply option (a). Move the `portalMode` column migration to Phase 1 as part of the S15 data layer. In the Phase 1 section of the phasing plan (Section 3), add: "portalMode column on subaccounts (text, default 'hidden') — required by Phase 3 onboarding." S16 remains in Phase 4 as the UI, toggle grid, and per-feature activation logic. Update Section 6.2 to note the column ships in Phase 1; the UI ships in Phase 4.
Reject reason (if reject): <edit here>
```

---

## How to resume the loop

After editing all `Decision:` lines above:

1. Save this file.
2. Re-invoke the spec-reviewer agent with the same spec path and this checkpoint.
3. The agent will read this checkpoint, honour each decision, and continue to iteration 5.

If you want to stop the loop entirely without resolving findings, set any decision to `stop-loop` and the loop will exit after honouring already-applied findings.

**Note:** This is iteration 4 of 5. One iteration remains. If all three findings are resolved as mechanical-equivalent (apply with small text edits), iteration 5 may be a clean pass.
