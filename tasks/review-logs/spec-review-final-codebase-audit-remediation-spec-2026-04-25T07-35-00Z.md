# Spec Review Final Report — codebase-audit-remediation-spec

**Spec:** `docs/superpowers/specs/2026-04-25-codebase-audit-remediation-spec.md`
**Spec commit at start:** `887ece3986bc486535eaf5f4ea4a8459b1af5d65` (initial draft, 2026-04-25 06:40 UTC)
**Spec commit at finish:** `9fefd520` (after iteration 5)
**Spec-context commit:** `03cf81883b6c420567c30cfc509760020d325949` (2026-04-21)
**Iterations run:** 5 of MAX_ITERATIONS=5
**Exit condition:** iteration-cap

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Directional | Ambiguous | AUTO-DECIDED |
|---|----|----|----|----|----|----|----|
| 1 | 21 | 3 | 24 | 0 | 0 | 0 | 0 |
| 2 |  7 | 0 |  7 | 0 | 0 | 0 | 0 |
| 3 |  6 | 0 |  6 | 0 | 0 | 0 | 0 |
| 4 |  3 | 0 |  3 | 0 | 0 | 0 | 0 |
| 5 |  6 | 0 |  6 | 0 | 0 | 0 | 0 |
| **Total** | **43** | **3** | **46** | **0** | **0** | **0** | **0** |

The findings curve declined from iter1 (24) through iter4 (3) — that pattern reflects cascade fixes converging — and then iter5 surfaced 6 fresh repo-grounded findings that Codex only caught after looking at the live repo state.

No directional findings surfaced in any iteration. The spec stayed inside the framing assumptions throughout.

## Mechanical changes applied (grouped by spec section)

### §0 — Purpose and scope
- Reconciled finding-count framing (47 audit + reconciliation = 63 in scope).
- Added canonical-reference clarification (0213 operational, 0200 verbatim shape).

### §1 — Framing and non-negotiables
- Softened the no-new-primitives claim to acknowledge §4.2 service relocations + Phase 5 §8.1 rateLimitStoreService.
- Fixed `withAdminConnection` location reference (`adminDbConnection.ts`, not `orgScopedDb.ts`).

### §2 — Execution rules
- Aligned §2.1 phase-1 sequencing with §4 (in-PR migration ordering).
- Added §2.4 carve-out for warning-only gates (resolves contradiction with §5.7 / §8.2).
- Added §2.5 concurrent-PR migration-number assignment rule (rebase + rename at merge time).
- Clarified §2.6 Phase 5 PR boundaries (one PR per top-level subsection + per §8.4 item).

### §3 — Phase overview
- Updated §3.1 finding-count math (`47 + 8 + 2 + 6 − 2 = 61`, plus +2 §4.5 deliverables = 63), with explicit 0202/0203 carve-out.
- Added §3.4 mapping rows for P3-M13/M14 (§5.7), P3-M15 (§5.6), P3-M16 (§7.3).
- Corrected §3.5 row counts and decomposition for `verify-rls-coverage` (19 raw → 12 distinct).
- Removed stale §3.5 readPath count diagnosis.

### §4 — Phase 1 (RLS hardening)
- Added per-table historical-policy-name DROP inventory column to §4.1 (memory_review_queue uses `*_org_isolation`; 0141/0142/0147 use `*_tenant_isolation`).
- Fully enumerated all 8 table blocks in the §4.1 SQL skeleton.
- Updated §4.1 verification comment to reflect the 0204–0208 + 0212 baseline set.
- Reframed §4.1 risk note as a temporary backstop reaffirming §15.1.
- Reconciled §4.5 eight-vs-six historical-files inconsistency to "six" with explicit 0202/0203 carve-out.
- Fixed §4.4 `subaccountResolution.ts` → `resolveSubaccount.ts` path.
- Added §4.4 already-compliant routes note (subaccountAgents, configDocuments, automationConnectionMappings, webLoginConnections).
- Updated §4.6 verification commands to use `npx tsx scripts/migrate.ts` (real path) and direct test-file paths.
- Normalised all §4.2 service filenames to singular-noun convention; marked existing services as "extend" not "create"; replaced systemAutomationsService with systemAutomationService.

### §5 — Phase 2 (gate compliance)
- Softened §5 Phase 2 goal to differentiate blocking vs warning gates.
- Rewrote §5.1 to redirect the gate at the existing `server/lib/workflow/actionCallAllowlist.ts` (32-slug ReadonlySet) instead of creating a new empty file.
- Replaced §5.4 ghlWebhook impossible fix (no `req.orgId` on unauthenticated route) with `config.organisationId` / `dbAccount.subaccountId` lookup pattern.
- Refined §5.4 connectorPollingService scope to per-call-site (org-only vs org+subaccount).
- Replaced §5.5 wrong-direction count interpretation with "enumerate offending entries first".

### §6 — Phase 3 (architectural integrity)
- Picked single canonical filename `types.ts` for §6.2.1 (removed implementer-choice).
- Corrected §6.2.2 directory `skillAnalyzer/` → `skill-analyzer/` (kebab-case); enumerated four step files.
- Added §6.1 scope clarification listing the two schema-leaf-rule tail items routed to §8.4.
- Updated §6.3 verification commands to use direct test-file paths.

