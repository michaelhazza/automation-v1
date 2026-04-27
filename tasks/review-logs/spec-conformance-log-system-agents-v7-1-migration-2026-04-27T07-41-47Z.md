# Spec Conformance Log

**Spec:** `docs/superpowers/specs/2026-04-26-system-agents-v7-1-migration-spec.md`
**Spec commit at check:** `7b481fa0` (latest spec edit on this branch)
**Branch:** `claude/audit-system-agents-46kTN`
**Base (merge-base with main):** `a596688ff5aa5669ee3a60290eb7bdf446a2024a`
**v7.1 work branched at:** `7654e3bf` (chunk-01 first commit)
**Scope:** All 9 chunks (Phases 1–9) — caller confirmed all-of-spec coverage; progress.md marks every chunk COMPLETE
**Changed-code set:** 106 v7.1-specific files (filtered from 818 total branch diff)
**Run at:** 2026-04-27T07:41:47Z

---

## Contents

1. Summary
2. Requirements extracted (full checklist)
3. Mechanical fixes applied
4. Directional / ambiguous gaps (routed to tasks/todo.md)
5. Files modified by this run
6. Next step

---

## 1. Summary

- Requirements extracted:     ~87
- PASS:                       ~75
- MECHANICAL_GAP → fixed:     2 (REQ-58 cleanup-job logging tags; REQ-87 production-mode test case)
- DIRECTIONAL_GAP → deferred: 9
- AMBIGUOUS → deferred:       1 (REQ-45 — universal-bundle managerAllowlistMember mismatch driven by pre-existing registry carveout)
- OUT_OF_SCOPE → skipped:     0

> Counts approximate because some spec items expand to multiple sub-requirements (e.g. "14 new ACTION_REGISTRY entries" = 14 sub-requirements all PASS, counted here as one cluster).

**Verdict:** CONFORMANT_AFTER_FIXES (2 mechanical gaps closed in-session; 10 directional/ambiguous gaps require human decisions before merge).

---

## 2. Requirements extracted (full checklist)

### Phase 1 — Schema migration (§6) — ALL PASS

| REQ | Section | Requirement | Verdict |
|-----|---------|-------------|---------|
| 1 | §6.1 | `migrations/0233_system_agents_v7_1.sql` — partial uniques + skill_idempotency_keys + canonical RLS policy | PASS |
| 2 | §6.4 | `migrations/_down/0233_system_agents_v7_1.sql` — no-op stub with rationale | PASS |
| 3 | §6.2 | `server/db/schema/skillIdempotencyKeys.ts` — Drizzle schema with composite PK, indexes, status `$type<...>()` | PASS |
| 4 | §6.2 | `server/db/schema/systemAgents.ts` — `slugActiveIdx` partial unique on `slug WHERE deleted_at IS NULL` | PASS |
| 5 | §6.2 | `server/db/schema/agents.ts` — `agents_org_slug_active_uniq` partial unique | PASS |
| 6 | §4.2 | `server/db/schema/index.ts` — re-export `skillIdempotencyKeys` | PASS |
| 7 | §6.3 | `server/config/rlsProtectedTables.ts` — manifest entry pointing at migration `0233_system_agents_v7_1.sql` | PASS |

### Phase 2 — Skill files + classification + visibility (§7) — ALL PASS

| REQ | Section | Requirement | Verdict |
|-----|---------|-------------|---------|
| 8–21 | §7.1 | 14 new skill `.md` files under `server/skills/` with frontmatter (`name`, `description`, `isActive`, `visibility`) | ALL 14 PASS |
| 22 | §7.6 | `server/skills/update_financial_record.md` deleted | PASS |
| 23 | §7.2 | `list_my_subordinates` added to `APP_FOUNDATIONAL_SKILLS` in `scripts/lib/skillClassification.ts` | PASS |
| 24 | §7.5.2 | `server/services/leadDiscovery/googlePlacesProvider.ts` — Places stub, fail-soft on missing env | PASS |
| 25 | §7.5.3 | `server/services/leadDiscovery/hunterProvider.ts` — Hunter stub, fail-soft on missing env / 402 / 429 | PASS |
| 26 | §7.4 | `scripts/verify-skill-visibility.ts` extended with foundational-self-containment assertion | PASS |

### Phase 3 — Action registry (§8) — MOSTLY PASS

