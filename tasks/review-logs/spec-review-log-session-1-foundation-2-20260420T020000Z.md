# Spec Review Log — session-1-foundation iteration 2

## HITL decisions applied from iteration 1

- **Finding 1.1 (Config Assistant popup primitive):** applied Option A. §5.4 rewritten to use `/api/agents/:agentId/conversations` + extended query params. §5.7 props renamed to `conversationId` / `onConversationReady`. §5.9 sessionStorage key renamed. Hook constant renamed `SESSION_RESUME_WINDOW_MIN` → `CONVERSATION_RESUME_WINDOW_MIN`. §5.10 and §9.3 now list `server/routes/agents.ts` as the server-side extension point. §5.5, §5.11, §5.12, §5.13 prose scrubbed for session→conversation terminology where it referred to the primitive. §4.1 `sessionId` request-field kept (wire-compat with `config_history.source_session`) with an explanatory comment.
- **Finding 1.2 (Onboarding service reconciliation):** applied Option A. §7.3 paragraph added explaining `onboarding_completed_at` is the sole wizard gate while derivation fields (`ghlConnected`, `agentsProvisioned`, `firstRunComplete`) remain orthogonal. §7.4 response-shape expanded to the 4-field object. §7.5 migration backfill comment rewritten. §9.3 row for `onboardingService.ts` updated to reflect the resolved contract (HITL-pending footnote removed).

## Findings classified and dispositioned (iteration 2)

