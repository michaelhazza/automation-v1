<!-- mission-control
active_spec: tasks/builds/audit-prevention-gates-2026-05-14/spec.md
active_plan: tasks/builds/audit-prevention-gates-2026-05-14/plan.md
build_slug: audit-prevention-gates-2026-05-14
branch: audit-prevention-gates-2026-05-14
status: REVIEWING
last_updated: 2026-05-14
last_merged_pr: #305
last_merged_slug: pre-v1-lockdown-2026-05-14
last_merged_branch: audit/full-pre-v1-lockdown-2026-05-14
last_merged_at: 2026-05-14T07:36:27Z
last_merged_commit: b48b49b9
-->

# Current Focus

Sprint-level pointer for the active session. Update when the current spec, branch, or sprint changes. If no spec is in flight, leave the fields below set to `none`.

The HTML comment block at the top is read by the Mission Control dashboard (`tools/mission-control/`). Keep prose in sync; prose is canonical if they disagree. Status enum: `PLANNING` | `BUILDING` | `REVIEWING` | `MERGE_READY` | `MERGED` | `NONE`.

Per-session progress goes in `tasks/builds/<slug>/progress.md`, not here. Historical merge log lives in git (`git log --merges main`) and in per-build handoff files under `tasks/builds/<slug>/handoff.md`.

---

**Active spec:** `tasks/builds/audit-prevention-gates-2026-05-14/spec.md`
**Active plan:** `tasks/builds/audit-prevention-gates-2026-05-14/plan.md`
**Active build slug:** `audit-prevention-gates-2026-05-14`
**Branch:** `audit-prevention-gates-2026-05-14`
**Status:** **REVIEWING**

**Active build:** Audit Prevention Gates — Phase 2 BUILD complete (HEAD `2bcdb52b`). 12 chunks shipped, 14 CI gates wired (P6 dropped per §B1; covered by pre-existing `verify-no-raw-console.sh`), 4 doc rules landed (P17-P20), 3 KNOWLEDGE patterns appended (P21-P23), ADR-0024 authored. Branch-level review pass complete: spec-conformance CONFORMANT, pr-reviewer APPROVED both rounds (0 Blocking, 8 → 5 Should-fix carried for finalisation surface), reality-checker READY (9/9 criteria), dual-reviewer APPROVED with 3 critical functional fixes (`fc2fb394`). G2 + G3 PASS. Doc-sync gate: 9 yes / 7 n/a / 1 no-with-rationale. Handoff written at `tasks/builds/audit-prevention-gates-2026-05-14/handoff.md`. Open issues for finalisation: 8 should-fix items (per Round 2 review), main drift during build (origin/main advanced 6e5d3a77 → 2802ebc0; Phase 3 S2 will merge), `pg`/`with-org-tx-or-scoped-db` baseline follow-ups, PR# placeholder updates. Next: `launch finalisation`.

**Just merged:** PR #305 — `pre-v1-lockdown-2026-05-14` (squash-commit `b48b49b9`, 2026-05-14T07:36:27Z). Pre-v1 lockdown audit branch under the Light finalisation path (audit-runner pipeline; bypassed Phase 1/2/3 entry guard with operator approval). Pass 2 deliverables: deleted dead `client/src/components/skill-analyzer/` subtree (4,114 LOC, 11 files; superseded by PR #300 consolidation), declared 4 previously-undeclared deps (`express-rate-limit` + `zod-to-json-schema` as static `dependencies`; `docx` + `mammoth` as `optionalDependencies` with dynamic-import fallback), removed two stale `@ts-expect-error` annotations, bumped `docs/codebase-audit-framework.md` v1.3 → v1.4 (§2 Vitest + lint refresh). Pass 3 deferred: 24 symptom items + 24 prevention proposals routed to `tasks/todo.md`; prevention-gates spec at `tasks/builds/audit-prevention-gates-2026-05-14/spec.md` + 820-line plan.md (future Major build). pr-reviewer APPROVED (0 blocking / 1 should-fix on `pg` dep ownership / 3 nit). chatgpt-pr-review 2 rounds, 6 findings all REJECT with code-cited rationale (diff-only reviewer blind spots on deletion-heavy + manifest-only PRs). Doc-sync sweep: `architecture.md` Skill Analyzer section updated (UI-retired callout, 3 deleted-file rows removed from Files table, prose mirror-clause dropped); `docs/codebase-audit-framework.md` footer fixed v1.3 → v1.4. KNOWLEDGE.md +3 patterns from the chatgpt-pr-review loop (manual-mode context-loss between rounds; diff-only reviewer false-positive shapes; audit-branch Light finalisation recovery path). CI: green on first push (no fix-loop iterations).