| REQ | Section | Requirement | Verdict |
|-----|---------|-------------|---------|
| 27 | §8.1 | `SideEffectClass` type + `IdempotencyContract` interface added | PASS |
| 28 | §8.1 | `ActionDefinition` extended with `sideEffectClass`, `idempotency`, `directExternalSideEffect`, `managerAllowlistMember` | PASS |
| 29–42 | §8.2 | 14 new `ACTION_REGISTRY` entries with correct field values verbatim per §8.2 table | ALL 14 PASS |
| 43 | §7.5.1 | `enrich_contact` `provider` parameter — spec wants `['default', 'hunter']`; impl has `['hunter', 'apollo', 'clearbit']` | DIRECTIONAL_GAP |
| 44 | §7.5.1 + §8.3 | `enrich_contact` handler routes to Hunter on `provider: 'hunter'` | DIRECTIONAL_GAP (handler is a stub that ignores `input.provider`) |
| 45 | §8.3 | `managerAllowlistMember: true` on universal-bundle skills — `write_workspace`, `update_task` missing because they have no `ACTION_REGISTRY` entry (pre-existing carveout) | AMBIGUOUS / DIRECTIONAL_GAP |
| 46 | §8.3 | `sideEffectClass` backfill across ~50 existing entries (compiler-enforced via non-optional field) | PASS |
| 47 | §8.3 | `update_financial_record` registry entry removed | PASS |

### Phase 4 — Skill executor (§9) — MOSTLY PASS

| REQ | Section | Requirement | Verdict |
|-----|---------|-------------|---------|
| 48 | §4.11c, §8.1.1, §16A.1 | `skillIdempotencyKeysPure.ts` — `canonicaliseForHash`, `hashKeyShape`, `ttlClassToExpiresAt`, `TTL_DURATIONS_MS`, `IDEMPOTENCY_CLAIM_TIMEOUT_MS`, `assertHandlerInvokedWithClaim` | PASS |
| 49 | §16A.1 | `SideEffectBeforeClaimError` named class | DIRECTIONAL_GAP (impl throws generic `Error`; behaviour preserved) |
| 50 | §4.11c, §16A.1 | `skillIdempotencyKeysPure.test.ts` — covers hashKeyShape, ttlClassToExpiresAt, canonicaliseForHash, assertHandlerInvokedWithClaim | PASS (after mechanical fix REQ-87) |
| 51 | §4.11c | `managerGuardPure.ts` — `isManagerAllowlisted(def, agentRole, perManagerDeclaredSlugs, toolSlug)` | PASS |
| 52 | §4.11c | `managerGuardPure.test.ts` — 5 deny paths covered | PASS |
| 53 | §4.11a | `adminOpsService.ts` — 7 admin-ops handlers (stub semantics) | PASS |
| 54 | §4.11a | `sdrService.ts` — 4 SDR handlers (stub semantics) | PASS |
| 55 | §4.11a | `retentionSuccessService.ts` — 2 retention-success handlers (stub semantics) | PASS |
| 56 | §4.11a, §9.2 | `executeListMySubordinates` in `configSkillHandlersPure.ts` reusing `computeDescendantIds` | DIRECTIONAL_GAP (handler in `skillExecutor.ts`, uses `resolveSubordinates` not `computeDescendantIds`) |
| 57 | §4.11b, §16.3 | `server/jobs/skillIdempotencyKeysCleanupJob.ts` — daily worker | PASS (functional) |
| 58 | §16.3 | Cleanup-job logging tags `skill_idempotency_keys.cleanup.batch` + `.complete` per spec verbatim | MECHANICAL_GAP → **FIXED in this run** |
| 59 | §9.1 | 14 `SKILL_HANDLERS` entries routing through `executeWithActionAudit` with `requireSubaccountContext` where needed | PASS |
| 60 | §9.3.1 | Cross-run idempotency wrapper — INSERT first-writer-wins, status branches, terminal UPDATE with `WHERE status = 'in_flight'`, terminal-race-lost, stale-claim takeover gated on `reclaimEligibility: 'eligible'` | PASS |
| 61 | §9.3.2 | Side-effect-class wrapper — `write` calls `checkSkillPreconditions`; `read` fail-soft logging on `not_configured`/`transient_error` | PASS |
| 62 | §9.3.3 | Logging contract — level mapping verbatim | PASS |
| 63 | §9.6, §16.5 | `assertRlsAwareWrite('skill_idempotency_keys')` before raw-SQL writes (wrapper INSERT + cleanup DELETE) | PASS |
| 64 | §8.1.1 + §9.3.1 | `hashActionArgs` calls `canonicaliseForHash` instead of `JSON.stringify` | PASS |
| 65 | §9.4 | Manager-role guard with three-condition deny composition + reason ordering | PASS |
| 66 | §9.4 | `writeSecurityEvent` on deny with `decision: 'deny'` and matching reason | PASS |
| 67 | §9.5 | `executeFinancialRecordUpdateApproved` removed; `case 'update_financial_record'` removed from worker adapter | PASS |
| 68 | §18.1, AC #33 | `skill.blocked` log emit rate-limiting (≤1/min per (skill, subaccount)) | DIRECTIONAL_GAP (not implemented) |
| 69 | §18.1, §16A.8 step 5 | `in_flight_reclaim_disabled` log rate-limiting | DIRECTIONAL_GAP |

