# Spec Review Final Report

**Spec:** `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md`
**Spec commit at start:** `c70d694fbdd3254e7320e8df24989968cb1c5648`
**Spec commit at finish:** `10a99d725ca87f75f3240bfc7fd2a701a578fe0a`
**Spec-context commit:** `1eb4ad72f73deb0bd79ad333b3f8caef23418392`
**Iterations run:** 4 of 5
**Exit condition:** two-consecutive-mechanical-only (iterations 3 and 4 both surfaced only mechanical findings)
**Verdict:** READY_FOR_BUILD (4 iterations, 11 mechanical fixes applied, 1 directional finding AUTO-DECIDED to tasks/todo.md)

---

## Iteration summary table

| # | Codex findings | Rubric findings | Accepted | Rejected | Auto-decided (framing) | Auto-decided (convention) | AUTO-DECIDED (best-judgment) |
|---|----|----|----|----|----|----|----|
| 1 | 5 | 0 | 4 | 1 | 0 | 0 | none |
| 2 | 4 | 0 | 3 | 0 | 0 | 0 | 1 (Task 6 volume re-scope → tasks/todo.md) |
| 3 | 2 | 0 | 2 | 0 | 0 | 0 | none |
| 4 | 2 | 0 | 2 | 0 | 0 | 0 | none |
| **Total** | **13** | **0** | **11** | **1** | **0** | **0** | **1** |

---

## Mechanical changes applied

### Task 2 — N-2 (`await await` typo)
- Replaced "(one occurrence)" with "(multiple occurrences — remove every match in the file)" for `canonicalDataService.principalContext.test.ts` (file actually has 5 occurrences). Iteration 1.

### Task 4 — F3 (`liveAgentCount` Dashboard badge)
- Corrected the route in the NavItem snippet from `to="/"` to `to="/clientpulse" exact` to match `Layout.tsx:848`. Iteration 1.
- Updated the locator narrative to point at the ClientPulse Dashboard nav and clarify that `to="/"` is the Home/Inbox nav, not Dashboard. Iteration 1.
- Added explicit prerequisite that the entire ClientPulse nav section is gated by `hasOrgContext && hasSidebarItem('clientpulse')` at `Layout.tsx:845`; "badge invisible" is expected when ClientPulse is not enabled. Iteration 1.
- Added a verification prerequisite at Task 4.3 that the dev verification org/subaccount must have ClientPulse enabled. Iteration 1.

### Task 5 — F4 (eslint-disable audit)
- Removed stale baseline counts (`12`, `5×`, `3×`, `4×`) from §5.1 and rephrased to lean on the inventory grep as the source of truth. Iteration 2.
- Replaced the stale "12 → 9" example acceptance framing in §5.3 and pointed at the new F4 audit-tallies sub-table for recording deltas. Iteration 2.

### Task 6 — F6 (`Record<string, unknown>` audit)
- Expanded the §6.1 inventory grep scope from `server/ client/ shared/ scripts/` to `server/ client/ shared/ scripts/ worker/ tools/` to match the F4 inventory and capture worker-side occurrences (10 confirmed). Iteration 1.
- Pointed §6.4 at the new F6 audit-tallies sub-table for recording A/B/C tallies. Iteration 2.
- Replaced the §6.3 "note in F6 task self-review" instruction with a pointer to `tasks/todo.md § Deferred spec decisions — pr-249-followups` as the canonical record; no in-spec self-review note required. Iteration 3.

### Task 7 — Doc-sync
- Replaced the two-verdict rule (`yes/no` only) with the three-verdict rule (`yes (sections X, Y) | no — <rationale> | n/a`) per `docs/doc-sync.md § Verdict rule`. Iteration 3.
- Added explicit pointer to `docs/doc-sync.md § Investigation procedure` as the gate for assigning any verdict. Iteration 3.
- Added a verdict-destination instruction: verdicts go in the closing PR description under a `## Doc-sync verdicts` section. Iteration 4.

### Classification (line 13)
- Changed "5 tasks" to "7 tasks (5 backlog items + pre-flight + doc-sync)" to match Contents and DoD. Iteration 2.

### Self-review against backlog source
- Extended the section with two new sub-tables: `F4 audit tallies` (initial/final count, removed-redundant, kept-with-justification breakdown) and `F6 audit tallies` (initial inventory, A/B/C counts, net total). Iteration 2.

### Definition of Done
- Disambiguated the bare "N-2, N-4, F3-cgpt, F4-cgpt, F6-cgpt" reference by quoting the source-log section headings under which the spec-relevant entries live, and explicitly listed the unrelated N-2/N-4 entries the implementer must NOT touch. Iteration 4.

### tasks/todo.md (companion update)
- Added `## Deferred spec decisions — pr-249-followups (2026-05-01)` section with two entries: F6 volume re-scope option and F6 ClientPulse intervention-payload discriminated-union refactor. Iterations 2 and 3.

---

## Rejected findings

| # | Iteration | Section | Description | Reason |
|---|---|---|---|---|
| 1 | 1 | Task 1, 2, 5, Verification | Codex flagged bash-style commands (`grep -c`, `grep -rn`, `2>/dev/null`, `$(git ls-files ...)`) as not-implementation-ready on a Windows/PowerShell environment. | CLAUDE.md establishes bash as the project's working shell. The bash-style commands are repo-canonical. Codex misread the environment because the codex CLI itself runs through PowerShell on the reviewer machine. |

---

## Directional and ambiguous findings (autonomously decided)

| Iteration | Title | Classification | Decision | Rationale |
|---|---|---|---|---|
| 2 | Task 6 (`Record<string, unknown>` audit) volume vs Standard classification | directional (scope) | AUTO-DECIDED → reject (defer to execution) | No framing assumption matches; no convention rule applies. Spec already has clear acceptance criteria (A/B/C tallies, per-callsite framing, out-of-scope carve-out for the discriminated-union refactor). Volume is large (510 callsites confirmed) but the work is well-bounded by its acceptance criteria — implementer can pace and split if execution proves intractable. Routed to `tasks/todo.md § Deferred spec decisions — pr-249-followups` as a deferred consideration with concrete re-scope options if needed. |

---

## Mechanically tight, but verify directionally

This spec is now mechanically tight against the rubric and against Codex's best-effort review. The autonomous decision criteria (framing assumptions + conventions + best-judgment fallback) handled the one directional finding that surfaced. However:

- The review did not re-verify the framing assumptions at the top of `docs/spec-context.md`. If the product context has shifted since the spec was written (stage of app, testing posture, rollout model), re-read the spec's framing sections (Goal / Classification, lines 1-22) yourself before calling the spec implementation-ready. The spec's pre-production / rapid-evolution framing matched the spec-context file at run time.
- The review did not catch directional findings that Codex and the rubric did not see. Automated review converges on known classes of problem; it does not generate insight from product judgement.
- The review did not prescribe what to build next. The spec's task ordering, scope trade-offs, and the F6 volume question are still the operator's call. The Task 6 deferral in `tasks/todo.md` makes it explicit that the operator should re-evaluate scope in flight, not before.

**Recommended next step:** review the deferred F6 entry in `tasks/todo.md`, decide whether to re-scope before starting (e.g. constrain to the F6 backlog files only) or commit to the per-callsite audit as written, then either invoke `architect` (if you want a chunked plan) or start implementation directly with `superpowers:executing-plans`. Classification is Standard so no architect pass is mandatory.
