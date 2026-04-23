# ChatGPT PR Review Session — implementation-plan-Y622C — 2026-04-23T12-30-00Z

## Session Info
- Branch: claude/implementation-plan-Y622C
- PR: #183 — https://github.com/michaelhazza/automation-v1/pull/183
- Started: 2026-04-23T12:30:00Z

---

## Round 1 — 2026-04-23T12-30-00Z

### ChatGPT Feedback (raw)

Executive summary

This is a serious, production-grade PR with strong architectural alignment. You've clearly moved past "feature build" into system design with invariants. The cached context layer, snapshotting model, and budget-gated execution are all directionally correct and defensible long-term.

That said, there are 3 real risks that matter and a handful of smaller sharp edges. None are blockers, but a couple are worth tightening before merge to avoid expensive refactors later.

What's strong (and worth locking in)
1. Snapshot model is correctly designed — Immutable bundle_resolution_snapshots, prefix hash as dedup key, versioned documents with hash guarantees. No changes needed.
2. Budget-aware execution with HITL gate is excellent — cached_context_budget_breach action is clean.
3. Separation of concerns is mostly clean — budget → resolution → assembly → routing → execution. Pure vs non-pure services are consistently used.
4. RLS repair migration is the right move — correct session var (app.organisation_id), FORCE RLS added, fail-closed guards added.

The real issues (focus here)

1. You've quietly downgraded subaccount isolation to the service layer
   - DB enforces organisation isolation; app enforces subaccount isolation.
   - Risk: trust in service correctness, inconsistency with "fail-closed at DB layer" philosophy.
   - Recommendation: Option A — reinstate subaccount RLS once session context is guaranteed everywhere. Option B — keep service-layer filtering but add a lint/test guard ensuring all queries include subaccount scoping, and document as temporary.

2. Missing concurrency story for bundle mutation vs snapshotting
   - Bundle versioning and snapshot dedup exist, but no explicit guarantee that a bundle changing mid-resolution is handled.
   - Recommendation: ensure snapshot captures bundle_version at start, OR run resolution inside repeatable-read / serializable transaction.

3. No explicit cache invalidation / lifecycle strategy
   - Snapshots retained indefinitely (v1). No TTL/eviction/storage-growth control.
   - Recommendation: at minimum, define Phase 2/3 retention policy and snapshot-reuse metrics.

Medium issues

4. Spec vs migration inconsistency — app.current_organisation_id remnants in earlier migrations; add hard rule or lint.
5. Polymorphic attachment table is service-enforced only — subject_type + subject_id have no FK; add runtime validator or integrity job.
6. Token budgeting is strong but missing graceful-degradation path — automatic fallback strategies (trim, model downgrade) deferred.

Final verdict: merge with awareness. Pre-merge checks:
- Explicitly document subaccount isolation decision
- Confirm snapshot consistency guarantee (version pinning or transaction isolation)

### Recommendations and Decisions

| # | Finding | Recommendation | User Decision | Severity | Rationale |
|---|---------|----------------|---------------|----------|-----------|
| 1 | Downgrade of subaccount isolation from DB-RLS to service-layer — document the decision and/or guard against future leakage | defer | defer (Option B-lite doc only) | high | Architectural decision has wide blast radius; the right immediate move is a spec paragraph, not a new lint or RLS rewrite in this PR |
| 2 | No explicit concurrency guarantee for bundle mutation vs snapshotting | reject | reject | high | Spec §4.2 already pins `bundle_version` at snapshot creation and the snapshot is prefix-hashed — the hash functionally acts as the version pin; adding transaction isolation is speculative complexity without a demonstrated failure mode |
| 3 | No snapshot retention / lifecycle strategy defined | reject | reject | medium | Phase 2/3 explicitly deferred in spec; v1 posture is "retain indefinitely" with volume monitoring — adding retention now is premature |
| 4 | Spec/migration inconsistency: `app.current_organisation_id` remnants; add lint or explicit ban | implement | implement | medium | Low-cost, high-durability win — phantom session var silently disables RLS; a CI guard + architecture.md canon note prevents regression |
| 5 | Polymorphic attachment (`subject_type` + `subject_id`) lacks FK — service-enforced only | reject | reject | medium | Polymorphic attachments by definition can't have a single FK target; integrity job is speculative complexity — service layer is the documented contract |
| 6 | Token budgeting lacks graceful-degradation fallback (auto-trim, auto-downgrade) | reject | reject | low | HITL `cached_context_budget_breach` is the intentional contract — auto-fallback conflicts with the "human decides when budget breached" design |

### Implemented (user-approved)

**Item 4 — `app.current_organisation_id` ban + canon documentation:**

- Added new guard script `scripts/verify-rls-session-var-canon.sh` — bans `current_setting('app.current_organisation_id', ...)` in any migration `.sql` or server `.ts` file. Finds 10 pre-existing matches in superseded migrations 0202–0208/0212 (all repaired by migration 0213); baseline set to 10 in `scripts/guard-baselines.json` so CI passes on the current state but catches any regression.
- Registered the new gate in `scripts/run-all-gates.sh` alongside `verify-rls-coverage.sh` and `verify-rls-contract-compliance.sh`.
- Added a new "Canonical RLS session variables (hard rule)" subsection to `architecture.md` Layer 1 RLS section: lists the five canonical session vars (`app.organisation_id`, `app.current_subaccount_id`, `app.current_principal_type`, `app.current_principal_id`, `app.current_team_ids`) with their setters, explicitly bans `app.current_organisation_id`, explains the "silently disables RLS" failure mode, references the naming-asymmetry decision in the canonical-data-platform roadmap, and links migration 0213 as the canonical repair pattern. Listed `verify-rls-session-var-canon.sh` in the CI gates list.

**Item 1 — deferred to `tasks/todo.md`:**

- Added `## Deferred from chatgpt-pr-review — PR #183 (2026-04-23)` section with a single item: "Subaccount isolation decision — document Option B-lite posture" — instructs a future session to restate the 0213 subaccount-RLS-drop decision as a first-class architectural decision inside `docs/cached-context-infrastructure-spec.md` §RLS.

Items 2, 3, 5, 6: rejected per user decision — no code changes, no backlog entries.

---

## Final Summary

- Rounds: 1
- Implemented: 1 (item 4) | Rejected: 4 (items 2, 3, 5, 6) | Deferred: 1 (item 1)
- Index write failures: 0
- Deferred to `tasks/todo.md` § Deferred from chatgpt-pr-review — PR #183:
  - Subaccount isolation decision — document "Option B-lite" posture — spec update, narrow scope
- Architectural items surfaced to screen (user decisions):
  - Subaccount isolation downgrade (item 1) → defer as spec doc update
  - Concurrency guarantee for bundle snapshotting (item 2) → reject (spec already pins via prefix hash + bundle_version)
  - Snapshot retention / lifecycle (item 3) → reject (Phase 2/3 deferred)
  - Polymorphic attachment FK (item 5) → reject (intentional polymorphism contract)
  - Token budget graceful degradation (item 6) → reject (HITL-by-design)
- KNOWLEDGE.md updated: no (no systematic gap spanning multiple rounds — single-round review)
- architecture.md updated: yes — added "Canonical RLS session variables (hard rule)" subsection and new CI gate line
- PR: #183 — ready to merge at https://github.com/michaelhazza/automation-v1/pull/183

### Top themes
- naming (canonical session variable namespace enforcement)
- architecture (subaccount isolation posture documentation)

### Consistency Warnings
None — single-round session.
