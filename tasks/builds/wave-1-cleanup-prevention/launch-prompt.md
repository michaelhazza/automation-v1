# Wave 1 Env D — paste prompt

This build is intentionally light-pipeline (no spec-coordinator, no feature-coordinator). It's a single coordinated PR covering ~30 mechanical doc / gate / package.json edits.

**Paste the block below as the opening message of a fresh Claude Code session in Env D.**

---

```
Wave 1 Env D — pre-v1 lockdown prevention + cleanup batch (Standard task).

Context. Three sibling Wave 1 specs are in flight in other dev environments
(Env A split-workflow-engine, Env B split-skill-analyzer, Env C
fix-route-db-support-agent). This is the lighter, mechanical cleanup batch
that ships ~30 prevention proposals and doc rules deferred from prior audits.
Single coordinated PR. No spec-coordinator chain — read the items below and
implement them directly.

1. Sync and branch:
     git fetch origin main
     git checkout -b claude/wave-1-cleanup-prevention origin/main

2. Items to apply (read each item's source line in tasks/todo.md for full
   context — the line numbers are approximate, the [origin:audit:prevention:*]
   tag is the canonical anchor):

   PACKAGE.JSON (2 items):
   - Add "pg": "^8.18.0" to optionalDependencies in package.json
     (matches the docx/mammoth precedent from PR #305 for dynamic-import
     patterns). Closes: pre-v1 lockdown "Missing dep pg" item.
   - Move @playwright/test from "dependencies" to "devDependencies".
     Closes: pre-v1 lockdown "@playwright/test listed as production dep".

   GATE BASELINE EXTENSION (1 item):
   - Extend scripts/.gate-baselines/with-org-tx-or-scoped-db.txt to cover
     ALL files under server/services/, server/jobs/, server/lib/, server/adapters/.
     Initial seed only covered A-B services. Each new entry is a CURRENT
     baseline (not a new violation) — only add files that currently exist
     and currently lack the org-tx/scoped-db pattern. Verify by running
     scripts/verify-with-org-tx-or-scoped-db.sh after seeding; it must
     pass. Closes: pre-v1 lockdown P15.

   GATE WARNING→ERROR PROMOTIONS (14 items):
   - Flip DEFAULT_EXIT_CODE from 2 (warning) to 1 (error) in each of the
     following scripts. They were seeded 7+ days ago via PR #307; the
     soak period has passed:
       scripts/verify-universal-skill-sync.sh
       scripts/verify-framework-context-block.sh
       scripts/verify-types-used.sh
       scripts/verify-canonical-retry.sh
       scripts/verify-any-budget.sh
       scripts/verify-marker-budget.sh
       scripts/verify-no-new-cycles.sh
       scripts/verify-duplicate-blocks.sh
       scripts/verify-knip-config.sh
       scripts/verify-with-org-tx-or-scoped-db.sh  (promote AFTER baseline extension above)
       scripts/verify-no-orphan-react-component.sh
       scripts/verify-no-missing-deps.sh
       scripts/verify-loc-cap.sh
       scripts/verify-frontend-design-budget.sh
     Verify each by running the script post-flip — it must exit non-zero
     only if a NEW violation is introduced; baseline entries must still
     pass. If ANY gate fails on current main with no new violations,
     that gate's seeding was wrong — leave it as warning and surface the
     finding back to the operator.

   NEW GATES TO AUTHOR (4 items):
   - scripts/verify-fk-only-tenant-tables.sh (Q2 from Track A2): scans
     migrations/* for CREATE TABLE statements that reference a parent
     table via FK but have no organisation_id column, and flags any
     such table missing an RLS policy. Adopt the seeded-baseline pattern
     used by other recent gates. Closes: Track A2 Q2.
   - scripts/verify-agents-view-in-workflow-routes.sh (Q6 from Track A2):
     flags any handler in server/routes/workflows* or server/routes/workflowRuns*
     that gates on AGENTS_VIEW. After Env A lands and migrates routes
     to WORKFLOW_RUNS_VIEW, this gate should pass with empty baseline.
     Closes: Track A2 Q6.
   - scripts/verify-no-direct-boss-work.sh (R1 from Track A3): flags
     `boss.work(...)` calls outside server/lib/workers/createWorker.ts
     (or whatever the canonical createWorker location is — confirm via
     grep). Seed with current baseline (4 occurrences in server/index.ts
     minus the one Env B will fix). Closes: Track A3 R1.
   - scripts/verify-org-id-source.sh tightening (P1 from Track A): one-line
     change to refuse new baseline entries (the dual-source pattern
     req.user.organisationId vs req.orgId is documented as the canonical
     middleware-provided req.orgId). Closes: Track A P1.

   DOC ADDITIONS (10 items — all append-only):
   - architecture.md: add a "Single org-id source" subsection under the
     auth/permissions area documenting req.orgId as canonical and
     req.user.organisationId as the legacy/raw source. (Track A P5,
     update post-PR #314 split posture for agentExecutionService.)
   - architecture.md: add "FK-scoped RLS pattern" subsection under the
     RLS area with the parent-EXISTS template used in Env A WF1 and
     Env B SA1 migrations. Reference both migrations once they land.
     (Track A2 Q3)
   - architecture.md: add "Canonical worker registration" subsection
     under the queues area documenting createWorker as the only allowed
     boss.work caller. (Track A3 R2)
   - DEVELOPMENT_GUIDELINES.md: add a §8 rule "Tick workers MUST resolve
     a real org context from the run row before opening DB transactions
     — resolveOrgContext: () => null is forbidden". (Track A2 Q4)
   - DEVELOPMENT_GUIDELINES.md: add a §8 rule "Routes never import from
     server/db/schema/**" with the supportAgentRoutes precedent and a
     pointer to verify-no-db-in-routes.sh. (Track A P4)
   - KNOWLEDGE.md: append pattern "FK-scoped tenant data needs RLS via
     parent-EXISTS — direct organisation_id column is the cheaper path
     when available". Closes Track A2 Q5.
   - KNOWLEDGE.md: append pattern "Split commit can leave a second
     god-file untouched — the Pure file can end up larger than its
     impure shell after extraction". Closes Track A3 R4.
   - KNOWLEDGE.md: append pattern "URL paths diverge from internal
     naming over time (UK vs US spelling, etc.) — flag during reviews
     but rename via deprecation cycle". Closes Track A3 R6.
   - KNOWLEDGE.md: append pattern "Audit log file references stale fast
     after splits — verify line numbers post-PR before classifying as
     a regression". Captures one of the NEEDS-DISCUSSION cases from
     the triage.
   - docs/codebase-audit-framework.md: extend Area 10 caps to include
     server/jobs/* (soft cap 1,500; hard cap 2,500 — matches services).
     Closes Track A3 R5.

3. Verification per item:
   - Each gate flip: run the gate script after the change; confirm
     it exits 0 against current main (baseline holds).
   - Each new gate authored: include a `--help` flag, document the
     intent in the script header, and run it once with `--list-baseline`
     to make sure the baseline file is properly seeded.
   - Each doc addition: minimal — make sure markdown parses (no broken
     tables, no unclosed code fences). The long-doc-guard hook will
     block oversized writes; use Edit append, not full-file Write.
   - package.json changes: `npm install` exits 0 after the change.

4. Final checks:
   - npm run lint
   - npm run build:server
   - npm run build:client
   - The new gates exit 0 (their baselines accept current main).
   - The flipped gates exit 0 (current main respects their baselines).

5. PR shape:
   - Single PR titled "wave-1: prevention + cleanup batch (Env D)".
   - Body lists every closed tasks/todo.md item with its origin tag.
   - Body explicitly notes which items belong to which prior audit
     (pre-v1 lockdown, Track A, Track A2, Track A3) for traceability.
   - DO NOT close items via PR body keywords — the operator updates
     tasks/todo.md status fields in a follow-up commit on this branch
     before merge.

6. On completion, run pr-reviewer against the branch. Apply any
   blocker/strong-recommendation findings. Open the PR. Stop and
   wait for operator review.

DO NOT implement anything outside the items listed above. If a
finding looks adjacent or related but isn't in this list, leave it
for post-v1 backlog or wait for the operator to expand scope.
```

---

## Source items in `tasks/todo.md`

For traceability, each item maps to a line in `tasks/todo.md`. The Env D session reads `tasks/todo.md` to confirm exact wording, but the canonical anchors are the `[origin:audit:prevention:*]` tags.

**Pre-v1 lockdown prevention proposals (open):** lines 374-389
**Track A prevention proposals (open):** lines 1570-1575
**Track A2 prevention proposals (open):** lines 1596-1601
**Track A3 prevention proposals (open):** lines 1620-1625

The Env D session will reference these anchors when writing the PR body for traceability.