**Prior merge:** PR #300 — `skill-merge-consolidation-pass` (squash-commit `7fa97612`, 2026-05-14T04:18:03Z). Conditional LLM consolidation pass for the skill analyzer's merge pipeline (migration 0358). Fires only when `validateMergeOutput` emits `SCOPE_EXPANSION` / `SCOPE_EXPANSION_CRITICAL`. New closed enum `consolidationOutcome` (`not_triggered | succeeded | declined | failed`) with `failureReason='not_shortened'` routing non-shortening LLM outputs to `failed` (dual-reviewer ACCEPT). Three informational warning codes (`CONSOLIDATION_APPLIED | DECLINED | FAILED`). chatgpt-pr-review APPROVED after 2 rounds (F4 canonical-JSON deep-equality + regression test applied; 4 findings rejected with code-cited rationale; 1 deferred as `SKILL-MERGE-RATIONALE-1`). CI fix-loop: 1 iteration (migration 0358 down was non-idempotent — `DROP COLUMN` without `IF EXISTS` violated the codebase convention that `*.down.sql` files must survive being applied first by the forward-only migrate runner). KNOWLEDGE.md +3 entries (Stripped-field upstream; Canonicalise JSON before deep-equality; LLM-self-attestation is not the success signal). 9 forward-backlog items routed to tasks/todo.md as `SKILL-MERGE-*`.

**Prior merge:** PR #299 — `personal-assistant-v2-operator` (squash-commit `6cd7e158`, 2026-05-14T00:44:20Z). Personal Assistant V2 (Operator Mode): cross-owner delegation pattern, live file events via R2 + UPSERT-derived version, capability-map V2 axis (`owner_user_id`), three-state owner-lookup privacy projection enforced at both service and route layers with org-scoped fail-closed, atomic claim+emit pattern for cross-owner timeout events with stale-claim TTL retry, DB trigger to auto-bump substep status-transition timestamp. 7 rounds of chatgpt-pr-review (APPROVED on Round 7); 22 findings applied; 4 backlog items routed to tasks/todo.md (PA-V2-LIST-APPROVALS-V1-ARM, PA-V2-WATCHER-HOST-BRIDGE, PA-V2-OPERATOR-TEMPLATE-PROMOTION, PA-V2-EVENT-IDEMPOTENCY). Mid-Phase-3 main-sync renumbered 6 V2 migrations to 0351-0356 (after main's iee-browser-on-e2b PR #297 claimed 0346-0350), plus EA controller-style flip moved 0345 → 0357. CI auto-fix loop closed: 2 iterations (RLS-gate single-line CREATE POLICY + action-registry snapshot refresh; then PDF determinism standalone-date-literal normaliser fix).

**Prior merge:** PR #297 — `iee-browser-on-e2b` (squash-commit `8008abae`, 2026-05-14). IEE browser substrate redirect from DigitalOcean to e2b sandboxes: 3 new tables (session profiles, per-subaccount settings, warm sessions), dispatch seam in `_ieeShared.ts::ieeDispatchBrowser`, profile manager + warm pool service scaffolds (RUNTIME-DISABLED until SDK lands), DigitalOcean retirement + CI gate. chatgpt-pr-review APPROVED after 4 rounds (28 findings closed); 9 deferred items as IEE-DEF-1..9. Phase 3 handoff: `tasks/builds/iee-browser-on-e2b/handoff.md`.

**Paused build:** `support-desk-canonical` on `claude/support-ticket-structure-xMcy8`, PR [#277](https://github.com/michaelhazza/2025-automation/pull/277). Phase 2 (BUILD) complete; handoff at `tasks/builds/support-desk-canonical/handoff.md`. Recover by reverting `current-focus.md` to that build when ready to finalise PR #277.

---

**Pick-next queue:** See `tasks/todo.md` for the durable backlog.

**Prior merges:** see `git log --merges main` or the per-build handoffs under `tasks/builds/<slug>/handoff.md`. The historical merge log that previously lived in this file was trimmed 2026-05-13 (commit on branch `claude/cleanup-todo-knowledge-5ALbK`); content is preserved in git history.
