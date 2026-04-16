# Spec Review Log — Iteration 1

**Spec:** `docs/config-agent-guidelines-spec.md`
**Spec commit:** `7054e4d0a5a11199abf0c705572504be7e444fe2`
**Spec-context commit:** `7cc51443210f4dab6a7b407f7605a151980d2efc`
**Codex runs:** 2

---

## Mechanical findings (auto-applied)

[ACCEPT] §3.4 seeder step 3 — missing permission/source fields in join table row insertion
  Fix: Added `permission: 'read'` and `source: 'manual'` to the attachment row spec.

[ACCEPT] §3.5 verification — assertion references non-existent isReadOnly field
  Fix: Changed `isReadOnly: true` to `permission: 'read'` (matches actual getBlocksForAgent() return shape).

[ACCEPT] §4 file inventory — test path does not track implementation location
  Fix: server/services/__tests__/ → server/jobs/__tests__/ for seedConfigAgentGuidelines.test.ts.

[ACCEPT] §3.2 + §3.5 — join table named inconsistently and incorrectly
  Fix: Updated both sections to use `memory_block_attachments` with schema-verification note (consistent with §3.4's hedging).

[ACCEPT] §3.6 — contradictory permission clause for content edits on protected blocks
  Fix: Removed "allowed if the caller has platform-admin permission" clause; now reads "allowed for org (agency) admins, matching existing Memory Blocks editing permissions." Consistent with §3.7.

[ACCEPT] §3.4 intro — seeder sentence incorrectly implies canonical updates propagate on redeploy
  Fix: Rewrote parenthetical to accurately describe create-if-absent behavior and point to §3.2/§5.

[REJECT] §3.3 — canonical guidelines text not yet locked
  Reason: Self-acknowledged open question per §3.3 Notes, §6 item 1, §7. Intended state pre-kickoff.

---

## Directional and ambiguous findings (HITL checkpoint)

Checkpoint: `tasks/spec-review-checkpoint-config-agent-guidelines-spec-1-20260416T005035Z.md`

- Finding 1.1 (directional) — Attachment detach endpoint unguarded; passive seeder recovery vs active API guard
- Finding 1.2 (directional) — PATCH protection scope: should isReadOnly/ownerAgentId also be guarded?
- Finding 1.3 (directional) — Route-level 409 test conflicts with api_contract_tests: none_for_now
- Finding 1.4 (ambiguous) — "Staging environment" in §3.8: informal shorthand or actual staging infra?
- Finding 1.5 (directional) — Confidence bands > 0.85 and 0.6-0.85 produce identical behavioral outcome

---

## Iteration 1 Summary

- Mechanical findings accepted:  6
- Mechanical findings rejected:  1
- Directional findings:          4
- Ambiguous findings:            1
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-config-agent-guidelines-spec-1-20260416T005035Z.md
- HITL status:                   pending
- Spec commit after iteration:   7054e4d (no new commit — spec edits are unstaged)
