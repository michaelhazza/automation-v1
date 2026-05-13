# Live backlog — in-flight items only

**Purpose.** This file holds only items that are mid-flight or imminently actionable. It is intentionally short. If an item belongs on a watchlist, in a future spec, in an architecture doc, or in an ADR — it does not belong here.

**Last triaged:** 2026-05-13 (Chunk 13.A inventory → Chunk 13.B sweep). Pre-sweep file (4,408 lines) is preserved verbatim in `tasks/todo-archive/2026-Q2.md § Bulk legacy backlog sweep — 2026-05-13`.

---

## How to use this file

1. **Adding an item.** Only add an item here if it is a concrete, claimable task that is being actively worked or will be worked in the next 1–2 weeks. Everything else goes in:
   - `tasks/builds/<slug>/spec.md` — for future-feature stubs (one paragraph each)
   - `tasks/todo-archive/<quarter>.md` — for items resolved, superseded, or accepted-as-is
   - `docs/decisions/<NNNN>-<slug>.md` — for durable architectural choices
   - `KNOWLEDGE.md` — for patterns / gotchas / conventions
   - `architecture.md` — for canonical structural rules
2. **Removing an item.** When an item is resolved, archived, or promoted, replace its body with a one-line back-reference to the new home. Do not silently delete.
3. **Quarterly trim.** Once per quarter, sweep `[x]` / CLOSED / RESOLVED rows to the archive under a "Bulk closed items — <date> sweep" heading. No per-item rationale needed; each row carries its own context.

---

## Currently active items

_(none — see `tasks/current-focus.md` for sprint-level pointer; status NONE as of 2026-05-11)_

---

## Pick-next queue

The pick-next backlog now lives as one-paragraph stub specs under `tasks/builds/<slug>/spec.md`. Each stub names a trigger condition and a one-line scope statement; `architect` expands at activation time. Browse the list with `ls tasks/builds/`.

The 38 SHIP stubs created in the 2026-05-13 sweep are listed in `tasks/todo-triage-inventory.md § 3`. Notable near-term candidates:

- `tasks/builds/sandbox-isolation-mvp/spec.md` — critical-path completion for the sandbox primitive once the e2b account is provisioned.
- `tasks/builds/operator-session-identity-v2/spec.md` — 13 OSI-DEF items from PR #286.
- `tasks/builds/workflows-v1-phase-2-gaps/spec.md` — 11 Phase 2 conformance gaps consolidated.
- `tasks/builds/lael-llm-request-emission/spec.md` — Live Agent Execution Log timeline "doing phase" wiring.
- `tasks/builds/ghl-oauth-hardening-v2/spec.md` — pre-launch GHL OAuth + auto-onboard hardening.

---

## Architectural decisions awaiting confirmation

Five new ADRs landed in the 2026-05-13 sweep (slots 0017–0021); the rationale and trigger-to-revisit for each is documented in the ADR itself, not here.

- `docs/decisions/0017-retrieval-ranker-v1-simplified.md` — auto-knowledge-retrieval ranker direction locked to v1-simplified.
- `docs/decisions/0018-overlay-stack-ownership.md` — central overlay-stack manager primitive for frontend.
- `docs/decisions/0019-job-result-and-review-loop-contracts.md` — `JobResult` discriminated union + review verdict vocabulary.
- `docs/decisions/0020-test-conventions-vitest-and-test-folder.md` — Vitest-only, `__tests__/` folder, `.js` relative imports.
- `docs/decisions/0021-workflows-v1-v2-boundary.md` — Workflows V1 → V2 boundary contract.

---

## Watchlist (not actionable yet — trigger-gated)

These items are deliberately not in flight. Each has a named trigger that will move it to a SHIP stub or active item.

- **`local-dev-*` → `v1.0.0` flip + real e2b template publish** (SANDBOX-F1 in legacy backlog). Operator action when the e2b account is provisioned. See `tasks/builds/sandbox-isolation-mvp/spec.md` for the surrounding work.
- **External Call Safety Contract abstraction** (`tasks/builds/external-call-safety-contract/spec.md`). Trigger: next subsystem that re-invents the intent-record / single-terminal-transition pattern.
- **Phase-5A canonicalRegistryDrift test upgrade** (`tasks/builds/canonical-registry-three-set-drift-test/spec.md`). Trigger: next `canonical_*` table OR Phase 5A spec authoring.
- **Run-debugger view** (`tasks/builds/run-debugger-view/spec.md`). Trigger: operator complaint about cross-service grep being the only diagnostic entry point.

---

## Pre-launch / paused builds

- **`support-desk-canonical` on `claude/support-ticket-structure-xMcy8`, PR [#277](https://github.com/michaelhazza/automation-v1/pull/277).** Phase 2 (BUILD) was previously recorded complete; resume from `tasks/builds/support-desk-canonical/handoff.md`. The Phase 2 follow-up scope lives in `tasks/builds/support-desk-canonical-phase-2/spec.md`.

---

## Pointers to upstream homes

- **Active sprint / current focus:** `tasks/current-focus.md`
- **Archive (pre-2026-05-13 backlog):** `tasks/todo-archive/2026-Q2.md`
- **Triage inventory (what moved where):** `tasks/todo-triage-inventory.md`
- **Spec stubs (38 SHIP items):** `tasks/builds/<slug>/spec.md`
- **ADRs:** `docs/decisions/`
- **Knowledge patterns:** `KNOWLEDGE.md`
- **Architectural rules:** `architecture.md`
