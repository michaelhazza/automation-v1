# Execution prompt — Support agent routes: route → service refactor

**Status:** Ready to execute. Drop the paste-block below into the first message of a new Claude Code session. The session needs no prior context.

**Pre-condition:** the `feat/audit-prevention-gates-2026-05-14` build has shipped and merged to main. Specifically: gate `scripts/verify-no-db-in-routes.sh` has been tightened per P2 (skips `import type`; refuses new baseline entries without an `ADR-<id>` trailer; baseline entries carry `# expires:` directives), and the new companion `scripts/verify-with-org-tx-or-scoped-db.sh` exists. If those have not shipped, **stop and ship #3 first** — this work depends on the new gate semantics.

---

## Sections

1. The paste-block (copy verbatim into a new session)
2. Why this prompt is shaped this way (meta notes for the operator)
3. Estimated effort

---

## 1. The paste-block

```
Fix the critical Route -> DB layer breach identified in the 2026-05-14 pre-v1 lockdown audit.
Self-contained context follows -- you don't need to look at the audit conversation.

## The finding

`server/routes/support/supportAgentRoutes.ts` (134 LOC, 2 routes) imports the
`canonicalInboxes` schema table object directly and builds Drizzle queries inside
route handlers:

- Line 6:  `import { canonicalInboxes } from '../../db/schema/index.js';`
- Lines 33-46: `GET /api/support/agent/dashboard` -- `db.select({ id, name, agentConfig })
  .from(canonicalInboxes).where(and(eq(canonicalInboxes.organisationId, principal.organisationId),
  eq(canonicalInboxes.isActive, true))).orderBy(canonicalInboxes.createdAt)`
- Lines 73-82: `PATCH /api/support/inboxes/:inboxId/agent-config` reads the existing
  inbox row by id + orgId before merging the patch

Both queries DO go through `getOrgScopedDb` (RLS still applies in defence-in-depth) and
DO manually filter by `principal.organisationId`. The breach is architectural, not a
tenant-isolation leak today -- but the audit framework Rule 10 + architecture.md are
explicit that routes must never touch `db` directly, because the route -> service ->
db cascade is the structural reason "forgetting to scope" becomes mechanically
impossible from routes.

Audit log of record: `tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md`
Originating finding: Pass 1 Findings -> Layer 1 Area 9 finding 1 + Module I finding 1.

## The fix is smaller than the finding suggests

`server/services/supportInboxService.ts` ALREADY EXISTS and already exports the
methods the route needs:

- `listInboxes(...)`        already does what `GET /api/support/agent/dashboard` needs
- `getInbox(...)`           read-by-id helper
- `updateAgentConfig(...)`  already does what `PATCH /api/support/inboxes/:inboxId/agent-config` needs

So this is NOT a "create a service" task. It's "the route is bypassing an existing
service." Investigate the two service methods' signatures FIRST, then decide one
of three design options:

(a) If shapes match exactly -> just modify the route to delegate.
(b) If shapes mismatch slightly -> adjust the service method signature OR add a thin
    service wrapper that produces the route-shaped result. Prefer adjusting the
    service if the new shape is more general; prefer the wrapper if the route needs
    a specific shape only.
(c) If the existing service methods don't cover one of the route's exact behaviours
    (the dashboard's mapping that adds the `draftsPending: 0` / `sentToday: 0` /
    `escalations: 0` / `evalDriftStatus: 'green'` stub fields) -- keep that mapping
    in the route as HTTP-translation, not in the service.

## Task classification

Significant (not Major). Multiple files, design decision (a/b/c above), no new
subsystem. Per CLAUDE.md task table: invoke `architect` first for the design call,
then implement, then full GRADED review posture.

## Steps

1. Branch. Create `feat/extract-support-agent-routes-2026-05-14` off main (or off
   the post-prevention-gates main, which is the same once #3 has merged). Confirm
   `git status` is clean. Confirm both `verify-no-db-in-routes.sh` and the new
   `verify-with-org-tx-or-scoped-db.sh` exist in `scripts/`.

2. Read these files BEFORE designing:
   - `server/routes/support/supportAgentRoutes.ts` (whole file -- only 134 lines)
   - `server/services/supportInboxService.ts` (whole file -- 208 lines; pay
     attention to `listInboxes`, `getInbox`, `updateAgentConfig` signatures + their
     internal query shape)
   - any `server/services/__tests__/supportInbox*` to understand current contract
   - `server/db/schema/canonicalInboxes.ts` (for the `agentConfig` JSONB shape)
   - `architecture.md` section Architecture Rules (the route -> service -> db
     cascade rule)

3. Invoke `architect` with the three options (a/b/c) above plus:
   - Recommend ONE option, with one-line rationale.
   - Identify what types need to move to `shared/types/supportInboxAgentConfig.ts`
     vs. stay in `server/services/`.
   - Decide whether to keep the dashboard's stub fields (`draftsPending: 0`, etc.)
     in the route (HTTP-translation) or move them to a `supportAgentDashboardView`
     service method (recommended default: keep in route -- they're presentation
     defaults, not business logic).
   - Surface any open question to the operator at plan-gate.

4. Operator approves plan, then execute as ONE chunk -- this is small enough that
   subagent-driven-development isn't worth the overhead.

5. Per-chunk verification (G1):
   - `npm run lint`
   - `npm run typecheck` (or `npm run build:server`)
   - `npm run build:client` -- N/A unless a `shared/types/` change cascades to
     client imports
   - Targeted Vitest: write or extend tests at
     `server/services/__tests__/supportInboxService.test.ts` covering the migrated
     code paths. Use the existing test file's pattern.
   - DO NOT run `npm run test:gates`, `scripts/verify-*.sh`, `scripts/gates/*.sh`,
     `scripts/run-all-*.sh`, `npm run test:qa`, `npm test`, or any orchestrator
     locally. CI-only per CLAUDE.md section "Test gates are CI-only".

6. Gate baseline cleanup (this is the audit-of-record closure step):
   - Find the baseline entry for `server/routes/support/supportAgentRoutes.ts`
     in `scripts/.gate-baselines/no-db-in-routes.txt` (or whichever filename
     the prevention-gates build chose).
   - Remove it. After this PR lands, the file should no longer match the gate's
     trigger pattern (the `import { canonicalInboxes }` line is gone).
   - Verify locally only by reading the gate's regex pattern + confirming the
     route file no longer contains a `from '../../db/...'` value import. The
     actual gate run is CI's job.

7. Branch-level review pipeline (per CLAUDE.md GRADED posture for Significant):
   - `spec-conformance`: SKIP -- no spec-driven contract is touched. Write
     `REVIEW_GAP: spec-conformance | task-class: Significant | reason: no
     spec-driven contract touched | operator-override: no | remediation: accept`
     in `tasks/builds/<slug>/progress.md`.
   - `adversarial-reviewer`: INVOKE -- diff matches the security-sensitive
     surface (route handler + org-scoping changes).
   - `pr-reviewer`: mandatory.
   - `reality-checker`: mandatory -- provide it the success criteria from this
     prompt and the evidence (Vitest test run log + lint / typecheck / build
     output).
   - `dual-reviewer`: mandatory if local Codex CLI is available; otherwise write
     `REVIEW_GAP: dual-reviewer | task-class: Significant | reason: codex
     unavailable | operator-override: no | remediation: accept -- covered by
     adversarial-reviewer + pr-reviewer` in `progress.md`.
   - `chatgpt-pr-review`: NOT in Phase 2 scope; finalisation-coordinator handles
     it in Phase 3 only.

## Acceptance criteria

Build is done when ALL of these are true:

- `server/routes/support/supportAgentRoutes.ts` contains no `import` of anything
  under `server/db/schema/` (no value imports; no type imports either -- types
  come from `shared/types/` or from the service's exported types).
- Both routes delegate to `supportInboxService` methods. No
  `db.select / insert / update / delete` calls inside the route handlers.
- `supportInboxService.ts` Vitest tests cover the migrated paths -- happy + at
  least one error path per route.
- The gate `scripts/verify-no-db-in-routes.sh` passes WITHOUT a baseline entry
  for `supportAgentRoutes.ts`. CI validates this on PR open.
- New `scripts/verify-with-org-tx-or-scoped-db.sh` passes for the modified
  service paths. CI validates.
- `pr-reviewer` and `reality-checker` approve. `adversarial-reviewer` raises no
  critical or high (medium/low findings can route to `tasks/todo.md`).
- `dual-reviewer` approves OR a `REVIEW_GAP` is recorded with one-line
  remediation.
- `tasks/builds/extract-support-agent-routes-2026-05-14/progress.md` is current
  through Phase 2 close; `current-focus.md` set to BUILDING then MERGE_READY.
- KNOWLEDGE.md is appended IF AND ONLY IF an unexpected pattern surfaces (e.g.
  the gate's regex doesn't catch the import shape we'd expected). No mandatory
  append.


---

## Out of scope

- DO NOT modify any other route file in this build, even if similar patterns
  exist. Per Rule 7 blast radius control.
- DO NOT modify the gate scripts themselves -- those landed in the
  prevention-gates build. Only modify the baseline file to remove the
  `supportAgentRoutes.ts` entry.
- DO NOT touch `architecture.md`'s "Single org-id source" rule (P17 from
  prevention-gates) -- that's already locked in by the time you start.
- DO NOT also fix `pagePreview.ts` / `pageServing.ts` type-only imports in
  this build. They're a separate Pass-3 item with a different fix shape
  (move row types to `shared/types/page.ts`). Each is its own discrete build.

## Linked artefacts

- Audit log (origin):
  `tasks/review-logs/codebase-audit-log-pre-v1-lockdown-2026-05-14T04-49-08Z.md`
- Prevention-gates spec (predecessor):
  `tasks/builds/audit-prevention-gates-2026-05-14/spec.md`
- Prevention-gates plan:
  `tasks/builds/audit-prevention-gates-2026-05-14/plan.md`
- This prompt:
  `tasks/builds/support-agent-routes-service-extract-2026-05-14/prompt.md`
- Closes the "Route -> DB layer breach" critical row in `tasks/todo.md`
  section "Deferred from codebase audit -- 2026-05-14".

## What to push back on

If the architect's plan-gate output suggests this task is bigger than a single
file change (e.g. proposes splitting the existing `supportInboxService.ts`
into `*Pure.ts` + thin wrapper, or proposes restructuring the supportRoutes
folder), challenge that scope: the audit finding was specifically about the
route's db imports. Anything beyond removing those imports + delegating to
the existing service is scope creep. Surface it to the operator before
executing.
```

---

## 2. Why this prompt is shaped this way

- **Self-contained.** The future session won't have access to the audit conversation. Everything it needs — finding, files, fix shape, success criteria, what to skip, review posture — is in the paste-block above.
- **Headline insight = the existing service.** The audit-log version of the finding called for "extract a `supportAgentInboxService`." Then I checked the codebase and found `supportInboxService.ts` already exports `listInboxes` / `getInbox` / `updateAgentConfig`. The prompt makes that the headline — saves the next session a discovery round.
- **Names options a/b/c.** Architect needs a design decision, not an implementation hand-off. The prompt forces the design choice up front.
- **Explicit on what NOT to do.** Rule 7 blast radius is the most-violated rule in scope-creeping branches.
- **Frames the gate-baseline cleanup as part of the build.** Otherwise the gate stays warning-shaped after the breach is fixed.
- **CI-only test discipline repeated verbatim.** Not a footnote — it's structurally where most agent sessions go wrong.

---

## 3. Estimated effort

Significant class, single chunk, ~30 min implementation + 15 min architect plan + 30 min reviewer loop. Sub-1-hour build for a competent session.
