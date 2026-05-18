# OSS Pattern-Lifts Bundle — Implementation Brief

> **Status:** Draft for engineer review
> **Date:** 2026-05-18
> **Origin:** Open-source ecosystem research (May 2026); deep-dives into existing pg-boss infrastructure (`server/config/jobConfig.ts`, `server/services/operatorChainSchedulerService.ts`, `server/services/agentResumeService.ts`) and quality infrastructure (`server/services/runtimeCheckService.ts`, `server/services/scorecardService.ts`, `server/services/benchRunService.ts`, `server/services/correctionCaptureService.ts`).
> **Why this is a bundle and not individual briefs:** Three open-source tools (Trigger.dev, promptfoo, Composio) were originally recommended for adoption. The codebase deep-dive showed that we already have 80% to 90% of the value of each, and that adopting any one as a full dependency would create a second runtime competing with what we already have. This brief covers the small, high-value pattern-lifts that close the remaining gaps without taking on the dependencies.

## 1. Bundle summary

| Item | Verdict | Effort | Priority |
|---|---|---|---|
| Generalised waitpoint primitive (Trigger.dev pattern-lift) | Build | 1-2 weeks | Medium |
| Pre-merge prompt-eval suite (promptfoo pattern-lift) | Build OR skip | 1 week if built | Low |
| Composio readiness (new-provider OAuth path) | Defer | n/a yet | Defer to product-pull |

## 2. Waitpoint primitive — Trigger.dev pattern-lift

### Why
We have two implementations of "pause a long-running job, wait for an external event, resume cleanly":
- `server/services/agentResumeService.ts:48-165` for agent runs blocked on OAuth (`integration_required` state, hashed resume token, TTL)
- `server/services/workflowEngine/queueLifecycle/dispatch.ts:555-585` for workflow steps requiring approval (`awaiting_approval` status, `workflow-resume` pg-boss job)

Both work. Every new long-running pattern reinvents this by hand. Trigger.dev's `wait.completeToken` gives any task this primitive for free. We do not adopt Trigger.dev (a second runtime alongside pg-boss is not worth the operational cost), but we lift the pattern.

### What to build
A `waitpoints` table:
- `id` (token, hashed at rest)
- `kind` (`approval`, `oauth`, `external_event`, etc.)
- `bound_run_id` (foreign key, nullable for system-level waits)
- `expires_at`
- `status` (`pending`, `completed`, `expired`)
- `resume_queue` (which pg-boss queue to drive on completion)
- `resume_payload` (JSONB, sealed)
- Tenant scoping: `organisation_id`, `subaccount_id`, RLS-policied like every other tenant table

A `waitpointService` with:
- `createWaitpoint(kind, options) → token`
- `completeWaitpoint(token, payload) → enqueues the bound resume job`
- `expireWaitpoints()` — periodic sweep, fires `<kind>:expired` events

Then migrate the two existing call sites to use the primitive. After migration, any future long-running pattern (manual data-prep gate, external compliance review, vendor turnaround) uses the same primitive.

### Effort
1 to 2 weeks. Includes table, service, two call-site migrations, tests, and `architecture.md` documentation.

### Risk
Low. The primitive generalises code that already runs in production. Migration is gated by feature flag and rollback is trivial (the original code paths remain until both are confirmed working).

## 3. Pre-merge prompt-eval suite — promptfoo pattern-lift

### Why
Today our quality system covers:
- Skill verification per step (`runtimeCheckService.ts`)
- Scorecards with LLM-as-judge, sampled (`scorecardJudgeRunner.ts`)
- Bench runs for model comparison, operator-triggered (`benchRunService.ts`)
- Regression cases from HITL rejections, weekly replay (`regressionReplayJob.ts`)
- Daily support-eval drift gate (`supportEvalDailyJob.ts`)
- Trajectory tests (structural assertions only, `tests/trajectories/*.json`)

The genuine gap: nothing runs LLM-graded evals at pull-request time. promptfoo does this with YAML suites and CI integration. We do not adopt promptfoo (it has no tenant model and would create a second grading engine), but we can lift the YAML-suite pattern.

### What to build (if pre-merge eval is a real felt pain)
- `prompt_eval_suites` table with YAML-shaped JSONB payload
- `prompt-eval-execute` pg-boss job that reuses `scorecardJudgeRunnerPure.buildJudgePrompt` and `computeVerdict`
- A `npm run eval:pre-merge` script that runs suites against a seeded fixture org and exits non-zero on regression
- A new `prompt_eval.completed` event on the live execution log
- One YAML suite per skill-family to start (5 to 10 files)

### Effort
About 1 week. Reuses existing judge runner code; the new surface is the suite table, the runner script, and the CI hook.

### Skip criterion
If pre-merge LLM eval has not bitten us in production (a model upgrade silently broke a skill and we found out from a client), this build is "nice to have" and should sit behind other priorities. The continuous-production-eval coverage we have already is unusual for our maturity stage.

### Risk
Low. Reuses existing judge infrastructure. Worst case: the suite is run-once and abandoned, wasting a week.

## 4. Composio readiness — defer

### Why this is on the list
Composio is a unified OAuth + connector library for 1000+ third-party apps, MIT-licensed. Original recommendation was to adopt it. Deep-dive showed our integration framework already covers the providers Composio offers (Gmail, HubSpot, Slack, GHL, Calendar, Drive, GitHub, Stripe) with stronger tenant isolation than Composio gives us (RLS + AES-256-GCM + ALS-based principal context checks).

### What changes the equation
Product demand for a provider we do not currently support AND that has no MCP vendor server. Specifically:
- Linear
- Asana
- Intercom
- Zendesk
- Shopify

If any of these become required, evaluate Composio versus building the connector natively. Composio saves engineering time but costs us at-rest token control because Composio stores credentials externally.

### Decision rule
- If the new provider has a vendor-published MCP server, prefer that (it slots into the existing MCP infrastructure with our security model).
- If the new provider has no MCP server but we can build a native connector in under 5 engineering days, build native.
- If the native build is over 5 days AND there is no MCP server, evaluate Composio with a security review focused on credential storage and rotation.

### Action today
None. Add this brief as the lookup when the question arises.

## 5. What we are NOT doing

| Tool | Why not |
|---|---|
| Trigger.dev (full adoption) | Second runtime alongside pg-boss; operational cost > value |
| promptfoo (full adoption) | Second grading engine; no tenant model; duplicates 90% of what we have |
| Composio (today) | Covers providers we already have; weakens at-rest credential control |

## 6. Definition of done (for the waitpoint build)

- `waitpoints` table with RLS
- `waitpointService` with create / complete / expire
- Two existing call sites migrated to use the primitive (agent OAuth resume; workflow approval gate)
- Telemetry: `waitpoint.created`, `waitpoint.completed`, `waitpoint.expired` events on live execution log
- `architecture.md` section added documenting the primitive and when to use it
- KNOWLEDGE.md entry capturing the "we considered Trigger.dev, chose to lift the pattern instead" rationale and the conditions that would re-open the question

## 7. Sequencing

1. **First:** MCP vendor server onboarding (separate brief: `docs/mcp-vendor-server-onboarding-brief.md`)
2. **Second (if waitpoint pain emerges):** Waitpoint primitive build
3. **Third (only if pre-merge eval pain emerges):** Prompt-eval suite build
4. **Fourth (only on product-pull for Linear / Asana / Intercom / Zendesk / Shopify):** Composio evaluation
