# Progress — development-lifecycle-governance-upgrade

**Branch:** claude/ai-driven-dev-lifecycle-FRqBd
**Plan:** tasks/builds/development-lifecycle-governance-upgrade/plan.md (locked — chatgpt-plan-review 2 rounds APPROVED, commit 54f5cda0)
**Status:** BUILDING — Chunk loop in progress

---

## Phase 1 close (retroactive)

Synthesised retroactively at session start 2026-05-14. Handoff written at `tasks/builds/development-lifecycle-governance-upgrade/handoff.md`. Spec-coordinator Steps 9–10 were never executed in the original session; all Phase 1 decisions recovered from spec frontmatter + review session logs.

## S1 branch sync

Merged `origin/main` into `claude/ai-driven-dev-lifecycle-FRqBd` at session start 2026-05-14. Three append-only conflicts resolved:
- `KNOWLEDGE.md`: kept HEAD (spec-edit grep-sweep pattern) + main's skill-merge-consolidation patterns (appended both)
- `tasks/todo.md`: kept HEAD (dev-lifecycle deferred F14) + main's skill-merge-consolidation deferred items (appended both)
- `tasks/current-focus.md`: kept HEAD BUILDING content; dropped main's NONE content

Post-merge typecheck: passed (both tsconfigs, exit 0).

## Plan gate

Operator said "proceed and do in automated fashion, don't stop until you have built all" — plan gate approved. Plan locked at commit `54f5cda0`.

---

## Chunk 1 — Intent artefact + spec-coordinator Step 3 intake

**Status:** COMPLETE
**Builder:** builder sub-agent (Sonnet 4.6)
**Completed:** 2026-05-14
**Files changed:** `.claude/agents/spec-coordinator.md`

### Changes made

- Renamed Step 3 heading from "Brief intake and UI-touch detection" to "Intent intake and UI-touch detection".
- Frontmatter description updated: "Step 3 — brief intake" → "Step 3 — intent intake".
- PLANNING lock prose updated: "skip Brief intake (Step 3)" → "skip Intent intake (Step 3)".
- Step 1 TodoWrite item 3 updated: "Brief intake" → "Intent intake".
- Replaced Step 3 body with the branching-on-classification instructions per plan spec.

### Lines changed (approximate, post-edit)

- Original Step 3 section: lines 115–131 (17 lines)
- New Step 3 section: lines 115–183 (69 lines, including schema, field rules table, Risk Surface vocabulary, Duplication/Strategy Check table shape, and UI-touch detection preserved at end)

### Grep-the-old-value pass results

Grep for "brief intake" / "Brief intake" in `.claude/agents/spec-coordinator.md`: **0 matches** — all four occurrences of the old phrasing were updated.

Grep for "brief.md" in `.claude/agents/spec-coordinator.md`: **2 matches** — both legitimate:
1. Line 120: Trivial-flow reference (`Use the existing brief.md flow`) — correct, stays.
2. Line 128: Migration rule (`in-flight Standard+ builds that pre-date this spec keep their existing brief.md`) — correct, stays.

### Dry-run walkthrough: Standard classification

Operator invokes: `spec-coordinator: add rate limiting to webhook handler`

Step 3 reads brief, classifies: **Standard** (touches server/routes, clear change, limited design decisions but not a single-file obvious change).

1. Coordinator notes: classification = Standard → `intent.md` required.
2. Operator nominates provisional slug: `webhook-rate-limiting`.
3. Coordinator creates `tasks/builds/webhook-rate-limiting/intent.md` with nine H2 sections:
   - `## Problem Statement` — operator fills in: webhook handler has no rate limiting, can be abused.
   - `## Desired Outcome` — operator fills in: per-endpoint rate limits enforced.
   - `## Non-Goals` — e.g. "None." or "Does not include billing-based tier limits."
   - `## Affected Capability Area` — operator selects from cluster list: `Integrations`.
   - `## User / Operator Impact` — operator fills in: prevents webhook abuse.
   - `## Risk Surface` — operator selects from vocabulary: `server/routes`, `webhook handlers`.
   - `## Assumptions` — bulleted list.
   - `## Open Questions` — bulleted list or "None."
   - `## Duplication / Strategy Check` — table scaffolded (values filled by Step 3a).
4. intent.md path written to `tasks/builds/webhook-rate-limiting/intent.md`.
5. Coordinator continues to Step 3a (Step 3a fills in the Duplication / Strategy Check table), then Step 4.

**This matches the spec §7.1 schema**: all nine required H2 sections produced, Risk Surface uses vocabulary from §7.1.1, field rules respected.

### Dry-run walkthrough: Trivial classification

Operator invokes: `spec-coordinator: fix typo in error message on line 42 of server/services/webhookService.ts`

Step 3 reads brief, classifies: **Trivial** (single file, obvious change, no design decisions).

1. Coordinator notes: classification = Trivial → no `intent.md` produced.
2. Coordinator resets `tasks/current-focus.md` to `NONE`, tells operator to implement directly, and stops.
3. Existing `brief.md` flow preserved — operator can write their own freeform brief if desired.

**This matches the existing Trivial flow**: no `intent.md`, PLANNING lock released, operator implements directly.

### G1 gate result

- `npx eslint .claude/agents/spec-coordinator.md`: 0 errors, 1 expected warning (file ignored — no matching config for .md). Pass.
- `npm run typecheck`: exit 0 (both tsconfigs). Pass.
- Attempts: lint: 1, typecheck: 1.

---

## Chunk 2 — Lifecycle Declaration + ABCd in spec authoring

**Status:** COMPLETE
**Builder:** builder sub-agent (Sonnet 4.6)
**Completed:** 2026-05-14
**Files changed:**
- `.claude/agents/spec-coordinator.md` (Step 6 section extended)
- `docs/spec-authoring-checklist.md` (Section 12 added; Appendix extended; ToC updated)

### Changes made

