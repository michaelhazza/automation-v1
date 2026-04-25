# Dev Brief — Lead Discovery via the SDR Agent

**Date:** 2026-04-25
**Author:** Synthetos Agency Launch audit (handoff)
**Owner session:** agent-build (System Agents Master Brief v7.1)
**Origin:** Workstream E of the Operator-as-Agency dev brief; rescoped per §11 of `tasks/audit-synthetos-agency-launch-2026-04-25.md`.
**Status:** Draft for the agent-build session to fold into Phase 5 of the SDR Agent rollout.

---

## 1. Purpose

The Synthetos Agency business plan needs automated lead discovery: find SMB prospects matching ICP criteria, enrich them, score them, and queue personalised outreach. The original dev brief (Workstream E) proposed a standalone `lead_discover` + `lead_score` skill set with its own pg-boss job, system agent seed, and "Sales Pipeline" subaccount pattern.

Under the v7.1 system agent structure, all of this is the **SDR/Lead-Qualification Agent's** job (`sdr-agent`, T3, under Head of Commercial, Phase 5). The SDR agent already has most of the wired skills; this brief lists the small delta needed to fully cover the lead-discovery use case.

This brief is self-contained — the agent-build session does not need to read the agency-launch audit to act on it.

---

## 2. Scope

In scope for this brief:

1. **New skill: `discover_prospects`** — Google Places API caller that finds SMBs matching geo + vertical + size criteria.
2. **Skill enhancement: `enrich_contact`** — add Hunter.io as a provider option for email + role enrichment.
3. **Environment variables** — `GOOGLE_PLACES_API_KEY`, `HUNTER_API_KEY` registered in `server/lib/env.ts` + `.env.example`.
4. **Action registry + handler registration** — wire both skills.
5. **SDR agent skill list update** — add `discover_prospects` to the SDR agent's wired skills in its `AGENTS.md`.

Explicitly deferred / out of scope:

- Standalone `lead-discover` pg-boss job — not needed; the SDR agent runs on-demand under the Head of Commercial.
- Standalone `lead-discover` system agent seed — not needed; the SDR agent IS the runner.
- "Sales Pipeline" subaccount pattern — not needed; the agent writes to canonical contacts of whichever subaccount it runs under.
- A separate `lead_score` skill — the SDR agent already has `score_lead`. If the GBP-completeness + GEO-gap signals need a dedicated scorer, fold them into `score_lead` rather than adding a new skill.

---

## 3. Dependencies

This work depends on **Workstream B** of the agency audit — specifically the `canonical_prospect_profiles` extension table (lead_score, outreach_stage, conversion_status) — being shipped before the SDR agent goes live in Phase 5. The SDR agent writes prospects to `canonical_contacts` and prospect lifecycle rows to `canonical_prospect_profiles`. If B is not yet shipped at the time the SDR agent is built, the agent-build session can stub the prospect-profile write at the skill-handler layer and leave a TODO; do NOT block the agent rollout on it.

---

## 4. New skill — `discover_prospects`

**File:** `server/skills/discover_prospects.md`

**Frontmatter (proposed):**

```yaml
---
slug: discover_prospects
visibility: basic
gate: auto
category: api
read_path: liveFetch
---
```

**Capability:** Finds candidate SMB prospects via the Google Places Nearby Search API. Inputs: search location (lat/lng or geo string), radius, target type (Google Places type — e.g. `lawyer`, `dentist`, `plumber`), optional keyword. Outputs: a structured list of candidate businesses with name, website (if present), phone, address, place_id, rating, review_count.

**Implementation notes:**

- Caller: the SDR agent invokes during a prospecting run.
- API: Google Places Nearby Search → `https://places.googleapis.com/v1/places:searchNearby`.
- Free $200 credit covers ~6,000 calls/month at current pricing — sufficient for the agency at launch.
- 30-day cache on `place_id`. Do NOT persist `photos[]` per Google ToS.
- Fail soft on `OVER_QUERY_LIMIT` / `REQUEST_DENIED` — return empty list with structured warning, not a hard error.
- Auto-gated. No HITL on discovery itself; HITL fires later on `update_crm` or `send_email` outbound steps.

**Outputs written to:** prospect candidates emitted into the agent run's deliverable set; no canonical writes from this skill alone (the SDR agent batches discovery → score → enrich → CRM-write through subsequent steps).

---

## 5. Skill enhancement — `enrich_contact`

