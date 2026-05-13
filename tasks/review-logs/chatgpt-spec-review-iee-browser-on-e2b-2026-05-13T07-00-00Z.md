# ChatGPT Spec Review — iee-browser-on-e2b

## Session Info

- **Spec under review:** `tasks/builds/iee-browser-on-e2b/spec.md`
- **Spec slug:** `iee-browser-on-e2b`
- **Brief:** `tasks/builds/iee-browser-on-e2b/brief.md` (LOCKED v7)
- **Branch:** `claude/migrate-browser-e2b-snI99`
- **PR:** [#297](https://github.com/michaelhazza/automation-v1/pull/297) (draft)
- **Mode:** manual
- **Human in loop:** yes (default for manual)
- **Started:** 2026-05-13T07:00:00Z
- **Scope class:** Major
- **Resume from:** n/a (fresh session)

## Pre-loop notes

- Phase 1 of three-phase pipeline. Spec accepted by `spec-coordinator` end-of-phase auto-commit (`2be15c04`).
- `spec-reviewer` (Codex) gapped this run: local Codex CLI v0.118 < required v0.125 for default `gpt-5.5` model. No iteration consumed; 5-iter budget remains.
- This session is the directional review pass. If findings emerge that justify spec amendment, they're applied per the agent's standard triage flow (technical auto-applied, user-facing operator-approved).
- After this session: handoff.md and progress.md REVIEW_GAP entries for `chatgpt-spec-review` are removed.

## Rounds

### Round 1 — 2026-05-13T07:00:00Z

**Verdict:** CHANGES_REQUESTED
**Findings:** 12 (4 high-severity, 6 medium, 2 low)
**Spec lines before:** 631 / Spec lines after: ~700 / Sections amended: §7.1, §7.2, §7.7, §7.9b (new), §7.11, §8.4, §8.5, §8.6, §8.7, §9, §10.3 (new), §13.1, §13.3, §13.7, §16, §17, §18, frontmatter

#### ChatGPT Feedback (raw)

```
Warm-pool persistence contract is missing
Severity: high / Category: bug
Brief explanation: The spec defines browserWarmPool.checkout() using an atomic UPDATE ... WHERE status = 'available' RETURNING, but no browser_warm_sessions table, schema file, migration, RLS posture, indexes, lease expiry, or cleanup contract appears in the inventory. This makes the warm-pool implementation under-specified and not build-ready.

Warm-session check-in policy contradicts "tear down after first use"
Severity: medium / Category: bug
Brief explanation: The contract says a healthy warm session under the age threshold is returned to the queue, then immediately says V1 tears down after first use. Those are different lifecycle models. Choose one. If V1 tears down after first use, remove the reusable check-in branch or explicitly mark it V2/dead code.

Launch approval has no auditable in-scope mutation path
Severity: high / Category: architecture
Brief explanation: Dispatch requires both status === 'on' and rolloutApproved === true, but rolloutApproved is not exposed in UI and is described as direct DB/admin-tool/future-route only. That means the build's first-launch gate depends on an out-of-band mutation path with no explicit permission, audit, rollback, or operator workflow. Add a small internal approval path or explicitly document the DB-runbook, audit row, and exact operator action required.

New FailureReason values are missing from the file inventory
Severity: high / Category: bug
Brief explanation: The spec introduces iee_browser_launch_disabled and profile_harvest_failed, but the inventory does not list shared/iee/failureReason.ts or related failure-mapping files as edited. This is a likely build miss because the existing failure vocabulary is referenced as reused, while the spec actually extends it.

Profile mount concurrency guard does not actually serialize mounts
Severity: high / Category: architecture
Brief explanation: The mount contract uses UPDATE ... WHERE status = 'active', but it does not transition to a mounted/leased state. Two concurrent dispatches can both see active unless the provider layer provides a strict lock. The text says "no double-mount" but the table state machine has no mounted, leased, mounting, or active_run_id concept. Either add an explicit profile lease state/table or pin the provider-level single-mount guarantee as a named contract with retry behaviour.

Cost subtype CHECK constraint is too weak
Severity: medium / Category: bug
Brief explanation: The migration constraint only enforces source_type = 'sandbox_compute' OR subtype IS NULL. It does not prevent invalid subtype values when source_type = 'sandbox_compute', and it appears to allow null subtype for sandbox compute rows despite the contract saying rows are discriminated as task or warm_pool. Add a stricter CHECK such as: non-sandbox means subtype IS NULL; sandbox means subtype IN ('task', 'warm_pool').

Warm-pool idle cost attribution is under-specified
Severity: medium / Category: improvement
Brief explanation: The spec says sandboxHarvestService writes cost rows "after every sandbox execution", but warm-pool idle cost is not necessarily tied to a task execution. The producer contract needs to say when idle-time rows are emitted, at warm-session teardown, periodic harvest, check-in, eviction, or task checkout, and how duplicates are prevented.

GET/PATCH permissions are blurred
Severity: medium / Category: improvement
Brief explanation: The RLS checklist names requirePermission('operator_settings.write'), but the route includes both GET and PATCH. GET should have an explicit read permission or an intentional "write implies read" statement. Also, because subaccount_admin is being added to the UI gate, the route-level permission mapping must explicitly confirm that role can write only its own subaccount settings.

Per-day cost alarm idempotency key is not defined
Severity: medium / Category: improvement
Brief explanation: The spec says incidentIngestor is idempotent, but does not define the event key for iee_browser.subaccount_cost_anomaly. Without a key such as (event_name, subaccount_id, dayUTC, ceilingCents) the end-of-day cron can duplicate incidents on retries or reruns.

SandboxRunTaskInput extension may be a hidden interface change
Severity: medium / Category: architecture
Brief explanation: The inventory says SandboxExecutionService.runTask already accepts SandboxRunTaskInput, but the browser fields include templateName, profileMount, and warmSessionCheckoutId. If the existing interface does not already allow provider-specific metadata, this needs an explicit shared type/file edit. Otherwise builders may hide it as any in the provider branch.

DO deletion needs a grep gate
Severity: low / Category: improvement
Brief explanation: The spec says DO code paths are deleted and doc-sync enforces it, but it does not define exact forbidden-token or forbidden-file gates. Add acceptance checks for DigitalOcean, DO, VPS deploy scripts, deleted worker handlers, and old production-target docs, with allowed historical exceptions if needed.

Open implementation path is acceptable but should be quarantined
Severity: low / Category: style
Brief explanation: Leaving the exact e2b provider file path as a Phase 2 lookup is fine, but the file inventory currently names server/services/sandbox/e2bSandbox.ts with "exact path TBD". Add a plan-gate requirement that the first implementation chunk updates the inventory before coding if the path differs, so reviewers do not chase stale paths.

Overall verdict: CHANGES_REQUESTED
The spec is strong and close, but the warm-pool persistence gap, launch-approval path, missing failure enum inventory, and profile mount serialization issue are build-readiness blockers. Fix those before handing this to implementation.
```

#### Recommendations and Decisions

| ID | Title | Severity | Triage | My recommendation | Final decision |
|---|---|---|---|---|---|
| F1 | Warm-pool persistence missing | high | technical-escalated | apply | user-approved apply ("as recommended") |
| F2 | Check-in policy contradicts tear-down | medium | technical | apply | auto (apply) |
| F3 | Launch approval has no auditable path | high | technical-escalated | apply | user-approved apply ("as recommended") |
| F4 | FailureReason values missing from inventory | high | technical-escalated | apply | user-approved apply ("as recommended") |
| F5 | Profile mount concurrency doesn't serialize | high | technical-escalated | apply | user-approved apply ("as recommended") |
| F6 | CHECK constraint too weak | medium | technical | apply | auto (apply) |
| F7 | Warm-pool idle cost attribution under-specified | medium | technical | apply | auto (apply) |
| F8 | GET/PATCH permissions blurred | medium | technical | apply | auto (apply) |
| F9 | Per-day alarm idempotency key undefined | medium | technical | apply | auto (apply) |
| F10 | SandboxRunTaskInput hidden interface change | medium | technical | apply | auto (apply) |
| F11 | DO deletion needs grep gate | low | technical | apply | auto (apply) |
| F12 | Open implementation path should be quarantined | low | technical | apply | auto (apply) |

**User approval input:** "as recommended" — applied to all 4 escalated high-severity findings.

#### Actions taken in spec

- Added 1 new table (`browser_warm_sessions`) — schema in §10.3; migration 0346 in §7.2; state machine in §13.7; RLS entry in §9.
- Tightened `llm_requests.subtype` CHECK constraint in migration 0345 (F6).
- Added `shared/iee/failureReason.ts` EXTEND in §7.1 with two new enum values (F4).
- Added `shared/types/sandbox.ts` EXTEND in §7.1 — `SandboxRunTaskInput` gains optional browser fields (F10).
- Added `server/routes/adminIeeBrowserRollout.ts` NEW in §7.7 (F3 auditable mutation path); documented in §8.4 + §9.
- Added `scripts/gates/verify-no-do-references.sh` NEW in §7.9b (F11 grep gate).
- Reworked §8.5 (warm-session lifecycle): dropped reuse branch; tear-down only in V1; added `evictStale()` (F2).
- Reworked §8.6 producer contract: idle-cost rows emit at teardown only, keyed on `warmSessionId` (F7); tightened CHECK statement.
- Added idempotency keys per event in §8.7 (F9).
- Corrected §13.3 concurrency guard for profile mount: pinned Spec B per-volume invariant as the actual serialiser; dropped misleading row-UPDATE claim (F5).
- Added new idempotency rows in §13.1 for rollout-flip and warm-session idle-cost.
- Added plan-gate note in §17 Q3 (F12).
- Added warm-session reuse to §16 deferred items (V2 amendment scope).
- Updated §7.11 inventory totals: tables 2→3, migrations 3→4, routes 1→2, added shared-types + CI-gate entries.
- Updated §18 self-consistency pass to reflect round 1 reconciliation.
- Updated spec frontmatter status: "chatgpt-spec-review round 1 complete — 12 findings applied".

#### Build-readiness verdict after round 1

All 4 high-severity blockers (F1, F3, F4, F5) addressed. 6 medium and 2 low improvements applied. Spec is build-ready unless round 2 surfaces new gaps.

