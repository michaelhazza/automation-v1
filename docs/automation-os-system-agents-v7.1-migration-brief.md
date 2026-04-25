# Automation OS — System Agents v7.1 Migration Brief

**Status:** Draft for the agent-build session
**Date:** 2026-04-25
**Source spec:** System Agents Master Brief v7.1
**Predecessor:** `docs/automation-os-system-agents-brief-v6.md`
**Pre-production:** wiping system-agent state is acceptable

---

## 1. Purpose

Audit what Automation OS currently has on disk and in the seed pipeline against the v7.1 system-agents spec, then specify the exact diff needed in the company folder, the skill registry, and `scripts/seed.ts`. Includes a self-contained local-dev reset plan and the runtime-contract invariants (§4.11) that turn v7.1 from organisational guidance into an enforceable structure.

## 2. Current state — what's actually there

### 2.1 Agents on disk

`companies/automation-os/agents/` contains **16 agent folders**, all flat under the Orchestrator (no T2 layer):

| # | Slug | Tier (current) | reportsTo | Notes |
|---|------|----------------|-----------|-------|
| 1 | `orchestrator` | T1 | `null` | OK |
| 2 | `business-analyst` | T2 (flat) | `orchestrator` | Needs reparent → CTO |
| 3 | `dev` | T2 (flat) | `orchestrator` | Needs reparent → CTO |
| 4 | `qa` | T2 (flat) | `orchestrator` | Needs reparent → CTO |
| 5 | `support-agent` | T2 (flat) | `orchestrator` | Needs reparent → CCO |
| 6 | `social-media-agent` | T2 (flat) | `orchestrator` | Needs reparent → CMO |
| 7 | `ads-management-agent` | T2 (flat) | `orchestrator` | Needs reparent → CMO |
| 8 | `email-outreach-agent` | T2 (flat) | `orchestrator` | Needs reparent → CMO |
| 9 | `strategic-intelligence-agent` | T2 (flat) | `orchestrator` | Stays direct-to-COO |
| 10 | `finance-agent` | T2 (flat) | `orchestrator` | Reparent → CRO + drop `update_financial_record` |
| 11 | `content-seo-agent` | T2 (flat) | `orchestrator` | Needs reparent → CMO |
| 12 | `client-reporting-agent` | T2 (flat) | `orchestrator` | **Retire** — skills absorbed into Retention/Success |
| 13 | `onboarding-agent` | T2 (flat) | `orchestrator` | Needs reparent → CCO |
| 14 | `crm-pipeline-agent` | T2 (flat) | `orchestrator` | Needs reparent → CRO |
| 15 | `knowledge-management-agent` | T2 (flat) | `orchestrator` | Needs reparent → CTO |
| 16 | `portfolio-health-agent` | special | `null` | OK (org-scoped) |

Plus the **Playbook Author** (`workflow-author`) — created in seed Phase 3, not in `agents/`. Stays as-is.

### 2.2 Skill registry

`server/skills/*.md` — current count: **143 markdown files** (counted minus `README.md`).

Universal/foundational skills already exist: `read_workspace`, `write_workspace`, `update_memory_block`, `create_task`, `move_task`, `update_task`, `reassign_task`, `add_deliverable`, `spawn_sub_agents`, `request_approval`, `triage_intake`.

Skills classified `none` in `scripts/lib/skillClassification.ts`: 14 (task-board primitives, workspace memory, HITL, Playbook Studio).

### 2.3 Seed pipeline (`scripts/seed.ts`)

Six phases, all idempotent at row level:

| Phase | What it does | Slug-based upsert | Removes orphans? |
|-------|--------------|-------------------|------------------|
| 1 | System org + system admin user | yes | n/a |
| 2 | 16 system agents from `companies/automation-os/agents/<slug>/AGENTS.md`; wires `parentSystemAgentId` from `reportsTo` | yes | **NO** |
| 3 | Playbook Author (17th system agent) | yes | n/a |
| 4 | Playbook templates + portfolio-health-sweep | yes | n/a |
| 5 | Synthetos dev org + main subaccount + Reporting Agent + activate-baseline-system-agents | yes | **NO** |
| 6 | Configuration Assistant guidelines block | yes | n/a |

**Key gap:** Phase 2 upserts every agent in the company folder but never deletes a `system_agents` row whose slug is no longer present on disk. Removing `client-reporting-agent`'s folder leaves an orphan row in the DB. Phase 5's `activateBaselineSystemAgents` then re-creates a corresponding `agents` row in the dev org.

A pre-flight check, `preflightVerifySkillVisibility`, fails the seed if any skill `.md` is missing/wrong on `visibility:`. This is the only existing "fail-fast" gate.

### 2.4 Hierarchy infrastructure

The seed already supports multi-tier hierarchy: Phase 2 first inserts every agent, then builds a slug→id map, then re-runs through `parsed.agents` setting `parentSystemAgentId`. Depth is unconstrained — adding the four T2 manager agents needs **no seed-script change**, only new agent folders.

## 3. v7.1 target — what the spec wants

22 system agents on disk, three-tier hierarchy:

