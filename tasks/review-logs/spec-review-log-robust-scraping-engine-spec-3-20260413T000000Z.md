# Spec Review Log — Iteration 3
**Spec:** `docs/robust-scraping-engine-spec.md`
**Spec commit:** 71ce9477d60b24a88cde7a332258934ed413f9a8 (uncommitted changes)
**Spec-context commit:** 7cc51443210f4dab6a7b407f7605a151980d2efc
**Timestamp:** 2026-04-13T00:00:00Z

---

## Pre-iteration: HITL decision applied (Finding 2.12)

Decision: apply-with-modification. Removed taskType column reference, replaced metadata field with brief field (structured text), updated step 7, added no-new-file note.

---

## Classification Decisions (Part 1 — Findings 3.1–3.5)

FINDING #3.1
  Source: Codex | Section: §7d / §12a
  Description: Agent has no skill/API to read scraping_cache baseline or know its scheduledTaskId on scheduled runs.
  Codex fix: Move to server-side runner, or add monitor-baseline read/write primitives.
  Classification: directional
  Reasoning: "This should be its own service" — architecture signal. Deciding whether the agent, a new skill, or a server runner handles baseline comparison is a product direction call.
  Disposition: HITL-checkpoint

FINDING #3.2
  Source: Codex | Section: §3d / §5b / §7d
  Description: §5b says selector_group default is "auto-generated from URL pattern"; §7d defines it as hostname+sha256(fields).slice(0,8) — two different formulas.
  Classification: mechanical
  Disposition: auto-apply
  Fix applied: Updated §5b selector_group description to show the exact derivation formula from §7d.

FINDING #3.3
  Source: Codex | Section: §7a / §11a / §15
  Description: §7a shows all three handler registrations together; §15 says to add them in phases 1, 2, 4 separately.
  Classification: mechanical
  Disposition: auto-apply
  Fix applied: Added phase note and inline comments to §7a handler registration block.

FINDING #3.4
  Source: Codex | Section: §7c
  Description: executeScrapeStructured described as "similar pattern" — no concrete response contract.
  Classification: mechanical
  Disposition: auto-apply
  Fix applied: Replaced one-line §7c description with concrete TypeScript response interface.

FINDING #3.5
  Source: Codex | Section: §4b / §5b
  Description: §5b shows parallel arrays in example but §4b never formally states this as the output shape convention.
  Classification: mechanical
  Disposition: auto-apply
  Fix applied: Added output shape convention sentence to §4b step 4.

---

## Classification Decisions (Part 2 — Findings 3.6–3.11 + Rubric)

FINDING #3.6
  Source: Codex | Section: §7d
  Description: brief-based monitor config is brittle — suggests structured JSON metadata instead.
  Classification: reject
  Reject reason: Conflicts with HITL decision just applied (Finding 2.12). The human chose brief because the schema has no metadata column. The brief IS machine-parseable. Codex was not aware of the resolved HITL decision.

FINDING #3.7
  Source: Codex | Section: §13a
  Description: In-memory rate limiter only works within one process.
  Classification: directional
  Reasoning: Architecture signal (shared backing store = new dependency) + production-caution (rate limiting). Pre-production framing — this is the human's call.
  Disposition: HITL-checkpoint

FINDING #3.8
  Source: Codex + Rubric-schema-overlaps | Section: §10
  Description: RLS policies use wrong setting name (app.current_org_id vs app.organisation_id), omit WITH CHECK, omit FORCE ROW LEVEL SECURITY — deviating from migrations 0079-0083 convention.
  Classification: mechanical
  Disposition: auto-apply
  Fix applied: Updated both RLS blocks in §10 to use correct setting name, null guard, WITH CHECK, FORCE ROW LEVEL SECURITY, DROP POLICY IF EXISTS.

FINDING #3.9
  Source: Codex + Rubric-load-bearing-claims | Section: §7d step 4
  Description: Step 4 only lists rrule and brief; scheduledTasks requires title, assignedAgentId, scheduleTime, timezone (all NOT NULL).
  Classification: mechanical
  Disposition: auto-apply
  Fix applied: Expanded §7d step 4 to list all required fields with concrete values. Timezone: UTC. scheduleTime: extracted from rrule. title: derived formula.

FINDING #3.10
  Source: Codex + Rubric-load-bearing-claims | Section: §13e / §2f
  Description: Spec never states whether contentHash uses pre- or post-truncation content — ambiguity for change detection on large pages.
  Classification: mechanical
  Disposition: auto-apply
  Fix applied: Added clarification to §13e that hashing/baseline storage always use full payload; 50KB truncation applies only to agent-facing content.

FINDING #3.11
  Source: Codex + Rubric-load-bearing-claims | Section: §6c / §7d
  Description: idempotencyStrategy: 'keyed_write' declared but deduplication key never defined.
  Classification: mechanical
  Disposition: auto-apply
  Fix applied: Added inline comment defining idempotency key as SHA-256(subaccountId + url + watch_for + frequency + fields).

FINDING #3.R4
  Source: Rubric-load-bearing-claims | Section: §7d step 4
  Description: scheduledTasks required fields (title, assignedAgentId, scheduleTime) absent from step 4.
  Classification: mechanical
  Disposition: auto-apply (resolved as part of Finding 3.9 fix)

---

## Iteration 3 Summary

- Mechanical findings accepted:  9 (3.2, 3.3, 3.4, 3.5, 3.8, 3.9, 3.10, 3.11, 3.R4)
- Mechanical findings rejected:  1 (3.6)
- Directional findings:          2 (3.1, 3.7)
- Ambiguous findings:            0
- Reclassified → directional:    0
- HITL checkpoint path:          tasks/spec-review-checkpoint-robust-scraping-engine-spec-3-20260413T000000Z.md
- HITL status:                   pending
- Spec commit after iteration:   71ce9477d60b24a88cde7a332258934ed413f9a8 (uncommitted changes)