**`.claude/agents/spec-coordinator.md` Step 6:**
- Extended the required-sections list with two new bullet entries: "Lifecycle Declaration (Standard+ only — required per spec §7.2)" and "ABCd Lifecycle Estimate (Standard+ only — required per spec §7.3)".
- Added "### Lifecycle Declaration template (§7.2)" subsection with the §7.2 five-field table reproduced verbatim and the launch-state restriction stated explicitly (`Inception` or `Growth` only at first registration).
- Added "### ABCd Lifecycle Estimate template (§7.3)" subsection with the §7.3 four-dimension table reproduced verbatim and the S/M/L-only sizing restriction stated explicitly (numeric estimates prohibited, false-precision class).
- Both templates reference the spec path `tasks/builds/development-lifecycle-governance-upgrade/spec.md §7.2` / `§7.3`.

**`docs/spec-authoring-checklist.md`:**
- Added item 12 to the Table of Contents.
- Added "## Section 12 — Lifecycle Declaration and ABCd Estimate blocks (Standard+ only)" between Section 11 and the Appendix, covering:
  - §12.1 Lifecycle Declaration block: what it is, when required, the 5 required fields and their rules, launch-state restriction.
  - §12.2 ABCd Estimate block: what it is, when required, the 4 dimensions, S/M/L-only sizing constraint.
  - Reviewer signal this prevents.
- Appended two new boxes to the Appendix pre-review checklist:
  - `[ ] **[Section 12]** Lifecycle Declaration present per spec §7.2 (5 required fields; launch state = Inception or Growth only)`
  - `[ ] **[Section 12]** ABCd Estimate present with S/M/L sizing only per spec §7.3 (4 dimensions; no numeric values)`

### Wording-matches-spec confirmation

Read both files end-to-end. Confirmed:
- The §7.2 five-field table (Capability cluster, Capability owner, Lifecycle state on launch, Risk surface, Review cadence) is reproduced verbatim in `spec-coordinator.md` Step 6.
- The §7.3 four-dimension table (Acquire, Build, Carry, decommission) with `S | M | L` sizing is reproduced verbatim in `spec-coordinator.md` Step 6.
- Launch-state restriction (`Inception` or `Growth` only) is stated explicitly in both `spec-coordinator.md` Step 6 and `spec-authoring-checklist.md` §12.1.
- Numeric-estimates prohibition is stated explicitly in both files.
- Both files reference the spec path `tasks/builds/development-lifecycle-governance-upgrade/spec.md §7.2` / `§7.3`.

### `docs/spec-template.md` confirmation

`docs/spec-template.md` was NOT created. Confirmed via Glob search: zero matches. This is the plan-locked decision from chatgpt-plan-review Round 1 F4. The schema lives in `docs/spec-authoring-checklist.md` Section 12 and in `.claude/agents/spec-coordinator.md` Step 6.

### Grep-the-old-value pass results

- Grep for "spec authoring rubric" in `.claude/agents/spec-coordinator.md`: **0 matches** — no stale references to update.
- Grep for "spec authoring rubric" in `docs/spec-authoring-checklist.md`: **0 matches** — no stale references.
- Grep for "Lifecycle Declaration" in `spec-coordinator.md`: **4 matches** — all in the new Step 6 content. Correct.
- Grep for "ABCd" in `spec-coordinator.md`: **3 matches** — all in the new Step 6 content. Correct.
- Grep for "Lifecycle Declaration|ABCd" in `spec-authoring-checklist.md`: **8 matches** — all in the new Section 12 and Appendix. Correct.
- `docs/spec-template.md`: does not exist. Confirmed.

### G1 gate result

- `npx eslint .claude/agents/spec-coordinator.md docs/spec-authoring-checklist.md`: exit 0; 2 expected warnings ("File ignored because no matching configuration was supplied" — markdown files). No errors.
- `npm run typecheck`: exit 0 (both tsconfigs). No TypeScript files touched.
- Attempts: lint: 1, typecheck: 1.

---

## Chunk 3 — Duplication / Strategy Check hard gate (Step 3a)

**Status:** COMPLETE
**Builder:** builder sub-agent (Sonnet 4.6)
**Completed:** 2026-05-14
**Files changed:** `.claude/agents/spec-coordinator.md`

### Changes made

- Inserted `## Step 3a — Duplication / Strategy Check` section at line 186, between Step 3 (line 116) and Step 4 (line 257).
- Step 3a includes:
  - Order invariant statement: Step 3 → Step 3a → Step 4 → Step 5 → Step 6 (with spec path as authority).
  - Inputs section: three sources verbatim from spec §6.1.1 (intent.md fields, Asset Register, in-flight builds).
  - Sources to consult: two mechanical greps verbatim from spec §6.1.1.
  - Decision criteria table: three outputs with fixed value sets, matching spec §6.1.1.
  - Multi-cluster and mixed-lifecycle tie-break rules verbatim from spec §6.1.1.
  - Recording location: §7.1.0 mandatory Markdown table shape reproduced verbatim.
  - Hard gate behaviour (stop / merge with existing capability): halt, append `### Duplication gate escalation` to progress.md, require `**Operator decision:**` line to resume.
  - Soft gate behaviour (revise): pause, append `### Revise loop` to progress.md, require amendment + `**Operator decision:** revision complete` to proceed to Step 4.
  - `proceed` path: continue to Step 4 normally.
  - Error handling edge cases: all four from spec §6.3 reproduced.

### Lines changed

- Original: Step 3 ended at line 184; Step 4 started at line 186 (2 lines between).
- New: Step 3a inserted at line 186 (72 lines); Step 4 now starts at line 257.

### Grep-the-old-value pass results

Grep for `Step 3.*Step 4` (cross-references that skip Step 3a):

