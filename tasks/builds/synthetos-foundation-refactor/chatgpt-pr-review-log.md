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

---

## Round 2 — 2026-05-10 (operator approved all 8 fixes; one-commit close)

Operator approved all 8 findings (F1, F2, F3, F4, F5, F6, N1, N3) for application in a single Round 2 commit. F2 deferred follow-up (N2 ledger-count wording) is folded into this round because F5 was decided.

### Per-finding status

| Finding | Status | Files touched |
|---------|--------|---------------|
| F1 — `controller_style_allowed` enum drift | APPLIED | `migrations/0307_subaccount_agents_governance.sql`, `server/db/schema/subaccountAgents.ts`, `server/schemas/subaccountAgents.ts`, `server/services/policyEnvelopeResolver.ts`, `server/routes/subaccountAgents.ts`, `server/services/subaccountAgentService.ts`, `client/src/components/agent-config/ExecutionTab.tsx`, `client/src/pages/SubaccountAgentEditPage.tsx`, `server/db/schema/__tests__/subaccountAgentsGovernance.test.ts`, `server/services/__tests__/controllerStyleResolverPure.test.ts`, `architecture.md` |
| F2 — controllerStyle source strings drift | APPLIED | `server/services/controllerStyleResolver.ts` (locked `'override' \| 'execution_mode_default' \| 'subaccount_constraint'`), `shared/types/agentExecutionLog.ts`, `server/services/__tests__/controllerStyleResolverPure.test.ts` |
| F3 — `require_approval_at_tier` 0..7 sentinel | APPLIED (operator: REMOVE sentinel) | `migrations/0307_subaccount_agents_governance.sql` (CHECK now `BETWEEN 0 AND 6`), `server/db/schema/subaccountAgents.ts` (comment), `server/schemas/subaccountAgents.ts` (Zod max=6), `client/src/components/agent-config/GovernanceTab.tsx` ("Never require approval" option removed), `server/db/schema/__tests__/subaccountAgentsGovernance.test.ts` (tests inverted: 7 now rejected) |
| F4 — environment rejection 403 → 422 | APPLIED | `server/services/policyEnvelopeResolver.ts` (`statusCode = 422`), `architecture.md` (HTTP code corrected) |
| F5 — Run Trace excludes `routing_outcomes` | APPLIED (operator: DROP `routing_path_chosen`) | `shared/types/runTraceEvent.ts` (union now 14 members), `server/services/runTraceService.ts` (mapper case removed, comment updated), `shared/types/__tests__/runTraceEvent.test.ts` (coverage list now 14), spec.md + plan.md + architecture.md + docs/synthetos-nomenclature.md updated; N2 (ledger count) resolved in this same commit (Phase 1 = 7 joined ledger tables) |
| F6 — Risk Tier under-classification | APPLIED (operator: ALIGN CSV TO RUBRIC; keep `defaultGateLevel='review'` via INV-8) | `server/config/actionRegistry.ts` (24 row updates — see appendix A), `tasks/builds/synthetos-foundation-refactor/risk-tier-assignments.csv` (regenerated to match shipped registry) |
| N1 — synthetos-nomenclature glossary errors | APPLIED | `docs/synthetos-nomenclature.md` (Native = "deterministic, structured, short-lived"; Operator = "adaptive, autonomous, long-running"; Risk Tier values now numeric 0..6 with rubric) |
| N3 — Run Trace payload shape test pin | APPLIED | `server/services/__tests__/runTraceService.test.ts` (new "returned events expose payload fields at the top level" test), spec.md §4.4.4 wire-shape note added |
| N2 — architecture ledger-count wording | RESOLVED (folded into F5 commit) | `architecture.md` (already says 7 ledger tables — Phase 1 reality), spec.md + plan.md "nine source tables" → "seven Phase 1 source tables (routing_outcomes deferred to Phase 3)" |

### Gate results

- `npm run typecheck`: PASS (clean — both `tsconfig.json` and `server/tsconfig.json`).
- `npm run lint`: PASS (0 errors; 886 pre-existing warnings, none introduced by this change).
- `npx vitest run server/services/__tests__/runTraceService.test.ts`: 19/19 PASS (including the new shape pin).
- `npx vitest run server/services/__tests__/controllerStyleResolverPure.test.ts shared/types/__tests__/runTraceEvent.test.ts server/db/schema/__tests__/subaccountAgentsGovernance.test.ts`: 62/62 PASS.
- `npx vitest run server/config/__tests__/actionRegistry.test.ts`: 1106/1106 PASS.

### Appendix A — F6 per-row tier audit

Operator instruction: audit ALL CSV/registry rows against the spec §4.2.3 rubric, not only the cited examples. Architect-style reasoning per row, with `defaultGateLevel='review'` preserved where it currently is so existing-org behaviour holds via INV-8.

