# Spec Review Iteration 5 — codebase-audit-remediation-spec

**Spec commit at start:** 880a53f7 (after iter4)
**Iteration:** 5 of MAX_ITERATIONS=5 (final iteration)
**Codex output:** tasks/review-logs/_spec-review-codebase-audit-remediation-iter5-codex-output.txt

## Codex findings (6 — repo-grounded findings, not cascade-fixes)

### iter5-FINDING #1 — §5.1 / §9.3 actionCallAllowlist already exists at a different path
- Mechanical, but with substantial scope. The spec proposed creating `server/lib/playbook/actionCallAllowlist.ts` as an empty allowlist. Repo verification: a populated `ReadonlySet<string>` containing 32 slugs already exists at `server/lib/workflow/actionCallAllowlist.ts`, with a colocated pure unit test and a runtime importer (`server/lib/workflow/validator.ts:34`). The gate `scripts/verify-action-call-allowlist.sh:29` hard-codes the wrong path.
- Fixed: §5.1 rewritten to "redirect the gate at the existing canonical file" rather than "create a new file". §9.3 contract section updated to reflect the live `ReadonlySet<string>` shape with 32 slugs. §12.1 entry removed (no new file). §12.2 entry added: `scripts/verify-action-call-allowlist.sh` line 29 path edit. §3.2 phase dependency graph entry left unchanged ("§5.1 actionCallAllowlist file" still describes the work — just gate edit, not file create).

### iter5-FINDING #2 — §1 / §4.2 wrong path for `withAdminConnection`
- Mechanical. Spec says `withAdminConnection` is in `server/lib/orgScopedDb.ts`. Repo verification: it's actually in `server/lib/adminDbConnection.ts`. `orgScopedDb.ts` exports `getOrgScopedDb` and friends.
- Fixed: §1 framing updated; §4.2 §3 ("System-admin HTTP routes") updated to reference `server/lib/adminDbConnection.ts`.

### iter5-FINDING #3 — §6.1 / §13.3 Phase 3 schema-leaf claim overscoped
- Mechanical. §6.1 claimed "the schema layer is a leaf" after the fix; §13.3 DoD echoed that claim. Repo verification: `server/db/schema/agentRuns.ts:3` imports from `services/agentRunHandoffServicePure.ts`, and `server/db/schema/skillAnalyzerJobs.ts:15` imports from `services/skillAnalyzerServicePure.ts`. Phase 3 fixes the cascade-driver (175 cycles) but does NOT make the schema layer a true leaf.
- Fixed: §6.1 added scope clarification listing the two tail items. §13.3 DoD softened to "the cascade-driver only; broader leaf rule is in §8.4 tail items". §8.4 added two new tail items (extract `AgentRunHandoffV1` and `SkillAnalyzerJobStatus` to shared/types). §12.1 and §12.2 cascaded with the new files and edits.

### iter5-FINDING #4 — §8.1 / §12.2 `queueSchedule.ts` doesn't exist
- Mechanical. §8.1 and §12.2 named `server/lib/queueSchedule.ts` (with "or equivalent — confirm at implementation time" caveat). Repo verification: actual cron registration site is `server/services/queueService.ts`.
- Fixed: §8.1 step 5 and §12.2 entry both updated to point at `server/services/queueService.ts`.

### iter5-FINDING #5 — §7.2.2 / §13.4 yaml-not-installed claim is stale
- Mechanical. §7.2.2 said the `verify-integration-reference.mjs` gate crashes with `ERR_MODULE_NOT_FOUND: 'yaml'`. Repo verification: `yaml ^2.8.3` is already in package.json devDependencies; the gate runs and emits warnings (capability-naming, MCP preset gaps) instead.
- Fixed: §7.2.2 rewritten as "triage the existing gate warnings"; original "install yaml" step removed. §12.2 package.json entry softened to "yaml is already declared". Added `docs/integration-reference.md` entry for the MCP-preset additions. §13.4 DoD wording was already softened in iter1; consistent with the new §7.2.2.

### iter5-FINDING #6 — §4.6 / §6.3 / §10.3 verification commands don't match the repo
- Mechanical. The spec used `node scripts/run-migrations.mjs` (file doesn't exist; actual is `scripts/migrate.ts`) and `npm test -- <pattern>` (the test runner ignores `--` filters per `scripts/run-all-unit-tests.sh`).
- Fixed: §4.6 verification updated to use `npx tsx scripts/migrate.ts` and direct `npx tsx <test-path>`. §6.3 same. §10.3 same plus a "test-runner convention" note explaining the direct-path pattern.

## Iteration 5 classification summary

- Codex findings: 6
- Rubric findings: 0
- Total: 6
- All mechanical. All auto-applied.
- mechanical_accepted: 6
- mechanical_rejected: 0
- directional: 0
- ambiguous: 0
- reclassified -> directional: 0

## Iteration 5 Summary

- Mechanical findings accepted:    6
- Mechanical findings rejected:    0
- Directional findings:            0
- Ambiguous findings:              0
- Reclassified -> directional:     0
- Autonomous decisions:            0

## Note on convergence

Iter5 was the iteration cap. Findings counts across iterations: 24 → 7 → 6 → 3 → 6. The iter5 findings were repo-grounded (not cascade-fixes from prior edits) — they required Codex to actually look at the live repo state. These would not have surfaced without exhausting the cap.