```
FINDING #1 (Codex)
  Source: Codex
  Section: §1.3(j), §1.1
  Description: §1.3(j) says both surfaces "call the same HTTP route," but post-iter-1 the Settings page calls /api/organisation/config/apply while the Assistant goes through the agent-conversations API + skill.
  Classification: mechanical
  Reasoning: Stale language (language made true pre-iter-1 is now inaccurate). Rewording to "same underlying config-update service + audit trail" preserves intent and matches the iter-1 HITL outcome.
  Disposition: auto-apply (applied)
  Fix: §1.3(j) rewritten to name the shared service layer + the two entry points explicitly. §1.1 rephrased in parallel.

FINDING #2 (Codex)
  Source: Codex
  Section: §2.4
  Description: Migration step-4 prose claims "ORDER BY updated_at DESC ... is what orgConfigService.getOperationalConfig resolves today" but current service uses LIMIT 1 with no ORDER BY.
  Classification: mechanical
  Reasoning: False claim about current behaviour — pure accuracy fix. No scope change; just correct the comment to acknowledge the intentional determinisation.
  Disposition: auto-apply (applied)
  Fix: Rewrote the step-4 SQL comment to call the ORDER BY an intentional determinisation + slight hardening of runtime behaviour, not a faithful copy.

FINDING #3 (Codex)
  Source: Codex
  Section: §4.8, §9.3
  Description: §4.8 claims the history viewer unions over two entity types but neither configHistoryService.ts nor routes/configHistory.ts is listed in §9.3; verified CONFIG_HISTORY_ENTITY_TYPES currently rejects both.
  Classification: mechanical
  Reasoning: File inventory + under-specified invariant cleanup. Spec intent is clear; naming the implementation owner and the exact gate-set change is a mechanical tightening.
  Disposition: auto-apply (applied)
  Fix: Added a paragraph at the end of §4.8 naming configHistoryService.ts as the owner of CONFIG_HISTORY_ENTITY_TYPES, explicitly adding both legacy + new entity types to the set, and defining an `organisation_config_all` special value for the history-read route. Added both configHistoryService.ts and routes/configHistory.ts as new rows in §9.3.

FINDING #4 (Codex)
  Source: Codex
  Section: §4.7, §7.5, §9.1
  Description: §4.7 reserved NNNN+2 for skill-analyzer-meta; §7.5 / §9.1 reserved NNNN+2 for onboarding_completed_at. Direct collision.
  Classification: mechanical
  Reasoning: Sequencing ordering bug — classic rubric catch.
  Disposition: auto-apply (applied)
  Fix: §4.7 table now lists 4 Session 1 migrations with onboarding at NNNN+2 and the conditional skill-analyzer-meta at NNNN+3.

FINDING #5 (Codex)
  Source: Codex
  Section: §5.4, §5.10, §9.3
  Description: Conversations-list extension names routes/agents.ts but omits services/conversationService.ts; verified listConversations is where the filter/order/limit need to live.
  Classification: mechanical
  Reasoning: File inventory drift — classic rubric catch. No scope change, just completing the touch list.
  Disposition: auto-apply (applied)
  Fix: Added `server/services/conversationService.ts` as a new row in both §5.10 and §9.3, with the `listConversations` contract extension spelled out.

FINDING #6 (Codex)
  Source: Codex
  Section: §5.1, §5.11
  Description: Spec refers to full-page Config Assistant at `/config-assistant`, but current route is `/admin/config-assistant`.
  Classification: mechanical
  Reasoning: Stale URL — rubric catch on stale language.
  Disposition: auto-apply (applied)
  Fix: Updated §5.1 and §5.11 to `/admin/config-assistant`. Verified no other references in the spec.

FINDING #7 (Codex)
  Source: Codex
  Section: §5.4
  Description: New `userId` query param on the conversations list endpoint is redundant — current route derives it from req.user.id.
  Classification: mechanical
  Reasoning: Under-specified contract + correctness fix within the already-approved iter-1 primitive choice. Not a scope change; narrowing the new query contract to what's actually needed.
  Disposition: auto-apply (applied)
  Fix: Dropped `userId` from the query contract. Added explicit note that user-scoping is implicit via req.user.id (preserved existing behaviour). Propagated to §5.10 and §9.3 service/route rows.

FINDING #8 (Codex)
  Source: Codex
  Section: §6.5, S1-5.2 (§1.2)
  Description: S1-5.2 says "no operational-config fields are visible" but §6.5 requires a read-only preview of the seed block.
  Classification: mechanical
  Reasoning: Contradiction between two sections — classic rubric catch. §6.5 is the design intent; S1-5.2 was loose language.
  Disposition: auto-apply (applied)
  Fix: S1-5.2 and §8.4 manual step 4 rewritten to say "no editable operational-config fields" and explicitly acknowledge the §6.5 read-only seed preview is expected.

FINDING #9 (Codex)
  Source: Codex
  Section: §6.2, §8.1 chunk 6 description, §9.2
  Description: Chunk 6 still says "All 10 typed editors"; §9.2 still lists InterventionTemplatesEditor.tsx; the spec elsewhere locks the JSON editor for Session 1.
  Classification: mechanical
  Reasoning: Stale language + file inventory drift from the iter-1 typed-vs-JSON decision. Clean-up, no scope change.
  Disposition: auto-apply (applied)
  Fix: Chunk-6 description rewritten to enumerate 9 typed editors + InterventionTemplatesJsonEditor. Removed InterventionTemplatesEditor.tsx row from §9.2.

FINDING #10 (Codex)
  Source: Codex
  Section: §3.5, §9.3
  Description: server/skills/clientPulseOperatorAlertServicePure.ts hard-codes clientpulse.operator_alert but isn't in the §3.5 touch list.
  Classification: mechanical
  Reasoning: File inventory drift — classic rubric catch. Verified the file has the literal.
  Disposition: auto-apply (applied)
  Fix: Added the file as a new row in both §3.5 code-changes table and §9.3 modify table.

FINDING #11 (Codex)
  Source: Codex
  Section: §1.2 S1-A2, §8.2
  Description: S1-A2 says "e2e that a proposer job emits the new slug" and §8.2 has `client/src/components/clientpulse-settings/__tests__/*.test.tsx` frontend-test placeholder — both contradict the framing's locked testing posture.
  Classification: mechanical
  Reasoning: Framing drift against spec-context.md (e2e_tests_of_own_app: none_for_now + frontend_tests: none_for_now). Cleaning up language that contradicts the convention_rejections list is mechanical.
  Disposition: auto-apply (applied)
  Fix: S1-A2 verification rewritten to use a pure-test assertion on proposer/job output. §8.2 S1-5.1 row rewritten to "Manual" only with an explicit note that no frontend unit tests land this session per the repo's testing posture.
```

## Rubric pass (spec-reviewer initiated)

No net-new mechanical issues surfaced by the rubric pass beyond what Codex caught. The spec's migration numbering, file inventories, section cross-references, and testing posture are now aligned. Verified:

- No remaining `/api/agent-runs?` or `/api/agent-runs/start` references.
- No remaining `10 typed editors` references.
- No remaining `/config-assistant` (without `/admin/` prefix) references.
- No remaining stale `SESSION_RESUME_WINDOW_MIN` / `activeSessionId` identifiers.
- `sessionId` survives only in §4.1/§4.2 wire format with an explanatory comment (wire-compat with existing `config_history.source_session` column) — this is NOT a session-primitive reference.

## Iteration 2 Summary

- Mechanical findings accepted:  11
- Mechanical findings rejected:  0
- Directional findings:          0
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          none this iteration
- HITL status:                   none
- Spec state at end of iteration: mechanically tightened against 11 Codex findings + 2 iteration-1 HITL resolutions applied.

This is a mechanical-only round. Per the stopping heuristic, if iteration 3 is also mechanical-only, the loop exits via the two-consecutive-mechanical-only-rounds rule.