### Phase 5+6 — Agent file changes + retire client-reporting-agent (§10+§11) — ALL PASS

| REQ | Section | Requirement | Verdict |
|-----|---------|-------------|---------|
| 70 | §10.1 | 7 new `companies/automation-os/agents/<slug>/AGENTS.md` folders with role, reportsTo, skills | PASS |
| 71 | §10.2, §10.3 | 13 reparents (12 `reportsTo:` switches + finance-agent skill drop of `update_financial_record`) | PASS |
| 72 | §11.1 | `companies/automation-os/agents/client-reporting-agent/` folder deleted | PASS |
| 73 | §11.2 | `server/skills/draft_report.md` and `deliver_report.md` preserved (not deleted) | PASS |

### Phase 7 — Env vars + manifest regeneration (§12) — ALL PASS

| REQ | Section | Requirement | Verdict |
|-----|---------|-------------|---------|
| 74 | §12.1 | `server/lib/env.ts` adds `GOOGLE_PLACES_API_KEY` + `HUNTER_API_KEY` (`z.string().optional()`) | PASS |
| 75 | §12.1 | `.env.example` mirrors with same heading | PASS |
| 76 | §12.2.1 | `scripts/regenerate-company-manifest.ts` — write + `--check` drift mode, deterministic sort by slug | PASS |
| 77 | §4.13, §12.2 | `companies/automation-os/automation-os-manifest.json` regenerated to `version: "7.1.0"`, 22 agents | PASS |

### Phase 8 — Seed-script orphan cleanup + verification gates + assertions (§13) — ALL PASS

| REQ | Section | Requirement | Verdict |
|-----|---------|-------------|---------|
| 78 | §13.2 | `scripts/verify-agent-skill-contracts.ts` — 7 assertions, exit 0 on success, exit 1 on any miss | PASS (with documented carveout for write_workspace/update_task pre-registry pattern) |
| 79 | §13.1 | `preflightVerifyAgentSkillContracts()` wired into seed pre-flight sequence | PASS |
| 80 | §13.1 | `preflightVerifyManifestDrift()` wired into seed pre-flight sequence | PASS |
| 81 | §13.3 | Phase-3 orphan cleanup — soft-delete system_agents not in expectedSlugs, cascade to agents, deactivate subaccount_agents | PASS |
| 82 | §13.4 | Post-Phase-3 hierarchy assertion — exactly one root, no cycles, depth ≤ 3, all parents non-deleted, every worker parented in `ALLOWED_T1_T2_PARENTS` | PASS (depth guard `hops >= 2` is semantically correct — fires before the 3rd hop reaches T4) |

### Phase 9 — Local-dev validation (§14) — operational only, no committed files

Per progress.md, Path A re-seed completed cleanly through Phase 3; Phase 4 failed on a pre-existing weekly-digest workflow validation issue unrelated to v7.1.

### Documentation updates (§4.16) — ALL DEFERRED

