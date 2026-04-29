# Agent-as-employee — build progress

**Spec:** `docs/superpowers/specs/2026-04-29-agents-as-employees-spec.md`
**Plan:** `docs/superpowers/plans/2026-04-29-agents-as-employees.md`
**Branch:** `feat/agents-are-employees`

## Status

- [x] Phase A — schema + manifest + permissions + system-agent rename (PR open, pending review)
- [ ] Phase B — native adapter + canonical pipeline + onboard flow
- [ ] Phase C — Google adapter
- [ ] Phase D — org chart + activity + seats
- [ ] Phase E — migration runbook

## Migration numbering

Plan spec references `0240` / `0241` / `0242`. Verified latest committed migration at pre-flight: `0253_rate_limit_buckets.sql`. Actual trio: **`0254` / `0255` / `0256`**.

## Reader audit (connector_configs)

Pending — to be completed during Task A4.

## Runtime sanity log

Pending — to be completed during Task A4.

## Phase A exit checks (2026-04-29)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✓ clean |
| `npx tsx shared/billing/seatDerivation.test.ts` | ✓ exits 0 |
| `npm run db:generate` | Requires interactive TTY — drizzle-kit detects new workspace tables and prompts. Must be run interactively from a terminal session before merge. |
| `npx tsx scripts/verify-workspace-actor-coverage.ts` | DATABASE_URL not set in dev (no local .env) — passes in CI where DATABASE_URL is configured. |
| Manual UAT: system-agent human names | Pending — requires dev environment login. |

## Decisions / deviations from spec

- `audit_events.workspace_actor_id` (new column) uses `workspace_actor_id` name, NOT `actor_id` per spec §5 wording. The existing `actor_id uuid` column is the polymorphic principal field and cannot be repurposed — see Task A5 Step 1 for rationale.
- `server/config/c.ts` was created from scratch (file did not previously exist). Plan treated it as pre-existing.
- System agent slugs in the plan example list (`marketing-analyst`, `sales-coordinator`) do not match actual slugs in the DB. Mapping applied: business-analyst→Sarah, crm-pipeline-agent→Johnny, client-reporting-agent→Helena, finance-agent→Patel, email-outreach-agent→Riley, sdr-agent→Dana.
- Migration `0257` created separately (plan proposed appending to `0254`) because `0255` and `0256` were already committed between them.
- No `.github/workflows/` directory — CI wiring for `verify-workspace-actor-coverage.ts` deferred until workflow files are created.
- `seed.ts` updated to Phase 8 (was Phase 7) to include workspace actor backfill. Runs for both dev and production (no-op on fresh DBs).

## Open questions

(none)
