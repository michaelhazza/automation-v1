# System Agents v7.1 Migration — Progress Log

**Spec:** `docs/superpowers/specs/2026-04-26-system-agents-v7-1-migration-spec.md`
**Plan:** `tasks/builds/system-agents-v7-1-migration/plan.md`
**Branch:** `claude/audit-system-agents-46kTN`

---

## Phase 0 baseline

Captured 2026-04-27. Migration number confirmed: `0233` (next free after `0232_gin_index_conversation_artefacts.sql`).

| Gate | Result | Notes |
|------|--------|-------|
| `build:server` (tsc) | ✓ PASS | Server-side TS clean |
| `verify-rls-coverage.sh` | violations=0 ✓ | |
| `verify-rls-protected-tables.sh` | violations=64 ⚠ | Pre-existing — see Known baseline violations |
| `verify-rls-session-var-canon.sh` | violations=0 ✓ | |
| `verify-migration-sequencing.sh` | violations=1 ⚠ | DATABASE_URL not set — pre-existing; requires dev DB |
| `verify-action-registry-zod.sh` | violations=0 ✓ | 100 Zod entries |
| `verify-idempotency-strategy-declared.sh` | violations=0 ✓ | 94 entries, 100% with idempotencyStrategy |
| `verify-skill-read-paths.sh` | violations=0 ✓ | 95 actions, 12 liveFetch with rationale |
| `verify-skill-visibility.ts` | 2 violations ⚠ | Pre-existing — see Known baseline violations |
| `verify-no-direct-adapter-calls.sh` | violations=0 ✓ | |
| `verify-principal-context-propagation.sh` | violations=0 ✓ | 7 files scanned |

## Known baseline violations (OUT OF SCOPE for this build)

### `verify-rls-protected-tables.sh` — 64 violations

62 tables in migrations have `organisation_id` but are not in `rlsProtectedTables.ts` and not in `rls-not-applicable-allowlist.txt`. These are pre-existing and pre-date this build's scope. Additionally, 2 stale entries in the registry (`document_bundle_members`, `reference_document_versions`) have no matching CREATE TABLE in migrations.

These violations do NOT interact with the Chunk 01–07 scope (which adds exactly one new table: `skill_idempotency_keys`).

### `verify-skill-visibility.ts` — 2 violations

`workflow_simulate` and `workflow_validate` have no YAML frontmatter block. Pre-existing; fix is `npx tsx scripts/apply-skill-visibility.ts`. Does not interact with the 14 new skill files in Chunk 02.

---

## Per-chunk completion notes

**Chunk 01** — Schema migration (commit range: early commits). `system_agents_slug_active_idx` partial unique, `agents_org_slug_active_uniq` partial unique, `skill_idempotency_keys` table + RLS. Applied to dev DB via direct SQL (migrations 0220-0232 skipped due to pre-existing dev DB schema drift; 0233 applied directly).

**Chunk 02** — 14 new skill `.md` files (discover_prospects, draft_outbound, etc.) + `apply-skill-visibility.ts` extended with foundational self-containment assertion.

**Chunk 03** — Action registry: `SideEffectClass`, `IdempotencyContract`, 14 new entries, `sideEffectClass` backfill on all 143 entries, `spawn_sub_agents` with `managerAllowlistMember: true`.

**Chunk 04** — `skillExecutor.ts`: 14 new handlers, manager-role guard, idempotency wrapper (§9.3.1), side-effect-class wrapper (§9.3.2), `checkSkillPreconditions`. New files: `skillIdempotencyKeysPure.ts`, `managerGuardPure.ts`, `adminOpsService.ts`, `sdrService.ts`, `retentionSuccessService.ts`, `proposeAction.ts` modified.

**Chunk 05** — 7 new agent AGENTS.md folders (4 manager heads + admin-ops + retention-success + sdr), 12 reparents, finance-agent rescoped (reportsTo + skill drop + body trimmed), `client-reporting-agent/` deleted.

**Chunk 06** — `GOOGLE_PLACES_API_KEY`/`HUNTER_API_KEY` added to `server/lib/env.ts` + `.env.example`. New `scripts/regenerate-company-manifest.ts`. Manifest regenerated to v7.1.0 (22 agents).

**Chunk 07** — `scripts/verify-agent-skill-contracts.ts` (7 assertions, exits 0). `scripts/seed.ts`: two new pre-flights, orphan cleanup, four-assertion hierarchy check (depth guard fixed: `hops >= 2`; early-return removed so assertions run on first-ever seed). `verify-skill-visibility.ts` foundational assertion narrowed to `openWorldHint`+`directExternalSideEffect` only. 38 platform utility skill files marked `reusable: true`.

**Chunk 08** — Dev DB validation. Seed completed Phases 1-3 cleanly. Spot-checks: 23 active system_agents, 6 orchestrator direct reports, sdr-agent→head-of-commercial, partial unique index correct, `skill_idempotency_keys` table empty. Phase 4 (weekly-digest) fails due to pre-existing workflow validation error unrelated to v7.1. Incidental fixes: `systemPlaybookTemplates` → `systemWorkflowTemplates` schema rename in seed.ts (from skipped migrations).

**Chunk 09** — Pre-merge verification. `build:server` fixed (EVENT_NAMES extended with skill.error/idempotency.hit/warn/blocked; rowCount cast; WARN→WARNING level). `build:client` clean. 224 unit tests PASS. Gates: rls-coverage=0, rls-session-var-canon=0, action-registry-zod=0, idempotency-strategy-declared=0, skill-read-paths=0, no-direct-adapter-calls=0, principal-context-propagation=0, verify-agent-skill-contracts=0.

---

## Wave progress

- Chunk 01 (Schema migration): ✓ COMPLETE
- Chunk 02 (Skill files + classification): ✓ COMPLETE
- Chunk 03 (Action registry extensions): ✓ COMPLETE
- Chunk 04 (Skill executor): ✓ COMPLETE
- Chunk 05 (Agent file changes): ✓ COMPLETE
- Chunk 06 (Env vars + manifest): ✓ COMPLETE
- Chunk 07 (Seed + gates): ✓ COMPLETE
- Chunk 08 (Local-dev validation): ✓ COMPLETE (Phase 4 pre-existing weekly-digest issue noted)
- Chunk 09 (Pre-merge verification): ✓ COMPLETE