```
orchestrator (T1)
├── head-of-product-engineering (T2)        NEW
│   ├── business-analyst                    REPARENT
│   ├── dev                                 REPARENT
│   ├── qa                                  REPARENT
│   └── knowledge-management-agent          REPARENT
├── head-of-growth (T2)                     NEW
│   ├── social-media-agent                  REPARENT
│   ├── ads-management-agent                REPARENT
│   ├── email-outreach-agent                REPARENT
│   └── content-seo-agent                   REPARENT
├── head-of-client-services (T2)            NEW
│   ├── support-agent                       REPARENT
│   ├── onboarding-agent                    REPARENT
│   └── retention-success-agent             NEW
├── head-of-commercial (T2)                 NEW
│   ├── finance-agent                       REPARENT + RESCOPE
│   ├── crm-pipeline-agent                  REPARENT
│   └── sdr-agent                           NEW
├── admin-ops-agent (T2 staff)              NEW
└── strategic-intelligence-agent (T2)       NO CHANGE

portfolio-health-agent → null               NO CHANGE (special)
```

**Net diff:** +7 agents (4 managers + admin-ops + retention-success + sdr), −1 agent (client-reporting), 13 reparents.

Plus Playbook Author = 23 system agents total in the DB.

## 4. Concrete change set

### 4.0 Migration order (mandatory)

Subtle ordering bugs surface when these steps interleave. Execute in this order:

1. **Schema migration** — partial-unique-index swap on `system_agents.slug` and `agents.(organisation_id, slug)` per §4.11.6. Plus the `skill_idempotency_keys` table per §4.11.4. Run via `npm run migrate`. **Path A in §6 fails without this.**
2. **Skill files** — create the 14 new `.md` files in `server/skills/` (§4.4). Stub frontmatter is sufficient at first.
3. **Skill classification** — add `list_my_subordinates` to `APP_FOUNDATIONAL_SKILLS` in `scripts/lib/skillClassification.ts`, then run `npx tsx scripts/apply-skill-visibility.ts` to fix every new skill's `visibility:` field.
4. **Action registry + handlers** — add registry entries (`server/config/actionRegistry.ts`) and handler implementations (`server/services/skillExecutor.ts` + `server/skills/handlers/`). External-side-effect handlers must enforce §4.11.3 + §4.11.4.
5. **Env vars** — add `GOOGLE_PLACES_API_KEY` and `HUNTER_API_KEY` to `server/lib/env.ts` and `.env.example` (§4.8).
6. **Agent files** — create the 7 new agent folders (§4.1) and reparent the 13 existing agents (§4.2). Drop `update_financial_record` from finance-agent (§4.6).
7. **Retire `client-reporting-agent`** — delete the folder (§4.3). Skill files stay (re-wired into retention-success-agent).
8. **Manifest + docs** — regenerate `automation-os-manifest.json` to v7.1 with all 22 agents (§4.9 — required, not optional).
9. **Local DB reset** — Path A in §6 (soft-delete UPDATE + `npm run seed`).

Skipping or inverting steps causes the seed pre-flight (`preflightVerifySkillVisibility`) to abort, or — most commonly — Path A fails on the second attempt with a unique-constraint violation because step 1 wasn't run.

### 4.1 New agent folders (7)

Create `companies/automation-os/agents/<slug>/AGENTS.md` for each, with frontmatter matching v7.1 §6 roster and skill list matching the per-agent skill table.

**Token budget ratios (intentional, not hand-wavy):**

| Agent class | `tokenBudget` | `maxToolCalls` | Rationale |
|-------------|---------------|----------------|-----------|
| Manager (4 heads) | `9000` (30% of worker) | `12` (60% of worker) | Decompose-delegate-aggregate; no domain execution |
| Staff worker (admin-ops) | `25000` | `20` | Heavy reconciliation logic, multi-step financial flows |
| Standard worker (retention-success, sdr) | `25000` | `20` | Match existing peer workers (crm-pipeline-agent: 25000/20) |

These ratios are enforced by the seed (`scripts/lib/companyParser.ts` `toSystemAgentRows` already reads `tokenBudget` and `maxToolCalls` from frontmatter). The runtime routing layer respects these caps via `subaccount_agents.tokenBudgetPerRun` and `maxToolCallsPerRun`. If a manager hits its budget consistently, that is a signal it is over-executing — fix the manager prompt, not the budget.

| Slug | reportsTo | Schedule | Gate | Skills (per spec §10–§14, §21, §29) |
|------|-----------|----------|------|--------------------------------------|
| `head-of-product-engineering` | `orchestrator` | on-demand | auto | manager bundle + `read_codebase` + `create_task` |
| `head-of-growth` | `orchestrator` | on-demand | auto | manager bundle + `read_campaigns` + `read_analytics` + `create_task` |
| `head-of-client-services` | `orchestrator` | on-demand | auto | manager bundle + `create_task` |
| `head-of-commercial` | `orchestrator` | on-demand | auto | manager bundle + `read_revenue` + `read_crm` + `create_task` |
| `admin-ops-agent` | `orchestrator` | on-demand | review | universal + admin-ops bundle (see §4.4) + `read_revenue` + `read_expenses` + `send_email` + `create_task` |
| `retention-success-agent` | `head-of-client-services` | on-demand | review | universal + `detect_churn_risk` + `score_nps_csat` + `prepare_renewal_brief` + `draft_report` + `deliver_report` + `send_email` |
| `sdr-agent` | `head-of-commercial` | on-demand | review | universal + `discover_prospects` + `web_search` + `enrich_contact` + `draft_outbound` + `score_lead` + `book_meeting` + `send_email` + `update_crm` |

