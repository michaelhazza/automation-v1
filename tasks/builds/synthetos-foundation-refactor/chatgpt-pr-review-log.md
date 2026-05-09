# ChatGPT PR Review — synthetos-foundation-refactor — Round 1 triage

PR: #279 — https://github.com/michaelhazza/automation-v1/pull/279
Canonical session log: `tasks/review-logs/chatgpt-pr-review-synthetos-foundation-refactor-2026-05-09T20-24-44Z.md`

This file is a build-folder copy of the round-1 triage entry, written per operator
instruction so the build folder carries the review record alongside spec / plan /
progress / handoff. The canonical session log is the audit trail; this file is a
mirror for build-folder discoverability.

---

## Round 1 — 2026-05-10 (triage only — no implementation yet)

ChatGPT verdict: CHANGES_REQUESTED (6 blockers F1–F6, 3 non-blockers N1–N3).

### Verification of each finding

**F1 — VERIFIED. Real spec drift.**
- Spec lines 354, 409, 1820–1821: `'native_only' | 'native_and_operator'` is locked.
- Code: `migrations/0307_subaccount_agents_governance.sql:9` uses `('native_only', 'operator_allowed')`.
- Code: `server/db/schema/subaccountAgents.ts:122` types `'native_only' | 'operator_allowed'`.
- Code: `server/schemas/subaccountAgents.ts:36` Zod uses `'operator_allowed'`.
- Code: `server/services/policyEnvelopeResolver.ts:98` checks `=== 'operator_allowed'`.
- Code references throughout: `controllerStyleResolver.ts`, `ExecutionTab.tsx`, `SubaccountAgentEditPage.tsx`, plus tests.
- Triage: `technical`.
- Recommendation: implement (rename to spec-locked `native_and_operator`).

**F2 — VERIFIED. Real spec drift.**
- Spec line 1018: `source: 'override' | 'execution_mode_default' | 'subaccount_constraint'`.
- architecture.md:4019: locked stable set `{'override','execution_mode_default','subaccount_constraint'}`.
- Code: `server/services/controllerStyleResolver.ts:13–15, 45, 53, 56` uses `explicit_override` and `subaccount_constraint_downgrade`.
- Tests: 30+ assertions in `controllerStyleResolverPure.test.ts`.
- Triage: `technical`.
- Recommendation: implement (rename literals + tests).

**F3 — VERIFIED but NEEDS_OPERATOR.**
- Spec lines 1835–1836 + 2094: `CHECK (require_approval_at_tier BETWEEN 0 AND 6)` with `DEFAULT 4`.
- Code: `migrations/0307_subaccount_agents_governance.sql:14` ships `BETWEEN 0 AND 7`.
- Code: `client/src/components/agent-config/GovernanceTab.tsx:74` adds `<option value={7}>Never require approval</option>`.
- Logic: `policyEngineServicePure.ts:273` uses `riskTier >= governance.requireApprovalAtTier` — value 7 is unreachable, silently disables the upgrade.
- Triage: `user-facing` — Governance tab adds an admin-visible option that materially changes product behaviour.
- Recommendation: surface to operator. Cleanest path: revert to 0–6.

**F4 — VERIFIED. Real spec drift.**
- Spec line 636: HTTP 422 with code `execution_mode_not_allowed_for_agent`.
- Code: `server/services/policyEnvelopeResolver.ts:57` sets `readonly statusCode = 403`.
- Triage: `technical`.
- Recommendation: implement (change to 422; update tests).

**F5 — VERIFIED but NEEDS_OPERATOR (architecture decision).**
- Spec lines 992, 1059–1067: requires `routing_path_chosen` event sourced from `routing_outcomes` UNION arm joined via `agent_run_id`.
- Code: `server/services/runTraceService.ts:5–7` excludes routing_outcomes.
- Schema reality: `server/db/schema/routingOutcomes.ts` has no `agent_run_id`/`run_id` column. ChatGPT's read of the impossibility is correct.
- Type union `shared/types/runTraceEvent.ts:14` still exports `'routing_path_chosen'` — unsourceable today.
- Triage: `user-facing` — Run Trace is a customer-visible surface with a 15-event contract.
- Recommendation: surface to operator. Cleanest: amend spec to drop `routing_path_chosen` from Phase 1, roadmap to Phase 3.