**File:** `server/skills/enrich_contact.md` (existing — enhance, don't replace)

The skill already exists and is wired to the SDR agent and Email Outreach agent. It needs a **Hunter.io provider option** added.

**Provider selector:** add a `provider` parameter to the skill input. Default behaviour stays unchanged; when `provider: 'hunter'` is passed, route to Hunter.io domain search + email finder.

**Hunter API endpoints used:**
- `GET https://api.hunter.io/v2/domain-search?domain=...&limit=10` — returns email patterns and verified emails for the domain.
- `GET https://api.hunter.io/v2/email-finder?domain=...&first_name=...&last_name=...` — finds a specific person's email.

**Quotas:** free tier = 25 searches/month. Starter plan = $49/month for 1,000 searches. Fail gracefully on `402` / `429`; return structured warning, do not throw.

**Caching:** in-memory LRU keyed on `domain` (24h TTL) is sufficient for v1. Persistent caching optional — defer.

---

## 6. Environment variables

Add to `server/lib/env.ts` (zod schema):

```ts
GOOGLE_PLACES_API_KEY: z.string().optional(),
HUNTER_API_KEY: z.string().optional(),
```

Both optional — when absent, the corresponding skill returns a clear "not configured" error instead of throwing. The SDR agent must handle this by routing the prospect-discovery task to `request_approval` with the configuration gap surfaced to the operator.

Add to `.env.example`:

```
# Lead discovery (Workstream E — SDR Agent)
GOOGLE_PLACES_API_KEY=
HUNTER_API_KEY=
```

Both are platform-level keys (env vars), not per-org credentials — the agency operates one Google Places billing account and one Hunter account across all clients.

---

## 7. Action registry + handler registration

**`server/config/actionRegistry.ts`** — add `discover_prospects` entry:

```ts
{
  slug: 'discover_prospects',
  description: 'Find candidate SMB prospects via Google Places Nearby Search.',
  topics: ['lead_gen'],
  defaultGateLevel: 'auto',
  actionCategory: 'api',
  readPath: 'liveFetch',
  // ... payload schema with location, radius, type, keyword
}
```

**`server/services/skillExecutor.ts`** — register handler in `SKILL_HANDLERS`:

```ts
discover_prospects: executeWithActionAudit(executeDiscoverProspects),
```

The handler implementation lives in `server/skills/handlers/discoverProspects.ts` (or wherever the existing handler convention places it).

For `enrich_contact`, the existing handler gets a provider-switch added; no new registry entry needed.

---

## 8. SDR agent wiring

**File:** `companies/automation-os/agents/sdr-agent/AGENTS.md`

Add `discover_prospects` to the wired skills list, gate `auto`. Updated skill table:

| Skill | Gate | Purpose |
|---|---|---|
| `discover_prospects` | auto | Find candidate SMB prospects via Google Places — NEW |
| `web_search` | auto | Existing |
| `enrich_contact` | auto | Existing — now supports Hunter provider |
| `draft_outbound` | auto | Existing |
| `score_lead` | auto | Existing |
| `send_email` | auto | Existing |
| `update_crm` | review | Existing |
| `book_meeting` | review | Existing |
| `request_approval` | review | Existing |

(Plus the universal task/workspace bundle.)

Update Appendix A — Skill to Agent Cross-Reference of the Master Agent Brief: register `discover_prospects` under "SDR/Lead-Qualification specific skills" alongside the existing entries for `draft_outbound`, `score_lead`, `book_meeting`.

---

## 9. Acceptance criteria

The work is complete when:

1. `server/skills/discover_prospects.md` exists with frontmatter + capability description.
2. `discover_prospects` is in `actionRegistry.ts` and has a handler in `skillExecutor.ts`.
3. `enrich_contact` accepts `provider: 'hunter'` and routes to Hunter.io.
4. Both env vars are in `env.ts` + `.env.example`.
5. SDR agent's `AGENTS.md` lists `discover_prospects` in its wired skills.
6. `npm run skills:verify-visibility` passes (both new/modified skills classified in `scripts/lib/skillClassification.ts`).
7. `npm run seed` succeeds with the SDR agent picking up the new skill.
8. Smoke test: with valid env vars, an SDR agent run can call `discover_prospects` against a known location, get candidate businesses back, and pass at least one to `enrich_contact` with `provider: 'hunter'` for email enrichment.

---

## 10. Why this isn't urgent

The agency business plan tolerates manual prospecting for the first 2–3 months (~50 LinkedIn DMs/week + 50–75 cold emails/week — the operator can sustain this by hand). Lead discovery automation is a path-to-scale lever, not a launch lever. Building this in Phase 5 of the agent rollout (after MVP / Phase 2 / Phase 3 / Phase 4) is on the right schedule.

If the agent-build session is still working through MVP-to-Phase-4 work when this brief lands, it can stay deferred. The agency launch is not blocked.

---

## 11. Cross-references

- `tasks/audit-synthetos-agency-launch-2026-04-25.md` §11 (origin of the rescoping)
- System Agents Master Brief v7.1 (Agent 21 — SDR/Lead-Qualification Agent + Appendix A)
- `tasks/audit-synthetos-agency-launch-2026-04-25.md` §2 (canonical_prospect_profiles dependency from Workstream B)
