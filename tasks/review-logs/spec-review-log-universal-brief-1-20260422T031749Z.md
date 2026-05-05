# Spec Review Log — universal-brief — Iteration 1

**Run timestamp:** `20260422T031749Z`
**Spec commit at start of iteration:** `2706df6741a0924f2da78f9a6a6ea343f91d78cb`
**Codex output:** `tasks/review-logs/_universal-brief-iter1-codex-output.txt`
**Codex prompt:** `tasks/review-logs/_universal-brief-iter1-prompt.txt`

## Findings index
- Codex findings 1–12 (below)
- Rubric-added findings 13–18 (below)
- All 18 classified as mechanical; applied directly to the spec.

---

## Codex findings (P1)

### #1 — Artefact storage model self-contradiction (§5.1 / §7.2 / §9.7 / §13)
- **Source:** Codex P1
- **Problem:** `conversation_messages.artefactIds` is an ID-array; §7.2 says the handler "joins to actual artefact records"; §9.7 says artefacts "live as JSONB on `conversation_messages.artefactIds`"; §13 defers the dedicated artefact table. There is no table to join to, and the column semantics contradict between prose sections.
- **Classification:** mechanical
- **Disposition:** auto-apply — change column to `artefacts jsonb default [] not null` storing full `BriefChatArtefact` blobs; strike the "joins to actual artefact records" phrasing in §7.2; adjust §9.7 accordingly; §13 deferred-artefact-table line stands.

### #2 — Rule "paused" status has no persistence mechanism (§5.3 / §7.7 / §7.8 / §8.4 / §12.1)
- **Source:** Codex P1
- **Problem:** Routes, UI, and tests refer to `status='paused'` + pause/resume affordances, but §5.3 adds only `deprecated_at` / `deprecation_reason` / `captured_via` / `priority` / `is_authoritative` — no paused column or status column.
- **Classification:** mechanical
- **Disposition:** auto-apply — add `paused_at timestamp` + partial index `memory_blocks_paused_idx`; derive `status` from `paused_at` + `deprecated_at`; update precedence algorithm step 1 to exclude both paused and deprecated.

### #3 — Precedence algorithm contradiction (§5.3 vs §15.2)
- **Source:** Codex P1
- **Problem:** §5.3 algorithm orders `authoritative > scope > priority > recency`; §15.2 mitigation narrative says `scope > authoritative > priority > recency`.
- **Classification:** mechanical
- **Disposition:** auto-apply — align §15.2 wording to match §5.3 detailed algorithm.

### #4 — Phase 2 references Phase 5 permissions (§9.5 / §11 Phase 2 / §14.2)
- **Source:** Codex P1
- **Problem:** Phase 2 ships Brief routes + WebSocket guards that depend on `briefs.read` / `briefs.write`, but §14.2 line 1781 puts all four permission keys in Phase 5.
- **Classification:** mechanical
- **Disposition:** auto-apply — move `briefs.*` permissions to Phase 2; keep `rules.*` in Phase 5.

### #5 — `conversation_messages` RLS cannot enforce subaccount isolation (§5.1 / §9.1)
- **Source:** Codex P1
- **Problem:** `conversation_messages` only denormalises `organisationId`, so the table-level RLS is org-only — but §9.1 claims full checklist coverage for a tenant-scoped table.
- **Classification:** mechanical
- **Disposition:** auto-apply — add `subaccountId uuid` (nullable, denormalised) + supplementary subaccount RLS policy matching `conversations`.

### #6 — Fast-path response generation / persistence primitives unnamed (§6.1 / §7.1 / §11 Phase 2-3 / §14)
- **Source:** Codex P1
- **Problem:** `simple_reply` / `cheap_answer` routes "return inline artefacts"; Orchestrator output appears in Brief conversations. Neither the canned-response generator nor the message writer / websocket emitter has a named file.
- **Classification:** mechanical (unnamed primitives rubric)
- **Disposition:** auto-apply — introduce `server/services/briefSimpleReplyGeneratorPure.ts` (Phase 3) and `server/services/briefConversationWriter.ts` (Phase 2); reference from §6.1 / §7.1 / §7.3; inventory both in §14.1.

### #7 — `RuleScope` omits `system` but §9.5 mentions system rules (§4.6 / §6.3.3 / §9.5)
- **Source:** Codex P1
- **Problem:** Contract type `RuleScope = subaccount | agent | org`; but §9.5 says "system rules" and describes system-admin inheritance over org rules. No system scope propagates through precedence / RLS / UI.
- **Classification:** mechanical (conservative option)
- **Disposition:** auto-apply — remove "system rules" language; org is the highest user-captured-rule scope in v1. Add a Deferred item for system rules.

