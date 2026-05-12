# Spec Review Log — personal-assistant-v1, Iteration 1

**Spec:** `docs/superpowers/specs/2026-05-12-personal-assistant-v1-spec.md`
**Spec commit at start:** `bd30060a8e7a2a670d6cbe5505bcc369cb8d782f`
**Codex run:** 1 of 5 (lifetime)
**Codex token spend:** 82,338

## Codex findings classification

### Finding 1 — `risk_tier_ceiling = 5` contradicts Tier 6 actions in default allowlist + default approval policy
- Section: §13.1, §13.2, §11.1, §11.4
- Codex fix: Change `risk_tier_ceiling = 6` or remove Tier 6 actions.
- Classification: mechanical | Disposition: auto-apply (set ceiling = 6)
- Reasoning: Internal contradiction; Tier 6 sends are load-bearing for V1.

### Finding 2 — "No external sends" / "No write actions invoked" claims contradict `slack.post_dm` Tier 6 writes
- Section: §11.1, §11.3
- Codex fix: Accurate statement that DM-to-self writes are Tier 6 but auto-allowed.
- Classification: mechanical | Disposition: auto-apply

### Finding 3 — `server/lib/permissions.ts` listed both as "no changes" (§5.3) and "add 6 keys" (§21.5)
- Section: §5.3, §21.5
- Codex fix: Move file to §5.2; remove §5.3 claim.
- Classification: mechanical | Disposition: auto-apply

### Finding 4 — §25.3 integration test "violates pure-function unit tests only"
- Section: §25.3
- Classification: directional | Disposition: AUTO-REJECT (framing)
- Reasoning: Rapid-evolution posture permits ≤3 carved-out integration tests for hot-path concerns (RLS, crash-resume, bulk idempotency). `docs/spec-context.md` lists `rls.context-propagation.test.ts` as accepted. RLS isolation is the exact carve-out kind.

### Finding 5 — External-event dedup leaves two mechanisms (Option A vs Option B)
- Section: §7.1, §7.10, §24.1, §27.1
- Codex fix: Lock to Option A.
- Classification: mechanical | Disposition: auto-apply (spec already recommends Option A)

### Finding 6 — Gmail polling `last_history_id` storage undefined; spec hints "JSONB `meta` column" but table has `config_json`
- Section: §10.4
- Codex fix: Lock to one approach + file inventory.
- Classification: mechanical | Disposition: auto-apply (lock to `integration_connections.config_json` `lastHistoryId` key)
- Reasoning: Verified `integration_connections.ts` has no `meta` column.

### Finding 7 — Goal §2.6 "30 days OR 50 sends" contradicts schema XOR-per-row policy
- Section: §2 goal 6, §7.4, §12.5
- Classification: mechanical | Disposition: auto-apply (align goal text to schema; defer combined policy)
- Reasoning: Codex's recommended schema-extension fix is itself directional; the mechanical fix is the inverse — align prose to actual schema/default.

### Finding 8 — `manual` voice-profile sampler ships V1 but storage undefined
- Section: §7.4, §12.2
- Codex fix: Defer `manual` OR add contracts.
- Classification: mechanical | Disposition: auto-apply (defer to V1.5; rapid-evolution + prefer-existing-primitives)

### Finding 9 — Calendar channel state contradictory source-of-truth
- Section: §7.8, §24.5, §27.4
- Codex fix: DB state is concurrency authority; live Google is reconciliation source.
- Classification: mechanical | Disposition: auto-apply (add clarifier; resolve §27.4)

### Finding 10 — `shared/types/agentExecutionLog.ts` missing from file inventory
- Section: §5.2, §10.7, §11.4, §24.3
- Classification: mechanical | Disposition: auto-apply (add to §5.2)

### Finding 11 — Review-gated action handling bypasses `actionService.proposeAction` primitive
- Section: §8.4, §9.4, §11.6, §24.3
- Codex fix: Compose `proposeAction` for approval state + `ea_drafts` for draft body.
- Classification: directional | Disposition: AUTO-DECIDED → route to tasks/todo.md
- Reasoning: Matches signal "Introduce a new abstraction" + framing "prefer existing primitives". But composition decision is non-trivial; needs architect investigation against `actionService.proposeAction`'s actual contract. Spec NOT edited.

### Finding 12 — Setup route drifts between `/personal/:agentId/setup` and `/personal/setup`
- Section: §5.2, §14.4, §23.2
- Codex fix: Use both consistently.
- Classification: mechanical | Disposition: auto-apply

---

## Rubric findings (Claude pass)

### R1 — §22.5 webhook ingestion latency target "<5s" violates Slack's <3s hard requirement
- Classification: mechanical | Disposition: auto-apply (tighten to <3s)

### R2 — §13.4 voice-profile skip path: step 3 says "skip leaves `optOutAt = now()`" but step 6 only writes a row "if derivation requested"
- Classification: mechanical | Disposition: auto-apply (lock to: skip writes no row; activation lazy-creates)

### R3 — §13.4 step 3 says "(write after step 5)" but memory_blocks write IS step 5
- Classification: mechanical | Disposition: auto-apply (change to "(write at step 5)")

---

## Decisions summary

- Codex findings: 12
- Rubric findings: 3
- Total findings: 15
- Mechanical accepted: 13 (Codex #1, #2, #3, #5, #6, #7, #8, #9, #10, #12 + Rubric R1, R2, R3)
- Mechanical rejected: 0
- AUTO-REJECT (framing): 1 (Codex #4)
- AUTO-DECIDED (deferred to tasks/todo.md): 1 (Codex #11)
- Reclassified → directional: 0