- **Frontmatter description (line 3):** was `Step 3 — intent intake + UI-touch detection. Step 4 — build slug derivation`. Updated to insert `Step 3a — duplication / strategy check (Standard+ only)` between Step 3 and Step 4.
- **TodoWrite list in Step 1 (lines 64–70):** was item 3 directly followed by item 4. Updated to add item `3a. Duplication / Strategy Check (Standard+ only)` between them.
- **Step 3 body intent.md schema note (line 133):** was "before proceeding to Step 4". Updated to "before proceeding to Step 3a".
- **Line 58 (`After Step 4 derives the actual slug...`):** references what Step 4 does, not Step 3 → Step 4 ordering. No update needed.
- **Line 126 (`Step 4 ratifies (or, on operator decision...`):** references the provisional-slug rule (what happens at Step 4), not ordering. No update needed.

All three ordering cross-references updated. Two references confirmed as legitimate "about Step 4" prose that do not need updating.

### Dry-run walkthroughs

**Branch 1: `proceed` (clear / clear)**

Scenario: operator intends to add a webhook rate-limiting feature.

- `intent.md` Affected Capability Area: `Integrations`
- Asset Register scan: no row with Name or Description overlapping "rate limiting on webhooks"
- In-flight spec scan: no `tasks/builds/*/spec.md` title mentions rate limiting for webhooks
- Duplication assessment: `clear` — no overlap found
- Strategic fit: `clear` — `Integrations` cluster has active rows in Growth state
- Recommendation: `proceed`

Step 3a writes to `intent.md`:
```
| Dimension | Assessment | Notes |
|---|---|---|
| Duplication | clear | No Asset Register row or in-flight spec covers webhook rate limiting |
| Strategic fit | clear | Integrations cluster is active (Growth state) |
| Recommendation | proceed | |
```

Step 3a continues to Step 4 without escalation. No `progress.md` entry written.

**Branch 2: `revise` (partial overlap) — soft-gate loop**

Scenario: operator intends to add "enhanced webhook monitoring dashboard".

- `intent.md` Affected Capability Area: `Integrations`
- Asset Register scan: finds existing row "Webhook Handler" in `Integrations` cluster — shares cluster but outcome differs (monitoring dashboard vs the handler itself)
- Duplication assessment: `partial overlap`
- Strategic fit: `clear` — Integrations is Growth
- Recommendation: `revise`

Step 3a writes to `intent.md`:
```
| Dimension | Assessment | Notes |
|---|---|---|
| Duplication | partial overlap | Existing "Webhook Handler" row in Integrations cluster shares cluster; outcome differs (dashboard vs handler) |
| Strategic fit | clear | Integrations cluster is active (Growth state) |
| Recommendation | revise | |
```

Step 3a appends to `tasks/builds/<slug>/progress.md`:
```
### Revise loop

Duplication: partial overlap — "Webhook Handler" row in Integrations shares cluster.
Strategic fit: clear.
Recommendation: revise.
Gate output written to intent.md.
Coordinator paused. Operator must amend intent.md (Affected Capability Area, Desired Outcome, or Problem Statement) to resolve partial overlap, then append: **Operator decision:** revision complete
```

Coordinator pauses. Operator amends `intent.md` — changes Desired Outcome to "extend the existing Webhook Handler capability with a rate-limiting endpoint policy" and Affected Capability Area stays `Integrations`. Step 3a re-runs.

Re-run:
- Asset Register scan: closest match is "Webhook Handler" — now outcome aligns with extending that row (operator has scoped it as an extension, not a new separate capability)
- Duplication assessment: `clear` (extending an existing row is not a duplicate — it is an update)
- Strategic fit: `clear`
- Recommendation: `proceed`

Operator appends `**Operator decision:** revision complete` to the `### Revise loop` section. Step 3a proceeds to Step 4.

**Branch 3: `merge with existing capability` (likely duplicate) — hard gate**

Scenario: operator intends to add "webhook event routing" — a new capability.

- `intent.md` Affected Capability Area: `Integrations`
- Asset Register scan: finds existing row "Webhook Handler" — Name is "Webhook Handler", Description includes "event routing via webhook callbacks". Cluster: `Integrations`. Both cluster AND outcome overlap.
- Duplication assessment: `likely duplicate`
- Strategic fit: `clear`
- Recommendation: `merge with existing capability`

Step 3a writes to `intent.md`:
```
| Dimension | Assessment | Notes |
|---|---|---|
| Duplication | likely duplicate | "Webhook Handler" row covers same cluster (Integrations) and outcome (webhook event routing) |
| Strategic fit | clear | Integrations cluster active (Growth) |
| Recommendation | merge with existing capability | |
```

Step 3a appends to `tasks/builds/<slug>/progress.md`:
```
### Duplication gate escalation

Duplication: likely duplicate — "Webhook Handler" row in Asset Register covers same cluster AND outcome.
Strategic fit: clear.
Recommendation: merge with existing capability.
Gate output written to intent.md.
Coordinator halted. Operator must append **Operator decision:** line to this section before the coordinator resumes.
```

Coordinator halts. Operator reviews. If operator decides to proceed as an update to the existing webhook-handler capability, they append: `**Operator decision:** proceed as update to webhook-handler capability row`. Step 4 then uses the existing build for that row's updates.

If operator decides to stop: `**Operator decision:** stop — not proceeding`. Pipeline ends.

**Branch 4: `stop` (not aligned) — hard gate**

Scenario: operator intends to add "ML-based lifecycle scoring for capability health".

- `intent.md` Affected Capability Area: `Audit & Governance`
- Asset Register scan: `Audit & Governance` cluster rows exist; all are in `Sunset Candidate` state (lifecycle governance tooling being wound down).
- Duplication assessment: `clear` — no existing row covers ML lifecycle scoring
- Strategic fit: `not aligned` — `Audit & Governance` cluster is in Sunset Candidate state, not active
- Recommendation: `stop`

Step 3a writes to `intent.md`:
```
| Dimension | Assessment | Notes |
|---|---|---|
| Duplication | clear | No existing row covers ML lifecycle scoring |
| Strategic fit | not aligned | Audit & Governance cluster in Sunset Candidate state |
| Recommendation | stop | |
```