**Manager bundle** (universal + delegation + standard board ops):
```
read_workspace, write_workspace, list_my_subordinates, spawn_sub_agents,
reassign_task, create_task, move_task, update_task, add_deliverable, request_approval
```

**Universal bundle** (every business agent except portfolio-health):
```
read_workspace, write_workspace, move_task, update_task, request_approval, add_deliverable
```

### 4.2 Reparents (13 agents)

Edit one line in each existing `AGENTS.md` — `reportsTo:` switches from `orchestrator` to the new T2 head:

| Agent | New parent |
|-------|------------|
| `business-analyst`, `dev`, `qa`, `knowledge-management-agent` | `head-of-product-engineering` |
| `social-media-agent`, `ads-management-agent`, `email-outreach-agent`, `content-seo-agent` | `head-of-growth` |
| `support-agent`, `onboarding-agent` | `head-of-client-services` |
| `finance-agent`, `crm-pipeline-agent` | `head-of-commercial` |

`strategic-intelligence-agent` and `portfolio-health-agent` are unchanged.

### 4.3 Retire `client-reporting-agent`

- Delete the folder `companies/automation-os/agents/client-reporting-agent/`.
- Skills `draft_report` and `deliver_report` are already file-resident — re-wire them in `retention-success-agent/AGENTS.md`. No skill files to delete.
- The system_agents row left behind in the DB is handled in §6 (local reset).

### 4.4 New skill files (14)

All new skills go in `server/skills/<slug>.md` with the standard frontmatter. Classification:

| New skill | Visibility | Classification entry needed |
|-----------|------------|------------------------------|
| `list_my_subordinates` | `none` | **Add to** `APP_FOUNDATIONAL_SKILLS` in `scripts/lib/skillClassification.ts` |
| `generate_invoice` | `basic` | default |
| `send_invoice` | `basic` | default |
| `reconcile_transactions` | `basic` | default |
| `chase_overdue` | `basic` | default |
| `process_bill` | `basic` | default |
| `track_subscriptions` | `basic` | default |
| `prepare_month_end` | `basic` | default |
| `discover_prospects` | `basic` | default — **Google Places caller; see §5** |
| `draft_outbound` | `basic` | default |
| `score_lead` | `basic` | default |
| `book_meeting` | `basic` | default |
| `score_nps_csat` | `basic` | default |
| `prepare_renewal_brief` | `basic` | default |

Frontmatter shape — copy from any existing peer (`server/skills/draft_post.md` etc) and replace slug/description.

After adding, run:
```bash
npx tsx scripts/apply-skill-visibility.ts
```
The seed pre-flight (`preflightVerifySkillVisibility`) will then pass.

**Foundational-skill drift safeguard:** any skill in `APP_FOUNDATIONAL_SKILLS` must be callable from any agent, in any environment, without external provider configuration. `list_my_subordinates` reads from `system_agents` directly — fine. If a future skill is added to the foundational set that needs an env var or external API, that is a classification bug, not an integration bug. Add an assertion in `scripts/verify-skill-visibility.ts` (or the pre-flight) that foundational skills declare no external integration in their action-registry entry.

### 4.5 Skill enhancement — `enrich_contact` (Hunter provider)

Per the SDR Lead-Discovery dev brief:
- Add `provider` parameter (default unchanged; `provider: 'hunter'` routes to Hunter.io).
- Hunter endpoints: `/v2/domain-search`, `/v2/email-finder`.
- Fail-soft on 402/429; return structured warning, not throw.
- Cache: in-memory LRU keyed on domain, 24h TTL.

### 4.6 Finance Agent — drop `update_financial_record`

Edit `companies/automation-os/agents/finance-agent/AGENTS.md` and remove `update_financial_record` from the `skills:` list.

The skill file `server/skills/update_financial_record.md` itself: **delete** (pre-production; nothing else references it). Action-registry/handler entries for it should be removed in the same PR.

### 4.7 Action registry + handler registration

In `server/config/actionRegistry.ts`, add entries for the 14 new skills. Each needs:
```
{ slug, description, topics, defaultGateLevel, actionCategory, readPath, payloadSchema }
```

In `server/services/skillExecutor.ts` `SKILL_HANDLERS` map, register a handler for each. Handlers live in the existing `server/skills/handlers/` (or wherever the convention places them). For Admin-Ops skills that wrap external calls (Stripe / Xero / accounting), stub the integration layer if those providers aren't connected yet — handlers must return a structured "not configured" warning rather than throw.

### 4.8 Env vars (per the SDR brief)

Add to `server/lib/env.ts`:
```ts
GOOGLE_PLACES_API_KEY: z.string().optional(),
HUNTER_API_KEY: z.string().optional(),
```

Add to `.env.example`:
```
# Lead discovery (SDR Agent)
GOOGLE_PLACES_API_KEY=
HUNTER_API_KEY=
```

Both optional — handlers gracefully degrade when absent.

### 4.9 Manifest JSON (required)

