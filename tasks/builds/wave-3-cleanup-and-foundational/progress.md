# Wave 3 — cleanup + foundational + Wave 1 audit residue (Session E)

**Branch:** `claude/wave-3-cleanup-and-foundational`
**PR:** [#330](https://github.com/michaelhazza/automation-v1/pull/330)
**Class:** Standard (single coordinated PR, no spec-coordinator per launch-prompt)
**Branch tip:** `4bf212e4` (build `0e2433a9` + review-pass fixes `d634b86b` + dual-reviewer log commit `4bf212e4`)

---

## Phase 2 review pipeline — COMPLETE

Per operator shorthand "post dev tasks": spec-conformance → adversarial-reviewer → pr-reviewer → dual-reviewer → chatgpt-pr-review.

### spec-conformance — SKIPPED (policy-not-applicable)

Build has no `spec.md` — driven by `launch-prompt.md` only, per Wave 3 launch instructions ("Single coordinated PR. No spec-coordinator. Standard-class"). Nothing to verify against. No `REVIEW_GAP` written (this is policy-not-applicable per CLAUDE.md trigger taxonomy, not required-but-unavailable).

### adversarial-reviewer — HOLES_FOUND (1 confirmed + 3 likely + 1 worth-confirming)

Log: `tasks/review-logs/adversarial-review-log-wave-3-cleanup-and-foundational-2026-05-16T00-00-00Z.md` (in agent run, file path implied).

- **C1 [CONFIRMED]** — `server/services/skillExecutor/handlers/tasks.ts:357-376` triage-mode read used bare `db` AND omitted `organisationId` predicate (Layer A absent, Layer B bypassed). **Fixed in-PR** (`d634b86b`): switched to `getOrgScopedDb('service:skillExecutor.executeTriageIntake.triage')` + added `eq(tasks.organisationId, context.organisationId)`.
- **L1 [LIKELY]** — `voiceProfileService.ts` raw `db.*` is the only isolation layer (predicates are sole defence). Routed to `tasks/todo.md` "F4 raw-db urgency" (operator action: confirm production behaviour under FORCE RLS, decide whether F4 promotes to hotfix priority).
- **L2 [LIKELY]** — `resolveOrganisationId` exported with JWT-claim fallback widened the attack surface for future pre-`authenticate` callers. **Fixed in-PR** (`d634b86b`): dropped `export` keyword; typecheck confirms no external imports broke.
- **W1 [WORTH-CONFIRMING]** — dual `assertInboxScope` call (route + service) fragile under future refactor. Routed to `tasks/todo.md`.
- **W2 [WORTH-CONFIRMING]** — pre-existing `page.html` rendering surface (not introduced by wave-3). Routed to `tasks/todo.md`.

### pr-reviewer — APPROVED (0 blocking, 3 should-fix, 4 consider)

Log: in-agent. Verdict: 7 targeted brief questions all checked out (resolveOrganisationId precedence, assertInboxScope ordering, voiceProfile predicates, stage5c filter, page.types-check compile-time enforcement, F7 migration safety, verify-rls-protected-tables.sh `|| true` wrap).

- **Should-fix 1** — `prepare.ts:258, 346, 474` guard-ignore comments framed swallow as "transient failure" when reality is raw `db.*` + FORCE RLS = rowCount=0 permanently until F4. **Fixed in-PR** (`d634b86b`): all 3 comments rewritten to honest framing.
- **Should-fix 2** — `voiceProfileService.ts:88, 107, 127` PA-CLEANUP-DEF-1 comments claimed "predicate IS primary defence" when raw db + FORCE RLS on `voice_profiles` (migration 0328) blocks all 3 updates. **Fixed in-PR** (`d634b86b`): all 3 comments rewritten as "predicate is preparatory for F4 migration".
- **Should-fix 3** — Targeted Vitest tests for clampMigrationConcurrency / assertInboxScope / stage5c filter-by-index. **Deferred** to `tasks/todo.md`.
- **Consider items (4)** — KNOWLEDGE.md duplicate pointer, verify-rls-protected-tables.sh comment accuracy nit, UNIVERSAL_SKILL_NAMES dual-source, §8.40 + F4 alignment note. **All deferred** to `tasks/todo.md`.

### dual-reviewer (Codex) — APPROVED (1 iter, zero findings)

Log: `tasks/review-logs/dual-review-log-wave-3-cleanup-and-foundational-2026-05-16T03-32-49Z.md`

Codex independently reviewed both commits (`0e2433a9` + `d634b86b`) and emitted: "No introduced, actionable correctness issues were found in the changed code." Branch advanced to `4bf212e4` (log + hash record auto-committed by dual-reviewer per agent contract).

### chatgpt-pr-review — APPROVED (1 round, 1 false-positive rejected)

Log: `tasks/review-logs/chatgpt-pr-review-wave-3-cleanup-and-foundational-2026-05-16T03-35-09Z.md`

Manual mode (OpenAI API unreachable). Diff sent: `.chatgpt-diffs/pr330-round1-code-diff.diff` (44K, code-only). ChatGPT flagged a single finding:

- **R1-F1** — claimed `recordIncident` was called in `routeCall.ts` without an import. **REJECTED** as false positive: verified the import is present at line 3 (`import { recordIncident } from '../incidentIngestor.js';`), pre-existing, also used at line 877 in another path. The diff hunk simply didn't show the import because it was unchanged. `npm run typecheck` passes, which would have caught a missing import.

Operator confirmed response was complete. Round closed APPROVED. No code edits.

---

## Verification gates

- `npm run lint` — 0 errors, 881 warnings (all pre-existing)
- `npm run typecheck` — 0 new errors (2 pre-existing `docx`/`mammoth` optionalDependencies)
- `npm run build:server` — passes
- Adversarial / pr-reviewer / dual-reviewer / chatgpt-pr-review — all APPROVED

---

## Branch state at pipeline close

- Tip: `4bf212e4`
- Commits ahead of main: 3
  1. `0e2433a9` — wave-3 build (25 files, +433/-150)
  2. `d634b86b` — review-pass fixes (6 files, +88/-17): C1 RLS hole, L2 un-export, 6 comment rewrites, tasks/todo.md deferrals, progress.md
  3. `4bf212e4` — dual-reviewer log + hash record (auto-committed by dual-reviewer)
- PR #330: open, ready for finalisation

## Operator-action items (carried forward to `tasks/todo.md`)

1. **F4 raw-db urgency** — confirm prod db-pool RLS posture before next deploy. If pool runs as non-BYPASSRLS, `voiceProfileService.deriveProfile` is likely throwing 409 on every call in production today. If pool is BYPASSRLS, the layered-defence rewrites need a follow-up to update the comments to acknowledge that path.
2. **3 targeted Vitest tests** (~45 LOC total) — clampMigrationConcurrency, assertInboxScope, stage5c filter-by-index. Lock the new invariants from regressing.
3. **Mechanical-batch carry-over** — UNIVERSAL_SKILL_NAMES dual-source consolidation (launch-prompt line 323, deferred from wave-3).
4. **Minor** — KNOWLEDGE.md duplicate pointer, verify-rls-protected-tables.sh comment accuracy nit, W1 dual-assertInboxScope fragility, W2 pre-existing page.html surface audit.

## Next step

Launch finalisation (`launch finalisation` or fresh session for `finalisation-coordinator`) to run S2 branch-sync, G4 regression guard, doc-sync sweep, KNOWLEDGE.md pattern extraction, current-focus → MERGE_READY, ready-to-merge label.

---

## Phase 3 — LEARNING_FEEDBACK_PROPOSAL

Per finalisation-coordinator Step 7a. Operator marks decisions inline (`approved` / `rejected` / `deferred`). Approved entries become `tasks/todo.md` items handled as separate (often Trivial) PRs. **No auto-apply in v1.**

| Pattern | Target | Rationale | Operator decision |
|---|---|---|---|
| [2026-05-16] Idempotency keys with time-bucketed defaults trade rare-collision risk for common-case safety (F8 audit) | `no-further-action` | Already documented in route comment (`server/routes/agentRuns.ts:53-65`) AND in KNOWLEDGE.md. Project-specific route-design pattern, not framework-wide. No agent / gate / template needs to learn it; the in-source comment + KNOWLEDGE entry are the durable home. | pending |
| [2026-05-16] FK-scoped tenant tables must carry explicit RLS even when the parent does (WF1 audit) — gate-discovery gap | `hook-or-grep-gate` | Pattern surfaces a discovery hole: `verify-rls-protected-tables.sh` only inspects tables with a literal `organisation_id` column — FK-only tables slip through. Widening the gate (walk schema files, identify FK-to-tenant-parent tables, require CREATE POLICY or allowlist entry) prevents the next 5 FK-only tables from shipping without RLS. Separate Trivial PR. | pending |
| [2026-05-16] RLS migrations cannot ship before raw-db consumers migrate (PR #329 trap) | `agent-instruction` (target: `pr-reviewer`) | Bundle-constraint rule. When pr-reviewer sees a `FORCE ROW LEVEL SECURITY` migration in the diff, it must search for raw-db consumers in `server/services/**` against the same table and flag any that lack `getOrgScopedDb` migration in the same PR. Catches the PR #329 class of trap pre-merge. | pending |

**Operator triage:** mark decisions inline above (replace `pending` with `approved` / `rejected` / `deferred`). Approved entries route to `tasks/todo.md` post-merge under heading `### compound-learning: <pattern-title> (wave-3-cleanup-and-foundational)`.
