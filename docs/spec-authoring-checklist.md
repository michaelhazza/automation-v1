# Spec Authoring Checklist

This file is the **pre-authoring checklist** for any non-trivial spec in this repo. It exists because `spec-reviewer` kept catching the same eight categories of problem across 15+ different specs — all of which are cheaper to prevent at authoring time than to fix in a review iteration.

Use it when drafting any **Significant** or **Major** spec (per the task classification in `CLAUDE.md`). It is *not* required for trivial doc updates, ADRs, or single-page clarifications.

> **What this checklist is not.** It is not a replacement for the rules in `architecture.md`, `CLAUDE.md`, or `docs/spec-context.md`. It is a pre-flight checklist that *points at* those rules so the author applies them while writing. When in doubt, the deep references win.
>
> **What this checklist is.** It is the minimum set of authoring decisions that, if missed, force `spec-reviewer` to catch them post-hoc. Every item below has been caught by the reviewer in a production spec.

---

## Table of contents

1. Existing primitives search (before you write)
2. File inventory lock
3. Contracts section (mandatory)
4. Permissions / RLS checklist
5. Execution model (sync/async, inline/queued, cached/dynamic)
6. Phase sequencing (dependency graph)
7. Deferred items section (mandatory, even if empty)
8. Self-consistency pass (last step before review)
9. Testing posture sanity check

Appendix — Pre-review checklist summary

---

## Section 1 — Existing primitives search (before you write)

Before you propose a new table, endpoint, service, or pattern, search the codebase for the closest existing primitive. If one exists, either:

- **Reuse it**, and state that explicitly in the spec, or
- **Extend it** (new column, new arg, new variant), and state why a new primitive would have been wrong, or
- **Invent a new primitive**, and state in one paragraph *why reuse and extension were both insufficient*.

The "invent new" path is the expensive one. Choosing it without justification is the single most common directional finding in the review corpus.

### Searches to run

| Proposing… | Grep | Then check |
|---|---|---|
| A new table | `server/db/schema/**/*.ts` for similar columns or naming | `rlsProtectedTables.ts` to see how neighbouring tables are scoped |
| A new route | `server/routes/**/*.ts` for similar list/get/update shapes | existing permission guards on neighbouring routes |
| A new service | `server/services/**/*.ts` for similar responsibilities | whether an existing `*ServicePure.ts` already exports the logic |
| A new job | `server/jobs/**/*.ts` + `server/jobs/index.ts` | whether an existing job can take a new payload variant |
| A new skill | `server/skills/**/*.md` + `server/config/actionRegistry.ts` | whether the skill is a thin variant of an existing one |
| A new prompt partition or cache tier | the prompt assembly in `agentExecutionServicePure.ts` | which partition the new content genuinely belongs in |
| A new feature flag | `docs/spec-context.md` (`feature_flags: only_for_behaviour_modes`) | whether this is a *behaviour mode* (shadow vs active, dev vs prod) or a rollout gate (the latter is directional and almost always wrong here) |

### Reference

- `docs/spec-context.md` → `accepted_primitives` block. Any primitive listed there is the preferred extension point for its category.
- `CLAUDE.md` → "Key files per domain" table. Start-here file for every common task.

### Reviewer signal this prevents

"You invented a new X, but the codebase already has a similar X — should you reuse it or are these genuinely different?" — caught on ClientPulse-GHL, session-1-foundation, skill-analyzer-v2, and others.

---

## Section 2 — File inventory lock

