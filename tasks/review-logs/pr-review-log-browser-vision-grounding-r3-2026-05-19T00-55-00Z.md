# PR Review Log — browser-vision-grounding (Round 3)

**Build slug:** browser-vision-grounding
**Round:** 3 (post-dual-reviewer re-review per playbook §8.6)
**HEAD at review:** 64c1ffdc
**Reviewer:** pr-reviewer (Opus)
**Date:** 2026-05-19

---

**Files reviewed (post-dual-reviewer):**
- `server/services/sandbox/e2bSandbox.ts:373-394` (vision-field threading into harnessInput envelope)
- `server/services/visionActionParserPure.ts:16-60` (quote-aware normalise)
- `server/services/__tests__/visionActionParserPure.test.ts:79-108` (3 new Vitest tests)

**Cross-checked against:**
- `shared/types/sandbox.ts:271-281` (SandboxRunTaskInput vision-field shape)
- `shared/types/visionActions.ts:4` (VisionDecisionMode type)
- `server/services/executionBackends/_ieeShared.ts:220-316` (source-of-truth populating)
- `infra/sandbox-templates/iee-browser/harness/index.ts:40-100` (HarnessInput consumer + routing)
- `infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts:1-52` (V1 stub)
- `tasks/review-logs/dual-review-log-browser-vision-grounding-2026-05-19T00-50-00Z.md` (dual-reviewer context)

Blocking: 0 / Should-fix: 0 / Consider: 3

**Verdict:** APPROVED

---

## Specific Checks

- **Vision-field threading correctness** — `e2bSandbox.ts:389-392` reads from `input.{decisionMode|visionEndpointUrl|visionEndpointToken|visionModelId}`; all four fields exist on `SandboxRunTaskInput` (`shared/types/sandbox.ts:271-281`) with the right optional-nullable shape. Each uses `?? null` to coerce `undefined` → `null` for the JSON envelope; harness consumers accept both shapes via `?? 'dom'` / `?? null` defaults.

- **Token leakage check** — no logger call in `e2bSandbox.ts` logs `harnessInput` or any of its constituent vision fields. The `withSandboxProvider` wrapper logs only the provider phase and diagnostics it constructs itself, not the raw call payload.

- **Source-of-truth populating** — `_ieeShared.ts:223-316` resolves all four fields via `visionGroundingService.resolveEndpointConfig()` at dispatch and threads them through to `sandboxRunTask`. The "is the dispatch path actually wired end-to-end" question that R2 missed is now verifiable.

- **Spec §8.1 compliance** — quote-aware `normalise` preserves the inter-argument whitespace collapse rule while NOT collapsing whitespace inside quoted-string regions. Trace cases checked: `type("ACME  Inc")` keeps the double space; `type("col1\tcol2")` keeps the escape; `type("she said \"hi\"")` does not exit the quote prematurely.

- **No regressions** — the existing 34 parser tests still pass; 3 new tests added cover repeated whitespace inside quotes, tab-escape preservation, and a non-pathological hotkey combo. Lint/typecheck clean.

## Consider (advisory)

- e2bSandbox comment block (lines 373-379) carrying the redaction-obligation note for the follow-up harness wiring — well-pitched retention given V1 keeps the harness as a stub.
- visionActionParserPure quote-aware normalise — 45-line function; trace verification was the failure mode flagged by dual-reviewer; logic correct on all edge cases.
- New parser tests — chosen to exercise the quote-aware code path without overlapping with the existing hotkey empty-token guard.

## Verdict

**APPROVED** — dual-reviewer fixes correctly applied; no regressions; vision/hybrid dispatch path is no longer dead-code at the boundary; parser whitespace bug is closed with proper test coverage.