---

## Codex findings (P2)

### #8 — Conversation-scope story inconsistent (§1 / §5.1 / §8.7 / §11 Phase 2-7 / §13)
- **Source:** Codex P2
- **Problem:** §1 item 2 says v1 supports four scopes; §5.1 backward-compat keeps agent chat on old tables; §8.7 says all four surfaces "use" `conversations`; Phase 2 lists Brief+Task; Phase 7 adds agent-run-log.
- **Classification:** mechanical
- **Disposition:** auto-apply — distinguish "schema supports" from "UI ships." The schema is polymorphic with four scope enums; in v1, Brief / Task / Agent-run-log use it, Agent scope stays on `agent_conversations`.

### #9 — File inventory misses migrations + schema edits (§11 Phase 7 / §5.3 / §5.4 / §14.1-§14.2)
- **Source:** Codex P2
- **Problem:** Phase 7's `user_settings` columns have no migration entry; existing Drizzle schema files edited for `memory_blocks`, `agent_runs`, `org_settings`, `user_settings`, `tasks` are missing from §14.2.
- **Classification:** mechanical
- **Disposition:** auto-apply — add migration `0TTT_user_settings_suggestion_frequency.sql` to §14.1 (Phase 7); add all existing schema file edits to §14.2.

### #10 — `briefArtefactBackstopPure.ts` missing from sources but has test file (§6.4 / §12.1 / §14.1)
- **Source:** Codex P2
- **Problem:** Test plan lists `briefArtefactBackstopPure.test.ts` but no pure source module exists.
- **Classification:** mechanical
- **Disposition:** auto-apply — split into `briefArtefactBackstop.ts` (async wrapper) + `briefArtefactBackstopPure.ts` (pure shape / invariant helpers); add both to §14.1 with test file.

### #11 — Fast-path "invoked within backstop" nonsensical (§7.11)
- **Source:** Codex P2
- **Problem:** §7.11: "it's invoked server-side within `briefCreationService.createBrief()` and `briefArtefactBackstop`." Backstop is a validator, not a classifier call site.
- **Classification:** mechanical
- **Disposition:** auto-apply — strike "and `briefArtefactBackstop`".

### #12 — Phase 5 success criteria assume real conflict detection (§6.3.2 / §11 Phase 5 / §11 Phase 6 / §17)
- **Source:** Codex P2
- **Problem:** §6.3.2 says save goes through conflict detector; Phase 5 says "stubbed until Phase 6"; §17 Behavioural requires "every capture goes through conflict detection."
- **Classification:** mechanical
- **Disposition:** auto-apply — Phase 5 ships a named no-op `ruleConflictDetectorService.check()` returning empty report; Phase 6 replaces implementation; §17 criterion clarified as "empty-report no-op in Phase 5, real detection in Phase 6 onward."

---

## Rubric-added findings (Claude's own pass)

### #13 — `briefCreationService` Phase 2 signature uses Phase 3 types (§6.3.1 / §11 Phase 2)
- **Source:** Rubric (phase-dependency)
- **Problem:** §6.3.1 signature: `uiContext: ChatTriageInput['uiContext']`, returns `FastPathDecision` — both live in `shared/types/briefFastPath.ts` (Phase 3). Phase 2 explicitly ships "without fast path."
- **Classification:** mechanical
- **Disposition:** auto-apply — advance `shared/types/briefFastPath.ts` to Phase 2 (types-only; behaviour still Phase 3). Phase-2 `createBrief` returns a stub `FastPathDecision` (`route: 'needs_orchestrator'`, `tier: 1`, `confidence: 1.0`, `secondLookTriggered: false`). Phase 3 swaps the classifier in.

### #14 — §10 execution-model table drops conversation-writer ops (§10)
- **Source:** Rubric (execution-model consistency)
- **Problem:** §10 omits rows for (a) Brief creation itself, (b) conversation message persistence, (c) Brief artefact websocket emission.
- **Classification:** mechanical
- **Disposition:** auto-apply — add three rows to §10 table.

