# ChatGPT PR Review — Riley Observations Wave 1

**PR:** https://github.com/michaelhazza/automation-v1/pull/186
**Branch:** `claude/start-riley-architect-pipeline-7ElHp`
**Reviewer:** ChatGPT (manual paste)
**Captured:** 2026-04-24T10:25:11Z
**Verdict from reviewer:** Approve with minor fixes (no blockers)

---

## Round 1 — Findings + triage

### Must-fix

#### F1. Heuristic provider extraction in EventRow.tsx — TECHNICAL · ACCEPT

**Reviewer:**
> `const providerMatch = p.resultSummary.match(/The (\w+) connection/i);`
> Brittle: breaks on localisation, wording changes, non-standard messages. Add structured payload fields: `{ errorCode: 'connection_not_configured', provider: 'mailchimp' }`. UI should never parse human strings.

**Triage:** TECHNICAL · ACCEPT
**Rationale:** The reviewer is correct. The `skill.completed` payload in `shared/types/agentExecutionLog.ts` only carries generic fields. Extend the union member with optional automation-specific structured fields and have the UI prefer them.
**Fix:** Add optional `errorCode?: string`, `provider?: string`, `connectionKey?: string` to the `skill.completed` payload in `shared/types/agentExecutionLog.ts`. Refactor `EventRow.tsx` to read structured fields, fall back to regex only as a transitional safety net (logged as deprecated).

---

#### F2. Skill slug detection is loose — TECHNICAL · ACCEPT

**Reviewer:**
> `p.skillSlug === 'invoke_automation' || p.skillSlug.startsWith('automation.') || p.skillSlug.startsWith('invoke_automation.')`
> Will drift over time. Use a canonical enum: `isAutomationInvocation: true` or `skillType: 'automation'`. Avoid prefix-based inference.

**Triage:** TECHNICAL · ACCEPT
**Rationale:** Same root cause as F1 — UI is inferring kind from string shape. Add a discriminator field.
**Fix:** Add optional `skillType?: 'automation' | 'agent_decision' | 'action_call' | 'other'` to the `skill.completed` payload. UI checks the structured field first; falls back to slug shape only as a transitional bridge.

---

#### F3. Retry semantics not defined (idempotency risk) — USER-FACING · ESCALATE

**Reviewer:**
> UI exposes "Retry step" but unclear: idempotent? new execution? reuses prior inputs? side effects already occurred? Minimum: retry must either be idempotent OR require explicit confirmation if non-idempotent.

**Triage:** USER-FACING · ESCALATE TO USER
**Rationale:** The backend dispatcher already enforces idempotency contract (`shouldBlock_nonIdempotentGuard` blocks attempt 2+ on non-idempotent automations unless `overrideNonIdempotentGuard` is set). The gap is the **UI doesn't surface that contract**. The fix could be:
- (a) Always show a confirmation prompt before retry on non-idempotent automations ("This automation may have already taken effect. Retry anyway?")
- (b) Disable the Retry button entirely for non-idempotent automations and instead show "Cannot auto-retry — start a new run"
- (c) Pass `idempotent` flag through and let the parent's `onRetryStep` handler decide

This changes user-visible behaviour. Defer to user.

---

### Should-fix

#### F4. Setup connection flow under-specified — TECHNICAL · ACCEPT

**Reviewer:**
> `onSetupConnection(provider, event)` only passes provider. Missing: required scopes, account type, environment (org vs subaccount). Pass structured: `{ provider, requiredConnectionType, missingScopes }`.

**Triage:** TECHNICAL · ACCEPT
**Rationale:** Aligned with F1/F2 — extend the structured payload, change the callback signature.
**Fix:** Change `onSetupConnection` callback signature to accept `{ provider, connectionKey, requiredScopes? }`. Extend the `automation_missing_connection` payload in the dispatcher to include `connectionKey` (we already compute it).

---

#### F5. Migration duplicates — TECHNICAL · REJECT

**Reviewer:**
> Duplicated migration filenames (e.g. 0219, 0220, 0221, 0222 appearing twice).

**Triage:** TECHNICAL · REJECT
**Rationale:** Reviewer misread the file list. The "duplicates" are paired up/down migrations:
- `migrations/0219_*.sql` (up)
- `migrations/_down/0219_*.sql` (down — paired reversibility)

This is the project convention across all 222 migrations. No actual duplicates exist. Verified: `ls migrations/_down/0222*` returns one file; `ls migrations/0222*` returns one file. Migration history is strictly linear.

---

#### F6. Terminology drift in schema layer — TECHNICAL · ACCEPT (partial)

**Reviewer:**
> `playbookRuns.ts` still exists alongside new terminology. Mixed usage across services.

**Triage:** TECHNICAL · ACCEPT (partial — reviewer factually wrong on `playbookRuns.ts` but correct on broader concern)
**Rationale:** Verified:
- `playbookRuns.ts` — does **NOT** exist (was renamed to `workflowRuns.ts` in M3 — reviewer wrong)
- `server/playbooks/` — empty directory (only `.gitkeep`) — vestigial
- `server/agents/playbook-author/` — directory name still legacy; `master-prompt.md` content already updated to "Workflow Author"
- `server/lib/workflow/__tests__/playbook.test.ts` — file content updated, filename still legacy

**Fix:**
1. Delete `server/playbooks/.gitkeep` and the now-empty directory.
2. Rename `server/agents/playbook-author/` → `server/agents/workflow-author/`. Update any references (seed.ts, etc.).
3. Rename `playbook.test.ts` → `workflow.test.ts`. Update `playbooks:test` script in package.json.

---

#### F7. UI logic embedded in component (EventRow) — TECHNICAL · ACCEPT

