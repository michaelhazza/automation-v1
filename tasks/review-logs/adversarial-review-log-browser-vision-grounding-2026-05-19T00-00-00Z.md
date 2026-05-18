# Adversarial Review Log — browser-vision-grounding

**Build slug:** browser-vision-grounding
**Branch:** main (diff base: e90906fb)
**Reviewed:** 2026-05-19T00:00:00Z
**Reviewer:** adversarial-reviewer (Phase 1 advisory)

**Files reviewed:**
- shared/types/visionActions.ts
- shared/types/sandbox.ts (vision fields)
- shared/iee/jobPayload.ts (BrowserTaskPayload.decisionMode)
- shared/visionInferencePricing.ts
- server/db/schema/visionInferenceCalls.ts
- migrations/0378_vision_inference_calls.sql + .down.sql
- server/config/rlsProtectedTables.ts (new entry)
- server/services/visionActionParserPure.ts
- server/services/visionGroundingService.ts
- server/services/executionBackends/_ieeShared.ts
- server/jobs/visionInferenceCostRollupJob.ts
- server/index.ts (boot registration)
- infra/sandbox-templates/iee-browser/harness/index.ts
- infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts
- server/services/skillParserServicePure.ts
- server/services/agentRunFinalizationService.ts (context)
- server/jobs/ieeCostRollupDailyJob.ts (comparison baseline)
- server/db/schema/costAggregates.ts (constraint schema)
- server/db/schema/ieeArtifacts.ts (context)
- server/lib/orgScoping.ts (context)

---

**Verdict:** HOLES_FOUND (1 confirmed-hole, 2 likely-holes)

## Findings

### FINDING 1 — confirmed-hole — FIXED in commit `887219dc`
`server/jobs/visionInferenceCostRollupJob.ts:57-83` (platform aggregate upsert)

**Attack scenario:** The daily rollup job's `ON CONFLICT (entity_type, entity_id, period_type, period_key) DO UPDATE` upserts with conflict key `(entity_type='source_type', entity_id='vision_inference', period_type='daily', period_key='2026-05-19')` — identical across all organisations for the same calendar day. The `SELECT … GROUP BY organisation_id` produces multiple rows (one per org), and the upsert processes them in arbitrary order. Each subsequent org's row blind-overwrites `total_cost_cents` and `request_count` — not additive. Every org's vision cost for that day except whichever processed last is silently zeroed.

**Secondary leakage:** Any dashboard reading `entity_type='source_type', entity_id='vision_inference'` serves one org's cost data attributed to a different org via the surviving `organisation_id` column. Cross-tenant data leak in the aggregate layer.

**Fix applied:** Changed `entity_type='vision_inference'` (was `'source_type'`) and `entity_id=organisation_id::text` (was the fixed string `'vision_inference'`), mirroring the `ieeCostRollupDailyJob` precedent. The `(entity_type, entity_id, period_type, period_key)` uniqueness key now dedups per-org-per-day. Commit: `887219dc`. Doc comment at `visionInferenceCostRollupJob.ts:57-65` credits the adversarial-reviewer finding.

### FINDING 2 — likely-hole — ROUTED to tasks/todo.md (BVG-ADV-2)
`server/services/visionGroundingService.ts:197` — harness-sourced `subaccountId` accepted without cross-org validation

**Attack scenario (V2 only — not triggerable in V1 because harness is stub):** `harvestVisionCalls` downloads `vision_calls.json` and deserialises `VisionCallRecord[]` with no validation of the `subaccountId` field beyond `?? ieeRun.subaccountId ?? null`. The RLS `WITH CHECK` on `vision_inference_calls` validates only `organisation_id`. The `subaccounts` FK is unconstrained against `organisationId`, so a compromised sandbox or storage ACL misconfiguration could persist a cross-org subaccount FK reference.

**Routed to:** `tasks/todo.md` as **BVG-ADV-2** with fix recommendation: before INSERT, run `SELECT id FROM subaccounts WHERE id = rec.subaccountId AND organisation_id = ieeRun.organisationId`; discard and warn on mismatch.

### FINDING 3 — likely-hole — ROUTED to tasks/todo.md (BVG-ADV-3)
`server/services/visionGroundingService.ts:68-83` / `server/services/executionBackends/_ieeShared.ts:272-274` — `VISION_INFERENCE_API_KEY` token leakage path lacks automated enforcement

**Attack scenario (V2 only — V1 stub harness logs nothing real):** `visionEndpointToken` flows through `HarnessInput` and `/workspace/input.json`. Token-redaction contract is documented but not enforced by any sanitiser — only by code-review discipline. A debug log line like `console.log(JSON.stringify(input))` or an error handler serialising the input object to `output.json` would leak the live API key to object storage.

**Routed to:** `tasks/todo.md` as **BVG-ADV-3** with fix recommendation: add static-search lint rule or `redact()` wrapper at harness layer that strips known token shapes (Bearer, sk_, eyJ) from any string written to artefact files.

## Additional Observations (routed to tasks/todo.md)

- **BVG-ADV-OBS-1:** `harvestVisionCalls` calls `setOrgGUC` mid-transaction, not as the first statement of the outer `db.transaction`. Safe due to transaction-local `set_config`, but diverges from documented invariant.
- **BVG-ADV-OBS-2:** `ui-tars-7b` placeholder pricing rates lack a CI gate that prevents shipping with non-authoritative values.
- **BVG-ADV-OBS-3:** `JSON.parse(rawJson) as VisionCallRecord[]` lacks `Array.isArray` guard — would throw with confusing error on malformed JSON. **FIXED in commit `fea13172`.**

## STRIDE Sweep — clean

Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege — no new holes beyond the three above. Vision-mode in V1 is a stub so post-write surfaces are theoretical.

## Status

- **Confirmed hole (ADV-1):** FIXED `887219dc`
- **Likely holes (ADV-2, ADV-3):** ROUTED to `tasks/todo.md` as V2-deferred (V1 harness is stub, not triggerable)
- **Observations (OBS-1, OBS-2, OBS-3):** OBS-3 fixed; OBS-1/2 routed to `tasks/todo.md`