| REQ | Section | Requirement | Verdict |
|-----|---------|-------------|---------|
| 83 | §4.16 | `architecture.md § "Key files per domain"` — add row for `companies/automation-os/agents/<slug>/AGENTS.md` (system-agent definitions) | DIRECTIONAL_GAP (exact wording / placement requires editorial choice) |
| 84 | §4.16 | `architecture.md` — add `skill_idempotency_keys` to RLS-protected enumeration | DIRECTIONAL_GAP (no central RLS-protected list in architecture.md; reference is ambiguous) |
| 85 | §4.16 | `tasks/current-focus.md` — update in-flight pointer | DIRECTIONAL_GAP (active-vs-shipped placement is content choice) |
| 86 | §4.16 | `docs/capabilities.md` — append the 7 new agents in vendor-neutral marketing-ready terms | DIRECTIONAL_GAP (editorial work — vendor-neutral copywriting) |

### Acceptance Criteria specials

| REQ | AC | Requirement | Verdict |
|-----|-----|-------------|---------|
| 87 | AC #37(c) | `assertHandlerInvokedWithClaim(false)` with `NODE_ENV='production'` returns silently (no-op test) | MECHANICAL_GAP → **FIXED in this run** |

---

## 3. Mechanical fixes applied

1. **REQ-58 — Cleanup-job logging tags added.**
   - File: `server/jobs/skillIdempotencyKeysCleanupJob.ts`
   - Lines: 14, 22–23, 41–55
   - Spec quote: "log.info({ tag: 'skill_idempotency_keys.cleanup.batch', batch: batchCount, rows: rowCount }); ... log.info({ tag: 'skill_idempotency_keys.cleanup.complete', total: totalDeleted, batches: batchCount, duration_ms: Date.now() - start });"
   - Change: imported `logger`, added `batchCount` + `start` timestamp, emit `skill_idempotency_keys.cleanup.batch` per batch and `skill_idempotency_keys.cleanup.complete` after the loop. Closes AC #32 (cleanup batching observability).

2. **REQ-87 — Production-mode test for `assertHandlerInvokedWithClaim` added.**
   - File: `server/services/__tests__/skillIdempotencyKeysPure.test.ts`
   - Lines: 210–219
   - Spec quote: "(c) `assertHandlerInvokedWithClaim(false)` with `NODE_ENV='production'` returns silently (production no-op)."
   - Change: added a third test case asserting `doesNotThrow` when `NODE_ENV='production'` and `claimed === false`. Closes AC #37(c).

---

## 4. Directional / ambiguous gaps (routed to tasks/todo.md)

All routed to `tasks/todo.md § "Deferred from spec-conformance review — system-agents-v7-1-migration (2026-04-27)"`:

- REQ-43 — `enrich_contact` provider enum diverges from spec
- REQ-44 — `enrich_contact` handler does not route to Hunter on `provider: 'hunter'`
- REQ-45 — `managerAllowlistMember` missing on `write_workspace` and `update_task` (pre-registry carveout)
- REQ-49 — `SideEffectBeforeClaimError` named class not implemented
- REQ-56 — `executeListMySubordinates` lives in `skillExecutor.ts` not `configSkillHandlersPure.ts`
- REQ-68 — `skill.blocked` rate-limit primitive missing
- REQ-69 — `in_flight_reclaim_disabled` rate-limit missing
- REQ-83 — architecture.md "Key files per domain" row not added
- REQ-84 — architecture.md RLS-protected enumeration update not made (ambiguous)
- REQ-85 — tasks/current-focus.md not updated
- REQ-86 — docs/capabilities.md not updated with the 7 new agents

---

## 5. Files modified by this run

- `server/jobs/skillIdempotencyKeysCleanupJob.ts` (REQ-58 mechanical fix)
- `server/services/__tests__/skillIdempotencyKeysPure.test.ts` (REQ-87 mechanical fix)
- `tasks/todo.md` (deferred items section appended)

---

## 6. Next step

CONFORMANT_AFTER_FIXES — 2 mechanical gaps closed in-session; 10 directional/ambiguous gaps deferred to `tasks/todo.md` for human decision before merge.

Recommended sequence:
1. Re-run `pr-reviewer` on the expanded changed-code set (the 2 mechanical-fix files are new touches the reviewer hasn't seen yet).
2. Address the 10 deferred items in `tasks/todo.md` — most are small (REQ-43, REQ-49, REQ-83, REQ-85, REQ-86); a few are real design decisions (REQ-44 Hunter routing, REQ-45 universal-bundle pattern, REQ-56 file-location, REQ-68/69 rate-limit primitive).
3. After the deferred items are resolved, run the full programme-end gate set per the gate-cadence rule (`bash scripts/run-all-unit-tests.sh` then `npm run test:gates`).
4. Open the PR.
