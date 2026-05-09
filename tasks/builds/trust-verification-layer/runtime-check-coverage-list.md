# Runtime Check Coverage List — Stage 1 Top-20 System Skills

**Build:** trust-verification-layer
**Chunk:** 2 (planning artifact — not used by tests or production code)
**Spec:** §5 file inventory, §6.1 RuntimeCheckDefinition, §11 Layer 1 (skill verification)

This table lists the top-20 external-facing action slugs from `ACTION_REGISTRY` with
their proposed `verify` declarations. These are reasonable defaults based on action type,
`isExternal`, and `idempotencyStrategy`. Operator confirms against last-30-days usage
telemetry before Chunk 2 ships (handoff Q1).

Backfilling these into the live registry entries is NOT done in Chunk 2 — the interface
is extended and entries remain `verify: undefined` until the CI gate (Chunk 4 CI gate:
`verify-runtime-check-coverage.sh`) is wired. This file is the seed list for that work.

---

## Coverage table

| # | actionType | proposed `kind` | blastRadius | reversible | rationale |
|---|---|---|---|---|---|
| 1 | `send_email` | `api_status_2xx` | `external` | `false` | Sends email via Gmail API; HTTP 200/201 from provider confirms acceptance. Irreversible — cannot unsend. |
| 2 | `crm.send_email` | `api_status_2xx` | `external` | `false` | GHL CRM email send; confirm via HTTP 2xx from GHL REST endpoint. Irreversible. |
| 3 | `crm.send_sms` | `api_status_2xx` | `external` | `false` | GHL SMS dispatch; HTTP 2xx from GHL confirms message queued. Irreversible — cannot recall SMS. |
| 4 | `crm.fire_automation` | `api_status_2xx` | `external` | `false` | Triggers a GHL automation workflow; 2xx confirms the trigger was accepted. Automation side-effects are not reversible. |
| 5 | `crm.create_task` | `row_exists` with `table: 'crm_tasks', matchKey: 'external_id'` | `external` | `false` | Confirm created task is reflected in canonical CRM table after write. |
| 6 | `crm.query` | `field_match` with `outputPath: 'results', expectedShape: 'string'` | `external` | `true` | Read-only query; verify results field is present and a string (serialised JSON). No external side effect — reversible. |
| 7 | `pay_invoice` | `external_returns` with `provider: 'stripe', expectedField: 'id'` | `external` | `false` | Stripe charge; verify response has a charge `id`. Payment is irreversible without a refund action. |
| 8 | `purchase_resource` | `external_returns` with `provider: 'stripe', expectedField: 'id'` | `external` | `false` | Stripe purchase; same verification pattern as pay_invoice. |
| 9 | `subscribe_to_service` | `external_returns` with `provider: 'stripe', expectedField: 'id'` | `external` | `false` | Stripe subscription create; verify subscription `id` returned. |
| 10 | `issue_refund` | `external_returns` with `provider: 'stripe', expectedField: 'id'` | `external` | `false` | Stripe refund; verify refund `id` returned. |
| 11 | `top_up_balance` | `external_returns` with `provider: 'stripe', expectedField: 'id'` | `external` | `false` | Balance top-up; verify payment intent `id`. |
| 12 | `create_task` | `row_exists` with `table: 'tasks', matchKey: 'id'` | `tenant` | `true` | Internal task creation; verify row persisted in `tasks` table. Reversible — task can be deleted. |
| 13 | `update_record` | `row_exists` with `table: 'records', matchKey: 'id'` | `tenant` | `true` | Generic record update; verify row exists post-write. Reversible via another update. |
| 14 | `fetch_url` | `api_status_2xx` | `external` | `true` | HTTP GET to external URL; 2xx confirms reachable. Read-only, reversible. |
| 15 | `scrape_url` | `field_match` with `outputPath: 'content', expectedShape: 'string'` | `external` | `true` | Scrape result; verify content field is a non-null string. Read-only, reversible. |
| 16 | `notify_operator` | `row_exists` with `table: 'operator_notifications', matchKey: 'id'` | `tenant` | `false` | Internal notification; verify notification row persisted. Not reversible post-send. |
| 17 | `request_approval` | `row_exists` with `table: 'approval_requests', matchKey: 'id'` | `tenant` | `true` | Approval gate request; verify request row created. Reversible — approval can be withdrawn. |
| 18 | `create_page` | `api_status_2xx` | `external` | `false` | Notion page creation via OAuth; 2xx confirms page created. Not natively reversible. |
| 19 | `update_page` | `api_status_2xx` | `external` | `true` | Notion page update; 2xx confirms write accepted. Reversible via another update. |
| 20 | `config_create_agent` | `row_exists` with `table: 'system_agents', matchKey: 'id'` | `tenant` | `false` | Agent creation; verify agent row persisted in `system_agents`. Deletion is possible but creates downstream dependencies. |

---

## Excluded from top-20

Read-only / internal actions (`read_inbox`, `read_data_source`, `read_codebase`, `list_connections`,
`list_platform_capabilities`, `check_capability_gap`) are candidates for `verify: null` with
`verifyNullJustification: 'Read-only skill with no observable side effect to verify'`.

Methodology skills (`challenge_assumptions`, `ask_clarifying_questions`, `write_spec`) are also
candidates for `verify: null` with `verifyNullJustification: 'Pure LLM skill — no deterministic
external check is possible'`.

---

## Notes for Chunk 4 (CI gate)

The CI gate (`scripts/gates/verify-runtime-check-coverage.sh`) will iterate the ACTION_REGISTRY
and assert that every entry has either `verify` set OR `verifyNullJustification` set. At Chunk 2
ship time, neither field is set on existing entries — the gate is CI-only and is introduced in
Chunk 4. The interface contract is the Chunk 2 deliverable; the data backfill happens in Chunk 4.
