# Spec Review Log — personal-assistant-v1, Iteration 2

**Spec:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`
**Spec commit at start:** `f72399a22924d27d9da49de167086ffe0b09b531`
**Codex run:** 2 of 5 (lifetime)

---

## Codex findings

### Finding 1 — §25.3 integration test violates "pure-function only" posture (REPEAT from Iter1)
- Codex fix: Defer the integration test entirely.
- Classification: directional | Disposition: **AUTO-REJECT (framing)** — repeat of Iter1 finding; rapid_evolution posture permits up to 3 carved-out integration tests for hot-path concerns; `accepted_primitives` explicitly lists `rls.context-propagation.test.ts`; the RLS isolation test in §25.3 is exactly the carve-out kind.

### Finding 2 — `*Pure.test.ts` test files required in prose but absent from §5 file inventory
- Section: §5, §25.2
- Codex fix: Add the test files to §5.1.
- Classification: mechanical | Disposition: auto-apply (add the test files as a single inventory row referencing the convention; do not enumerate each)

### Finding 3 — §25.1 static gates list omits `external_trigger_dedup`
- Section: §25.1
- Classification: mechanical | Disposition: auto-apply (add the fourth table to the prose)

### Finding 4 — Gmail push remains in V1 implementation prose + file inventory despite being deferred
- Section: §5.1, §10.2, §24.10, §26
- Codex fix: Scope `googleWebhook.ts` to Calendar push only; remove flag-gated Gmail push path.
- Classification: mechanical | Disposition: auto-apply (drop flag-gated Gmail push code path entirely from V1 — cleaner per "no feature flags in pre-production" framing)

### Finding 5 — `create_event` idempotency uses Google `requestId` parameter that doesn't apply to `events.insert`
- Section: §7.2, §8.4, §24.2
- Severity: critical
- Codex fix: Use a local idempotency record.
- Classification: mechanical | Disposition: auto-apply
- Reasoning: Google Calendar's `events.insert` does NOT honour a `requestId` parameter for idempotency (that's specific to other APIs). Every V1 `create_event` invocation is draft-mediated (Tier 6 review-gated per §13.1 + §11.6); the `ea_drafts.sentMessageId` lifecycle IS the idempotency source — set once on first send, subsequent retries return the existing `sentMessageId`. Prefer existing primitive over new `external_action_idempotency` table.

### Finding 6 — `eaDraftService` state machine vs `actionService.proposeAction` (REPEAT from Iter1 Finding #11)
- Section: §7.5, §11.6, §24.3, §27 open question 15
- Classification: directional | Disposition: **AUTO-DECIDED → REPEAT** — already routed to `tasks/todo.md` as EA-V1-AD1; reflected as §27 open question #15. Phase 2 architect investigates `proposeAction`'s contract before deciding. Not editing the spec — composition choice is non-trivial without primitive contract visibility.

### Finding 7 — Voice-profile refresh stale "30 days OR 50 sends" prose survives in §12.4, §12.5, §22.3
- Section: §12.4 line 947, §12.5 line 961, §22.3 line 1612
- Classification: mechanical | Disposition: auto-apply (replace stale OR-language with "every 30 days (V1 default)"; remove `sent_count_since_derive` reference)

### Finding 8 — `webhook_nonces` architect-choice with no migration/RLS/inventory for the new-table option
- Section: §10.2, §24.10, §27 open question 5
- Codex fix: Lock to "V1 reuses `oauth_state_nonces`; no new nonce table ships."
- Classification: mechanical | Disposition: auto-apply (lock to reuse per "prefer existing primitives" framing; resolve §27 Q5)

### Finding 9 — §23.2 chunk 26 "Workflow implementation modules" with no named files in inventory
- Section: §23.2 chunk F.26
- Codex fix: "Workflow bodies live entirely in the three skill markdown files listed in section 5.1."
- Classification: mechanical | Disposition: auto-apply

### Finding 10 — `docs/integration-reference.md` listed in both chunk B (slug additions) and chunk I.41 (terminal doc-sync)
- Section: §23.2 chunks B.12 + I.41
- Codex fix: Remove I.41 (slugs land in B.12).
- Classification: mechanical | Disposition: auto-apply

---

## Rubric findings (Claude pass)

None this iteration — Iter1 fixes addressed all major rubric gaps. Codex picked up the stale-language tail (#7) which counts as the rubric category here.

---

## Decisions summary

- Codex findings: 10
- Rubric findings: 0
- Total findings: 10
- Mechanical accepted: 8 (Codex #2, #3, #4, #5, #7, #8, #9, #10)
- Mechanical rejected: 0
- AUTO-REJECT (framing): 1 (Codex #1)
- AUTO-DECIDED (already routed): 1 (Codex #6)
- Reclassified: 0