Every non-trivial spec has a "Files to change" table (usually `§3`, `§4`, or `§11` depending on the spec's template). This table is the **single source of truth** for what the spec touches.

### The rule

Every time you add a prose reference to a new file, column, migration, table, service, or endpoint, **cascade the reference into the inventory in the same edit**. No exceptions, even for "minor" additions — that's the path by which inventory drift gets introduced.

### Consistency pass (before sending to reviewer)

Grep your draft for the following phrases and verify each occurrence is reflected in the file inventory:

- `new table` / `new column` / `new migration`
- `new service` / `new endpoint` / `new route`
- `new job` / `new skill`
- `new hook` / `new middleware`
- `new partition` / `new cache tier`

If any prose reference is missing from the inventory, the reviewer will raise a `file-inventory-drift` finding.

### Reviewer signal this prevents

"File X is referenced in §5 but not in the Files-to-change table" — caught on agent-intelligence, canonical-data-platform, improvements-roadmap, memory-and-briefings, onboarding-playbooks (migration numbers especially).

---

## Section 3 — Contracts section (mandatory)

For every data shape that crosses a service boundary or is consumed by a parser, write a **Contracts** subsection. Do not describe the behaviour in prose without pinning the shape.

### Required fields per contract

- **Name** (e.g. `GEO_SCORE_PAYLOAD`, `agentProposals`, `ConfigQuestion`)
- **Type** (JSON / Drizzle enum / JSONB column / TypeScript union / Postgres composite)
- **Example instance** (one concrete, valid example — not pseudocode)
- **Nullability and defaults** (which fields can be null, what the default is when absent)
- **Producer** (which service/handler/job writes this)
- **Consumer** (which service/parser/UI reads this)

### Why the example matters

A contract without a worked example is ambiguous at the boundary the parser cares about. Example: "score is a number between 0 and 100" does not say whether missing dimensions produce `null`, `0`, or a skipped key — and the parser has to make a choice either way. Pin it in the spec, not in the implementation.

### Reviewer signal this prevents

"X is processed by Y but the payload shape is never defined" — caught on geo-seo, skill-analyzer-v2, improvements-roadmap, robust-scraping, memory-and-briefings.

---

## Section 4 — Permissions / RLS checklist

Every new tenant-scoped table (anything with `organisation_id` or `subaccount_id`) must have all four of the following. If any is absent, document *why* inline in the spec — do not leave it implicit.

### The four requirements

1. **RLS policy** in the same migration that creates the table. See `architecture.md §1155 "Row-Level Security — Three-Layer Fail-Closed Data Isolation"` for the three-layer model and the exact policy shape.
2. **Entry in `server/config/rlsProtectedTables.ts`** — this is the manifest that `verify-rls-coverage.sh` enforces. Missing entry = CI gate failure.
3. **Route-level or middleware guard** if the table is accessed via HTTP. Name the guard in the spec (`authenticate`, `requirePermission(key)`, `resolveSubaccount`, or a new guard with a named location).
4. **Principal-scoped context** if the table is read from an agent execution path. See `architecture.md §1116 "P3B — Principal-scoped RLS"`.

### Opt-out rule

If a new table is intentionally *not* tenant-scoped (e.g. system-wide reference data), write one line explaining why. The reviewer's rubric correctly flags "missing RLS on org-scoped table" and won't be satisfied by implicit reasoning.

### Reviewer signal this prevents

"RLS claimed needed but migration doesn't include policies" / "Endpoint unguarded" / "Access control stated in Goals but not enforced in routes or migrations" — caught on ClientPulse, config-agent-guidelines (multiple rounds), canonical-data-platform, memory-and-briefings.

---

## Section 5 — Execution model (sync/async, inline/queued, cached/dynamic)

If your spec introduces behaviour that crosses a transactional or latency boundary, pick one execution model *explicitly* and keep the rest of the spec consistent with it.

### The three choices

- **Inline / synchronous** — caller blocks on the operation. Use when the result must be available before the caller returns. Example: prompt assembly during an agent run. Do NOT add a pg-boss job row for inline operations.
- **Queued / asynchronous (pg-boss)** — durable, survives restarts, retryable. Use when the operation is decoupled from the caller. Do NOT describe this as "the service does X" in prose — a job processor does X, and the spec should say so.
- **Cached / prompt-partition** — for LLM prompt sections that stay constant for a full request lifecycle. If you claim "stablePrefix", the partition table and the assembly code must both agree. A prompt partition in `dynamicSuffix` with a stated goal of 40–60% cache efficiency is a self-contradicting spec.

### Consistency pass

After writing the execution-model decision, check:

1. Does the job idempotency table include a row for this operation? (Queued only.)
2. Does the route/service prose describe a *synchronous call* or an *enqueue*? Match that to the model above.
3. Does any non-functional goal (cache efficiency, latency budget) contradict the model?

### Reviewer signal this prevents

"Bulk dispatch marked inline but job row exists" / "Briefing in dynamicSuffix vs 40-60% cache efficiency" / "Sync postCall vs async job row" — caught on agent-intelligence, improvements-roadmap.

---

## Section 6 — Phase sequencing (dependency graph)

If your spec has phases, do one explicit pass over the dependency graph *before* sending to review.

### The three failure modes

1. **Backward dependency.** Phase N references a column/table/service that's created in Phase N+k. Fix: move the prerequisite earlier, or move the dependent later, or merge phases.
2. **Orphaned deferral.** A section says "X is deferred to Phase N+1" but Phase N+1 doesn't list X. Either add it to Phase N+1 or move it to the Deferred Items section (see Section 7).
3. **Phase-boundary contradiction.** A phase claims "no migrations" but is assigned a table-creation migration. Usually means the item's phase was changed in one section but not the other.

### How to check

For each phase, list (inline in a scratch note, not in the spec):

- Schema changes introduced: <migration numbers>
- Services introduced: <names>
- Services modified: <names>
- Jobs introduced: <names>
- Columns referenced by code: <column names>

Then for every "referenced by code" column, confirm it's in an equal-or-earlier phase's "schema changes introduced" line.

### Reviewer signal this prevents

"Phase N depends on column X but X ships in Phase N+k" — caught on agent-intelligence, canonical-data-platform, improvements-roadmap, memory-and-briefings.

---

## Section 7 — Deferred items section (mandatory, even if empty)

Every spec has an explicit `## Deferred Items` section listing features/migrations/criteria mentioned in prose but intentionally deferred.

### The rule

Any time prose in the spec uses the words "deferred", "later", "Phase N+1 will", "not in this phase", "future", or "nice to have", the thing being deferred must appear in the Deferred Items section. The section is the single source of truth — prose mentions without a corresponding Deferred entry are treated as in-scope deliverables by readers.

### Format

```markdown
## Deferred Items

- **Name of deferred feature.** Phase N will ship [the small thing]. Phase N+1 will ship [the larger thing]. Reason: <one line>.
- **Another deferred feature.** <same shape>.
```

Empty is fine — if nothing is deferred, write "None." rather than omitting the section, so future readers know the author considered deferrals.

### Reviewer signal this prevents

"S14 described as standalone in §5.10 but marked deferred in Q6" / "Deferred items scattered through prose and inferred rather than listed" — caught on memory-and-briefings, geo-seo.

---

## Section 8 — Self-consistency pass (last step before review)

After completing Sections 1–7, do one final read-through focused on contradictions between sections. This is the cheapest pass to run and the highest-value pass to skip.

### Questions to answer

- Do the **Goals / Philosophy** sections match the **Implementation** sections? (The #1 directional finding — 35% of specs.)
- Does every phase item have an explicit verdict (BUILD IN PHASE N, DEFER, WON'T DO)?
- Does every "single source of truth" claim survive? Grep for the claimed source — is it actually written to by every path the spec describes? Is it filtered out anywhere?
- Do non-functional claims (cache efficiency, latency budgets, cost budgets) match the execution model in Section 5?
- Does every phrase using "must", "guarantees", "idempotent", "source of truth" have a backing mechanism named? Load-bearing claims without a mechanism are the most expensive finding class to fix in review.

### Reviewer signal this prevents

"Goals say X but Implementation does Y" / "Load-bearing claim without enforcement" — caught on agent-intelligence, ClientPulse (multiple), geo-seo, improvements-roadmap.

---

## Section 9 — Testing posture sanity check

Before adding any test plan to the spec, re-read the testing-related sections of `docs/spec-context.md`:

```yaml
testing_posture: static_gates_primary
runtime_tests: pure_function_only
frontend_tests: none_for_now
api_contract_tests: none_for_now
e2e_tests_of_own_app: none_for_now
performance_baselines: defer_until_production
composition_tests: defer_until_stabilisation
```

If your spec's test plan proposes anything in the `none_for_now` or `defer_until_*` categories, either:

- Remove the test plan item, or
- Acknowledge it as a framing deviation in the spec's own Implementation philosophy section (not silently). The reviewer will flag this as directional either way, but flagging it yourself shortens the review loop.

### Reviewer signal this prevents

"Spec proposes E2E/frontend/API-contract tests against framing" — caught on onboarding-playbooks (D1, D2), routines-response.

---

## Appendix — Pre-review checklist summary

Before invoking `spec-reviewer` on a draft spec, answer yes to all of the following:

- [ ] Every new primitive has a "why not reuse" paragraph
- [ ] Every new file / column / migration / endpoint is in the file inventory
- [ ] Every data shape crossing a boundary has a Contracts entry with an example
- [ ] Every new tenant-scoped table has RLS policy + manifest entry + route guard + principal-scoped context (or a documented reason for opting out)
- [ ] Execution model (sync/async, inline/queued, cached/dynamic) is picked explicitly and the prose + inventory + goals all agree
- [ ] Phase dependency graph has no backward references, no orphaned deferrals, no phase-boundary contradictions
- [ ] `## Deferred Items` section exists (even if "None.")
- [ ] Self-consistency pass complete: Goals ↔ Implementation match; every load-bearing claim has a named mechanism
- [ ] Testing plan consistent with `docs/spec-context.md`

If every box is checked, the spec is ready for `spec-reviewer`. If any box is unchecked and you're intentionally leaving it so (e.g. deferring the contract to implementation), mark the deviation inline in the spec's framing section — don't leave it implicit.

---

## Maintenance

This checklist is built from patterns observed in `tasks/spec-review-checkpoint-*.md` across 15+ specs. When a new recurring pattern emerges across three or more specs, extend this checklist with a new section that points at the reviewer signal and the existing deep reference.

When a section of this checklist stops catching recurrent findings (i.e. the reviewer no longer raises that signal for specs authored against this checklist), leave the section in place — it is working. Do not remove "working" sections; only remove sections that turn out to be noisy or wrong.
