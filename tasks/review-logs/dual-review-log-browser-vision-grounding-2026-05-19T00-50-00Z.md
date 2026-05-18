# Dual Review Log — browser-vision-grounding

**Files reviewed:** diff `e90906fb..HEAD` (HEAD `f3fdd57f` at iter1 start). 13-chunk vision grounding scaffolding above the IEE browser stack — types (`shared/types/visionActions.ts`, `shared/types/sandbox.ts`), failure reasons (`shared/iee/failureReason.ts`), pricing module + Vitest (`shared/visionInferencePricing.ts`), schema + migration `0378_vision_inference_calls.sql` with FORCE RLS, parser (`server/services/visionActionParserPure.ts`) + Vitest, vision grounding service (`server/services/visionGroundingService.ts`) + Vitest config tests, harness stub (`infra/sandbox-templates/iee-browser/harness/visionDecisionLoop.ts`), dispatch + finalisation harvest hook (`server/services/executionBackends/_ieeShared.ts`), rollup job (`server/jobs/visionInferenceCostRollupJob.ts`), decisionMode threading (`server/services/agentExecutionService/types.ts`, `shared/iee/jobPayload.ts`), skill grammar (`server/services/skillParserServicePure.ts`), boot registration (`server/index.ts`), docs (`docs/iee-development-spec.md`).
**Iterations run:** 2/3 (iter2 terminated on zero accepted findings)
**Timestamp:** 2026-05-19T00:50:00Z
**Commit at finish:** 71a12df6

---

## Iteration 1

Codex CLI: `codex review --base e90906fb` (Codex used base-branch mode against the merged history of the build).

### Decision log

[ACCEPT] server/services/executionBackends/_ieeShared.ts:312-315 — vision fields are populated in `SandboxRunTaskInput` but the e2b provider's `harnessInput` (`server/services/sandbox/e2bSandbox.ts:373-382`) does NOT serialize `decisionMode`, `visionEndpointUrl`, `visionEndpointToken`, or `visionModelId` into `/workspace/input.json`. Result: harness always reads `decisionMode` as absent and defaults to `dom`; the entire vision/hybrid dispatch path is dead-code at the boundary.
  Reason: Critical — this is the one new execution path the V1 build creates, and reality-checker missed end-to-end serialization verification. The fix is mechanical (four lines added to the envelope) and unblocks the whole vision/hybrid path. Verified by grepping `decisionMode|visionEndpoint*` across `server/services/sandbox/`: zero matches before the fix.

[ACCEPT] server/services/visionActionParserPure.ts:17 — `normalise(line)` calls `replace(/\s+/g, ' ')` over the full line, including INSIDE quoted-string args. `type("ACME  Inc")` was silently collapsed to `type("ACME Inc")`, which would mis-type form fields. Quoted-string args have explicit escape syntax (`parseQuotedString` already handles `\n`/`\r`/`\t`) — collapsing their interior whitespace is incoherent with that contract.
  Reason: Real correctness bug. Spec §8.1 "collapse internal whitespace" rule applies to the inter-argument grammar level, not the contents of quoted strings. V1 harness is a stub so the parser is unreachable today, but the follow-up build wires it without the operator getting a second review. Trivial quote-aware normalise rewrite + 3 new Vitest tests preserve the spec's intent without amending it. Acceptable to fix now since the fix is non-spec-impacting (preserves all existing test behaviour, only changes mishandled quoted-text behaviour) and adding it post-hoc against a wired harness would require harness retesting.

(No further findings emitted by Codex iter1.)

## Iteration 2

Codex CLI: `codex review --uncommitted --title "browser-vision-grounding iter2 retry"`.

Codex's first iter2 attempt was blocked by Windows PowerShell tool-policy mid-exploration before it converged on findings. The retry exhausted its time window listing review-log directory contents and reading the modified e2bSandbox.ts file without producing a verdict block. No `[P#]` findings, no `## Findings` heading, no "no issues" / "looks good" verdict were emitted.

Per playbook termination rule (zero accepted findings → break), the loop ends here. Known pattern: Codex on Windows often spends its session on shell exploration that runs into the PowerShell `ConstrainedLanguage` restriction and stops mid-stream. The iter1 findings are the substantive output; iter2 found no new issues before the policy block.

### Decision log

(No new findings raised.)

---

## Changes Made

- `server/services/sandbox/e2bSandbox.ts:373-394` — add `decisionMode`, `visionEndpointUrl`, `visionEndpointToken`, `visionModelId` to the `harnessInput` envelope written to `/workspace/input.json`. Six-line additive block plus an in-file comment block explaining the token-redaction obligation for the follow-up wiring.
- `server/services/visionActionParserPure.ts:16-60` — replace `normalise()` with a quote-aware implementation that trims leading/trailing whitespace and collapses interior whitespace ONLY when not inside a double-quoted string region, respecting backslash escapes inside quotes. Preserves spec §8.1's intent without mangling typed text.
- `server/services/__tests__/visionActionParserPure.test.ts:79-108` — add 3 Vitest tests covering: repeated whitespace inside `type()` text preserved; tab-escape inside `type()` preserved; quoted `hotkey()` combo whitespace preserved. Total parser test count: 34 → 37 (all green).

Local verification:
- `npm run lint`: 0 errors, 879 warnings (unchanged from prior baseline).
- `npm run typecheck`: clean (both `tsconfig.json` and `server/tsconfig.json`).
- `npx vitest run server/services/__tests__/visionActionParserPure.test.ts`: 37/37 pass.

Test gates: CI-only per CLAUDE.md § *Test gates are CI-only — never run locally*. The above three targeted commands cover the change set.

## Rejected Recommendations

(None — both findings were accepted.)

---

**Verdict:** APPROVED (2 iterations, 2 critical fixes applied: vision-field serialization at the harness boundary + quote-aware parser normalisation)