### #15 — `resolveBriefVisibility` helper not named in inventory (§7.3 / §14.1)
- **Source:** Rubric (unnamed primitives + inventory drift)
- **Problem:** §7.3 introduces "new helper mirroring `resolveAgentRunVisibility`" without a file path.
- **Classification:** mechanical
- **Disposition:** auto-apply — introduce `server/lib/briefVisibility.ts` (Phase 2) and add to §14.1.

### #16 — SKIPPED (self-check false alarm — `resolveLifecyclePure` is correctly referenced from both §6.5 and §8.2).

### #17 — `server/db/schema/conversations.ts` ambiguous about both table exports (§14.1)
- **Source:** Rubric (file inventory precision)
- **Problem:** Both `conversations` and `conversationMessages` are defined in §5.1 but §14.1 lists only one schema file.
- **Classification:** mechanical — minor
- **Disposition:** auto-apply — append "exports both tables" annotation to the inventory entry.

### #18 — §6.3.6 references 6-step algorithm; finding #2 makes it 7 steps (§5.3 / §6.3.6)
- **Source:** Rubric (cascade from finding #2)
- **Classification:** mechanical
- **Disposition:** auto-apply as part of the finding-#2 cascade.

---

## Applied fixes

Applied to `docs/universal-brief-dev-spec.md`:

1. `artefactIds` column → `artefacts` (stores `BriefChatArtefact[]` blobs); §7.2 no-join rewording; §9.7 + §13 cascade.
2. `paused_at` + index added to §5.3 migration; derived `status` helper added; precedence algorithm now 7-step.
3. §15.2 mitigation narrative aligned to `authoritative > scope > priority > recency`.
4. `briefs.read` / `briefs.write` permissions moved to Phase 2 in §14.2 and Phase 2 scope list.
5. `conversation_messages.subaccountId` added (nullable, denormalised) + supplementary subaccount RLS policy + denormalisation-invariant paragraph in §5.1.
6. `briefSimpleReplyGeneratorPure` (Phase 3) + `briefConversationWriter` (Phase 2) introduced as named primitives; §6.1 + §7.1 reference them; inventoried in §14.1.
7. "System rules" language removed from §9.5; `RuleScope` stays `subaccount | agent | org`.
8. §1 item 2 + §8.7 reconciled: schema admits four scopes; Brief/Task/Agent-run-log use new tables, Agent scope stays on `agent_conversations`.
9. Migration `0TTT` added for Phase 7 user_settings; existing Drizzle schema-file edits inventoried in §14.2 under the phase that edits them.
10. Backstop split into async + pure modules; §6.4 files list + §14.1 + §14.1 tests + Phase 0 scope list + "Services introduced" updated.
11. §7.11 "and `briefArtefactBackstop`" struck.
12. §6.3.2 flow step 2 clarified as no-op-stub in Phase 5; §17 criterion clarified; Phase 5 scope list + §14.1 inventory entry updated.
13. `shared/types/briefFastPath.ts` advanced to Phase 2 (types only); §6.3.1 adds Phase-2-vs-Phase-3 behaviour paragraph.
14. Three new rows in §10 execution-model table (Brief creation, message persistence, websocket emission).
15. `server/lib/briefVisibility.ts` inventoried in §14.1; Phase 2 "Services introduced" updated.
17. `server/db/schema/conversations.ts` inventory entry annotated as exporting both tables.
18. §6.3.6 updated to reference 7-step algorithm and expose `deriveRuleStatus` helper.
19. (bonus rubric fix) §7.10 approval-route corrected from `/api/actions/:actionId/approve` to `/api/review-items/:id/approve`.
20. Two new Deferred items added to §13: system-scoped user-captured rules; `verify-conversation-message-denorm.sh` static gate.

## Counts (for stopping heuristic)

- `mechanical_accepted`: 17 core findings + 1 rubric bonus (route path correction) + 2 deferred-item additions = 20 mechanical changes
- `mechanical_rejected`: 0
- `directional_or_ambiguous`: 0 (no findings hit a directional signal)
- `reclassified → directional`: 0

Iteration 1 — **mechanical-only round.**

## Iteration 1 Summary

- Mechanical findings accepted: 17 (plus 3 cascading/bonus edits)
- Mechanical findings rejected: 0
- Directional findings: 0
- Ambiguous findings: 0
- Reclassified → directional: 0
- Autonomous decisions (directional/ambiguous): 0
  - AUTO-REJECT (framing): 0
  - AUTO-REJECT (convention): 0
  - AUTO-ACCEPT (convention): 0
  - AUTO-DECIDED: 0
- Spec commit after iteration: (uncommitted edits in working tree)