`companies/automation-os/automation-os-manifest.json` is index-only (per its own `_comment`, not read by code), but it is the only human-readable snapshot of system structure — drift here means future readers see a stale picture. **Required for this migration.** Update:
- `version: "7.1.0"`
- `description` — "16-agent team" → "22-agent team"
- `agents` array — all 22 entries with correct `reportsTo` per v7.1 §6
- `masterBrief` — point at this file (`docs/automation-os-system-agents-v7.1-migration-brief.md`)

If the manifest must be regenerated mechanically, add a small script `scripts/regenerate-company-manifest.ts` that walks `companies/automation-os/agents/*/AGENTS.md` and emits the JSON. Run it as part of the seed pre-flight to flag drift.

### 4.10 Seed-script changes (required before production)

The seed already handles N-tier hierarchy correctly. Two required additions — Path A in §6 covers the migration moment, but these must land before any production deploy or `system_agents` will drift permanently from disk:

1. **Orphan cleanup in Phase 2/3** (idempotent, low blast radius):
   After parsing the company folder, compute the expected slug set and soft-delete any `system_agents` row outside it — but include `workflow-author` in the allowlist since Playbook Author is upserted in Phase 3.
   ```ts
   // Run after Phase 3 so Playbook Author is in scope
   const expected = new Set([...parsed.agents.map(a => a.slug), 'workflow-author']);
   await db.update(systemAgents)
     .set({ deletedAt: new Date(), status: 'inactive' })
     .where(and(
       isNull(systemAgents.deletedAt),
       not(inArray(systemAgents.slug, [...expected])),
     ));
   ```
2. **Cascade soft-delete to `agents` and `subaccount_agents`** for any system_agent slug that just got cleared — otherwise dev orgs keep stale `agents` rows referencing the now-deleted system_agent. Soft-deleting `agents` where `systemAgentId` matches the orphan and setting `subaccount_agents.isActive = false` for those is sufficient.

Both changes can be deferred only until production deploy. For the v7.1 migration moment, §6 Path A covers the gap with one-shot SQL.

### 4.11 Invariants & contracts (mandatory)

The hierarchy migration moves from "guidance" to "contract" — these invariants must be encoded as runtime/build-time checks, not docstring promises. Each one corresponds to a known failure mode in the existing system.

#### 4.11.1 Agent ↔ skill contract completeness

Every skill referenced in any `AGENTS.md` `skills:` list must:

1. Have a corresponding `server/skills/<slug>.md` file with valid frontmatter (incl. `visibility:`).
2. Be registered in `server/config/actionRegistry.ts`.
3. Have a handler in `server/services/skillExecutor.ts` `SKILL_HANDLERS`.

Add a verification script at `scripts/verify-agent-skill-contracts.ts` (or extend the existing seed pre-flight) that:
- Parses every `companies/automation-os/agents/*/AGENTS.md`.
- Collects the union of all `skills:` slugs.
- Asserts each slug exists in all three places above.
- Aborts the seed (exit 1) on any miss.

This eliminates the silent-runtime-failure mode where an agent has a skill in its frontmatter but no handler at runtime.

#### 4.11.2 Hierarchy validation invariants

The seed must validate the hierarchy after Phase 3 (so Playbook Author is in scope):

- **Exactly one root** with `parent_system_agent_id IS NULL` and slug `orchestrator` among the business-team agents (`portfolio-health-agent` and `workflow-author` are exempt).
- **No cycles** — a depth-first walk from each leaf must terminate at `orchestrator` within ≤ 3 hops.
- **Every non-root has a valid parent** — `parent_system_agent_id` references a non-deleted row.
- **Maximum depth ≤ 3** for the v7.1 tree (Orchestrator → Head → Worker).

Implement as a post-seed assertion in `phase3_playbookAuthor` (after the orphan cleanup). Failure aborts the seed and prints the offending slug(s).

#### 4.11.3 Side-effect safety contract

New skills with external side effects must enforce a hard contract — fail-soft is only acceptable for read operations:

| Skill class | On config-missing or transient failure | On partial success |
|-------------|----------------------------------------|---------------------|
| **Read** (`read_revenue`, `read_expenses`, `discover_prospects`, `read_inbox`, `read_campaigns`, `read_crm`, `read_analytics`, `read_codebase`, `read_docs`, `web_search`) | Return structured `{ status: 'not_configured' \| 'transient_error', warning, data: null }`. Never throw. | n/a |
| **Write / external side-effect** (`send_invoice`, `send_email`, `book_meeting`, `update_crm`, `publish_post`, `publish_page`, `update_bid`, `update_copy`, `process_bill`, `reconcile_transactions`, `chase_overdue`, `prepare_month_end`, `deliver_report`, `configure_integration`, `generate_invoice`, `track_subscriptions`, `trigger_account_intervention`) | Validate config first. If any required config or auth is missing, return `{ status: 'blocked', reason }` **before** any side effect. Never partially execute. | Return `{ status: 'partial', completed_steps, remaining_steps }` and surface as a board task with explicit recovery instructions. |

Handlers that touch multiple resources (e.g. `prepare_month_end` collating Stripe + Xero) must wrap the cross-resource operation in a transactional boundary or a compensating-action pattern. Half-written financial state is the worst failure class in this system.

Codify by:
- Adding `sideEffectClass: 'read' | 'write'` to the action registry entry for every new skill.
- Adding a wrapper in `executeWithActionAudit` that enforces the table above based on `sideEffectClass`.

