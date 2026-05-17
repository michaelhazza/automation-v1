**Status:** Draft v1 — for external stress-test
**Build slug:** hosting-provider-evaluation
**Date drafted:** 2026-05-17
**Author:** main session (operator-driven)
**Classification:** Operational / infrastructure decision

# Hosting provider evaluation — investigation & decision brief

## Contents

- [1. Purpose & how to stress-test this](#1-purpose--how-to-stress-test-this)
- [2. Executive summary](#2-executive-summary)
- [3. Why this investigation happened](#3-why-this-investigation-happened)
- [4. Constraints & requirements](#4-constraints--requirements)
- [5. Options surveyed](#5-options-surveyed)
- [6. Why Vercel was rejected](#6-why-vercel-was-rejected)
- [7. AU region analysis](#7-au-region-analysis)
- [8. The "separate worker" architectural question](#8-the-separate-worker-architectural-question)
- [9. Codebase findings that closed the worker question](#9-codebase-findings-that-closed-the-worker-question)
- [10. Final hosting decision](#10-final-hosting-decision)
- [11. Local dev environment decision](#11-local-dev-environment-decision)
- [12. Cost estimate](#12-cost-estimate)
- [13. Risks & mitigations](#13-risks--mitigations)
- [14. Assumptions to verify](#14-assumptions-to-verify)
- [15. Open follow-ups & deliverables](#15-open-follow-ups--deliverables)

## 1. Purpose & how to stress-test this

This brief documents a hosting investigation conducted on 2026-05-17. The output is three connected decisions: production hosting provider, staging hosting strategy, and local development workflow. The brief is written to be reviewed by an external LLM or human reviewer who can challenge the premises, surface options missed, validate cost estimates, and pressure-test the architectural assumptions.

**Reviewers should specifically probe:**
- Are there hosting providers we missed that fit better than Render for an AU-launched, long-running Node + Postgres + e2b stack?
- Is the "single Render service" decision sound, or is there a hidden reason to split web and worker that we glossed over?
- Are the AU-region latency claims defensible?
- Is the deploy-survivability story for long-running OpenClaw sessions watertight, or are there failure modes we haven't named?
- Are the cost estimates realistic for production scale?

## 2. Executive summary

**Decisions:**
1. **Production:** Render, Sydney region, single web service plus Render Postgres. ~$45/mo at production scale.
2. **Staging:** Render, Sydney region, smaller tier of same shape. ~$21/mo.
3. **Sandbox execution:** e2b (cloud, on-demand sandboxes from template images). Usage-based billing, pennies per session.
4. **Local development:** Run from VS Code via `npm run dev` directly. Docker locally is optional. Sandboxes dispatch to real e2b.
5. **IEE worker process:** Retire entirely. Orchestration consolidates into the main Render web service. Separate cleanup spec drafted at `tasks/builds/iee-worker-retirement/spec.md`.

**Combined infrastructure cost:** ~$66/mo for staging plus production, plus variable e2b usage (~cents per sandbox-session).

**Why this shape, in one sentence:** The codebase is a long-running Express + pg-boss + WebSocket app that orchestrates external e2b sandboxes; that shape rules out serverless platforms (Vercel, Lambda, Cloudflare Workers), and the AU customer base rules out US-only regional providers (Replit, Railway).

## 3. Why this investigation happened

Three triggers, in order:

1. **Hosting choice was overdue.** No staging or production environment exists yet. The team had been on Replit for development but never deployed. As the v1.2 architecture stabilised and Phase 2 capabilities shipped (OpenClaw / operator_managed, e2b sandbox isolation), a real hosting decision became blocking.
2. **First customers will be in Australia.** Region latency matters; a default US-region deployment carries a ~150 ms tax on every API call, every WebSocket event, every chained operator step.
3. **Vercel was a candidate the team wanted to evaluate.** Common reflex choice for "host a Node app," but the codebase's actual shape (Express, pg-boss background queues, WebSockets, Playwright bindings, long-running operator sessions) doesn't match Vercel's serverless model.

## 4. Constraints & requirements

The codebase has specific characteristics that constrain hosting choices:

- **Long-running Express server** with WebSocket support (`server/websocket/`).
- **pg-boss background job queues** (100+ handlers in `server/jobs/`, plus operator_managed session handlers). Requires a persistent process to listen on queues.
- **Playwright dependency** in `package.json` (heavy binary; problematic for serverless function size limits).
- **e2b orchestration logic** in the main server. Dispatches per-task sandboxes to e2b cloud; receives terminal events back via pg-boss.
- **Operator sessions can run for hours.** Chain-link continuation pattern (one agent run spans N `operator_runs` rows). Must survive deploys without losing customer-visible state.
- **Multi-tenant Postgres with RLS.** Managed Postgres preferred.
- **AU customer base initially.** Sydney region availability is a hard preference, not a nice-to-have.
- **Single-operator early stage.** Solo CEO running everything. Operational simplicity matters as much as price.
- **Existing investments preserved where possible.** Operator already set up Docker on a dev machine for the (now-retired) worker; abandoning that investment is fine but worth acknowledging.

## 5. Options surveyed

Six platforms were considered. Three were eliminated quickly on shape mismatch; three were genuine contenders.

| Provider | Shape fit | AU region | Verdict |
|---|---|---|---|
| Vercel | Serverless functions; wrong for long-running Express + WebSockets + Playwright | n/a | **Rejected** (Section 6) |
| AWS Lambda / API Gateway | Same as Vercel; serverless misfit | yes (Sydney) | **Rejected** (same reason as Vercel) |
| Cloudflare Workers | Serverless / edge runtime; even more constrained than Vercel | n/a | **Rejected** (same reason) |
| **Render** | Persistent web services + managed Postgres + cron + background workers + Docker-compatible | **yes (Sydney)** | **Chosen** |
| **Fly.io** | Persistent Machines + volumes + multi-region | yes (`syd`) | Strong runner-up |
| Railway | Persistent + managed PG + nice DX | No (Singapore closest) | Rejected on region |
| Replit (Reserved VM) | Mature dev experience; thinner ops surface | No (US only) | Rejected on region |

## 6. Why Vercel was rejected

Vercel optimises for: static frontends, edge functions, ISR, image optimisation, short-lived API routes. The SynthetOS app needs the opposite: a persistent process holding WebSocket connections, draining pg-boss queues, orchestrating long-running e2b sessions.

Concrete mismatches:

- **Function timeouts.** Vercel functions cap at 10s (Hobby), 60s (Pro default), 800s (Fluid Pro max). OpenClaw chain links can run minutes; full sessions hours. Doesn't fit.
- **No persistent process.** pg-boss handlers need a long-running listener. Vercel cron is workable for scheduled jobs but not for queue draining or terminal-event handling.
- **Function size limit.** Playwright binaries plus Chromium exceed Vercel's bundled-function size constraints.
- **WebSockets are second-class.** Vercel supports them through edge functions, but ergonomics and pricing are worse than a persistent server.
- **Architectural split.** Running the API on Vercel and bolting a second host on the side for the worker / WebSockets is two platforms, two bills, twice the ops surface. Worse than picking one provider that handles the whole shape.

Vercel's strengths (edge CDN, ISR, image optimisation) buy nothing for SynthetOS because the frontend is a Vite SPA hitting our own API — the API itself can't live on Vercel.

**Same reasoning rules out AWS Lambda, Cloudflare Workers, and any serverless-first platform.**

## 7. AU region analysis

Latency budgets, approximate round-trip times:

| Origin | Destination | RTT |
|---|---|---|
| US-West (Replit, Railway default) | Sydney | 140–180 ms |
| Singapore (Railway closest) | Sydney | 90–100 ms |
| Sydney (Render, Fly.io, AWS Sydney) | Sydney | 5–20 ms |

For a UI-heavy, chatty-API app with WebSocket events and step-by-step operator session updates, the 150 ms US-region tax is felt on every interaction. Not a P&L line item, but a product-quality line item.

Region availability narrowed the field to: Render Sydney, Fly.io Sydney, AWS Sydney. AWS adds enterprise ops overhead disproportionate to current scale. Decision came down to Render vs Fly.io.

**Render vs Fly.io for AU launch:**
- **Render:** PaaS shape, "Heroku-like" simplicity, managed Postgres in Sydney, no Machines/volume concepts to learn, web service + worker service + cron + PG all on one provider. Slightly more expensive at scale.
- **Fly.io:** More flexibility (Machines, regions, volumes), cheaper at small scale, better multi-region path later. More ops concepts to learn upfront. Managed Postgres on Fly was deprecated in 2024; PG path is "run on Machines yourself" or "use external (Supabase, Neon)."

**Decision: Render.** Reasoning: solo-CEO operational simplicity beats Fly's flexibility at our current stage. The "more flexibility" Fly offers is only useful when we have a reason to use it (multi-region, custom networking). We don't. When we do, switching is a few days of work; locking in operational complexity now to preserve future optionality is the wrong trade.

## 8. The "separate worker" architectural question

Before locking the Render shape, an architectural question arose: should the deployment be **one web service** (everything in one process) or **two services** (web + worker)?

The legacy IEE worker (`worker/` directory in the repo) used to be a separate Node process running on DigitalOcean droplets, with Playwright binaries baked in. With the e2b migration, the heavy execution moved into e2b cloud sandboxes; the worker's remaining role is just to listen on pg-boss queues and dispatch.

Three positions evaluated:

**Position A: Keep worker as a separate Render service.**
- Pros: blast-radius isolation; independent scaling; can restart worker without bouncing API.
- Cons: extra $7-25/mo; more deployment artefacts; two-process mental model for a solo operator.

**Position B: Collapse worker into the main web service.**
- Pros: single deployment; same pg-boss instance; no inter-process complexity; cheaper.
- Cons: heavy IEE handler could starve API event loop; deploy bounces both at once.

**Position C: Delete the worker process entirely.**
- Pros: removes ~30 dead-code files; clarifies that orchestration lives in the main app; matches what's actually shipped (operator_managed already runs in the main server per `server/index.ts:735-783`).
- Cons: must migrate one daily cron handler (cost-rollup, ~30 lines) into the main server first.

**The deciding question:** *what does the worker actually do today?* This required a codebase deep-dive (Section 9). The answer changed the framing entirely.

## 9. Codebase findings that closed the worker question

Empirical findings from inspecting `server/`, `worker/`, `docs/superpowers/specs/`, and `infra/sandbox-templates/`:

1. **OpenClaw / operator_managed already runs in the main server.** `server/index.ts:735` registers the `operatorManagedBackend`. Lines 747-783 register all four operator pg-boss handlers (completed, dispatch-next-chain-link, progressed, task-profile-gc). The worker process has zero involvement in OpenClaw.

2. **Browser-on-e2b already runs in the main server.** `ieeBrowserBackend` dispatches to e2b via `sandboxExecutionService`. The browser harness lives inside the e2b sandbox at `infra/sandbox-templates/iee-browser/harness/`, not inside the worker.

3. **The worker entry point (`worker/src/index.ts`) registers only two handlers:**
   - `iee-dev-task` (parked from v1 scope per operator confirmation)
   - `iee-cost-rollup-daily` (a single daily SQL upsert, ~30 lines)

4. **The worker's `worker/src/browser/` directory is import-orphaned.** Legacy Playwright code from the DigitalOcean era, superseded by the e2b sandbox harness. No registered handler consumes it.

5. **Deploy-survivability is already engineered.** The operator backend spec (`docs/superpowers/specs/2026-05-12-operator-backend-spec.md` § 7.1) explicitly handles the "main server crashes mid-dispatch" case via `adoptOrStart()` in `sandboxExecutionService.ts:255`. Uses `sandbox_start_key = operator_run_id` to ensure exactly-once sandbox creation across retries.

6. **Sandbox lifecycle is fully decoupled from the orchestrator process.** OpenClaw sessions run *inside* e2b sandboxes; the orchestrator dispatches and then listens for events via pg-boss (a durable queue in Postgres). When the orchestrator process dies, the sandbox keeps running; events queue in pg-boss; the next-alive orchestrator process drains them.

7. **Reconciliation cron as backstop.** `maintenance:backend-reconciliation` runs every 2 min, scans `operator_runs` for heartbeat-stale running rows (cheap via the partial index `operator_runs_running_progress_idx`), and catches anything that slips past the primary path.

8. **Graceful shutdown is wired.** `server/index.ts:1093` implements SIGTERM handling: HTTP close → Socket.IO close → pg-boss stop → DB pool close, with a 15s timeout backstop. Idempotency keys catch any redelivery from a force-killed handler.

**Conclusion:** Position C (delete the worker entirely) is correct. The IEE worker process is doing two things, one of which is parked (dev-task) and one of which is a 30-line cron migration (cost-rollup). Everything load-bearing already runs in the main server. The codebase is closer to "single-process architecture" than the directory structure suggested.

A separate cleanup spec was drafted at `tasks/builds/iee-worker-retirement/spec.md`.

## 10. Final hosting decision

**Production:**
- Render, Sydney region
- 1 × Standard web service (2 GB RAM, $25/mo) running Express + all pg-boss handlers in one process
- 1 × Standard Postgres (1 GB, $20/mo)
- Sandbox execution: e2b cloud, on-demand sandboxes, ~cents per session, billed separately

**Staging:**
- Render, Sydney region (same shape, smaller tier)
- 1 × Starter web service (512 MB, $7/mo)
- 1 × Starter Postgres (256 MB, $7/mo)
- Sandbox execution: same e2b account, separate API key, usage minimal during dev

**Same provider both environments:** parity, one billing line, one dashboard, one CLI, one mental model. Branch-based deploys (`main` → production, `staging` → staging). `render.yaml` as infrastructure-as-code.

**Sandbox provider abstraction preserved.** The codebase has a registered-providers seam (`sandboxProviderResolver.ts`) supporting `e2b`, `local_docker`, `inline`. If e2b ever needs replacing, the swap is contained to that one file.

## 11. Local dev environment decision

**Decision: drop Docker locally. Run from VS Code directly via `npm run dev`. Sandboxes dispatch to real e2b.**

The original reason Docker was set up locally: the worker container needed Playwright + browser binaries baked in, which is painful to install natively on Windows. With the worker retired and browsers running in e2b, that reason is gone.

The repo's Dockerfile is effectively `npm install && npm run dev` wrapped in `node:20-slim`. Running those commands in the VS Code terminal gives the same result without the Docker overhead, and produces these wins:

- **Faster iteration.** Hot reload is instant; no volume-mount latency.
- **Native VS Code debugger.** Set a breakpoint, hit it. No remote-Docker debug dance.
- **Direct log access.** Server logs in the same terminal you're editing in.
- **No Docker Desktop running.** ~2-4 GB of RAM reclaimed.
- **Simpler troubleshooting.** Debug Node, not "Node inside Docker inside Windows."

**What's preserved:**
- Same `host` Postgres (operator already has Windows-native Postgres).
- Same `.env` shape.
- Sandboxes still work because `SANDBOX_PROVIDER=e2b` dispatches to real e2b cloud.
- `docker-compose.yml` and `Dockerfile` stay in the repo as documentation; just stop running them daily.

**What's given up:**
- Strict production parity (Windows local vs Linux Render). 95% of code behaves identically; the 5% (file paths, line endings, native modules) is the kind of thing CI / staging catches, not local.
- Multi-developer environment consistency. Not a concern with one developer; revisit when hiring.

**Optional follow-up (low priority):** Extend `localDockerSandbox.ts` to switch between `synthetos-sandbox`, `iee-browser`, and `operator-session` template images based on `templateName` input. Today it only resolves `synthetos-sandbox`. This would allow fully offline local dev (no e2b dependency). Estimated half-day of work; deferred until a real need surfaces.

## 12. Cost estimate

All figures USD per month. Verify on each provider's pricing page before commitment; pricing can drift.

**Production:**
| Item | Tier | Cost |
|---|---|---|
| Render web service | Standard (2 GB RAM) | $25 |
| Render Postgres | Standard (1 GB) | $20 |
| **Subtotal** |  | **$45** |
| e2b sandbox usage | Variable; ~$0.03-0.10 per sandbox-session | scales with traffic |

**Staging:**
| Item | Tier | Cost |
|---|---|---|
| Render web service | Starter (512 MB) | $7 |
| Render Postgres | Starter (256 MB) | $7 |
| **Subtotal** |  | **$14** |
| e2b sandbox usage | Minimal during dev | near zero when idle |

**Combined fixed cost:** ~$59/mo (or ~$21/mo if starting both on Starter tier and upgrading prod later).

**Comparison points:**
- Replit Core + Reserved VM: ~$40/mo, US-only region.
- Fly.io equivalent: ~$45/mo (web + worker + external PG), Sydney available, more ops complexity.
- Vercel + separate worker host: would split between ~$20/mo Vercel + ~$30/mo separate host = ~$50/mo + 2x ops surface.

e2b usage is genuinely variable. For a single CEO developer running dozens of sessions per day during build-out, dev usage is probably $5-15/month. Customer-driven production usage scales linearly with sandbox-seconds consumed.

## 13. Risks & mitigations

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Render Sydney region has a regional outage | Low | High | Multi-region not in scope at v1; accept; revisit if AU outage data warrants Fly.io multi-region migration. |
| e2b has an outage | Low-Med | High | Sandbox provider abstraction (`sandboxProviderResolver.ts`) supports swap to alternative. Local Docker fallback exists for dev. No customer-facing graceful fallback during outage; tasks queue and resume when e2b returns. |
| Single Render service hits CPU/memory ceiling | Med | Med | Vertical scale to Render Pro tiers; horizontal split web vs worker (the architecture supports it, we just chose not to start there). |
| Cost-rollup migration introduces SQL bug | Low | Low | Single daily cron; observable next day; 2-day look-back window means backfill is trivial. |
| Operator session breaks during a deploy | Low | High | Verified by Section 9 findings; deploy-survivability is engineered. Recommended: 10-min manual drill before first customer goes live. |
| Worker deletion breaks a CI gate we missed | Low | Low | Cleanup spec includes grep verification step. |
| Render's pricing changes materially | Med (long-term) | Low | Could migrate to Fly.io with ~1 week of work. Architecture is provider-portable. |

## 14. Assumptions to verify

These are claims made in this brief that haven't been independently verified and are good targets for the stress-test:

1. **Render Sydney region availability and feature parity.** Brief assumes Sydney offers all standard Render features (web services, managed Postgres, cron). Should be verified on render.com/docs before commitment.
2. **e2b sandbox provider availability in or near AU.** e2b's nearest region to Sydney needs confirmation. Sandboxes can run in any region without breaking architecture, but latency from Render Sydney to e2b's nearest region affects per-step operator latency.
3. **Render rolling deploy semantics.** Brief assumes zero-downtime rolling deploys with configurable grace period. Default is 30s; should be verified and set to 30s (vs the 15s `SHUTDOWN_TIMEOUT_MS` hardcoded in `server/index.ts:1090`).
4. **Cost estimates.** Render pricing was researched but should be re-verified at signup. e2b per-sandbox-second pricing should be confirmed against current rate card.
5. **`maintenance:backend-reconciliation` cron is registered and running.** Brief assumes the existing reconciliation cron will fire if the primary terminal-event path fails. Should be verified by checking `server/services/queueService.ts` or equivalent and confirming the cron schedule.
6. **Idempotency contracts on operator pg-boss handlers.** Brief asserts these are correctly keyed (per spec § 10.1) such that pg-boss re-delivery after a forced shutdown is safe. Worth verifying with a smoke test before first customer.
7. **Phase 1.5 use cases (Revenue Ops, Research Intelligence, Paid Ads) are actually shipped.** Brief assumes Phase 1 and 1.5 are complete based on stress-test signals; the hosting decision doesn't depend on this, but the v1.3 architecture brief does.

## 15. Open follow-ups & deliverables

Immediate (before or during initial Render deployment):

1. **Render account setup, region selection, `render.yaml` drafted.** Define both staging and production services as IaC.
2. **Domain + SSL.** Custom domain configured for both environments.
3. **Env-var sets.** Separate secrets per environment (do NOT share DBs or API keys between staging and prod).
4. **CI deploy hooks.** Branch-based deploy on push (main → prod, staging → staging).
5. **e2b account setup, API keys, sandbox quota confirmed for AU traffic.**
6. **Pre-launch manual deploy drill.** Start an OpenClaw session, restart the Render service mid-session, assert the session completes normally. 10-minute test; one-time.
7. **Bump `SHUTDOWN_TIMEOUT_MS` from 15s to 25s** in `server/index.ts` to match Render's 30s default grace period.

Adjacent specs already drafted on this branch:

- `tasks/builds/iee-worker-retirement/spec.md` — retire the legacy worker process before deploying to Render.

Future (post-launch, not blocking):

- Extend `localDockerSandbox.ts` for per-task template switching if fully offline local dev becomes valuable.
- Multi-region story if Australian → global expansion happens (Fly.io migration path).
- Observability: pick a logs/metrics destination (Render's built-in, Logtail, Datadog, etc.); set up alerts on the operator session reconciler.
- Backup strategy for Render Postgres (configurable; default is fine for early stage).
- Cost monitoring dashboard once production traffic exists.

---

## End

This brief is the source of truth for the hosting investigation conducted 2026-05-17. If the decisions are revised after stress-test, append a new section ("Decision revision YYYY-MM-DD") rather than rewriting; the original record is more useful for future-self than a clean-slate rewrite.
