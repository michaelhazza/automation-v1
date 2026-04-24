# Riley Observations — Implementation Plan Index

**Build slug:** `riley-observations`
**Source spec:** [`docs/riley-observations-dev-spec.md`](../../../docs/riley-observations-dev-spec.md) (1973 lines, ChatGPT round-4 verdict: ready to merge / proceed to implementation)
**Source brief:** [`docs/riley-observations-dev-brief.md`](../../../docs/riley-observations-dev-brief.md) (reference only — spec supersedes)
**Mockups:** [`prototypes/riley-observations/index.html`](../../../prototypes/riley-observations/index.html) (10 mockups; binding per spec §3a.2)
**Design principles:** [`docs/frontend-design-principles.md`](../../../docs/frontend-design-principles.md) (binding)
**Review log:** [`tasks/review-logs/chatgpt-spec-review-riley-observations-2026-04-23T08-33-46Z.md`](../../review-logs/chatgpt-spec-review-riley-observations-2026-04-23T08-33-46Z.md) (4 rounds; every applied/rejected/deferred decision with rationale)
**PR (spec):** #179

---

## Wave granularity — confirmed

Spec §12.21 recommends one plan per Wave. The architect confirms this split — four wave plans under `tasks/builds/riley-observations/`. W0 (Part 6 — doc-only edit to `docs/spec-authoring-checklist.md`) is handled as a one-shot commit outside the planning surface and is not covered here.

| Wave | Parts | Plan file | Migration(s) | Estimated effort |
|---|---|---|---|---|
| **W1** | Part 1 (naming pass) + Part 2 (Workflows calling Automations) | [`plan-w1-naming-and-composition.md`](./plan-w1-naming-and-composition.md) | M1 / M2 / M3 — three strict-ordered renames, plus §5.4a capability-contract columns on `automations` (added inline with M2) | ~2 days |
| **W2** | Part 3 (Explore Mode / Execute Mode) | [`plan-w2-explore-execute-mode.md`](./plan-w2-explore-execute-mode.md) | 0205 | ~1 day |
| **W3** | Part 5 (context-assembly telemetry) | [`plan-w3-context-assembly-telemetry.md`](./plan-w3-context-assembly-telemetry.md) | None | ~0.5 day |
| **W4** | Part 4 (heartbeat activity-gate) | [`plan-w4-heartbeat-gate.md`](./plan-w4-heartbeat-gate.md) | 0206 | ~1–2 days |

**Total:** ~4.5–5.5 engineering-days. Matches the brief's ~3–4 days plus a half-day review margin across the four waves.

---

## Migration ordering — pinned

Spec §10.1 lists migrations 0202–0206. The numbers `0202/0203/0204` are already used on `main` by prior work (cached-context infrastructure). The Sonnet execution session picks the next-available contiguous triple for W1's three rename migrations at branch-off time (`ls migrations/ | sort | tail`), preserving strict order. W2 and W4 use the spec's `0205`/`0206` — if those numbers are also taken when the waves land, renumber identically at branch-off.

Strict-order constraint: **M1 → M2 → M3 (W1) → (W2 migration, W4 migration) in either order after W1**. M3 cannot ship before M1 clears the `workflow*` namespace (Postgres-level hard constraint; spec §4.2). W2 and W4 both reference post-rename table names (`workflow_runs`, `agent_runs`) and cannot run before W1 lands.

Every forward migration has a paired down-migration under `migrations/_down/` authored in the same commit.

---

## Cross-wave coordination

- **W1's rename touches files referenced by every other wave.** Every wave plan uses post-rename names (`workflow_runs`, `automations`, `workflow_templates`, `WorkflowRunModal`, etc.). W2/W3/W4 cannot start coding against `main` until W1 merges — waves in-flight during W1's merge coordinate via the rebase script + codemod (`scripts/rebase-post-riley-rename.sh` / `scripts/codemod-riley-rename.ts`; see W1 §4.5).
- **Post-W1 PR window is 72 hours (spec §10.4).** Any other wave PR in-flight during that window needs rebase + codemod run. The Sonnet execution session should not open two Riley-observations PRs concurrently.
- **Telemetry events all land in `server/lib/tracing.ts`.** W1 registers `workflow.step.automation.dispatched` + `workflow.step.automation.completed`. W3 registers `context.assembly.complete`. W4 registers `heartbeat.tick.gated`. No cross-wave ordering constraints on `tracing.ts` edits beyond "later waves append, don't overwrite."
- **Mock 10 binds to the same file across W2 + W4** — `client/src/pages/AdminAgentEditPage.tsx`, Schedule & Concurrency section L1410–1531. W2 adds the safety-mode field; W4 adds the heartbeat-gate toggle. Both are Edit-only, same section, complementary additions. Coordination: the wave that ships second rebases onto the first's edits.
- **No parallel config pages.** Spec §3a.2 locks 1 + 2 + 8 bind existing-page extensions. Every plan's file-inventory table uses `Edit` for: `AdminAgentEditPage.tsx`, `SubaccountAgentEditPage.tsx`, run-log row rendering, Workflows library, Automations library. No plan introduces a new "Agent Safety Settings", "Agent Config", "Run Detail", or "Agent Observability" page.