#### 4.11.4 Idempotency for new write skills

Every side-effect skill must be idempotent under retry. The existing job/retry system will replay calls; without dedup, retries duplicate writes:

| Skill | Idempotency strategy |
|-------|---------------------|
| `send_invoice` | Idempotency key on `(engagement_id, billing_period_start, billing_period_end)`; reject if invoice already exists. |
| `generate_invoice` | Same as `send_invoice` — invoice number is the dedup key. |
| `process_bill` | Idempotency key on external bill ID + amount + due-date hash. |
| `reconcile_transactions` | Stripe charge ID is the natural dedup key — refuse to reconcile a charge already marked reconciled. |
| `chase_overdue` | Idempotency key on `(invoice_id, dunning_step)`; one chase per step per invoice. |
| `book_meeting` | Idempotency key on `(prospect_email, requested_slot)`; calendar provider's own dedup is the secondary safety net. |
| `update_crm` | Caller-supplied idempotency key on the create/update operation; on retry, return the existing record. |
| `send_email` (already exists, applies here) | Idempotency key on `(recipient, subject, body_hash, send_window)`. |
| `deliver_report` | Idempotency key on `(report_id, channel, period)`. |
| `prepare_renewal_brief` | Read-only output; no idempotency concern, but must accept a `brief_id` to allow repeated drafts without duplicating board tasks. |

Add an `idempotency` field to each new action-registry entry: `{ keyShape: string, scope: 'subaccount' | 'org', ttlClass: 'permanent' | 'long' | 'short' }`. The handler wrapper hashes the inputs per `keyShape` and records the result in `skill_idempotency_keys` before executing. Replays return the cached result.

**Idempotency store contract** (keep it simple — do not over-design):

```sql
CREATE TABLE skill_idempotency_keys (
  subaccount_id   uuid NOT NULL,
  skill_slug      text NOT NULL,
  key_hash        text NOT NULL,
  request_hash    text NOT NULL,
  response_payload jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  expires_at      timestamptz NULL, -- NULL = no expiry (financial)
  PRIMARY KEY (subaccount_id, skill_slug, key_hash)
);
```

- **Scope (primary key)** — `(subaccount_id, skill_slug, key_hash)`. Org-scoped skills (none yet, but reserved) use the org-subaccount UUID.
- **Replay behaviour** — on hit, the handler **must** return the original stored `response_payload` verbatim. It must not recompute, re-hit external APIs, or re-emit side effects.
- **TTL by class:**
  - `permanent` — financial / accounting skills (`generate_invoice`, `send_invoice`, `process_bill`, `reconcile_transactions`, `chase_overdue`, `prepare_month_end`). Audit trail must never expire. `expires_at = NULL`.
  - `long` — CRM / commitments (`update_crm`, `book_meeting`, `deliver_report`). 30 days. Long enough to absorb retry cycles, short enough to keep the table from rotting.
  - `short` — communications (`send_email`). 14 days. Same recipient + same content within 14 days is treated as a duplicate.
- **Cleanup** — a daily pg-boss job deletes rows where `expires_at < NOW()`. `permanent` rows never match.
- **Request-hash mismatch** — if the same `key_hash` is invoked with a different `request_hash`, that is a contract violation. Log `skill.error` and return `{ status: 'idempotency_collision' }` rather than overwrite. Almost always a caller bug.

**Concurrency-safe write pattern (mandatory):** without this, two simultaneous identical requests both pass the existence check and both execute the side effect — idempotency fails silently. The handler wrapper must use a single atomic SQL statement to acquire the key, not check-then-write:

```sql
INSERT INTO skill_idempotency_keys
  (subaccount_id, skill_slug, key_hash, request_hash, response_payload, expires_at)
VALUES ($1, $2, $3, $4, '{}'::jsonb, $5)
ON CONFLICT (subaccount_id, skill_slug, key_hash) DO NOTHING
RETURNING xmax = 0 AS is_first_writer;
```

- **`is_first_writer = true`** — this caller wins. Execute the side effect, then `UPDATE skill_idempotency_keys SET response_payload = $1 WHERE ...`.
- **`is_first_writer = false`** — another caller is in flight or already done. Read the row; if `response_payload <> '{}'`, return it verbatim. If still `'{}'`, poll briefly (up to a small bounded window) or return `{ status: 'in_flight' }` to let the caller retry.

This is the `INSERT ... ON CONFLICT DO NOTHING` first-writer-wins pattern. Without it, `send_invoice` and `book_meeting` will silently double-fire under realistic concurrency.

#### 4.11.5 Manager behaviour contract

Manager agents (the four department heads) must not execute worker-only skills. The hierarchy collapses if a manager directly does the work it should be delegating.

Encode at three layers:

