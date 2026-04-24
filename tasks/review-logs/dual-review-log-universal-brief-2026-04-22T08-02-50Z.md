# Dual Review Log — universal-brief

**Files reviewed:** Uncommitted + committed diff on branch `claude/implement-universal-brief-qJzP8` vs `main`. 21 modified tracked files + 2 new migrations. Spans `migrations/` (0194, 0195 edited; 0200, 0201 new), `server/routes/` (briefs, rules, conversations), `server/services/` (briefCreationService, briefConversationService, briefConversationWriter, ruleLibraryService, fastPathDecisionLogger, memoryEntryQualityService, memoryBlockRetrievalServicePure, chatTriageClassifier), `server/config/rlsProtectedTables.ts`, `server/lib/permissions.ts`, `client/src/pages/` (BriefDetailPage, LearnedRulesPage), `client/src/components/` (AgentRunChatPane, TaskChatPane, RuleCaptureDialog, ApprovalSuggestionPanel + a test).

**Iterations run:** 3/3
**Timestamp:** 2026-04-22T08:02:50Z (start) -> 2026-04-22T~08:35Z (end)
**Review mode:** `codex review --base main` (non-interactive, 540s budget per iteration)

---

## Iteration 1

Codex flagged 5 findings: 3x P1, 2x P2.

```
[ACCEPT] client/src/components/task-chat/TaskChatPane.tsx:57-61 — Chat pane appends undefined on send.
  Reason: Verified POST /api/conversations/:conversationId/messages returns
  { messageId, artefactsAccepted, artefactsRejected } — not { message: ChatMessage }.
  Current code pushes undefined into the messages array, guaranteeing a crash on
  the next render when it reads m.role / msg.id. Same bug duplicated in
  AgentRunChatPane.tsx:63-64. Fix: drop the attempt to append a non-existent
  assistant reply (the write endpoint confirms persistence but emits no reply;
  assistant turns arrive later via websocket). Keep the optimistic user-message
  append and update its id from tempId -> serverId so later ws / refetch merges
  dedupe correctly.

[ACCEPT] client/src/components/rules/RuleCaptureDialog.tsx:33-38 — Scope silent-broadening.
  Reason: The dropdown offers 'Entire organisation' / 'This client' / 'Specific
  agent', but the save logic falls back to { kind: 'org' } whenever the selected
  kind doesn't match defaultScope.kind (and no non-org defaultScope was
  supplied). LearnedRulesPage opens the dialog without a defaultScope, so every
  'This client' / 'Specific agent' selection silently saves as an org-wide
  rule — a real scope-broadening bug. Fix: disable the non-org options unless
  the caller supplied a matching defaultScope, and add a defensive in-handler
  guard that refuses the save with an inline error rather than silently
  widening scope.

[REJECT] client/src/components/brief-artefacts/ApprovalSuggestionPanel.tsx:34-40 — Missing /api/rules/draft-candidates route.
  Reason to defer (not reject outright): Real 404, verified — panel posts to
  /api/rules/draft-candidates but rules.ts only has /, /:ruleId PATCH,
  /:ruleId DELETE. The ruleCandidateDrafter.draftCandidates service exists but
  is unrouted. However, wiring it requires scanning conversation_messages
  .artefacts JSONB for the artefactId, loading the parent brief for
  briefContext, and fetching related existing rules — 40-50 lines of real
  server logic, and the JSONB scan has architectural implications. Out of
  scope for a "second-pass patch correctness" review. Filed to tasks/todo.md
  as DR1 alongside the existing Universal Brief deferred items. Pre-existing
  from commit 6af10f1 — not introduced by the pr-reviewer fix pass.

[REJECT] server/jobs/fastPathDecisionsPruneJob.ts:18-21 — Plain db handle on RLS-protected table.
  Reason: Already filed as B10 in tasks/todo.md under
  '## Deferred from pr-reviewer review — Universal Brief'. The existing B10
  entry explicitly names fastPathDecisionsPruneJob.ts, fastPathRecalibrateJob
  .ts, and ruleAutoDeprecateJob.ts. Duplicate finding.

[REJECT] server/jobs/ruleAutoDeprecateJob.ts:10-20 — Plain db handle on RLS-protected table.
  Reason: Same as above — covered by the existing B10 deferred item.
```

## Iteration 2

Codex flagged 6 findings: 4x P1, 2x P2. Two were duplicates of iter1 deferrals.

