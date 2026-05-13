# Spec Review Log — personal-assistant-v1, Iteration 4

**Spec:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`
**Spec commit at start:** `36be9f0d9b01003cf0f300c5d016ab1b0f350d6e`
**Codex run:** 4 of 5 (lifetime)

## 15 Codex findings

1. Calendar push references survive across many sections (§6.4, §7.10, §10.9, §18.2, §20.5, §22.1, §24.9, §24.10, §23.2). **mechanical sweep**.
2. Chunk graph A still includes `webhook_channel_registrations`. **mechanical**.
3. Dedup-key naming + Calendar occurrence semantics. **mechanical**.
4. `events.insert` unknown-success after timeout. **mechanical** — add recovery via summary-prefix search OR deterministic event id.
5. EA provisioning idempotency lacks concurrency mechanism. **mechanical** — add advisory lock.
6. `respond_to_invite` Tier 3 + review-gated vs Tier 0-3 auto. **mechanical** — clarify action-level gate overrides tier default.
7. §8.5 `deriveIdempotencyKey` still mentions Google `requestId`. **mechanical** — sweep.
8. `ea_drafts.kind` uses values not in enum (`briefing_unsent`, `retry_required`). **mechanical** — rewrite §16.3/§20.2 to not abuse `ea_drafts`.
9. `ea_drafts` index uses wrong column names (`user_id`, `status`). **mechanical** — fix to `owner_user_id`, `state`.
10. Voice profile attachment to agent has no SOT. **mechanical** — pin to memory_block `ea.voice_profile_id`.
11. Voice derivation events missing from `agentExecutionLog.ts` inventory row. **mechanical** — sweep.
12. Integration test — **AUTO-REJECT (framing)** — fourth repeat.
13. Slack dropdown 3 options identical V1 behaviour. **mechanical** — surface forward-compat label or read-only V1 view.
14. §22.2 "job idempotency table" not specified. **mechanical** — replace with advisory locks + `external_trigger_dedup`.
15. `manual` voice-profile wording conflates refresh policy with sampler. **mechanical** — tighten.

## Counts
- Mechanical accepted: 14
- AUTO-REJECT: 1 (Codex #12 REPEAT)
- AUTO-DECIDED: 0 (no repeats of proposeAction this iter)
- Rejected: 0