1. **In each manager's `AGENTS.md`** — the system prompt explicitly states: *"You do not execute domain skills. You decompose, delegate via `reassign_task` or `spawn_sub_agents`, aggregate, and report."*
2. **Manager skill bundle is closed** — managers are wired with the universal bundle + delegation bundle + at most one domain-read skill (e.g. `read_revenue` for the CRO). They do not get worker-execution skills (`draft_post`, `update_crm`, `send_email`, `write_patch`, etc.).
3. **Runtime guard — explicit allowlist, not a denylist.** Extend `executeWithActionAudit` so when a `system_agents` row's role is `manager` (set by frontmatter `role: manager` on the four department heads), it accepts **only** the skills present in the manager allowlist. Anything outside the allowlist — worker skill, another department's read skill, an unrecognised slug — is a hard reject with `{ status: 'blocked', reason: 'manager_role_violation' }`.

   The allowlist per manager:
   ```
   manager_allowlist = universal_bundle ∪ delegation_bundle ∪ this_manager_specific_reads
   ```
   - `universal_bundle` = `read_workspace`, `write_workspace`, `move_task`, `update_task`, `request_approval`, `add_deliverable`, `create_task`
   - `delegation_bundle` = `list_my_subordinates`, `spawn_sub_agents`, `reassign_task`
   - `this_manager_specific_reads` = the read skills declared in that manager's `AGENTS.md` (e.g. `read_codebase` for the CTO; `read_revenue` + `read_crm` for the CRO).

   Allowlist semantics close two edge cases the original "reject worker-only skills" wording missed: (a) a manager invoking another manager's read skill, and (b) a manager invoking a read skill whose handler indirectly triggers a side effect. If it isn't on the list, it doesn't run.

4. **No direct external side effects from a manager.** Manager-permitted skills must not directly trigger external side effects; any downstream execution that touches an external system (CRM write, email send, payment, ad change, code commit) must occur via a delegated agent. This includes the indirect path: a manager calling `create_task` whose downstream automation triggers worker logic is acceptable (the work is still routed through a worker and its review gates), but a manager handler that itself calls Stripe / Gmail / Anthropic / GitHub is a contract violation. Encode by tagging each skill in the action registry with `directExternalSideEffect: bool`; the manager guard rejects any skill where that flag is `true`.

This makes the violation a hard error rather than a slow drift into "super-managers" that bypass the workers.

#### 4.11.6 Active-row uniqueness (mandatory schema migration)

**This is required, not nice-to-have.** Today's schema has a *full* unique index on `system_agents.slug` and a full unique on `agents.(organisation_id, slug)`. Combined with the soft-delete reset in §6 Path A, that creates a deterministic failure: soft-deleted rows still occupy the slug, so the seed's `INSERT` then violates the unique constraint and rolls back. Path A is unusable until this is fixed.

**The invariant — only one active row per slug:**

```sql
-- system_agents: globally unique slug (incl. workflow-author)
DROP INDEX IF EXISTS system_agents_slug_idx;
CREATE UNIQUE INDEX system_agents_slug_active_idx
  ON system_agents (slug)
  WHERE deleted_at IS NULL;

-- agents: unique slug per org
DROP INDEX IF EXISTS agents_org_slug_uniq;
CREATE UNIQUE INDEX agents_org_slug_active_uniq
  ON agents (organisation_id, slug)
  WHERE deleted_at IS NULL;
```

Land as a Drizzle migration (`server/db/migrations/<n>_partial_unique_active_slug.sql`) plus a matching schema update in `server/db/schema/systemAgents.ts` and `server/db/schema/agents.ts` swapping `uniqueIndex(...).on(...)` for the equivalent partial unique. The `subaccount_agents` table is keyed on `(subaccount_id, agent_id)` UUIDs, not slugs — no change needed there.

**Why this matters beyond Path A:**
- Re-running the soft-delete reset multiple times (during iterative dev) cannot accumulate duplicates.
- Backwards-compatible — the partial index permits one active + many soft-deleted rows per slug.
- Lookups stay fast — the `isNull(deletedAt)` filter the seed already uses can hit the partial index directly.
- Manual data-inspection in psql gives a clean view: `SELECT * FROM system_agents WHERE deleted_at IS NULL` is the unambiguous "current state".

**Order of operations** — run the migration **before** the §6 Path A wipe. The §4.0 migration order is updated accordingly.

## 5. SDR Lead-Discovery dev brief — incorporation

The SDR brief lands cleanly inside §4. Deferred items from the brief explicitly do not apply:
- ❌ Standalone `lead-discover` pg-boss job — the SDR agent runs on-demand.
- ❌ Standalone "lead-discover" system agent seed — the SDR agent IS the runner.
- ❌ "Sales Pipeline" subaccount pattern — SDR agent writes to whatever subaccount it runs under.
- ❌ Separate `lead_score` skill — folded into `score_lead`.

The remaining items are all in §4.4 / §4.5 / §4.7 / §4.8 above. The SDR agent's wired skill list in §4.1 already includes `discover_prospects`.

The brief's dependency on Workstream B (`canonical_prospect_profiles` extension) is **not a blocker** for this rollout — if Workstream B isn't shipped when the SDR agent goes live in Phase 5, stub the prospect-profile write at the handler layer with a TODO and proceed.

## 6. Local dev setup — recommended path

Pre-production. Idempotent re-seeding will not delete the `client-reporting-agent` row from the DB. Two viable paths:

### Path A (recommended) — soft-delete system-agent state, re-seed

Fastest, cleanest, FK-safe. No seed-script changes required.

**All reset operations must respect FK constraints and use soft-delete semantics consistent with system tables.** A hard `DELETE FROM agents` violates `agent_runs.agent_id` FK on any DB that has been used. Soft-delete leaves the rows in place; the seed already filters lookups by `isNull(deletedAt)` so soft-deleted rows are correctly treated as not-existing during re-seed.