Step 3a appends to `tasks/builds/<slug>/progress.md`:
```
### Duplication gate escalation

Duplication: clear.
Strategic fit: not aligned — Audit & Governance cluster is Sunset Candidate; intent targets a capability in a cluster being wound down.
Recommendation: stop.
Gate output written to intent.md.
Coordinator halted. Operator must append **Operator decision:** line to this section before the coordinator resumes.
```

Coordinator halts. Operator must append `**Operator decision:** stop confirmed — discarding this intent` or `**Operator decision:** override — proceed with different cluster` before the coordinator can resume. Without the `**Operator decision:**` line, typing "continue" does nothing.

### G1 gate result

- `npx eslint .claude/agents/spec-coordinator.md`: exit 0; 1 expected warning (file ignored — no matching config for .md). No errors.
- `npm run typecheck`: exit 0 (both tsconfigs). No TypeScript files touched.
- Attempts: lint: 1, typecheck: 1.

---

## Chunk 4 — `docs/capabilities.md` Asset Register restructure

**Status:** COMPLETE
**Builder:** builder sub-agent (Sonnet 4.6)
**Completed:** 2026-05-14
**Files changed:** `docs/capabilities.md`, `tasks/todo.md`

### Changes made

**`docs/capabilities.md`:**
- Added `## Cluster list (closed — see §7.4.5 for mutation procedure)` section after the Editorial Rules section and before the Table of Contents. Contains the 10-cluster seed list verbatim from spec §7.4.2 (Workflow Engine, Approvals, Identity & Auth, Reporting, Integrations, Agent Runtime, Admin & Ops, Billing, Memory & Knowledge, Audit & Governance) plus the mutation procedure note referencing spec §7.4.5.
- Added `## Asset Register` section immediately after the cluster list, containing the pinned 12-column Markdown table header verbatim from spec §7.4.1.
- Backfilled 47 capability rows (31 Product Capabilities + 16 Agency Capabilities) into the Asset Register table. All existing capability descriptions preserved; every cell populated with real value or explicit placeholder.

**`tasks/todo.md`:**
- Appended a new section `## Capabilities Asset Register backfill — development-lifecycle-governance-upgrade (2026-05-14)`.
- 47 `### owner-resolution: <capability-id>` entries (spec §7.4.3).
- 47 `### capabilities-backfill: <capability-id>` entries for Carry notes (spec §10 Chunk 4 entry format).

### Count of capabilities migrated

**Total: 47 capabilities**

Product Capabilities (31):
1. multi-tenant-platform
2. authentication-access-control
3. ai-agent-system
4. agent-workplace-identity
5. capability-aware-orchestrator
6. platform-feature-request-pipeline
7. universal-brief
8. configuration-assistant
9. skill-system
10. crm-query-planner
11. workflow-engine
12. human-in-the-loop
13. task-board-workspace
14. pulse-supervision-home
15. agent-spending
16. live-execution-log
17. memory-knowledge-system
18. trust-verification-layer
19. workspace-health-diagnostics
20. sub-account-optimiser
21. sub-account-baseline
22. activity-analytics
23. client-portal
24. pages-content-builder
25. integration-framework
26. document-bundles-cached-context
27. execution-infrastructure
28. personal-assistant
29. sandboxed-runtime-iee
30. persistent-agent-workspace
31. subscription-driven-long-task-execution

Agency Capabilities (16):
32. performance-reporting-analytics
33. seo-management
34. geo-ai-search-visibility
35. content-creation-publishing
36. crm-contact-management
37. email-marketing-outreach
38. campaign-management-optimization
39. financial-analysis-reporting
40. churn-detection-account-health
41. customer-support-automation
42. landing-page-management
43. competitor-intelligence
44. portfolio-intelligence
45. llm-spend-observability
46. memory-injection-utility
47. tier-4-isolated-code-execution

### Count of placeholders created

- **Owner placeholders:** 47 (one per capability; all Owner cells = `TBD owner - temp reviewer: michaelhazza; due 2026-08-14`)
- **Carry notes placeholders:** 47 (one per capability; all TBD with backfill link)
- **Launch source placeholders:** 47 (all = `unknown — historical` — no build slug available for migrated entries)

Breakdown by field type:
- Owner: 47 entries → each has `### owner-resolution: <id>` in tasks/todo.md (spec §7.4.3 all three artefacts: cell value + todo entry + ISO due date)
- Carry notes: 47 entries → each has `### capabilities-backfill: <id>` in tasks/todo.md (spec §10 Chunk 4 format)

### §15.1 open question — cluster list completeness

**Decision: 10-cluster list is sufficient. §7.4.5 did NOT fire.**

Every capability maps cleanly to at least one of the 10 seed clusters:
- "Universal Brief" → Agent Runtime (conversational agent intake surface)
- "Trust & Verification Layer" → Audit & Governance, Agent Runtime
- "Document Bundles & Cached Context" → Memory & Knowledge
- "Sub-account Optimiser" → Admin & Ops
- "Sub-account Baseline" → Admin & Ops
- "LLM Spend Observability & Per-Client P&L" → Billing, Reporting
- "Memory Injection Utility" → Memory & Knowledge
- "Tier 4 Isolated Code Execution" → Agent Runtime

No ADR required. Merge diff stays at 8 modified, 0 new.

### Post-S1-merge content confirmation