### §7 — Phase 4 (system consistency)
- Rewrote §7.2.2 from install-yaml (stale — already declared) to triage-existing-gate-warnings (capability-naming, MCP preset gaps).

### §8 — Phase 5 (controlled improvements)
- Major §8.1 rewrite: split testRunRateLimit (test-run, 4 callers) from public-form rate limiters (formSubmission, pageTracking inline); introduced new shared primitive `server/services/rateLimitStoreService.ts` (moved from `server/lib/` per the architecture rule); added "why not reuse" paragraph + service-tier justification.
- Soft-allocated migration numbers (`<NNNN>` placeholders) per §2.5 merge-time rule.
- Named the cleanup-job registration site (`server/services/queueService.ts` per repo verification, replacing the speculative `queueSchedule.ts`).
- Added two §8.4 schema-leaf-rule tail items (extract `AgentRunHandoffV1` and `SkillAnalyzerJobStatus` to `shared/types/`).

### §9 — Contracts
- Updated §9.1 RLS-policy contract with explicit historical-policy-DROP discipline.
- Replaced §9.2 producer/consumer surface (rateLimitStoreService is producer; testRunRateLimit + public routes are callers).
- Rewrote §9.3 to describe the existing `ReadonlySet<string>` shape with 32 slugs.
- Fixed §9.2 cleanup-job wording (delete is not read-only).

### §10 — Testing posture
- Added rateLimitStoreService.test.ts row to §10.1; preserved testRunRateLimit.test.ts for wrapper semantics.
- Updated §10.3 commands to use direct test-file paths; added test-runner-convention note.

### §12 — File inventory
- Cascaded all path / filename fixes into §12.1, §12.2, §12.4.
- Added: `shared/types/agentRunHandoff.ts`, `shared/types/skillAnalyzerJob.ts`, `server/services/rateLimitStoreService.ts`, `docs/integration-reference.md`.
- Removed: `server/lib/playbook/actionCallAllowlist.ts` (redirect to existing file instead).
- Added: `scripts/verify-action-call-allowlist.sh` line-29 path edit; `server/services/queueService.ts` registration entry; new schema-leaf cascades.

### §13 — Definition of done
- Updated §13.4 yaml-gate DoD wording (already-installed clarification).
- Aligned §13.5 cycle target with §6.3 (≤ 5).
- Updated §13.5 test count from four to five.
- Replaced "PR-open time" wording with "merge time per §2.5".

### §15 — Ongoing rules
- Softened §15.3 zero-new-primitives claim with new-primitive justification reference.

## Rejected findings

None. Every finding raised by Codex or the Rubric pass was accepted as mechanical. The spec was tightly framed from the outset; all 46 mechanical findings were either internal contradictions, file-inventory drift, stale claims, or downstream cascades from earlier edits.

## Directional and ambiguous findings (autonomously decided)

None surfaced in any iteration. The spec stayed inside the framing assumptions (`pre_production`, `static_gates_primary`, `prefer_existing_primitives`) throughout. No findings required the autonomous decision criteria in Step 7 of the spec-reviewer agent.

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review across 5 iterations. Every directional finding that surfaced was zero — Codex did not raise testing-posture, primitive-introduction, or framing-assumption concerns at any point. However:

- The review did not re-verify the framing assumptions at the top of `docs/spec-context.md`. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's §1 (Framing) and §2 (Execution rules) sections yourself before calling the spec implementation-ready.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgment. Specifically: the spec proposes a specific 5-phase ordering, a single corrective migration `0227` covering 8 tables, a targeted Phase 3 type extraction, and a Phase 5 stream of small PRs. Whether those structural choices match the implementer's preferences is a human judgment.
- The review did not prescribe what to build first. The spec's §2.1 strict-phase-ordering rule is the recommendation, but if the implementer workflow benefits from interleaving (e.g. doing the Phase 4 capabilities edit while waiting on Phase 1 migration testing), that is a workflow call the human owns.

**Recommended next step:**

1. Read §0 (Purpose and scope), §1 (Framing), §2 (Execution rules), §3 (Phase overview) — confirm headline framing matches your current intent.
2. Spot-check §4.1 (the corrective migration table + SQL skeleton) — every historical policy name is enumerated and every block is explicit.
3. Skim §12 (File inventory) — every prose-referenced file appears here; if any prose addition since spec authoring touches a new file, cascade it into §12 before merging.
4. Start implementation against Phase 1.

## Notes for the implementer

- **Migration `0227` is the only pre-allocated number.** Phase 5 migrations use `<NNNN>` placeholders per §2.5 — pick the next available number at merge time after rebasing onto `main`.
- **`server/lib/workflow/actionCallAllowlist.ts` already exists** with 32 slugs. §5.1 fixes the gate's path, not the file.
- **`yaml` is already in package.json** — §7.2.2 is now about triaging existing warnings, not installing a missing dep.
- **The schema-leaf rule has tail items in §8.4** (`agentRuns.ts` + `skillAnalyzerJobs.ts`) that did NOT appear in the original audit; they were caught in iter5 by repo verification.
- **Use `npx tsx <test-file-path>` for individual tests** — the `scripts/run-all-unit-tests.sh` runner ignores `--` filter args. Verification commands have been updated throughout.
