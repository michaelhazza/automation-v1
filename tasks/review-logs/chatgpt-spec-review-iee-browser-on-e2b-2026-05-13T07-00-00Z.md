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

### Round 2 — 2026-05-13T08:00:00Z

**Verdict:** NEEDS_MINOR_TIGHTENING (improvement from CHANGES_REQUESTED → significant progress)
**Findings:** 7 (2 medium, 5 low — no highs)
**Sections amended:** §5 ("only genuinely new pieces" list), §7.1 (llmRequests EXTEND), §7.2 (migration 0345 + new 0347), §7.8 (docs disposition decided), §7.11 (totals updated), §8.4 (admin route body), §10 (heading), §10.3 (partial unique index), §15 (CI acceptance test), §18 (round 2 reconciliation), frontmatter

#### ChatGPT Feedback (raw)

```
A few small things still worth tightening. The round-1 blockers are mostly fixed, and I'd move this from CHANGES_REQUESTED to NEEDS_MINOR_TIGHTENING, not a hard block.

Schema/table count heading still says "two new tables"
Severity: low / Category: style
Brief explanation: §10 still says "Schema details (the two new tables)", but the spec now has three new tables after adding browser_warm_sessions. The inventory totals correctly say 3 new tables, so this is just a stale heading.

"Only genuinely new pieces" list is stale
Severity: low / Category: style
Brief explanation: §5 still says the only new pieces are the template, warm-pool service, two sibling tables, defaults module, and llm_requests.subtype. It now omits browser_warm_sessions, the rollout route, shared type extensions, and CI gate.

llm_requests(warm_session_id) index assumes a column not listed in the schema extension
Severity: medium / Category: bug
Brief explanation: The updated inventory says there is a unique partial index on llm_requests(warm_session_id) WHERE subtype = 'warm_pool', but the listed llmRequests.ts extension only mentions subtype text. Add warm_session_id uuid nullable to the schema extension and migration 0345, or move the uniqueness/idempotency key somewhere else. This is the main remaining implementation-readiness issue.

Rollout approval route says ETag-style conflict but no expected version is in the contract
Severity: medium / Category: improvement
Brief explanation: §13.1 says rollout approval uses an ETag-style settings_version predicate and loser gets HTTP 409, but §8.4 route body only includes { approved: boolean }. Either add expectedSettingsVersion / If-Match, or remove the 409 claim and make the route last-write-wins with audit.

Warm-pool refill "one row at a time" needs the enforcement mechanism
Severity: low / Category: improvement
Brief explanation: The warm-pool contract says refill is triggered "one row at a time per subaccount," but the browser_warm_sessions schema does not define a partial unique guard for status='available', nor an advisory lock, nor a single-flight job key. Add one mechanism so two refill triggers do not create two available warm sessions for the same subaccount.

Profile mount serialization still relies on a referenced external invariant
Severity: low / Category: architecture
Brief explanation: The spec now correctly stops pretending the profile row UPDATE serializes mounts, and instead relies on Spec B's per-volume single-mount invariant. That's acceptable, but because this is load-bearing, the plan should include a named acceptance check that verifies the e2b provider enforces this before profile reuse ships.

Docs disposition still appears as open in §7.8
Severity: low / Category: style
Brief explanation: §17 says the Part 10 disposition is decided: split into docs/iee-on-e2b-rollout.md. §7.8 still says "Rewrite… or split… Disposition decided by operator." Update §7.8 to the decided split path so there's no stale forward reference.

Overall verdict: NEEDS_MINOR_TIGHTENING
The only one I'd definitely fix before handoff is #3, because it is a real schema/index mismatch. #4 is also worth cleaning because ETag semantics tend to rot quickly if the route contract is vague. The rest are polish/self-consistency fixes.
```

#### Recommendations and Decisions

| ID | Title | Severity | Triage | My recommendation | Final decision |
|---|---|---|---|---|---|
| R2-F1 | §10 heading says "two new tables" | low | technical | apply | auto (apply) |
| R2-F2 | §5 "only new pieces" list stale | low | technical | apply | auto (apply) |
| R2-F3 | `llm_requests(warm_session_id)` index assumes missing column | medium | technical | apply | auto (apply) |
| R2-F4 | Rollout route ETag claim but no `expectedSettingsVersion` in body | medium | technical | apply | auto (apply) |
| R2-F5 | Warm-pool refill lacks DB-level enforcement | low | technical | apply | auto (apply) |
| R2-F6 | Profile-mount serialization needs named acceptance check | low | technical | apply | auto (apply) |
| R2-F7 | §7.8 docs disposition stale (still "or split") | low | technical | apply | auto (apply) |

**User approval input:** none required (no high/critical severity findings; all auto-applied per agent rules §3a). Operator reviewed the triage table and confirmed proceed.

#### Actions taken in spec

- R2-F1: §10 heading "the two new tables" → "three new tables — R2-F1 corrected".
- R2-F2: §5 "only genuinely new pieces" list expanded to 10 items (a-j): template, warm-pool service, 3 sibling tables, defaults module, 2 column-extensions on llm_requests, admin route, 2 shared-type extensions, CI gate.
- R2-F3: §7.1 llmRequests.ts EXTEND now lists `subtype` + `warmSessionId` (FK to browser_warm_sessions). New migration 0347 added for the FK + partial unique index (split from 0345 to honour migration ordering — 0346 must create the FK target first).
- R2-F4: §8.4 admin route body gains `expectedSettingsVersion: number`. ETag-style WHERE predicate spelled out; 0 rows → HTTP 409 made consistent with §13.1.
- R2-F5: §10.3 schema adds partial UNIQUE INDEX `browser_warm_sessions(subaccount_id) WHERE status='available'` — DB-level enforcement of "size 1 per enabled subaccount". Two refill triggers cannot both create an `'available'` row for the same subaccount.
- R2-F6: §15 adds a named CI acceptance test (`ieeBrowserProfileManager.serialization.test.ts`) that issues two concurrent runTask calls against the same profile volume and asserts provider-layer serialization. Chunk 5 plan-gate: profile manager doesn't ship until this test passes against the e2b provider.
- R2-F7: §7.8 docs row for `iee-development-spec.md` Part 10 changed from "rewrite-or-split (operator decision)" to "DECIDED — split". New row added for `docs/iee-on-e2b-rollout.md`.
- §7.11 inventory totals refreshed: column extensions 1 → 2 (warm_session_id added), migration pairs 4 → 5 (0347 added), indexes/CHECKs enumerated.
- §18 self-consistency pass extended with round 2 reconciliation block.
- Frontmatter status updated: "rounds 1 + 2 complete — 19 findings applied".

#### Build-readiness verdict after round 2

ChatGPT verdict NEEDS_MINOR_TIGHTENING → all 7 findings tightened. R2-F3 (the only one ChatGPT flagged as "definitely fix before handoff") closed by adding the warm_session_id column + migration 0347. R2-F4 also closed. Spec is build-ready; no remaining mechanical or directional gaps surfaced.

