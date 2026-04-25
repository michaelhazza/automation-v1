# Automation OS — System Agents v7.1 Migration Brief

**Status:** Draft for the agent-build session
**Date:** 2026-04-25
**Source spec:** System Agents Master Brief v7.1
**Predecessor:** `docs/automation-os-system-agents-brief-v6.md`
**Pre-production:** wiping system-agent state is acceptable

---

## 1. Purpose

Audit what Automation OS currently has on disk and in the seed pipeline against the v7.1 system-agents spec, then specify the exact diff needed in the company folder, the skill registry, and `scripts/seed.ts`. Includes a self-contained local-dev reset plan.

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

### 4.1 New agent folders (7)

Create `companies/automation-os/agents/<slug>/AGENTS.md` for each, with frontmatter matching v7.1 §6 roster and skill list matching the per-agent skill table. Manager `tokenBudget` ≈ `9000` (≈30% of standard worker default of 30000).

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

### 4.9 Manifest JSON

`companies/automation-os/automation-os-manifest.json` is index-only (per its own `_comment`, not read by code), but should be regenerated to v7.1 with all 22 agents. Update `version: "7.1.0"`, `agents` array, and the `description` ("16-agent team" → "22-agent team"). Optional but recommended for human readers.

### 4.10 Seed-script changes (optional but recommended)

The seed already handles N-tier hierarchy correctly. Two recommended additions:

1. **Orphan cleanup in Phase 2/3** (idempotent, low blast radius):
   After parsing the company folder, compute the expected slug set and soft-delete any `system_agents` row outside it — but include `workflow-area` in the allowlist since Playbook Author is upserted in Phase 3.
   ```ts
   // Run after Phase 3 so Playbook Author is in scope
   const expected = new Set([...parsed.agents.map(a => a.slug), 'workflow-area']);
   await db.update(systemAgents)
     .set({ deletedAt: new Date(), status: 'inactive' })
     .where(and(
       isNull(systemAgents.deletedAt),
       not(inArray(systemAgents.slug, [...expected])),
     ));
   ```
2. **Cascade soft-delete to `agents` and `subaccount_agents`** for any system_agent slug that just got cleared — otherwise dev orgs keep stale `agents` rows referencing the now-deleted system_agent. Soft-deleting `agents` where `systemAgentId` matches the orphan and setting `subaccount_agents.isActive = false` for those is sufficient.

Both changes are optional given §6's recommended local-dev reset path; without them, manual cleanup is required for `client-reporting-agent`.

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

### Path A (recommended) — wipe system-agent state, re-seed

Fastest, cleanest, no seed-script changes required.

```bash
# 1. Make all the file-on-disk changes (§4.1 – §4.9)

# 2. From a psql session, wipe the system-agent surface in the dev DB:
psql $DATABASE_URL <<'SQL'
BEGIN;
-- Subaccount-level activations of system-managed agents
DELETE FROM subaccount_agents WHERE agent_id IN (
  SELECT id FROM agents WHERE is_system_managed = true
);
-- Org-level rows linked to system_agents
DELETE FROM agents WHERE is_system_managed = true;
-- The authoritative system_agents rows themselves (incl. Playbook Author)
DELETE FROM system_agents;
COMMIT;
SQL

# 3. Re-seed
npm run seed
```

The seed will recreate all 22 v7.1 agents + Playbook Author = 23 rows in `system_agents`, set `parentSystemAgentId` correctly across all three tiers, and reactivate them in the Synthetos Workspace subaccount via Phase 5.

User passwords are preserved by the seed (`upsertUser` deliberately omits `passwordHash` on update). Integration-connection placeholders use `onConflictDoNothing` and won't be re-overwritten.

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
9. `select count(*) from system_agents where parent_system_agent_id is null and slug != 'workflow-area'` returns **2** (Orchestrator and Portfolio Health).
10. `select slug from system_agents where parent_system_agent_id = (select id from system_agents where slug = 'orchestrator')` returns exactly the **6** direct reports: `head-of-product-engineering`, `head-of-growth`, `head-of-client-services`, `head-of-commercial`, `admin-ops-agent`, `strategic-intelligence-agent`.
11. The Synthetos Workspace subaccount has `subaccount_agents` rows for all 21 subaccount-scoped agents (everything except `portfolio-health-agent` which goes to the org subaccount).

## 8. Out of scope for this brief

- Hierarchy enforcement plumbing (Appendix E of v7.1) — `parentAgentId` on `SkillExecutionContext`, scope param on `config_list_agents`, parent-scoping in `spawn_sub_agents`/`reassign_task`. Required for runtime delegation enforcement; tracked separately.
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