**Reviewer:**
> Component parses payload, detects automation failure, extracts provider. Should live in a presentation mapper layer. `const viewModel = mapEventToViewModel(event)` then UI is purely declarative.

**Triage:** TECHNICAL · ACCEPT
**Rationale:** Aligned with project convention — pure-function siblings (`*Pure.ts`) hold logic; UI consumes the resulting view model.
**Fix:** Extract the `skill.completed` → `InvokeAutomationFailedRow` mapping into a sibling pure module (`eventRowPure.ts` or similar), with its own unit tests.

---

## Round 1 — Decisions matrix

| # | Triage | Decision | Action |
|---|---|---|---|
| F1 | technical | accept | Add structured payload fields, refactor EventRow |
| F2 | technical | accept | Same as F1 (add `skillType`) |
| F3 | user-facing | escalate | Present 3 options to user |
| F4 | technical | accept | Extend payload + callback signature |
| F5 | technical | reject | Reviewer misread; convention documented |
| F6 | technical | accept | Clean up 3 vestigial names |
| F7 | technical | accept | Extract pure mapper |

5 technical fixes auto-applied; 1 user-facing escalated; 1 technical rejected with rationale.

---

## Round 2 — Findings + triage

**Reviewer verdict:** Approve. No blockers. Tightening recommendations only.
**Captured:** 2026-04-24T10:40:49Z

### R2-1. Transitional fallbacks need a kill switch — TECHNICAL · ACCEPT

**Reviewer:**
> Without enforcement, fallbacks become permanent and new emitters may accidentally rely on them. Add a metric/log when fallback is used, optional feature flag to disable later.

**Triage:** TECHNICAL · ACCEPT
**Rationale:** Currently no emitter populates the structured fields, so the runtime path is *always* fallback — exactly the silent-regression risk the reviewer is flagging. A `console.warn` with a stable code (`event_row_legacy_provider_detection_used`, `event_row_legacy_skill_slug_detection_used`) lets ops grep for it and notice when emitters haven't migrated.
**Fix:** Add warning logs in `eventRowPure.ts` when the fallback paths are taken. Stable code in the warn payload.

---

### R2-2. `server/lib/playbooks/.gitkeep` ghost directory — TECHNICAL · REJECT

**Reviewer:**
> server/lib/playbooks/.gitkeep is a lingering artifact. Delete it.

**Triage:** TECHNICAL · REJECT
**Rationale:** Verified — the file does **NOT** exist:
- `ls server/lib/playbooks/` → "No such file or directory"
- `find . -name '.gitkeep'` → zero results

Reviewer is reading the GitHub PR diff view, which shows the *deleted* state of `server/playbooks/.gitkeep` (renamed in F6 round 1). GitHub's rename detection presents both the old name (deleted) and new name (added) which can read as "still present."

---

### R2-3. `playbookRuns.ts` and `processes.ts` still exist — TECHNICAL · REJECT

**Reviewer:**
> Still seeing playbookRuns.ts, processes.ts alongside automations, workflows. Define a deprecated rule or alias clearly.

**Triage:** TECHNICAL · REJECT
**Rationale:** Verified — neither file exists. `find server -name "playbook*" -o -name "processes.ts"` returns zero results. M2 renamed `processes.ts` → `automations.ts`; M3 renamed `playbookRuns.ts` → `workflowRuns.ts`. Same root cause as R2-2 — reviewer reading GitHub PR diff.

---

### R2-4. Tighten event payload typing — TECHNICAL · ACCEPT

**Reviewer:**
> Move toward a discriminated `AutomationSkillCompletedPayload` type with required `skillType: 'automation'`. Then validate at emit time, reduce defensive logic in mappers.

**Triage:** TECHNICAL · ACCEPT (additive — does not break the existing flexible type)
**Rationale:** The current `skill.completed` union member uses `skillType?: 'automation' | ...` (optional). Add a stricter `AutomationSkillCompletedPayload` helper type for the dispatcher to use when emitting — keeps the union flexible for legacy emitters but gives new code a strict contract.
**Fix:** Export a stricter `AutomationSkillCompletedPayload` type from `shared/types/agentExecutionLog.ts`. Add a builder helper `buildAutomationSkillCompletedPayload()` that takes the strict shape. New emitters use the helper; old ones can migrate over time.

---

### R2-5. ConfirmDialog not enforced at service layer — DEFER

**Reviewer:**
> UI enforces retry confirmation but nothing stops API call directly or programmatic trigger. Server-side guard for non-idempotent retries, or audit logging.

**Triage:** ARCHITECTURAL · DEFER (correctly out of scope for this PR)
**Rationale:** The dispatcher's existing `shouldBlock_nonIdempotentGuard` only fires on attempt 2+ within a single dispatch invocation. A separate "Retry step" endpoint (not yet built — the UI button just calls a callback prop) would look like attempt-1 of a fresh dispatch and bypass the guard. The right fix design is part of building that endpoint, not a surgical add now. Route to `tasks/todo.md` so the future endpoint design includes:
- Server-side guard: `attempt > 1 OR retried_via_user_action` flag → respect non-idempotent block
- Audit log entry for every retry, capturing actor + idempotent-flag-at-time-of-retry
- Optional: explicit `force: true` query param the UI sets when the user has already confirmed

---

## Round 2 — Decisions matrix

| # | Triage | Decision | Action |
|---|---|---|---|
| R2-1 | technical | accept | Add fallback warning logs |
| R2-2 | technical | reject | File doesn't exist (verified) |
| R2-3 | technical | reject | Files don't exist (verified) |
| R2-4 | technical | accept | Add stricter `AutomationSkillCompletedPayload` helper type |
| R2-5 | architectural | defer | Route to tasks/todo.md for retry-endpoint design |

2 technical fixes auto-applied; 2 technical rejected (factually wrong); 1 architectural deferred.
