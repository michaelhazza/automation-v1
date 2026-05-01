# Dual Review Log — deferred-items-pre-launch

**Files reviewed:** all changes on branch `claude/deferred-items-pre-launch-5Kx9P` vs `main` (35 files, ~1083 insertions / 98 deletions)
**Iterations run:** 3/3
**Timestamp:** 2026-05-01T05:33:57Z
**Commit at finish:** a4fd2da2
**Codex CLI:** `OpenAI Codex v0.118.0` (model `gpt-5.4`)
**Mode:** `--base main` for iteration 1 (clean working tree); `--uncommitted` for iterations 2–3 (after edits applied).

---

## Iteration 1

Codex completed in ~530s and produced two P1 findings.

### [ACCEPT] server/services/briefSimpleReplyGeneratorPure.ts:24 — `source: 'stub'` breaks artefact validation
- **Codex finding:** Cheap-answer template now emits `source: 'stub'`, but `briefArtefactValidatorPure.ts:48` defines `VALID_SOURCES = new Set(['canonical', 'live', 'hybrid'])`. Every fast-path artefact will be rejected by `validateArtefactForPersistence()` and lost from the conversation.
- **Verification:** Confirmed line 48 hardcodes the three-element set and `'stub'` is missing. CLAUDE.md / DEVELOPMENT_GUIDELINES.md §8.13: *"Adding a new kind to a discriminated union and updating the validator's allow-list happens in the same commit."* Spec §2.6 missed this dependency.
- **Fix applied:** added `'stub'` to `VALID_SOURCES` in `server/services/briefArtefactValidatorPure.ts:48`. No test changes needed — existing `'cache' → invalid_enum` test still passes (still not in the allow-list).

### [ACCEPT-PARTIAL → REVISED in iter 2] server/config/actionRegistry.ts:2684,2711 — `crm.send_sms` and `crm.create_task` missing `requiredIntegration: 'ghl'`
- **Codex finding:** Both route through `ghlEndpoints.ts` (the GHL OAuth endpoint registry). Without the tag, `checkRequiredIntegration` returns `shouldBlock: false` and the run fails later at execution time instead of pausing for OAuth at agent-execution time.
- **Initial decision (iter 1):** Accepted; fixed all three GHL-routed CRM intervention actions (`crm.fire_automation`, `crm.send_sms`, `crm.create_task`) for consistency with the existing `crm.send_email` tag.
- **Revised decision (iter 2):** Reverted — see iteration 2 below. Codex iter-2 surfaced a deeper issue that invalidates the fix.

---

## Iteration 2

Codex completed in ~580s on the uncommitted changes from iter 1.

The validator fix from iter 1 was confirmed correct ("the new validator enum change is fine"). However, Codex flagged a regression in the iter-1 `actionRegistry.ts` additions.

### [ACCEPT] server/config/actionRegistry.ts:2654,2683,2740 — REVERT iter-1 additions of `requiredIntegration: 'ghl'` on `crm.fire_automation`, `crm.send_sms`, `crm.create_task`
- **Codex finding:** All four `crm.*` review-gated actions route through `proposeReviewGatedAction()` in `skillExecutor.ts`, which only creates an internal action/review record — the actual GHL call happens later in `executionLayerService.ts` after human approval. Tagging `requiredIntegration: 'ghl'` makes `checkRequiredIntegration` block the run BEFORE the proposal is even created, so any org without an active GHL connection cannot surface intervention recommendations or approval cards at all.
- **Verification:**
  - Traced `skillExecutor.ts:1402–1413`: all four actions handlers route to `proposeReviewGatedAction(actionType, input, context)`.
  - Traced `proposeReviewGatedAction` (`skillExecutor.ts:2075`): only calls `actionService.proposeAction` and `reviewService.createReviewItem`; no GHL call.
  - Traced `agentExecutionService.ts:2759–2815`: `checkRequiredIntegration` runs BEFORE tool dispatch — if `shouldBlock: true`, the tool handler is never invoked, so no proposal is created.
  - Confirmed user's brief explicitly listed the intended scope: *"4 OAuth-requiring actions tagged (send_email/gmail, read_inbox/gmail, update_crm/ghl, crm.send_email/ghl)"*. My iter-1 additions over-implemented beyond the user's stated intent.
- **Fix applied:** reverted all three additions; `actionRegistry.ts` now matches HEAD exactly. The four pre-existing tags (lines 320, 345, 1656, 2682) remain — they are the user's deliberate choice per the brief.
- **What was NOT modified:** the pre-existing `crm.send_email` tag on line 2682 was not touched. Codex's analysis applies equally to it (and to `update_crm` line 1656, and to gmail `send_email` line 320), but the architectural question of "should `checkRequiredIntegration` block review-gated actions at proposal time?" is out of scope for dual-reviewer. Restructuring this check is a Significant change requiring its own spec. The existing tags went through `pr-reviewer` and reflect the user's deliberate choice.

---

## Iteration 3

Codex completed in ~140s on the uncommitted changes after iter-2 revert.

**Verdict:** *"The only code change updates the validator mirror to accept the already-defined `stub` result source from the shared contract, which matches existing producers that emit `source: 'stub'`. I did not find any introduced bug in the staged, unstaged, or untracked code changes."*

Loop terminates: clean exit, zero new findings.

---

## Changes Made

- `server/services/briefArtefactValidatorPure.ts:48` — added `'stub'` to `VALID_SOURCES` set so cheap-answer artefacts pass `validateArtefactForPersistence()`.

(Iter-1 edits to `server/config/actionRegistry.ts` were reverted in iter 2 — net zero change to that file.)

---

## Rejected Recommendations

- **Iter-1 finding 2 (extended scope):** Codex flagged `crm.send_sms` and `crm.create_task` as missing the `requiredIntegration: 'ghl'` tag. Initial accept added tags to those plus `crm.fire_automation` for consistency with `crm.send_email`. Iter-2 Codex correctly identified this as a regression (review-gated actions should not block at proposal time). Final decision: revert all three additions; do not modify the pre-existing tags either, as that requires a dedicated architectural spec outside dual-reviewer scope.

---

## Verification State Post-Loop

- Typecheck: 138 errors (baseline unchanged from user-stated 138).
- Lint: 283 errors (baseline unchanged from user-stated 283).
- Targeted tests: 88 passing (44 briefArtefactValidator + 35 conversationThreadContext + 9 integrationBlock).

---

**Verdict:** APPROVED (3 iterations; iter 1 raised 2 P1 findings, iter 2 reversed one of them after deeper analysis, iter 3 clean exit; one validator-allow-list fix retained).