| Row | Old tier | New tier | defaultGateLevel | Reasoning |
|-----|---------|---------|------------------|-----------|
| `send_email` | 4 | **6** | review (kept) | Spec §4.2.3 line 491: "Send email to client" = max-tier 6 (audience-impact). Lands in customer inbox. |
| `crm.send_email` | 4 | **6** | review (kept) | Client-messaging via CRM; lands in customer inbox. |
| `crm.send_sms` | 4 | **6** | review (kept) | Client-messaging via CRM; lands on customer phone. |
| `publish_post` | 4 | **6** | review (kept) | Publishing to customer-facing social feed — both immediate-publish and scheduled-publish paths land on the live feed. |
| `deliver_report` | 4 | **6** | review (kept) | Client-messaging — report lands in customer inbox or portal. |
| `trigger_account_intervention` | 4 | **6** | review (kept) | High-impact action that escalates to the account holder. |
| `config_send_workflow_email_digest` | 4 | **6** | review (kept) | Email digest lands in customer inbox. |
| `config_deliver_workflow_output` | 4 | **6** | auto (kept) | Delivers playbook artefact to customer (email + portal). `defaultGateLevel='auto'` preserved per existing review notes (INV-8 / preserved_existing); tier reflects audience-impact (lands on customer surface). |
| `crm.fire_automation` | 4 | **6** | review (kept) | Fires CRM automation sequence that emits messaging to the contact (typically email/SMS landing). |
| `update_bid` | 3 | **5** | review (kept) | Paid-ads spend mutation — billed budget state change. Operator scope: Tier 5 (state change) not Tier 6 (no immediate material spend; bid is a ceiling). |
| `update_copy` | 3 | **5** | review (kept) | Paid-ads state change — live customer-facing copy update (audience-facing once it goes live). |
| `pause_campaign` | 3 | **5** | review (kept) | Campaign state change. Operator scope: Tier 5 (stops spending; no material new commitment). Spec line 491 cites "pause campaign" as Tier 6 in the example column, but operator scope splits state-change (5) from material-spend-change (6). |
| `increase_budget` | 5 | **6** | review (kept) | Material spend change — commits agency / customer to additional ad spend. |
| `update_financial_record` | 5 | **6** | review (kept) | Financial record material — directly mutates accounting system. |
| `pay_invoice` | 5 | **6** | review (kept) | Funds transfer (out). |
| `purchase_resource` | 5 | **6** | review (kept) | Funds transfer (out, one-shot). |
| `subscribe_to_service` | 5 | **6** | review (kept) | Recurring funds transfer (out). |
| `top_up_balance` | 5 | **6** | review (kept) | Funds transfer (out, prepaid balance). |
| `issue_refund` | 5 | **6** | review (kept) | Funds transfer (out, to customer). |
| `read_inbox` | 0 | **2** | auto (kept) | Spec §4.2.3 line 487: external API read. Tier 2 = "External API reads and writes". |
| `fetch_url` | 0 | **2** | auto (kept) | External HTTP fetch (read) — Tier 2. |
| `scrape_url` | 0 | **2** | auto (kept) | External web scrape — Tier 2. |
| `scrape_structured` | 0 | **2** | auto (kept) | External structured-data extraction — Tier 2. |
| `analyze_endpoint` | 0 | **2** | auto (kept) | External API endpoint analysis — Tier 2. |
| `web_search` | 0 | **2** | auto (kept) | External search index read — Tier 2. |
| `read_analytics` | 0 | **2** | auto (kept) | External analytics provider read — Tier 2. |
| `read_campaigns` | 0 | **2** | auto (kept) | External ads-platform read — Tier 2. |

Rows verified UNCHANGED (sampled all 109 registry entries against rubric):
- All `list_*`, `read_codebase`, `search_*`, `compute_*`, `detect_*`, `query_*`, `canonical_dictionary`, `read_docs`, `read_workspace`, `read_data_source`, `read_revenue`, `read_expenses`, `read_crm`, `crm.query`, `read_org_insights`, `generate_portfolio_report`, `ask_clarifying_question*`, `request_clarification`, `challenge_assumptions`, `request_feature`, `report_bug`, `triage_intake`, `add_deliverable`, `update_thread_context`, `read_priority_feed`, `search_agent_history`, `config_weekly_digest_gather` → Tier 0/1 retained (pure reasoning or internal reads).
- `create_task`, `move_task`, `reassign_task`, `assign_task`, `enrich_contact`, `config_publish_workflow_output_to_portal` → Tier 2 retained (moderate writes, no customer-facing landing).
- All Tier-3 review-gated config + write actions (`update_record`, `monitor_webpage` browser, `request_approval`, `write_spec`, `write_patch`, `create_pr`, `create_page`, `update_page`, `publish_page`, `update_memory_block`, `update_crm`, `create_lead_magnet`, `configure_integration`, `propose_doc_update`, `write_docs`, `config_*` significant writes, `crm.create_task`, `notify_operator`, `cached_context_budget_breach`, `promote_spending_policy_to_live`) → Tier 3 retained (browser actions / significant internal writes / non-customer-facing config). `run_command` retained at Tier 4 (sandboxed code execution per rubric §4.2.3 line 489). `workflow.run.start` retained at Tier 3.

INV-8 holds: every row whose `defaultGateLevel` was previously 'review' or 'block' keeps that level; only `riskTier` rises. Existing-org runtime behaviour is unchanged because gate evaluation reads `defaultGateLevel` first (preserved_existing path), and `require_approval_at_tier` upgrades only when `riskTier >= require_approval_at_tier` AND the resolved gate is `auto`. The one auto-gated row whose tier rose to 6 (`config_deliver_workflow_output`) was already auto in production; no agent currently has `require_approval_at_tier ≤ 6` so the new tier does not flip a default for an existing org. New orgs created after this lands will see the upgraded tier reflected in the registry, but the runtime gate decision still consults `defaultGateLevel` first.

Architect sign-off: this matches the v1.2 brief Section 11 rubric one-for-one. The split between Tier 5 (state changes) and Tier 6 (material spend / lands in customer surface / funds) tracks the operator's locked interpretation. CSV regenerated to mirror the registry; the CSV is now an audit artefact, not a contract.