```
[REJECT] client/src/components/brief-artefacts/ApprovalSuggestionPanel.tsx:34-35 — draft-candidates route missing.
  Reason: Already deferred as DR1 in iter1. Duplicate.

[REJECT] server/routes/conversations.ts:100-104 — Follow-up messages don't re-enqueue orchestration.
  Reason to defer (not reject outright): Real bug. Verified against spec
  §7.11 line 1171: "Re-invokes the fast path + Orchestrator if the message
  looks like a follow-up intent (rather than a passive 'thanks')." The current
  handler only persists the user turn. Same gap exists in
  POST /api/briefs/:briefId/messages. Chat surfaces become one-way after the
  initial response. Fix is architectural: reimplementing createBrief's
  dispatch logic for follow-ups, and requires design decisions for non-Brief
  scopes (task, agent_run) that don't enqueue orchestration, idempotency for
  passive acks, and simple_reply/cheap_answer handling on follow-ups. Filed
  as DR2 in tasks/todo.md.

[ACCEPT] client/src/pages/LearnedRulesPage.tsx:30-36 — /subaccounts/:id/rules ignores :id.
  Reason: Verified. App.tsx mounts LearnedRulesPage on both /rules and
  /subaccounts/:id/rules, but the component never calls useParams(), so the
  subaccount route silently shows org-wide rules and the capture dialog
  defaults to org scope — making the scope-broadening issue from iter1 fire
  every single time a rule is added from a client route. Fix: read useParams,
  force-pin the filter to { scopeType: 'subaccount', scopeId: id } when
  mounted on the subaccount route, and pass matching defaultScope to
  RuleCaptureDialog. Coherent with the iter1 scope-broadening fix.

[REJECT] server/jobs/ruleAutoDeprecateJob.ts:11-20 — Maintenance tx.
  Reason: Already deferred as B10. Duplicate.

[ACCEPT] server/services/memoryEntryQualityService.ts:360 — daysSinceUpdate gate never fires after first decay.
  Reason: Verified. applyBlockQualityDecay's decay branch writes
  updatedAt: now alongside qualityScore, but daysSinceUpdate is measured
  against updatedAt. After the first decay pass every row looks freshly
  updated, so the >= BLOCK_AUTO_DEPRECATE_DAYS (14) gate can never become
  true for a rule whose score gradually falls below threshold. Rules decay
  forever and never auto-deprecate. Fix: stop bumping updatedAt in the
  decay-only branch. Auto-deprecate branch continues bumping updatedAt
  because that's a real state change. Surgical 1-line removal + clarifying
  comment.

[REJECT] server/services/briefSimpleReplyGeneratorPure.ts:24 — cheap_answer source: 'canonical' on canned stubs.
  Reason: Already deferred as S4 in tasks/todo.md. Duplicate.
```

## Iteration 3

Codex flagged 4 findings: 3x P1, 1x P2. Three were duplicates.

```
[REJECT] client/src/pages/BriefDetailPage.tsx:43-45 — ApprovalCard rendered without onApprove/onReject.
  Reason to defer (not reject outright): Real gap. Verified — ApprovalCard
  props onApprove/onReject are optional, BriefDetailPage passes neither, so
  the buttons render enabled but clicks are silent no-ops. No server-side
  approve/reject route exists either (grep /api/briefs/.*/approve finds
  nothing). Fix is architectural: needs new server route(s) to dispatch
  approvals via actionRegistry or enqueue an orchestrator run, execution
  record linkage for executionId + executionStatus on the artefact, and
  client handlers. This is a missing backend feature, not a wire-up
  oversight. Filed as DR3 in tasks/todo.md.

[REJECT] server/routes/conversations.ts:94-103 — Re-run routing on follow-up.
  Reason: Already deferred as DR2 in iter2. Duplicate.

[REJECT] server/services/briefSimpleReplyGeneratorPure.ts:15-33 — cheap_answer canonical labelling.
  Reason: Already deferred as S4. Duplicate.

[REJECT] server/jobs/fastPathDecisionsPruneJob.ts:15-20 — Maintenance tx.
  Reason: Already deferred as B10. Duplicate.
```

Zero new accepted findings this iteration -> loop has converged. Codex is cycling back over the same architectural deferrals.

---

## Changes Made

- `client/src/components/task-chat/TaskChatPane.tsx` — fix WriteMessageResult shape mismatch; drop undefined append; swap optimistic tempId -> serverId
- `client/src/components/agent-run-chat/AgentRunChatPane.tsx` — same fix as TaskChatPane
- `client/src/components/rules/RuleCaptureDialog.tsx` — disable non-org select options without matching defaultScope; defensive guard in handleSave prevents silent scope-broadening with inline error message
- `client/src/pages/LearnedRulesPage.tsx` — read :id from useParams; force-pin filter to scopeType: 'subaccount' + scopeId on /subaccounts/:id/rules; pass matching defaultScope to RuleCaptureDialog
- `server/services/memoryEntryQualityService.ts` — stop bumping updatedAt in decay-only branch so the 14-day auto-deprecate gate can actually fire; add explanatory comment
- `tasks/todo.md` — filed DR1, DR2, DR3 under new `## Deferred from dual-reviewer review — Universal Brief` section

## Rejected Recommendations

Three pre-existing architectural issues were filed as deferred items in `tasks/todo.md` rather than fixed inline (mirroring the pattern the user established with pr-reviewer's B10):

- **DR1** — missing `POST /api/rules/draft-candidates` route (server-side JSONB artefact lookup + draftCandidates wiring)
- **DR2** — follow-up conversation messages don't re-invoke fast-path + Orchestrator per spec §7.11 (design decisions required for non-Brief scopes, idempotency)
- **DR3** — `BriefApprovalCard` approve/reject are not wired end-to-end (missing backend dispatch routes + action-registry integration + execution record linkage)

Five Codex findings across iterations 2-3 were already covered by existing `tasks/todo.md` entries (B10, S4) from the pr-reviewer pass — rejected as duplicates, no action needed:

- Maintenance jobs bypassing admin/org tx (iter1 x2, iter2 x1, iter3 x1) — covered by B10
- cheap_answer placeholder as `source: 'canonical'` (iter2, iter3) — covered by S4
- Missing `/api/rules/draft-candidates` route (iter2) — covered by DR1 filed in iter1

---

## Verdict

`PR ready for user review.` All Codex findings that are correctable in the scope of a second-pass patch session have been applied (5 fixes across 5 files). All remaining findings are either (a) already captured as pre-existing architectural deferrals in `tasks/todo.md` from the pr-reviewer pass, or (b) newly filed as DR1/DR2/DR3 because they require design decisions or missing backend features beyond the second-pass scope. The user should review `tasks/todo.md` items DR1–DR3 alongside the existing B10/S-series deferrals before declaring this branch merge-ready — DR2 and DR3 in particular materially limit user-facing behavior (one-way chat, non-actionable approval cards) and should land before the Universal Brief is exposed to end users.