**F6 — VERIFIED IN PART but NEEDS_OPERATOR.**
- Spec line 491: rubric explicitly puts "Send email to client" at Tier 6.
- Spec line 493: max-tier rule — "Send email" → tier 6.
- CSV `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv` row 6: `send_email,review,4` — drift.
- Other drifts: `crm.send_email`/`crm.send_sms`/`publish_post`/`deliver_report`/`trigger_account_intervention` at Tier 4; `pause_campaign`/`update_bid`/`update_copy` at Tier 3 (spec rubric: pause campaign → Tier 6).
- web/scrape at Tier 0 is defensible (read-only, internal).
- Operator context check: `progress.md` confirms PR-review round 4 closed with "S1-S6 + N1-N7 deferred per operator scope" — but the *spec rubric itself was not amended*; only individual review items were deferred.
- Triage: `user-facing` — Risk Tier is product policy and ships in Run Trace headline.
- Recommendation: surface to operator. Recommended path: align CSV to rubric (Tier 5/6 for client messaging + ad mutations) while keeping `defaultGateLevel: 'review'` via INV-8 so no existing-org behaviour changes. Architect sign-off mandatory.

**N1 — VERIFIED. Real doc drift.**
- `docs/synthetos-nomenclature.md:11`: native definition wrong (says "autonomous, no approval loop"; spec §272 says "deterministic, structured, short-lived").
- `docs/synthetos-nomenclature.md:18`: Risk Tier values wrong (says `'low'/'medium'/'high'/'critical'`; codebase + spec use `0..6`).
- Previously flagged as N4 in PR-review round 1 log and deferred — ChatGPT correctly catches the deferred-but-not-fixed item.
- Triage: `technical`.
- Recommendation: implement (correct both rows, cite spec §272 + §4.2 rubric).

**N2 — VERIFIED IN PART.**
- architecture.md:4006 says "7 ledger tables"; spec line 945 says "nine".
- Resolves with F5: drop the event → architecture's "7" is correct; add the column → architecture should say 8.
- Triage: `technical`. Defer to follow-up of F5.

**N3 — VERIFIED. Workable shape, missing test pin.**
- `shared/types/runTraceEvent.ts:48–80`: payloads flattened at top level.
- Spec §4.4.4 (lines 1014, 1018–1019): nested under `payload`.
- Implementation chose flatten consistently across type / SQL / UI consumer. Internally coherent.
- Triage: `technical`.
- Recommendation: implement small test pin in `runTraceService.test.ts`; update spec §4.4.4 to match the flat shape that shipped.

### Recommendations table

| Finding | Triage | Severity | Recommendation |
|---------|--------|----------|----------------|
| F1 — `controller_style_allowed` enum drift | technical | high | implement |
| F2 — controllerStyle source strings drift | technical | high | implement |
| F3 — `require_approval_at_tier` 0–7 sentinel | user-facing | high | NEEDS_OPERATOR |
| F4 — environment rejection 403 vs 422 | technical | high | implement |
| F5 — Run Trace excludes `routing_outcomes` | user-facing | high | NEEDS_OPERATOR |
| F6 — Risk Tier under-classification | user-facing | high | NEEDS_OPERATOR |
| N1 — nomenclature glossary errors | technical | medium | implement |
| N2 — architecture ledger-count wording | technical | low | defer (follow-up of F5) |
| N3 — Run Trace payload shape test pin | technical | low | implement |

### Operator asks (in priority order)

1. **F3 — sentinel value 7 ("Never require approval"):** keep or remove? *Recommend: REMOVE; revert to 0–6.*
2. **F5 — `routing_path_chosen` event:** drop from Phase 1, or add `agent_run_id` column to `routing_outcomes`? *Recommend: DROP from Phase 1; roadmap to Phase 3.*
3. **F6 — Risk Tier rubric alignment:** raise client-messaging + paid-ads actions to spec rubric, or amend rubric? *Recommend: ALIGN CSV TO RUBRIC, keep `defaultGateLevel='review'` via INV-8.*
4. **Technical batch (F1, F2, F4, N1, N3):** approve as one round, or split per-item? *Recommend: APPROVE AS ONE ROUND.*

No edits or commits made this round. Round 2 fires once the operator answers the asks above.