---

## Pre-coding decisions resolved

The plan closes every pre-coding question from `tasks/todo.md` §"Deferred from spec-reviewer review — riley-observations-dev-spec (2026-04-22)" inside the relevant wave plan. Architect decisions per wave:

| # | Decision | Wave | Outcome |
|---|---|---|---|
| 1 | `input_schema` / `output_schema` validator + format | W1 | **zod, best-effort, `additionalProperties: true` default.** Parse as JSON, validate against a minimal JSON-Schema subset (`properties`, `required`, `additionalProperties`); skip silently if empty/unparseable. Module: `server/lib/workflow/invokeAutomationSchemaValidator.ts`. |
| 2 | Portal safety_mode field | W2 | **`subaccount_agents.portal_default_safety_mode text NOT NULL DEFAULT 'explore'`** in migration 0205. |
| 3 | `system_skills.side_effects` runtime storage | W2 | **Top-level column** `system_skills.side_effects boolean NOT NULL DEFAULT true` in migration 0205, backfilled from the markdown audit. |
| 4 | Supervised-mode removal call-site audit | W2 | 7 load-bearing sites enumerated inline (Modal, run service, engine service, route, schema types, workflow types, test fixtures). Not a decision — an audit step. |
| 5 | `safety_mode` vs pre-existing `run_mode` reconciliation | W2 | **Keep the split.** New `safety_mode` column on `workflow_runs` alongside the legacy `run_mode` enum. |
| 6 | Rule 3 "Check now" fate | W4 | **Drop Rule 3 from v1.** Ship with 3 rules. `'explicit_trigger'` reserved as enum value for additive post-launch re-introduction. |
| 7 | "Meaningful" output definition | W4 | `status = 'completed'` AND (≥ 1 action proposed OR ≥ 1 memory block written). Hook in `agentRunFinalizationService.ts`. |
| 8 | Event-source table list per heartbeat-enabled agent | W4 | **Portfolio Health only currently enabled.** Generic fallback covers other agents if operators flip the toggle. |

W3 has no pre-coding decisions — it inlines the two §12.5 advisory items (tracing-latency assessment confirms <5ms realistic; `gapFlags` source per flag enumerated).

---

## Out of scope for this build

Explicitly deferred — listed in `tasks/todo.md` under "Deferred from chatgpt-spec-review — riley-observations-dev-spec (2026-04-23)" and "Implementation-time follow-ups for riley-observations." Do NOT plan these:

1. Automation + Workflow versioning and marketplace-readiness (§9b)
2. `automations.deterministic` flag (§9b sub-block)
3. `automations.expected_duration_class` flag (§9b sub-block)
4. `irreversible` as third `side_effects` enum value (§9b sub-block)
5. Thin execution test harness (post-v1 follow-up per ChatGPT round-4 closing verdict)

---

## Orientation for the Sonnet execution session

When switching to Sonnet via `superpowers:executing-plans` / `superpowers:subagent-driven-development`, read this index first, then the wave plan you're about to execute. Each wave plan is self-contained — it names the migrations, enumerates every file to Edit vs Write, pins every architect decision, and cites every mockup. The execution session does not need to re-read the spec unless a plan entry cross-references a spec section you haven't seen.

**Start with W1.** Every other wave depends on W1's rename. Don't interleave waves; ship one PR per wave.

**Per-wave ritual:**

1. Read the wave plan.
2. Work through the file-inventory table top-to-bottom. Each row is one `Edit` or `Write` operation.
3. Run the wave plan's Test strategy section (pure-function suites; no MSW; codebase framing `static_gates_primary`).
4. Invoke `spec-conformance` on the wave's spec sections when the wave claims complete.
5. Invoke `pr-reviewer` after `spec-conformance` is green.
6. Open PR.

**The plan does not re-state the spec's reviewer checklist (§11.3), test strategy per Part (§11.2), or contracts table (§9a).** Refer to the spec directly when the plan cites those sections.