> **Prerequisite:** Run the partial-unique-index migration from §4.11.6 first (or `npm run migrate` if it's already in the migration set). Without it, the soft-deleted rows still occupy the slug under the existing full-unique index, and the subsequent re-seed `INSERT` will fail with a unique-constraint violation.

```bash
# 1. Make all the file-on-disk changes (§4.1 – §4.9)

# 2. Run the schema migration (partial-unique indexes + skill_idempotency_keys):
npm run migrate

# 3. From a psql session, soft-delete the system-agent surface in the dev DB:
psql $DATABASE_URL <<'SQL'
BEGIN;

-- Deactivate subaccount-level activations linked to system-managed agents
-- (subaccount_agents uses an is_active boolean, not deleted_at)
UPDATE subaccount_agents
   SET is_active = false, updated_at = NOW()
 WHERE agent_id IN (
   SELECT id FROM agents WHERE is_system_managed = true
 );

-- Soft-delete org-level rows linked to system_agents
UPDATE agents
   SET deleted_at = NOW(), updated_at = NOW()
 WHERE is_system_managed = true AND deleted_at IS NULL;

-- Soft-delete the authoritative system_agents rows (incl. Playbook Author)
UPDATE system_agents
   SET deleted_at = NOW(), status = 'inactive', updated_at = NOW()
 WHERE deleted_at IS NULL;

COMMIT;
SQL

# 4. Re-seed
npm run seed
```

The seed will recreate all 22 v7.1 agents + Playbook Author = 23 fresh rows in `system_agents` (the soft-deleted rows are ignored by the `isNull(deletedAt)` filters in `phase2_systemAgents` and `phase3_playbookAuthor`), set `parentSystemAgentId` correctly across all three tiers, and reactivate them in the Synthetos Workspace subaccount via Phase 5.

Existing `agent_runs` rows continue to satisfy the FK because the `agents` rows they reference are still present (just soft-deleted). User passwords are preserved by the seed (`upsertUser` deliberately omits `passwordHash` on update). Integration-connection placeholders use `onConflictDoNothing` and won't be re-overwritten.

> **Why not `DELETE`?** `agent_runs.agent_id` references `agents.id` with no cascade. A hard delete on a populated dev DB raises a foreign-key violation and rolls the whole transaction back — Path A then silently fails. Soft-delete is the only correct choice.

### Path B — full DB reset

Heavier hammer. Use only if there are other schema drifts you want to clear.

```bash
# Drop everything, re-migrate, re-seed
dropdb $DB_NAME && createdb $DB_NAME
npm run migrate
npm run seed
```

You lose any local UI-created data (custom agents, custom prompts, etc.). Acceptable in pre-production but unnecessary if Path A is sufficient.

### Path C (defer) — add orphan cleanup to seed

Implement §4.10 items 1 + 2. After that, `npm run seed` alone is sufficient — no manual SQL. Recommended for the next session, but not a blocker now.

### Rollback

Even pre-prod, keep an exit:

```bash
# 1. Revert the branch
git checkout main
git branch -D claude/audit-system-agents-46kTN  # or your branch

# 2. Re-run Path A (the wipe is the same SQL — re-seed from main brings back v6 state)
psql $DATABASE_URL < <(/* same wipe SQL as Path A */)
npm run seed
```

The seed is idempotent against any prior agent state, so reverting the file changes and re-seeding is a clean rollback. Custom (non-system-managed) agents in the dev org are protected by the existing `existingCustomAgents` guard in `activateBaselineSystemAgents`.

### Logging expectations for new skills

Every new skill handler must emit structured logs at the standard tag points (the existing logging infra treats tagged logs as metrics):

| Event | Tag | Required fields |
|-------|-----|-----------------|
| Skill invoked | `skill.invoke` | `slug`, `agent_slug`, `subaccount_id`, `idempotency_key` (where applicable) |
| External call started | `skill.external.start` | `slug`, `provider` (e.g. `google_places`, `hunter`, `stripe`), `endpoint` |
| External call succeeded | `skill.external.success` | `slug`, `provider`, `latency_ms`, `result_count` (where applicable) |
| Fail-soft on a read (transient error or no data) | `skill.warn` | `slug`, `reason`, `provider`, `retryable: bool` — **WARN level**, not ERROR |
| Expected blocked write (config missing, validation failed) | `skill.blocked` | `slug`, `reason`, `provider`, `requires` (what the operator must configure) — **INFO level**, never paged |
| Hard failure (write skill that should have blocked but didn't, or any contract violation) | `skill.error` | `slug`, `reason`, full context — **ERROR level**, paged |
| Idempotency hit (replay returned cached result) | `skill.idempotency.hit` | `slug`, `key_hash` |

Fail-soft on a **read** skill emits `skill.warn`. An *expected* blocked write (the §4.11.3 must-block path — config missing, no auth, validation rejected) emits `skill.blocked` at INFO level. Only contract violations and unexpected failures emit `skill.error`. The split prevents the alerting layer from paging on every "Stripe API key not configured" event during local dev.

## 7. Acceptance criteria

The migration is complete when:

1. `companies/automation-os/agents/` contains exactly 22 folders (no `client-reporting-agent`, plus the 7 new ones).
2. Every `AGENTS.md` `reportsTo` matches v7.1 §6.
3. `server/skills/` contains the 14 new skill files; `update_financial_record.md` is deleted.
4. `scripts/lib/skillClassification.ts` lists `list_my_subordinates` in `APP_FOUNDATIONAL_SKILLS`.
5. `server/config/actionRegistry.ts` and `server/services/skillExecutor.ts` register all new skills.
6. `server/lib/env.ts` and `.env.example` include `GOOGLE_PLACES_API_KEY` and `HUNTER_API_KEY`.
7. `npm run seed` succeeds with the pre-flight visibility check passing.
8. After Path A reset + reseed, `select count(*) from system_agents where deleted_at is null` returns **23** (22 company agents + Playbook Author).
9. `select count(*) from system_agents where parent_system_agent_id is null and slug != 'workflow-author'` returns **2** (Orchestrator and Portfolio Health).
10. `select slug from system_agents where parent_system_agent_id = (select id from system_agents where slug = 'orchestrator')` returns exactly the **6** direct reports: `head-of-product-engineering`, `head-of-growth`, `head-of-client-services`, `head-of-commercial`, `admin-ops-agent`, `strategic-intelligence-agent`.
11. The Synthetos Workspace subaccount has `subaccount_agents` rows for all 21 subaccount-scoped agents (everything except `portfolio-health-agent` which goes to the org subaccount).
12. **Agent ↔ skill contract** (§4.11.1) — `scripts/verify-agent-skill-contracts.ts` exits 0; every skill in every `AGENTS.md` resolves to a `.md` file, an `actionRegistry` entry, and a `SKILL_HANDLERS` handler.
13. **Hierarchy invariants** (§4.11.2) — post-seed assertion passes: exactly one root, no cycles, depth ≤ 3, all parents non-deleted.
14. **Side-effect classification** (§4.11.3) — every new write skill has `sideEffectClass: 'write'` in its registry entry; the `executeWithActionAudit` wrapper enforces fail-soft vs must-block by class.
15. **Idempotency wiring** (§4.11.4) — every new write skill declares an `idempotency.keyShape` in its registry entry; replay tests confirm second invocation returns cached result.
16. **Manager guard** (§4.11.5) — runtime guard in `executeWithActionAudit` rejects worker-only skills when called by an agent with `role: manager`. Test: invoke `draft_post` from `head-of-growth` → returns `{ status: 'blocked', reason: 'manager_role_violation' }`.
17. **Manifest JSON** (§4.9) is at `version: "7.1.0"` with all 22 agents listed and `reportsTo` matching frontmatter.
18. **Foundational-skill assertion** (§4.4) — every skill in `APP_FOUNDATIONAL_SKILLS` declares no external integration in its registry entry.
19. **No orphan skills** — every skill `.md` file in `server/skills/` is referenced by at least one agent's `AGENTS.md` `skills:` list, **OR** is explicitly tagged `reusable: true` in its own frontmatter (Reporting Agent skills like `fetch_paywalled_content`, `analyse_42macro_transcript`; Playbook Studio skills like `playbook_validate`). Verified by `scripts/verify-agent-skill-contracts.ts` (extending the §4.11.1 check). Stale skills rot the registry and confuse delegation routing — every file must justify its existence.
20. **No orphan agents** — every active `system_agents` row except `orchestrator`, `portfolio-health-agent`, and `workflow-author` has a non-null `parent_system_agent_id` referencing another active row. Verified by the §4.11.2 hierarchy assertion as part of the post-seed check.
21. **Active-row uniqueness** (§4.11.6) — `system_agents` and `agents` carry partial unique indexes on slug `WHERE deleted_at IS NULL`; `\d+ system_agents` in psql shows `system_agents_slug_active_idx` and `agents_org_slug_active_uniq` as `WHERE (deleted_at IS NULL)` partial uniques.

## 8. Out of scope for this brief

- Deeper hierarchy enforcement plumbing from v7.1 Appendix E — `parentAgentId` on `SkillExecutionContext`, scope param on `config_list_agents`, parent-scoping in `spawn_sub_agents`/`reassign_task`. Required for child-only delegation routing; tracked separately. **Not** to be confused with the manager-role guard in §4.11.5, which IS in scope and lands in this migration.
- Content/SEO + Social Media merge investigation (v7.1 Appendix F) — explicitly deferred.
- The actual master prompts for the 4 manager agents and 3 new workers — write per the agent definitions in v7.1 §10–§14, §21, §29. Each prompt must encode the manager pattern (vet → decompose → pick subordinate → delegate → aggregate → report) for the heads, and the standard worker pattern for the others.
- Admin-Ops Stripe/Xero integration — handlers can stub at first. Real integration is its own piece of work.

## 9. Cross-references

- v7.1 spec: System Agents Master Brief v7.1 (provided in this session)
- Predecessor: `docs/automation-os-system-agents-brief-v6.md`
- Lead-discovery brief: incorporated into §4 / §5 above
- Seed pipeline: `scripts/seed.ts`
- Skill classification: `scripts/lib/skillClassification.ts`
- Hierarchy plumbing (deferred): `docs/hierarchical-delegation-dev-brief.md`
