# PR Review — agentic-engineering-notes branch

**Files reviewed:**
- `CLAUDE.md` (verifiability heuristic § 4; adversarial-reviewer fleet row + invocation + pipeline step 4)
- `.claude/agents/architect.md` (model-collapse pre-check)
- `.claude/agents/adversarial-reviewer.md` (new agent)
- `replit.md` (agent quick-start)
- `scripts/README.md` (new)
- `docs/README.md` (new)
- `tools/mission-control/server/lib/logParsers.ts` (ReviewKind + FILENAME_REGEX_STD)
- `tools/mission-control/server/__tests__/logParsers.test.ts` (two new test cases)
- `tasks/review-logs/README.md` (adversarial-reviewer registration + caller contract)

**Reviewed at:** 2026-04-30T11:15:00Z
**Branch:** `claude/agentic-engineering-notes-WL2of`
**Spec:** `docs/agentic-engineering-notes-dev-spec.md`
**Spec-conformance verdict:** CONFORMANT (`tasks/review-logs/spec-conformance-log-agentic-engineering-notes-2026-04-30T10-51-24Z.md`)

**Verdict:** APPROVED (0 blocking, 4 strong)

---

## Blocking Issues

No blocking issues found.

The branch is process/tooling only — no production code, no schema, no routes, no services. The single TypeScript change (`logParsers.ts`) is read-only, pure-function, locally typecheckable, and accompanied by two new tests covering the new prefix and a hyphenated-slug edge case. No tenant boundaries, no auth, no soft-delete, no agent-tier rules to violate.

---

## Strong Recommendations

### S1. Verdict-semantics drift between the spec and the agent definition

**Where:** `docs/agentic-engineering-notes-dev-spec.md:137` vs `.claude/agents/adversarial-reviewer.md:81-83`.

The spec says:

> `HOLES_FOUND` — at least one finding labelled `confirmed-hole` or `likely-hole`. `worth-confirming`-only results still set `HOLES_FOUND` if the agent is meaningfully suspicious; pure curiosity items (no attack scenario) do not.

The agent says:

> `NO_HOLES_FOUND` — … `worth-confirming`-only findings appear in the log but do not set `HOLES_FOUND` — the verdict stays `NO_HOLES_FOUND`.
> `HOLES_FOUND` — … `worth-confirming`-only results use `NO_HOLES_FOUND`.

These two contracts disagree on the carve-out. Per `tasks/review-logs/README.md:5` ("if a contract here disagrees with an agent definition, the agent definition is correct (more local), but flag the drift back to here"), the agent wins, and the spec must be updated to match — OR the agent must add the "meaningfully suspicious" carve-out the spec promised. Pick one path explicitly so future operators don't have to interpret which clause was the intent.

**Suggested fix:** Edit `docs/agentic-engineering-notes-dev-spec.md` § 4.2 verdict semantics block to drop the "worth-confirming-only … still set HOLES_FOUND" clause, or add the carve-out to the agent's verdict-semantics block. Same commit.

### S2. `derivePhaseFromVerdict` will mis-render adversarial-review verdicts on the dashboard

**Where:** `tools/mission-control/server/lib/inFlight.ts:67-86` — the verdict→Phase mapping switch.

This branch adds `'adversarial-review'` to `ReviewKind` and the filename regex, so adversarial logs will now win `pickLatestLogForSlug` whenever they're the most recent log for a build. But `derivePhaseFromVerdict` has no case for `NO_HOLES_FOUND` or `HOLES_FOUND` — both fall into the `default` branch and resolve to `REVIEWING`.

Concrete consequence: a build that finishes `pr-reviewer` (APPROVED → MERGE_READY) and then runs `adversarial-reviewer` cleanly (NO_HOLES_FOUND) will *regress* on the dashboard from MERGE_READY back to REVIEWING — exactly the wrong signal for a clean adversarial pass.

The spec did not explicitly require this update (§ 4.3 only called out the parser regex), so this is not a spec gap; it's a foreseeable downstream consequence of broadening `ReviewKind`.

**Suggested fix:** in `tools/mission-control/server/lib/inFlight.ts`, add `NO_HOLES_FOUND` to the green-family case (alongside APPROVED, READY_FOR_BUILD, CONFORMANT, etc.) and `HOLES_FOUND` to the change-requested family (alongside CHANGES_REQUESTED, NEEDS_REVISION, NON_CONFORMANT). Explicit beats default.

### S3. Architect model-collapse check is not enforced by the execution-order discipline

**Where:** `.claude/agents/architect.md:69-79` (the new `## Pre-plan: model-collapse check` section) vs `.claude/agents/architect.md:14-22` (Step 1–5 strict execution order) and `.claude/agents/architect.md:26-40` (the minimum TodoWrite skeleton).

The architect's own framing says:

