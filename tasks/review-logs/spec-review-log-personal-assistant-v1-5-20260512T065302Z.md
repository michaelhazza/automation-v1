# Spec Review Log — personal-assistant-v1, Iteration 5 (CAP)

**Spec:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`
**Spec commit at start:** `4dd3a488a44967c5dee56a716767db664152e2d8`
**Codex run:** 5 of 5 (lifetime — MAX_ITERATIONS cap reached after this iteration)

## 9 Codex findings

### Finding 1 — Reverse iter3 deferral of `googleWebhook.ts`
- Codex says spec contradicts required V1 scope by deferring the route.
- Classification: directional (reverses a correctness-driven spec decision)
- Disposition: **REJECT** — the iter3 reasoning still holds: Google Calendar push notifications fire on event create/update/delete, NOT at reminder time. With V1 having no local Calendar mirror (§18 live-fetch), push provides no V1 consumer. Re-introducing the route creates unused code. The user-prompt's "new google webhook route" mention reflected pre-correction scope; iter3 corrected the architecture. Spec stands.

### Finding 2 — Integration test (5th REPEAT)
- Classification: directional | Disposition: AUTO-REJECT (framing)

### Finding 3 — Slack auto-send dropdown wording survives in goals + workflow + open-questions
- Section: §2.3, §11.1 (step 6), §27 Q7
- Classification: mechanical | Disposition: auto-apply (sweep)

### Finding 4 — Trigger subscriptions never provisioned (CRITICAL)
- Section: §13.4 provisioning steps
- Classification: mechanical | Disposition: auto-apply (add step that seeds `agent_triggers` rows for inbox_triage + meeting_prep)

### Finding 5 — Dedup contract still has three shapes + stale `externalEventId` wording
- Section: §10.9, §24.9
- Classification: mechanical | Disposition: auto-apply (sweep)

### Finding 6 — Slack mention owner resolution underspecified
- Section: §10.2, §10.3, §10.6
- Classification: mechanical | Disposition: auto-apply (add: resolve via owner-scoped integration_connections matching the Slack team_id + bot-installer; emit `trigger.suppressed reason=owner_unresolved` on zero-or-multiple matches)

### Finding 7 — voice_profiles RLS lacks admin path for owner-scoped rows (CRITICAL)
- Section: §12.7, §21.1
- Classification: mechanical | Disposition: auto-apply (extend RLS to include admin role; rely on API serialisation for content redaction)

### Finding 8 — Voice profile attachment opt-out clears EITHER memory_block OR optOutAt
- Section: §12.4 (iter4 added the dual-clear language)
- Classification: mechanical | Disposition: auto-apply (opt-out ONLY sets `optOutAt`; the memory_block attachment persists across opt-out/reactivation)

### Finding 9 — `manual` voice-profile source described as both excluded AND reserved
- Section: §26 deferred item wording
- Classification: mechanical | Disposition: auto-apply (clarify: `manual` is not in the V1 source enum; activation requires a future migration)

## Counts
- Mechanical accepted: 7
- Mechanical rejected: 1 (Codex #1)
- AUTO-REJECT (framing): 1 (Codex #2)
- AUTO-DECIDED: 0
- Reclassified: 0
