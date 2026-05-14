# Spec Review Iteration 1 — codebase-audit-remediation-spec

**Spec:** docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md
**Spec commit at start:** 887ece3986bc486535eaf5f4ea4a8459b1af5d65
**Iteration:** 1 of MAX_ITERATIONS=5
**Codex output:** tasks/review-logs/_spec-review-codebase-audit-remediation-iter1-codex-output.txt

## Codex findings (extracted, then verified against repo)

See the per-finding sections below for classification details. All 21 Codex findings + 3 Rubric findings classified as mechanical-accept this iteration. No directional findings surfaced — Codex stayed inside the framing.

### Classification summary table

| # | Section | Class | Disposition |
|---|---|---|---|
| 1 | §2.1 vs §4 phase 1 sequencing | mechanical | accept |
| 2 | §4.1 historical policy DROP misses *_tenant_isolation | mechanical | accept |
| 3 | §4.1 missing per-table policy-name inventory | mechanical | accept (combined with #2) |
| 4 | §4.5 "eight historical files" vs "six files" | mechanical | accept |
| 5 | §3.5 "11 migrations" but 14 listed | mechanical | accept |
| 6 | §0 finding-count reconciliation drift (47/57/63) | mechanical | accept |
| 7 | §4.1 / §9.1 unproven "regardless of planner" claim | mechanical | accept |
| 8 | §4.1 RLS-only vs §15.1 defence-in-depth | mechanical | accept |
| 9 | §4.4 doesn't acknowledge already-compliant routes | mechanical | accept |
| 10 | File path drift: services use plural / wrong lib paths | mechanical | accept |
| 11 | §5.4 ghlWebhook impossible fix (no req.orgId) | mechanical | accept |
| 12 | §5.4 connectorPollingService over-confident scope | mechanical | accept |
| 13 | §5.5 readPath count direction inverted | mechanical | accept |
| 14 | §6.2.1 implementer-choice filename | mechanical | accept |
| 15 | §6.2.2 skillAnalyzer vs skill-analyzer dir | mechanical | accept |
| 16 | Phase 5 PR boundary inconsistency | mechanical | accept |
| 17 | Hardcoded migrations 0228/0229 vs "any order" | mechanical | accept |
| 18 | testRunRateLimit conflated with public-form limiter | mechanical | accept |
| 19 | rateLimitBucketCleanupJob registration site unnamed | mechanical | accept |
| 20 | §13.5 server-cycle target escalation | mechanical | accept |
| 21 | §2.4 vs §5.7/§8.2 baseline-allow contradiction | mechanical | accept |
| R1 | §0 vs §4.1 canonical-reference (0213 vs 0200) | mechanical | accept |
| R2 | §13.4 / §7.2.2 yaml-gate DoD overspecified | mechanical | accept |
| R3 | §10.3 unnamed agentRunVisibility test path | mechanical | accept |

### Counts

- Codex findings: 21
- Rubric findings: 3
- Total: 24
- mechanical_accepted (planned): 24
- mechanical_rejected: 0
- directional: 0
- ambiguous: 0
- reclassified -> directional: 0

### Verification against repo (key findings)

- Migration policy names confirmed via grep:
  - 0139 memory_review_queue: `memory_review_queue_org_isolation` (matches spec)
  - 0141 drop_zone_upload_audit: `drop_zone_upload_audit_tenant_isolation` (DOES NOT match spec DROP)
  - 0142 onboarding_bundle_configs: `onboarding_bundle_configs_tenant_isolation` (DOES NOT match)
  - 0147 trust_calibration_state: `trust_calibration_state_tenant_isolation` (DOES NOT match)
  - 0153 agent_test_fixtures: `agent_test_fixtures_org_isolation` (matches)
  - 0192 agent_execution_*: all `*_org_isolation` (matches)
  - 0213_fix_cached_context_rls: explicitly drops *_subaccount_isolation, *_read, *_write — confirms canonical pattern.
- Service file names: services use SINGULAR (subaccountAgentService, clarificationService, conversationService, automationService, webLoginConnectionService); spec uses plural.
- server/lib/: confirmed presence of adminDbConnection.ts, orgScopedDb.ts, resolveSubaccount.ts; NO subaccountResolution.ts.
- client/src/components/: directory is `skill-analyzer` (kebab), not `skillAnalyzer`. Step files: SkillAnalyzerImportStep.tsx, SkillAnalyzerExecuteStep.tsx, SkillAnalyzerProcessingStep.tsx, SkillAnalyzerResultsStep.tsx.
- testRunRateLimit.ts callers: agents.ts, skills.ts, subaccountAgents.ts, subaccountSkills.ts (NOT public form/page tracking).
- public/formSubmission.ts and public/pageTracking.ts have their OWN inline Map-based rate limiters (separate from testRunRateLimit).
- subaccountAgents.ts, configDocuments.ts, automationConnectionMappings.ts, webLoginConnections.ts ALL have :subaccountId and ALL already call resolveSubaccount() — already compliant with §15.1 invariant.
- ghlWebhook.ts is unauthenticated (HMAC verification, no JWT); no req.orgId; resolves org via locationId-to-config lookup.

### Decision log

[ACCEPT] §2.1 vs §4 — phase 1 sequencing contradiction: align §2.1 to "applied locally + CI before merge"
[ACCEPT] §4.1 — DROP every historical policy name per table; add per-table inventory table
[ACCEPT] §4.5 — reconcile "eight"/"six" to "six"
[ACCEPT] §3.5 — fix migration count from 11 to 14
[ACCEPT] §0 — fix finding-count reconciliation
[ACCEPT] §4.1 / §9.1 — narrow "regardless of planner" claim
[ACCEPT] §4.1 — reword risk note to "temporary backstop" reaffirming §15.1
[ACCEPT] §4.4 — add note distinguishing already-compliant routes from failing ones
[ACCEPT] §4.2 / §4.4 / §12 — normalise file paths and singular service names
[ACCEPT] §5.4 — replace ghlWebhook fix with config.organisationId / dbAccount.subaccountId pattern
[ACCEPT] §5.4 — soften connectorPollingService scope claim
[ACCEPT] §5.5 — replace wrong-direction count interpretation with "enumerate first"
[ACCEPT] §6.2.1 — pick types.ts (matches §12), remove implementer choice
[ACCEPT] §6.2.2 — fix skill-analyzer path everywhere; enumerate step files
[ACCEPT] §2.6 — clarify "per category in §8.1–§8.4"
[ACCEPT] §8.1 / §8.4 / §12 — soften migration numbers to "next available at implementation time"
[ACCEPT] §8.1 / §9.2 / §12 — separate testRunRateLimit (test-run) from public-form rate limiters
[ACCEPT] §8.1 / §12 — name the cleanup-job registration site
[ACCEPT] §13.5 — align cycle target with §6.3 (≤ 5)
[ACCEPT] §2.4 vs §5.7/§8.2 — carve warning-only gates out of bypass prohibition
[ACCEPT] §0 / §4.1 — pick 0213 as the canonical reference; cross-link 0200
[ACCEPT] §13.4 — soften yaml-gate DoD wording
[ACCEPT] §10.3 — confirm agentRunVisibility test path during implementation


## Iteration 1 Summary

- Mechanical findings accepted:    24
- Mechanical findings rejected:     0
- Directional findings:             0
- Ambiguous findings:               0
- Reclassified -> directional:      0
- Autonomous decisions:             0
  - AUTO-REJECT (framing):     0
  - AUTO-REJECT (convention):  0
  - AUTO-ACCEPT (convention):  0
  - AUTO-DECIDED:              0 (none routed to tasks/todo.md)
- Spec line count before:           1643
- Spec line count after:            1708
- Spec commit after iteration:      <pending — committed in step 8b>

### Notable mechanical edits

- §4.1 — added per-table historical-policy-name DROP inventory (memory_review_queue uses *_org_isolation; 0141/0142/0147 use *_tenant_isolation; rest are *_org_isolation). Corrected the SQL skeleton.
- §0 / §3.1 — reconciled finding-count framing to 63 (47 + 8 + 2 + 8 - 2).
- §3.5 — corrected migration count from 11 to 14.
- §4.5 — reconciled "eight historical files" to "six files" with explicit 0202/0203 carve-out.
- §4.1 / §9.1 — narrowed "regardless of planner" claim; expanded policy-rule list with explicit DROP discipline.
- §4.1 risk note — reframed RLS-only behaviour as a temporary backstop, reaffirming §15.1.
- §4.4 — added "already-compliant routes" note (subaccountAgents, configDocuments, automationConnectionMappings, webLoginConnections); fixed `server/lib/subaccountResolution.ts` -> `server/lib/resolveSubaccount.ts`.
- §4.2 / §12 — normalised all service filenames to singular-noun (matches repo); marked existing services as "extend" not "create"; added naming-convention note.
- §5.4 — replaced impossible ghlWebhook fix with config.organisationId / dbAccount lookup pattern; softened connectorPollingService scope claim.
- §5.5 — replaced wrong-direction count interpretation with "enumerate first" diagnostic-first approach.
- §6.2.1 — picked types.ts (matches §12); removed implementer choice.
- §6.2.2 / §12 — corrected `skillAnalyzer/` -> `skill-analyzer/`; enumerated four step files.
- §2.6 — clarified Phase 5 PR boundaries (one PR per top-level subsection + one per §8.4 item).
- §8.1 / §12 — soft migration numbers; explicit "next available at PR-open time" rule.
- §8.1 — major rewrite: split testRunRateLimit (test-run, 4 callers) from public-form rate limiters (formSubmission, pageTracking inline limiters); introduced new shared primitive `server/lib/rateLimitStore.ts`; named cleanup-job registration site (jobs/index.ts + queueSchedule.ts).
- §13.5 — aligned cycle-target DoD with §6.3 (≤ 5).
- §2.4 — carved warning-only gates out of bypass prohibition (resolves contradiction with §5.7 / §8.2).
- §0 — added canonical-reference clarification (0213 operationally cited; 0200 verbatim policy source).
- §13.4 — softened yaml-gate DoD wording.
- §10.3 — flagged agentRunVisibility test as needing path confirmation at implementation time.