> "Every invocation runs in exactly this sequence. Do not reorder, do not merge steps. Earlier sections and sibling documents do not override this list."

The model-collapse check is a free-floating section between "When You Are Invoked" and "TodoWrite hygiene during execution" — it is NOT one of the Step 1–5 ordered steps and NOT a skeleton TodoWrite item. A future architect run that reads top-down and follows the strict sequence may complete all 9 skeleton items and produce a plan with no "Model-collapse check" heading — exactly the failure mode the success signal in spec § 5.4 is supposed to detect.

**Suggested fix:** Add an explicit skeleton item — e.g. between current items 1 (Load context) and 2 (Primitives-reuse search), a new "Model-collapse pre-check — answer the three questions; record decision under '## Model-collapse check' in the plan output (even if the answer is 'reject collapse, here's why')." This makes the architect's own TodoWrite hygiene enforce the spec § 5.4 success signal.

### S4. Missing test for the adversarial-review verdict→phase mapping

If S2 is accepted, `inFlight.test.ts` should grow two cases. Spec for the new test file (`tools/mission-control/server/__tests__/inFlight.test.ts`):

- **Given** the verdict string `'NO_HOLES_FOUND'`,
  **when** `derivePhaseFromVerdict` is called,
  **then** the result is `'MERGE_READY'`.
- **Given** the verdict string `'HOLES_FOUND'`,
  **when** `derivePhaseFromVerdict` is called,
  **then** the result is `'REVIEWING'`.

The implementer authors and runs only this single file: `npx tsx tools/mission-control/server/__tests__/inFlight.test.ts`. CI runs the broader suite.

If S2 is rejected (i.e. the team accepts the default-to-REVIEWING behaviour for adversarial verdicts), capture that decision in `KNOWLEDGE.md` so the next operator stops re-discovering it.

---

## Non-Blocking Improvements

### N1. `scripts/README.md` includes additive categories beyond the spec's seed list

Spec § 3.1 listed five categories (Database, Code intelligence, Audits with CI-only caveat, Imports/exports, Internal `_*`). The implemented file adds two more (Smoke tests, Miscellaneous) that cover real scripts the spec snapshot didn't slot. Additive and useful — flagging only because the spec-conformance log called this out (REQ #2 evidence) and a future audit might raise it as scope creep. Not a defect.

### N2. `replit.md` adds a fourth pointer (CLAUDE.md) beyond the three the spec named

Spec § 3.1 named three pointers (`architecture.md`, `scripts/README.md`, `docs/README.md`). The shipped quick-start adds a fourth to `CLAUDE.md`. Consistent with intent (CLAUDE.md is the agent playbook); not divergent.

### N3. `docs/README.md` includes a curated "What's NOT here" section that calls out `improvements-roadmap-spec.md` as historical

The "What's NOT here" annotation at lines 119-124 is good editorial hygiene — exactly the kind of pruning agent-facing indices need. Worth keeping; no change required. Mentioning so future maintainers preserve this curation rather than drift back to "list everything."

### N4. Lazy-slug regex assumes timestamp shape disambiguates

`logParsers.ts:63-65` — `FILENAME_REGEX_STD` uses non-greedy slug `([A-Za-z0-9-]+?)` followed by `-` and the timestamp pattern. This works because the timestamp anchors strictly on `\d{4}-\d{2}-\d{2}T...`. A pathological slug starting with a 4-digit-numeric segment (e.g. `2026-thing`) followed immediately by what looks like a timestamp could mis-split, but real slugs don't shape that way and the existing tests cover hyphenated slugs correctly. Documenting the assumption so a future reader doesn't accidentally allow a slug shape that breaks it.

### N5. `tasks/review-logs/README.md` § Caller contracts gained a complete `### adversarial-reviewer` subsection

This goes beyond what spec § 4.3 strictly required (the spec asked for a filename example + verdict enum row). The added caller-contract block at lines 94-105 mirrors the `pr-reviewer` shape and fills a real gap — additive, good. No change required.

---

## Summary

This is a clean, surgically scoped process/tooling PR. The single TypeScript change (`logParsers.ts`) is well-tested. The new agent definition matches the existing read-only-reviewer pattern. The doc additions (replit quick-start, scripts/README, docs/README) materially improve agent bootstrap and discovery. Spec-conformance gave it CONFORMANT with zero gaps, and the spec itself went through two `spec-reviewer` iterations plus a ChatGPT pass before this build started.

Two of the four Strong recommendations (S1: verdict carve-out drift; S2: dashboard phase mapping) are real downstream gaps worth closing in this PR while the context is fresh; the other two (S3: architect TodoWrite enforcement; S4: missing inFlight test) are belt-and-braces additions that will save future debugging.

**Verdict:** APPROVED (0 blocking, 4 strong)