PR #301 (audit-runner Area 10 god-file register additions) was checked. The following capabilities from the current `docs/capabilities.md` head were included in the backfill:
- memory-injection-utility (B2 dashboard capability, added in PR #298 memory-improvements)
- All 47 capabilities reflect the current state of the file at 2026-05-14 (post-S1-merge).

### Anchor-collision check

Pre-append scan of `tasks/todo.md` for `### capabilities-backfill:` and `### owner-resolution:` headings:
- Result: **0 collisions found**. No pre-existing headings with either namespace exist. No namespacing required.
- Checked against PR #300 (skill-merge-consolidation-pass) deferred items section: headings use different namespaces (`SKILL-MERGE-*`) — no collision.

### Lifecycle state reasoning (per capability)

- **Mature** (live and stable for ≥1 quarter): multi-tenant-platform, authentication-access-control, ai-agent-system, skill-system, workflow-engine, human-in-the-loop, task-board-workspace, pulse-supervision-home, live-execution-log, memory-knowledge-system, workspace-health-diagnostics, activity-analytics, client-portal, pages-content-builder, integration-framework, execution-infrastructure, performance-reporting-analytics, seo-management, content-creation-publishing, crm-contact-management, email-marketing-outreach, campaign-management-optimization, financial-analysis-reporting, landing-page-management
- **Growth** (live but in active iteration): agent-workplace-identity, capability-aware-orchestrator, platform-feature-request-pipeline, universal-brief, configuration-assistant, crm-query-planner, agent-spending, trust-verification-layer, sub-account-optimiser, sub-account-baseline, document-bundles-cached-context, personal-assistant, sandboxed-runtime-iee, persistent-agent-workspace, subscription-driven-long-task-execution, geo-ai-search-visibility, churn-detection-account-health, customer-support-automation, competitor-intelligence, portfolio-intelligence, llm-spend-observability, memory-injection-utility, tier-4-isolated-code-execution

### Grep-the-old-value pass results

Grep for `capabilities\.md#(product-capabilities|agency-capabilities|skills-reference|integrations-reference|changelog|core-value)` across all `.md` files: **0 matches** — no anchor-based links to old section headings exist. All existing file-level references to `docs/capabilities.md` remain valid.

Grep for `\| \|` in the Asset Register section: the 16 matches found are ALL in the pre-existing Agency Capabilities two-column info tables (lines 685+ in the updated file) — not in Asset Register rows. Confirmed: every Asset Register row has all 12 cells populated.

### G1 gate result

- `npx eslint docs/capabilities.md tasks/todo.md`: exit 0; 2 expected warnings (markdown files not in eslint config). No errors.
- `npm run typecheck`: exit 0 (no TypeScript files touched).
- Attempts: lint: 1, typecheck: 1.

---

## Chunk 5 — doc-sync trigger row + finalisation Step 6 verdict

**Status:** COMPLETE
**Builder:** builder sub-agent (Sonnet 4.6)
**Completed:** 2026-05-14
**Files changed:**
- `docs/doc-sync.md` (capabilities.md trigger row extended)
- `.claude/agents/finalisation-coordinator.md` (Step 6 capabilities.md table row updated + Capability Registration verdict prose block added)

### Changes made

**`docs/doc-sync.md`:**
- Replaced the simple `docs/capabilities.md` row (previously: "Any add / remove / rename...") with the full Capability Registration trigger row per spec §5 (Chunk 5 contracts).
- New row includes: trigger conditions (any Asset Register row §7.4.1 field change), Editorial Rules reference, all 8 valid §6.2.1 verdict strings (`yes: create new capability record`, `yes: update existing capability record`, `yes: split existing capability record`, `yes: merge with existing capability record`, `n/a: docs-only change`, `n/a: test-only change`, `n/a: internal refactor with no capability surface change`, `n/a: build / tooling change only`), `yes`-class and `n/a`-class requirements, and explicit statement that any other phrasing is invalid and blocks `MERGE_READY`.

**`.claude/agents/finalisation-coordinator.md` Step 6:**
- Updated the Reference-doc update-triggers table row for `docs/capabilities.md` to reference §6.2.1 combined verdict format and the new doc-sync row.
- Added a new "Capability Registration verdict" prose block immediately after the reference-doc table and before "Record verdicts in the chatgpt-pr-review session log". The prose block:
  - Names the eight valid §6.2.1 strings verbatim.
  - States that any other phrasing is invalid and treated as a missing verdict.
  - Adds the `yes`-class and `n/a`-class explicit requirements.
  - Handles the `split` case inline: original row's `Lifecycle state` moved to `Sunset Candidate` or `Sunset`; Related-docs link points to successor row(s).
  - States the MERGE_READY block clause: Step 9 is blocked until a valid §6.2.1 verdict is recorded; absent or invalid verdict → record reason in `progress.md` and halt pipeline.

### Dry-run walkthroughs

**Branch 1: Capability-surface-touching change**

Scenario: a PR merges a new route that introduces a new background-task scheduler capability.

- Doc-sync sweep reaches `docs/capabilities.md`.
- Coordinator inspects the diff: new code surface, new asset register row required.
- Verdict recorded: `yes: create new capability record`
- Asset Register row is added with all §7.4.1 fields populated (Capability ID, Name, Description, Owner per §7.4.3, Cluster, Lifecycle state = Inception, Launch source = build slug, Risk surface, Last review date = today, Carry notes from ABCd, Decommission notes = "None planned", Related docs).
- This matches one of the four valid `yes:` strings — verdict is accepted. MERGE_READY proceeds.

**Branch 2: Internal refactor with no capability surface change**

Scenario: a PR refactors the webhook handler's internal retry logic without changing any user-visible behaviour or API surface.

- Doc-sync sweep reaches `docs/capabilities.md`.
- Coordinator inspects the diff: no new capability, no Asset Register row mutated, no cluster/name/description/lifecycle state changes.
- Verdict recorded: `n/a: internal refactor with no capability surface change`
- This matches one of the four valid `n/a:` strings — verdict is accepted. MERGE_READY proceeds without requiring an Asset Register update.

### Grep-the-old-value pass results

Grep for `Add / remove / rename capability` in `.claude/agents/finalisation-coordinator.md`: **0 matches** — old phrasing fully replaced.

Grep for `capabilities\.md` in `.claude/agents/finalisation-coordinator.md`: **4 matches** — all in Step 6:
1. Line 271: updated table row (new §6.2.1 combined-format reference). Correct.
2. Line 278: new Capability Registration verdict heading. Correct.
3. Line 280: new prose "When the doc-sync sweep reaches `docs/capabilities.md`...". Correct.
4. Line 297: new MERGE_READY block clause. Correct.

No stale references to the old doc-sync format remain.

### G1 gate result

- `npx eslint docs/doc-sync.md .claude/agents/finalisation-coordinator.md`: exit 0; 2 expected warnings (markdown files not in eslint config). No errors.
- `npm run typecheck`: exit 0 (both tsconfigs). No TypeScript files touched.
- Attempts: lint: 1, typecheck: 1.

---

## Chunk 6 — Compound Learning Feedback (Step 7a)

**Status:** COMPLETE
**Builder:** builder sub-agent (Sonnet 4.6)
**Completed:** 2026-05-14
**Files changed:** `.claude/agents/finalisation-coordinator.md`

### Changes made

- Inserted `## Step 7a — Compound Learning Feedback` section between Step 7 and Step 8 (between line 319 and line 321 in the pre-edit file).
- Updated frontmatter description: inserted `Step 7a — Compound Learning Feedback.` between `Step 7 — KNOWLEDGE.md pattern extraction.` and `Step 8 — tasks/todo.md cleanup.`
- Updated Step 1 TodoWrite list: added item `7a. Compound Learning Feedback` between items 7 and 8.

Step 7a contains:
- Order invariant statement: Step 6 → Step 7 → Step 7a → Step 8 → Step 9 (MERGE_READY) → Step 10. Step 7a NEVER blocks MERGE_READY.
- Producer / consumer model description.
- Proposal table contract reproduced verbatim from spec §7.5.
- 8-value target enum reproduced verbatim from spec §7.5.
- 6-agent shortlist for `agent-instruction` reproduced verbatim from spec §7.5.
- Auto-apply prohibition reproduced verbatim from spec §7.5.
- Step-by-step behaviour (emit rows, operator marks decisions, approved → tasks/todo.md, collision check).
- Error handling for all four edge cases from spec §6.

### Grep-the-old-value pass results

Grep for `Step 7.*Step 8` (old direct sequencing without Step 7a):

- **Frontmatter description (line 3):** old value `Step 7 — KNOWLEDGE.md pattern extraction. Step 8 — tasks/todo.md cleanup.` Updated to insert `Step 7a — Compound Learning Feedback.` between them.
- **Step 1 TodoWrite list (line 71):** old value had item 7 directly followed by item 8. Updated to add item `7a. Compound Learning Feedback`.
- **Step 7a body:** references to "patterns extracted in Step 7" and "No patterns extracted in Step 7" are correct — they refer to Step 7's output, not sequencing.
- **All other step-number references in the file** were checked. No other "Step 7 → Step 8" direct-sequencing references found without the intervening Step 7a.

Result: all stale references updated. No remaining Step 7 → Step 8 references that skip Step 7a.

### Dry-run walkthrough: three synthetic KNOWLEDGE.md patterns through Step 7a

**Pattern 1 — Agent instruction pattern**

Scenario: Step 7 extracts a pattern titled "finalisation-coordinator must pause on conflicting code-area files before auto-resolving". This pattern is about improving an agent's behaviour.

Step 7a processes:

```
| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| finalisation-coordinator must pause on conflicting code-area files before auto-resolving | agent-instruction: finalisation-coordinator | This pattern describes a behavioural rule for the finalisation-coordinator agent, which is in the 6-agent shortlist. | approved |
```

- Target `agent-instruction: finalisation-coordinator` is valid — `finalisation-coordinator` is in the 6-agent shortlist.
- Operator approves. Approved entry appended to `tasks/todo.md` under heading `### compound-learning: finalisation-coordinator code-area conflict pause (<slug>)`.
- No agent file edited in this finalisation cycle — the entry becomes a follow-up Trivial PR task.

**Pattern 2 — Missing checklist box pattern**

Scenario: Step 7 extracts a pattern titled "spec authoring checklist missing validation for Risk Surface vocabulary". This pattern is about a gap in the spec authoring instructions.

Step 7a processes:

```
| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| spec authoring checklist missing validation for Risk Surface vocabulary | spec-authoring-instructions | This pattern identifies a missing check in the spec authoring checklist / spec-coordinator Step 6 instructions — the `spec-authoring-instructions` target is the correct bucket. | approved |
```

- Target `spec-authoring-instructions` is in the 8-value enum. Valid.
- Operator approves. Approved entry appended to `tasks/todo.md` under heading `### compound-learning: spec authoring Risk Surface vocabulary check (<slug>)`.
- No `docs/spec-authoring-checklist.md` or `spec-coordinator.md` edited in this finalisation cycle.

**Pattern 3 — No clear target pattern**

Scenario: Step 7 extracts a pattern titled "build timelines are consistently underestimated for Growth-state capabilities". This is a general observation with no obvious mechanism to enforce.

Step 7a processes:

```
| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| build timelines consistently underestimated for Growth-state capabilities | no-further-action | No specific mechanism in the existing target set (spec-authoring-instructions, plan-template, agent-instruction, hook-or-grep-gate, regression-test, context-pack, documentation) can enforce this — it is a planning judgment, not a mechanical rule. Logging explicitly to avoid silently dropping. | deferred |
```

- Target `no-further-action` is in the 8-value enum. Valid.
- Operator defers. Row remains in `progress.md` as deferred. Not appended to `tasks/todo.md`.
- No agent / hook / test file edited.

**Confirmation:** Three proposal rows produced. No agent / hook / test file edited in any of the three dry-runs. The auto-apply prohibition holds for all three cases.

### G1 gate result

- `npx eslint .claude/agents/finalisation-coordinator.md`: exit 0; 1 expected warning (file ignored — no matching config for .md). No errors.
- `npm run typecheck`: exit 0 (both tsconfigs). No TypeScript files touched.
- Attempts: lint: 1, typecheck: 1.

---

## Chunk 7 — Process documentation sync (CLAUDE.md + architecture.md)

**Status:** COMPLETE
**Builder:** builder sub-agent (Sonnet 4.6)
**Completed:** 2026-05-14
**Files changed:** `CLAUDE.md`, `architecture.md`

### Changes made

**`CLAUDE.md`:**
- Updated `spec-coordinator` row in the agent fleet table: changed "brief intake, mockup loop, spec authoring, reviews, handoff" to "intent intake, duplication/strategy check, mockup loop, spec authoring, reviews, handoff" (aligns with Chunk 1's coordinator-file update).
- Added "### Build lifecycle" subsection in the "Local Dev Agent Fleet" section (between the Model guidance table and Task Classification). Contains:
  - The nine-step corrected lifecycle sequence (verbatim from spec §10 Chunk 7).
  - One bullet per step with coordinator/gate mapping.
  - Explicit statement: "Capability Registration and Compound Learning run **during finalisation, before merge** — they precede `MERGE_READY`."

**`architecture.md`:**
- Added "### Dev build lifecycle" subsection in the "Local Development Setup" section (after the "Switching machines" subsection, before the `---` separator). Contains:
  - The nine-step corrected lifecycle sequence (verbatim from spec §10 Chunk 7).
  - Orchestrator summary line mapping Phase 1/2/3 to the new wrapper steps.
  - Explicit statement: "Capability Registration and Compound Learning run **during finalisation, before merge** — they precede `MERGE_READY`."

### Pre-check: Rule 16 / audit framework section integrity

Pre-check finding: "Rule 16" and "audit framework" content is in `docs/codebase-audit-framework.md` (PR #303), NOT in `architecture.md`. Grep of `architecture.md` for "Rule 16", "audit framework", "#303" returned **0 matches** before and after the edit. The architecture.md edit is confined to the "Local Development Setup" section (lines ~3703-3711). No audit framework content was touched.

Confirmed post-edit: `grep -n "Rule 16|audit framework" architecture.md` → **0 matches**. Rule 16 content preserved in `docs/codebase-audit-framework.md`.

### Repo-wide grep for old step phrasing

`grep -rn "Intent.*Elaboration|Elaboration.*Specification" --include="*.md"` (excluding spec.md, review-logs, brief.md):
- Only match: `tasks/builds/development-lifecycle-governance-upgrade/plan.md` line 355 — this is the acceptance criteria text describing *what to search for*, not a live lifecycle sequence. This is a legitimate historical reference.
- No matches in `docs/decisions/` or `_retired/`.
- No matches in `CLAUDE.md` or `architecture.md`.

Result: **no old step phrasing remains in live process docs**.

### Grep-the-old-value pass

- Grep for "brief intake" in `CLAUDE.md`: **0 matches** — updated to "intent intake, duplication/strategy check".
- Grep for "Elaboration" in `CLAUDE.md`: **0 matches**.
- Grep for "Elaboration" in `architecture.md`: **0 matches**.
- Grep for `Intent.*Duplication.*Specification.*Build Planning.*Construction.*Review.*Capability Registration.*Compound Learning.*Merge` in both files: **1 match each** — correct.

### `docs/spec-template.md` confirmation

`docs/spec-template.md` does not exist. Confirmed via `ls`: no such file or directory. Plan-locked decision from Chunk 2 preserved.

### G1 gate result

- `npx eslint CLAUDE.md architecture.md`: exit 0; 2 expected warnings (markdown files not in eslint config). No errors.
- `npm run typecheck`: exit 0 (both tsconfigs). No TypeScript files touched.
- Attempts: lint: 1, typecheck: 1.

---

## G2 gate

**Status:** COMPLETE — 2026-05-14
- `npm run lint`: 0 errors, 899 warnings (all pre-existing, none from this branch). Pass.
- `npm run typecheck`: exit 0 (both tsconfigs). Pass.
- Zero TypeScript files changed — G2 baseline CI safety net only.

---

## Branch-level review pass

**Status:** COMPLETE — 2026-05-14

### spec-conformance
Verdict: CONFORMANT_AFTER_FIXES. 37 requirements checked. One mechanical gap fixed: Step 3a recording-location table used wrong shape (`| Dimension | Assessment | Notes |` with capitalized values); corrected to spec §7.1.0 `| Output | Value |` shape with lowercase enum values. Commit: 2b03b64c.

### adversarial-reviewer
skipped — policy-not-applicable (diff is markdown-only with zero §5.1.2 security surface: no server/db/schema, no server/routes, no auth/permission services, no middleware, no RLS migrations, no webhook handlers)

### pr-reviewer
Verdict: APPROVED (after 4 rounds, 3 fix-loop commits applying 7 findings):
- Round 1: 2 blocking + 2 should-fix — doc-sync.md Final Summary template; architecture.md Phase 1 description; capabilities.md 47 owner-task links; spec-pointer for bare §-refs
- Round 2: 3 should-fix — HTML entity bug in code fence; review-logs/README.md stale format; finalisation-coordinator.md disambiguation scope
- Round 3: 1 blocking — path regression `docs/2026-04-30...` → `docs/superpowers/specs/2026-04-30...`; brief.md stale path

### reality-checker
Verdict: READY. All 7 goals (G1–G7) and all backwards-compat invariants verified with file+line citations.

### dual-reviewer
REVIEW_GAP: dual-reviewer | task-class: Significant | reason: Codex CLI not installed locally (command not found) | operator-override: no | remediation: accept — markdown-only build; pr-reviewer ran 4 rounds with fix-loop; reality-checker READY; risk is low

---

## Doc Sync gate

**Status:** COMPLETE — 2026-05-14

| Doc | Verdict | Rationale |
|---|---|---|
| `architecture.md` | yes (Dev build lifecycle subsection added) | Chunk 7 added `### Dev build lifecycle` with corrected 9-step sequence |
| `docs/capabilities.md` | yes: update existing capability record | Chunk 4 restructured all 47 existing capability entries into the 12-column Asset Register; dev-lifecycle-governance row deferred to Phase 3 per plan Executor notes (conditional on post-Chunk-4 state) |
| `docs/integration-reference.md` | n/a: build / tooling change only | No integration scope in this build |
| `CLAUDE.md` / `DEVELOPMENT_GUIDELINES.md` | yes (CLAUDE.md: Build lifecycle subsection + agent fleet row updated) | Chunk 7 updated CLAUDE.md; DEVELOPMENT_GUIDELINES.md unchanged |
| `CONTRIBUTING.md` | n/a: build / tooling change only | No lint/convention policy changes |
| `docs/frontend-design-principles.md` | n/a: build / tooling change only | No UI changes |
| `KNOWLEDGE.md` | no — deferred to Phase 3 | Phase 2 build produced no runtime code patterns; KNOWLEDGE.md extraction handled by finalisation-coordinator Step 7 at Phase 3 |
| `docs/spec-context.md` | n/a: spec-review sessions only | Not a spec-review session |
| `docs/decisions/` | n/a: §7.4.5 cluster mutation procedure did not fire | 10-cluster seed list was sufficient for all 47 capabilities |
| `docs/context-packs/` | no — unaffected | architecture.md sections added but no existing anchors renamed/removed; context packs unaffected |
| `references/test-gate-policy.md` | n/a: build / tooling change only | No test-gate posture changes |
| `references/spec-review-directional-signals.md` | n/a: no new recurring spec-reviewer pattern | No new recurring signals |
| `docs/incident-response.md` | n/a: build / tooling change only | No incident response changes |
| `docs/testing-transition-plan.md` | n/a: build / tooling change only | No test migration changes |
| `.claude/FRAMEWORK_VERSION` + `.claude/CHANGELOG.md` | yes (version 2.3.0 → 2.4.0) | Framework-level change: new coordinator pipeline steps (spec-coordinator Steps 3/3a/6; finalisation-coordinator Step 7a); CHANGELOG.md entry added |

---

## REVIEW_GAP log

REVIEW_GAP: dual-reviewer | task-class: Significant | reason: Codex CLI not installed locally | operator-override: no | remediation: accept

---

## LEARNING_FEEDBACK_PROPOSAL (Phase 3 Step 7a)

Producer: `finalisation-coordinator` post-merge recovery pass (PR #304 merged at 2026-05-14T10:13:36Z, merge commit `0ffbf081`). Operator marks each row's `Operator decision` inline (`approved` | `rejected` | `deferred`). Approved entries get appended to `tasks/todo.md` under `### compound-learning: <pattern-title> (development-lifecycle-governance-upgrade)`. Step 7a is **never blocking** — proposals carry forward whether marked or not.

| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| `chatgpt-pr-review` sub-agent can over-execute `gh pr merge` itself, skipping `finalisation-coordinator` Steps 9 / 10 / 11 / 12.1 / 12.4 and the project's `--squash --admin --delete-branch` convention. Use an explicit charter line in `chatgpt-pr-review` instructing it to return verdict + summary only and never to invoke `gh pr merge`; finalisation-coordinator owns Step 12. | `agent-instruction: finalisation-coordinator` (also touches the `chatgpt-pr-review` instruction set, but that agent is outside the 6-agent shortlist — surface as a separate `tasks/todo.md` follow-up item instead) | Real defect observed this session: chatgpt-pr-review merged PR #304 using `--merge` instead of the project-standard `--squash --admin --delete-branch`, skipping the MERGE_READY transition, ready-to-merge label CI pass, and the squash-sha patch on main. Recovery required a separate post-merge prep commit on main (this commit). | _pending_ |
| Capability Registration verdicts (§6.2.1 eight-string format) are NOT interchangeable: `yes: create new capability record` ≠ `yes: update existing capability record`. A doc-sync sweep that ratifies the existing 47 backfilled rows can correctly emit `update`, while still missing a newly-created row the build promised. Finalisation-coordinator Step 6 should cross-check the verdict against the Phase 2 handoff's expected verdict (when stated) — if mismatch, halt and require explicit verdict reconciliation. | `agent-instruction: finalisation-coordinator` | Real defect observed this session: chatgpt-pr-review issued `yes: update existing capability record` for the 47 historical backfill rows but missed adding the `dev-lifecycle-governance` row the Phase 2 handoff explicitly named as expected (`yes: create new capability record`). Recovery required appending the row in the post-merge prep commit. | _pending_ |
| Reference-doc verdict tables in finalisation must require BOTH the §6.2.1 verdict AND a diff-evidence cross-check (`git diff origin/main...HEAD -- docs/capabilities.md | grep "^+| <slug>"` for `create`, or a row-level grep for `update`). A verdict stated in prose without diff evidence is not a verdict — it's an assertion. | `hook-or-grep-gate` | Same root cause as the row above; preventive gate rather than coordinator instruction. Grep gate would have failed when the sub-agent claimed `yes: update` against a diff that contained no Asset-Register-cell modifications matching the build slug. | _pending_ |
| Code-only diff exclusions in `chatgpt-pr-review` predictably produce false-positive "missing file" / "stale changelog claim" / "dangling anchor link" findings on PRs whose excluded files (review-logs, plan/spec/progress, KNOWLEDGE.md, tasks/todo.md) are actually in the branch diff. The agent's duplicate-detection / first-round triage should auto-tag such findings with the `false-positive-diff-scope` reason class so the operator sees the artefact at-a-glance. | `agent-instruction: pr-reviewer` (deferred — pr-reviewer is a separate agent with a different charter; better target is `chatgpt-pr-review` itself, but that's outside the 6-agent shortlist) | Observed three times in two consecutive PRs (#305 then #304) — same false-positive class. KNOWLEDGE.md already has the pattern; the value-add here is auto-tagging it at finding-intake so the operator doesn't have to think about it round-by-round. | _pending_ |
