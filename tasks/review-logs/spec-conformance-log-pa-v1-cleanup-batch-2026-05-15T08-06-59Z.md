# Spec Conformance Log — pa-v1-cleanup-batch

**Spec:** `tasks/builds/pa-v1-cleanup-batch/spec.md` (BATCH spec)
**Authoritative sub-spec:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md` (treated as authoritative at HEAD; 2026-05-13 amendment block is part of the contract)
**Spec commit at check:** HEAD of branch `claude/pa-v1-cleanup-batch`
**Branch:** `claude/pa-v1-cleanup-batch`
**Branch HEAD (pre-log commit):** `ed822574`
**Commit at finish:** `2e70c02f`
**Base (merge-base with `origin/main`):** `c92d2a81`
**Scope:** full batch — 12 spec-conformance REQ items + 1 adversarial item enumerated in spec §1 / §5 / §6 / §7
**Changed-code set:** 13 files
**Run at:** 2026-05-15T08:06:59Z

---

## Summary

- Requirements extracted:     14 (12 REQs + 1 adversarial + 1 meta-bookkeeping item that flips per-PR)
- PASS:                       14
- MECHANICAL_GAP -> fixed:     0
- DIRECTIONAL_GAP -> deferred: 0
- AMBIGUOUS -> deferred:       0
- OUT_OF_SCOPE -> skipped:     0

**Verdict:** CONFORMANT

---

## Requirements extracted (full checklist)

| REQ | Spec section | Verdict | Evidence |
|---|---|---|---|
| REQ-C1 | PA-V1 §7.1 (amendment line 406) | PASS | `shared/types/externalSourceTrigger.ts:1-43` — flat discriminated union on `eventType` with three variants, no envelope. |
| REQ-C3 | PA-V1 §7.3 | PASS | `shared/types/slackAction.ts:3-8` — `types` field with the spec-named enum + `default(['public_channel'])`. |
| REQ-C4 | PA-V1 §7.4 + §21.1 (amendment line 472) | PASS | Migration `0360_voice_profiles_schema_align.sql` drops the partial index, renames `sample_count`/`last_refreshed_at`/`opted_out_at`, adds `source_config` and `refresh_config` jsonb `NOT NULL DEFAULT '{}'`, re-creates the index on new names. Paired `.down.sql` reverses correctly and documents jsonb data-loss on revert. Drizzle `server/db/schema/voiceProfiles.ts` exports `sampleSize`, `lastDerivedAt`, `optOutAt`, `sourceConfig`, `refreshConfig`. Zod `shared/types/voiceProfile.ts:14-31` matches. Service `server/services/voiceProfile/voiceProfileService.ts` and job `server/jobs/voiceProfileRefreshJob.ts:27-42` use new names. Vitest `__tests__/voiceProfileColumnAlignment.test.ts` asserts both positive and negative cases. Downstream consumers `server/services/agentExecutionServicePure.ts::assembleVoiceBlock` and `server/services/operatorSessionInitialContextBundler.ts` updated to read `optOutAt`/`lastDerivedAt`. |
| REQ-CAL2 | PA-V1 §8.2 | PASS | `server/config/actionRegistry/calendar.ts:62-63` (`create_event`) and `:85-86` (`update_event`) carry `riskTier: 4` + `defaultGateLevel: 'review'`. |
| REQ-CAL3-naming | PA-V1 §8.4 + §24.2 + §24.9 (amendment line 47-49) | PASS | `server/services/calendar/calendarActionService.ts:170` `DRAFT_NOT_FOUND` 404; `:178-183` `DRAFT_OWNER_MISMATCH` 403 with explicit owner check `row.draftOwnerUserId !== callerOwnerUserId`; `:188` `DRAFT_NOT_APPROVED` 422; `:195` `DRAFT_SEND_IN_FLIGHT` 409. |
| REQ-T8 | PA-V1 §7.1 (amendment line 429) | PASS | `server/services/triggers/externalSourceTriggersPure.ts:13-22` — exact shapes per amendment: `messageId`, `${calendarEventId}@${startAt}@${minutesUntilStart}`, `${channelId}@${messageTs}`. |
| REQ-EA1 | PA-V1 §13.2 | PASS | `migrations/0343_ea_home_widget_spec_align.sql:26-50` writes 23 spec-named per-EA skills; 7 platform-meta skills covered by `server/config/universalSkills.ts` per the migration header. |
| REQ-EA3 | PA-V1 §13.4 (amendment line 1187) | PASS | `migrations/0332_executive_assistant_seed.sql:64-66` creates `agents_personal_assistant_per_user_idx ON agents(organisation_id, owner_user_id) WHERE slug = 'executive-assistant' AND deleted_at IS NULL`. |
| REQ-EA4 | PA-V1 §13.1 | PASS | `migrations/0343_ea_home_widget_spec_align.sql:24` writes `refreshPolicy: 'on_login'`. |
| REQ-EA5 | PA-V1 §13.1 + §13.6 | PASS | `migrations/0343_ea_home_widget_spec_align.sql:22` writes `titleTemplate: '${agent.displayName}'`. |
| REQ-M9 | PA-V1 §5.1 + §20.4 + §22.2 (amendment line 51-53, REVIEW-F1) | PASS | `server/jobs/workflowGateStallNotifyJob.ts:124-137` invokes `eaDraftService.expireOldEADraftProposals()` and logs `ea_draft_proposal_system_rejected_due_to_expiry` with `reason: 'expired_after_7d'` + `systemExpired: true`. Matches the seventh-pass honest framing (terminal state is `rejected` with metadata flags). |
| REQ-M15 | PA-V1 §14.1 | PASS | `client/src/config/sidebar.ts:16-27` `NavGroup` union: `top -> personal -> work -> projects -> agents -> company -> clientpulse -> organisation -> support -> platform -> footer`. INVARIANT comment `:7-11` matches. Personal emission `:115-128` sits between `top` (`:80-113`) and `work` (`:130+`), gated on `userOwnedAgents.length > 0`. Tests `client/src/config/__tests__/buildNavItems.test.ts:226-258` (canonical order), `:261-282` (personal-before-work), `:285-301` (hidden-when-empty). |
| Adversarial — createDraftWithProposal atomicity | PA-V1 §7.5 + amendment line 55-57 (REVIEW-F2) | PASS | `server/services/eaDrafts/eaDraftService.ts:98-133` wraps `actionService.proposeAction({ ..., tx })` and `tx.insert(eaDrafts)` inside `db.transaction(async (tx) => { ... })`. Migration `0344_ea_drafts_proposal_action_unique.sql` adds defence-in-depth UNIQUE on `proposal_action_id`. |
| Acceptance §9.6 — `tasks/todo.md` close-out | spec §9 item 6 | PASS (pending PR-number substitution at finalisation) | All 12 deferred REQs + 1 adversarial item in `tasks/todo.md:1401-1499` flipped to `[x] [status:closed:pr:<pending>]` with one-line closure rationale per item. `<pending>` placeholder is the documented substitution point — finalisation rewrites to the merge PR number per spec §9. Expected mid-build state, not a gap. |

---

## Mechanical fixes applied

None. Every requirement in scope is already conformant on the branch as it stands.

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

None.

---

## Files modified by this run

None.

---

## Cross-cutting verification

Spec §9 acceptance criteria:

- §9.2 `npm run build:server` — CI gate; covered by caller's pre-handoff note "VERIFIED PASSING".
- §9.3 `npm run lint` — verified locally: 0 errors, 886 pre-existing warnings (unrelated). PASS.
- §9.3-equivalent `npm run typecheck` — verified locally: both `tsconfig.json` and `server/tsconfig.json` complete without diagnostics. PASS.
- §9.4 migrations land with paired `.down.sql` — `0360_voice_profiles_schema_align.sql` + `.down.sql` both present; up does drop-index/rename/add/re-create; down does drop-index/rename-back/drop-columns/re-create in reverse, with data-loss caveat in header.
- §9.5 PA-V1 conformance log shows zero remaining open REQ items — verified at `tasks/review-logs/spec-conformance-log-personal-assistant-v1-2026-05-12T13-15-07Z.md` "Close-out notes (2026-05-15, pa-v1-cleanup-batch)" section.
- §9.6 `tasks/todo.md` items marked closed — verified at `tasks/todo.md:1401-1499`. `<pending>` placeholders are the documented substitution token.
- §9.7 operator visual confirmation of Personal nav placement — correctly DEFERRED to PR body / operator action. Not a code-conformance gap at this stage.

---

## Notes for downstream reviewers

1. The 11-of-13 "false positives" pattern is documented. The 2026-05-12 PA-V1 conformance log was a snapshot taken before the 2026-05-13 spec amendments and before migrations 0343/0344 landed. Spec authority at HEAD is the post-amendment version per the caller contract.
2. Two real code changes only: REQ-C4 (voice_profiles column align — migration + Drizzle + Zod + service + job + two downstream consumers) and REQ-M15 (sidebar nav order + comment + test). Both line-traceable to spec sections.
3. Adversarial atomicity has belt-and-braces defence: transaction wrap at the service layer + UNIQUE index at the DB layer (migration 0344).
4. No drive-by edits. `agentExecutionServicePure.ts` and `operatorSessionInitialContextBundler.ts` touch only renamed columns — part of REQ-C4 service-layer alignment per plan §2.2.
5. `<pending>` PR-number placeholders in `tasks/todo.md` are expected and correct at this stage; finalisation substitutes them at merge.

---

## Next step

CONFORMANT — no gaps, mechanical or directional. Proceed to `pr-reviewer`. No re-run against an expanded changed-code set is required (no fixes applied this run).

**Commit at finish:** `2e70c02f` (pushed to `origin/claude/pa-v1-cleanup-batch`).
