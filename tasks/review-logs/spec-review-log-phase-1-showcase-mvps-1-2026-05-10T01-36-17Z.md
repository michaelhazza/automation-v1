# Iteration 1 — phase-1-showcase-mvps

- Spec commit at start: `9e82e1a8c585d539e71361510a730c8ebe8ea9a2`
- Codex output: `tasks/review-logs/_codex_phase-1-showcase-mvps_iter1_2026-05-10T01-36-17Z.txt` (16,123 lines, 17 numbered findings)

## Findings index

- C1 §8.3/§8.4 rollout-flag conflict — mechanical, accept
- C2 §7.1/§7.2 frontend+E2E test conflict — mechanical, accept
- C3 §3.3 INV-8 vs §5.3.4 controllerStyle contradiction — mechanical, accept
- C4 §0.2 predecessor "build pending" stale — mechanical, accept
- C5 §2.2 NG1 SLA-source ambiguity — mechanical, accept
- C6 §2.2 NG3 vs §5.3.1 web_search drift — mechanical, accept
- C7 §5.3.1/§5.4.2 missing risk tier for non-support skills — mechanical, accept
- C8 §5.3 agent_config shape mismatch with `SupportInboxAgentConfig` — mechanical, accept
- C9 §5.2/§5.3.3 per-ticket atomic claim missing — mechanical, accept
- C10 §6.1.2 run_artifacts uniqueness gap — mechanical, accept
- C11 §4.6.1 vs §6.1.2 S3 failure-state phantom contract — mechanical, accept
- C12 §6.1 iee_artifacts vs run_artifacts source-of-truth — mechanical, accept
- C13 §5.5.4 RLS coverage gap on supportEvalRuns — mechanical, accept
- C14 §3.5/§5.6.3 event naming `phase1.support.*` vs `support.*` — mechanical, accept
- C15 §9.2 eval threshold movable — directional, AUTO-DECIDED reject
- C16 §11.1-11.4 open decisions block build — directional, AUTO-DECIDED reject
- C17 §4.4.3 file inventory: agentRunCompletedHandler.ts non-existent — mechanical, accept
- R2 missing `## Deferred Items` section per checklist §7 — mechanical, accept
- R3 frontmatter not canonical per checklist §11 — mechanical, accept
- R5 §5.5.4 missing eval CI gate file — mechanical, accept

## Counts

- Mechanical accepted: 18
- Mechanical rejected: 0
- Directional / ambiguous (auto-decided reject, routed to todo.md): 2 (C15, C16)
- Reclassified → directional: 0

## Applied changes (summary)

- Frontmatter (R3): canonical Status / Spec date / Last updated / Author block.
- §0.2, §0.4 (C4): predecessor "build pending" language removed; canonical layer treated as locked.
- §1.2, §1.3, §3.3 INV-8 (C3): Both MVPs run as Native Controller throughout Phase 1; light Operator escalation = `assign + internal note + Run Trace event`. No per-task switch to `'operator'`.
- §2.2 NG1 (C5): SLA columns in canonical schema explicitly called out as inert provider metadata.
- §2.2 NG3 (C6): no `search_knowledge_base`, no `web_search` in the Support Agent's default skills for Phase 1.
- §3.5 INV-16 (C14): event names align — `phase1.support.*` is both the structured log code AND the Run Trace event_type discriminator. Added `phase1.support.collision_skipped`, `phase1.macro.login_failed`, `phase1.macro.run_stuck`.
- §4.4.3 (C17): file path corrected to `server/jobs/ieeRunCompletedHandler.ts` (existing handler, extended).
- §4.5.3 (C2): replaced React component test row with a single integration test for the new artifacts route.
- §4.6.1 (C11): S3 upload failure terminates the run with `failureReason: 'artifact_upload_failed'`; no partial `run_artifacts` row, no phantom Retry-upload UI.
- §4.6.3 (C2): replaced "Failure-mode integration tests" with a pure-function test for the stale-step detector.
- §5.3.1 (C6, C7, C8): default skill list → 12 entries (11 `support.*` + `ask_clarifying_question`); risk-tier table adds `ask_clarifying_question`; agent_config shape aligned with existing `SupportInboxAgentConfig` Zod schema; three additive optional fields (`minConfidence`, `voiceProfile`, `escalationCategories`) called out with defaults; default-mode-on-install behaviour stated explicitly.
- §5.3.4 (C9): NEW subsection — per-ticket atomic claim contract using existing `bot_claimed_at` / `bot_claimed_by_run_id`. Idempotency posture (state-based), retry classification (safe under TTL), claim TTL (15 min default), claim release on terminal verdict, per-ticket terminal-verdict enum.
- §5.3.5 (renumbered): "Why Native Controller, not Operator" — unchanged content, just renumbered.
- §5.4.2 (C7): risk-tier table extended with `ask_clarifying_question`.
- §5.4.3 (C2): pure-function tests instead of "unit tests with fixture tickets" + "dispatch tests"; added a `*Pure.ts` helper file for clean separation.
- §5.5.4 (C13, R5, C2): RLS registration in `rlsProtectedTables.ts` added to file inventory; `scripts/gates/verify-support-agent-eval-thresholds.sh` added to file inventory; replaced "tests + integration" line with a pure-function test for threshold/drift math.
- §5.6.2 (C8): UI fields use existing `SupportInboxAgentConfig` field names; `promptOverride` reused for custom voice prompt.
- §5.6.3 (C14): Run Trace event names aligned to `phase1.support.*` namespace.
- §5.6.4 (C8, C2): added `shared/types/supportInboxAgentConfig.ts` additive Zod fields; removed component test row.
- §6.1.2 (C10, C12): added `UNIQUE (storage_provider, storage_key)` index; documented idempotency posture (key-based), retry classification (safe), HTTP mapping for `23505` (200 idempotent hit). Documented `iee_artifacts` vs `run_artifacts` source-of-truth precedence.
- §6.1.6 (C2): pure-function tests + a single integration test for the round-trip; removed the broader "E2E test" row.
- §7 (C2, R5): Test Strategy rewritten to align with framing (static-gates-primary, pure-function unit tests, two narrow integration tests, no frontend/E2E component tests). The eval CI gate is documented as CI-only.
- §8.3 / §8.4 (C1): feature flags removed; per-subaccount enablement uses existing `subaccount_agents.is_active` and `canonical_inboxes.agent_config.mode`.
- §10.5 (R2): NEW `## Deferred Items` section with 11 entries derived from NG1-NG10 and other prose deferrals.
- §11 ToC entry added.

Routed to `tasks/todo.md` § Deferred spec decisions — phase-1-showcase-mvps:
- PSM-D1 (= C15): tighten eval acceptance threshold? (left as tunable per operator pre-pass)
- PSM-D2 (= C16): resolve §11 open decisions pre-build, or let architect carry them? (left for architect plan-breakdown)

