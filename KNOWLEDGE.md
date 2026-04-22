# Project Knowledge Base

Append-only register of patterns, decisions, and gotchas discovered during development.
Read this at the start of every session. Never edit or remove existing entries — only append.

---

## How to Use

### When to write (proactively, not just on failure)
- You discover a non-obvious codebase pattern
- You make an architectural decision during implementation
- You find a gotcha that would trip up a future session
- You learn something about how a library/tool behaves in this project
- The user corrects you (always capture the correction)

### Entry format

```
### [YYYY-MM-DD] [Category] — [Short title]

[1-3 sentences. Be specific. Include file paths and function names where relevant.]
```

### Categories
- **Pattern** — how something works in this codebase
- **Decision** — why we chose X over Y
- **Gotcha** — non-obvious trap or edge case
- **Correction** — user corrected a wrong assumption
- **Convention** — team/project convention not documented elsewhere

---

## Entries

### 2026-04-04 Decision — Injected middleware messages use role: 'user' not role: 'system'

Anthropic's Messages API only supports `system` as the top-level parameter, not as mid-conversation messages. Context pressure warnings are injected as `role: 'user'` with a `[SYSTEM]` prefix. This is the correct pattern — `role: 'system'` inside the messages array would cause an API error.

### 2026-04-04 Pattern — Persist execution phase to agentRuns for observability

The agentic loop already computes `phase` ('planning' | 'execution' | 'synthesis') per iteration in `agentExecutionService.ts` (line ~940). Consider persisting this to the `agent_runs` row for debugging and post-mortem analysis. Deferred to next sprint — would require a schema change.

### 2026-04-05 Decision — Strategic research: build sequence after core testing

Completed competitive analysis (Automation OS vs Polsia.com) and broader strategic research (competitors, proactive autonomy, marketing skills, onboarding, ROI dashboards, voice AI). Key findings and build priorities documented in `tasks/compare-polsia.md`. Research session: https://claude.ai/chat/a1947df8-4546-4cbb-9d8e-65c542b5f40c

**Pre-testing build priorities (Bucket 1):**
1. Morning Briefing skill — read-only orchestrator evaluation cycle, validates agent quality with zero risk (~1 week)
2. Agency Blueprint Wizard — template-based workspace setup using existing `boardTemplates`/`agentTemplates`/`hierarchyTemplates` schemas (~1 week)
3. Baseline KPI capture during onboarding — enables ROI measurement later (2-3 days)

**Post-testing priorities (Bucket 2):** Proactive agent modes (Observer→Advisor→Operator→Autonomous), SEO agent skills, white-labeled ROI dashboards.

**Deferred (Bucket 3):** Voice AI (Vapi/Retell), paid ads skills, cold email, MCP protocol, agent marketplace.

Core platform testing must validate existing skills, three-tier agents, heartbeat scheduling, process execution, and HITL before adding proactive autonomy.

### 2026-04-13 Pattern — Capabilities registry structure for product + GTM documentation

`docs/capabilities.md` is the single source of truth for what the platform can do. Structure that works well across all audiences:

1. **Core Value Proposition** — 3-4 bullets anchoring the system before any detail
2. **Replaces / Consolidates** — three-column table (replaced / with / why it's better); highest leverage section for sales conversations
3. **Product Capabilities** — benefit-oriented, not config-oriented; one paragraph + 3-5 bullets max per section; deep detail stays in `architecture.md`
4. **Agency Capabilities** — Outcome / Trigger / Deliverable table per capability; add contrast ("not assembled manually") to differentiate from generic SaaS language; no skill references (that's triple representation)
5. **Skills Reference** — flat table with Type (LLM/Deterministic/Hybrid) and Gate (HITL/Universal/auto) columns; legend at top
6. **Integrations Reference** — tables by category (external services, engines, data sources, channels, MCP)

Update rule: update `capabilities.md` in the same commit as any feature or skill change. This is enforced via CLAUDE.md "Key files per domain" table. A CI guard script is a deferred follow-up task.

### 2026-04-13 Decision — GEO skills implemented as methodology skills, not intelligence skills

GEO (Generative Engine Optimisation) skills (`audit_geo`, `geo_citability`, `geo_crawlers`, `geo_schema`, `geo_platform_optimizer`, `geo_brand_authority`, `geo_llmstxt`, `geo_compare`) are registered as methodology skills in the action registry and use `executeMethodologySkill()` in the skill handler. This means the LLM fills in a structured template using the methodology instructions — there is no deterministic handler that does the analysis. This is the correct pattern because GEO analysis requires LLM reasoning over page content, not deterministic computation. The `geoAuditService.ts` stores results after the agent produces them; it does not compute scores itself.

### 2026-04-13 Decision — MemPalace benchmarks debunked; anda-hippocampus shortlisted for world model

MemPalace (github.com/MemPalace/mempalace) claimed 96.6% LongMemEval / 100% LoCoMo. Community debunked within 24h: LoCoMo 100% was meaningless (top-k exceeded corpus), AAAK "30x lossless compression" is actually lossy with >10% accuracy drop, palace structure contributed minimally (vanilla ChromaDB did the work), honest independent BEAM 100K score is 49%. Repo is AI-generated stubs masquerading as a product. Status: WATCH only, no integration. Retrieval patterns we extracted (query sanitization, temporal validity, dedup, hierarchical metadata) remain valid — they don't depend on MemPalace. For Brain's world model: week 1 uses `beliefs.json` via AgentOS persistence; next phase shortlists anda-hippocampus (ldclabs) for graph-native memory with sleep consolidation and contradiction detection via state evolution. See `docs/oss-intelligence-analysis.md` post-mortem section.

### 2026-04-16 Correction — capabilities.md must use marketing language, never internal technical terms

When updating `docs/capabilities.md`, ALWAYS write in end-user / sales / marketing language. The editorial rules in CLAUDE.md (rule 3) explicitly say: "Write for end-users, agency owners, and buyers — not engineers. Avoid internal technical identifiers." This applies to ALL updates, not just provider-name scrubbing. Specific violations to avoid: referencing implementation patterns by their engineering names (e.g. "canonical-hash idempotency", "dual-bucket boundary tolerance", "WebSocket-first", "eviction metrics", "adaptive polling backstop"). Instead, describe the USER BENEFIT: "exactly-once execution", "real-time streaming", "usage guardrails", "instant feedback". If you wouldn't say it on a sales call, don't write it in capabilities.md.

### 2026-04-13 Pattern — GEO audit score storage uses JSONB for dimension breakdown

`geo_audits` table stores `dimension_scores` as JSONB array of `{dimension, score, weight, findings, recommendations}` and `platform_readiness` as JSONB array. This allows flexible per-dimension storage without needing separate tables for each score type. The `weights_snapshot` column captures the weights used at audit time so historical scores remain reproducible even if default weights change later.

### 2026-04-17 Gotcha — Rebase with merge conflicts can leave duplicate code visible in PR diff

When a rebase involves merge conflicts in a heavily-edited file, the resolved file can look clean locally while the CUMULATIVE diff against main (what GitHub shows in the PR) reveals old+new versions of a block coexisting — because the fix added the new line without removing the old one during conflict resolution. `git show origin/<branch>:file` shows current HEAD (may look clean), while `git diff main...HEAD -- <file>` shows the cumulative diff that reviewers actually see. Always run `git diff main...HEAD -- <changed-file>` after any rebase that involved conflicts to verify what GitHub will show.

### 2026-04-17 Correction — Verify reviewer feedback against the PR diff perspective, not just the local file

During the MCP tool invocations PR, a reviewer flagged a `const durationMs` shadowing bug multiple rounds. Each time, reading the local file and `git show origin/...` showed clean code, so the feedback was dismissed. The actual issue was that intermediate rebase states had introduced the bug into the PR's cumulative diff, even though current HEAD was clean. Rule: if a reviewer repeatedly flags the same issue and the local file looks correct, run `git diff main...HEAD -- <file>` before dismissing. If the cumulative diff is also clean, the reviewer is misreading diff format markers — confirm and explain.

### 2026-04-17 Gotcha — GitHub unified diff format is commonly misread as "both lines present"

A reviewer seeing the GitHub PR diff may interpret:
```diff
-      const durationMs = Date.now() - callStart;
+      durationMs = Date.now() - callStart;
```
as both lines existing in the final file, when in fact `-` means REMOVED and `+` means ADDED — only the `+` line exists after the change. When a reviewer flags a bug that is visibly "fixed" in the diff (old bad line on `-`, new good line on `+`), the code is correct and the reviewer is misreading the diff format. Confirm by reading the actual file or `git show origin/<branch>:file`.

### 2026-04-18 Correction — "Execute the prompt" means invoke the pipeline, not critique the prompt

When the user hands over a build prompt they authored (e.g. the ClientPulse build prompt) and says "use this in a new session," the correct reading is that the prompt IS the instruction — the next step is to execute it, not to suggest tweaks or ask for confirmation. When the user then explicitly says "I want you to EXECUTE the prompt," the earlier hedge ("safe to paste into a fresh session") was already the wrong posture. Rule: if the user provides a self-contained build prompt and tags it as a Major task per CLAUDE.md, invoke `feature-coordinator` immediately. Do not offer "two small tweaks worth considering" unless the user asks for review of the prompt itself.

### 2026-04-19 Correction — Don't invoke dual-reviewer from within this environment

When the user followed up a pr-reviewer pass by saying "we are running dual-reviewer locally," they meant dual-reviewer cannot run from within the Claude Code session here: the Codex CLI (`/opt/node22/bin/codex`) is installed but reports "Not logged in," no `OPENAI_API_KEY` is set, and `~/.codex/` does not exist. Launching the `dual-reviewer` subagent causes it to fall back to a manual senior-engineer review (duplicating what `pr-reviewer` already produced) rather than a real Codex round. Rule: after `pr-reviewer` completes on this machine, stop and hand off to the user for local `dual-reviewer`; do not auto-chain into it.

### 2026-04-21 Gotcha — Windows `node --watch` kills the dev server abruptly, SIGTERM handlers never fire

The graceful-shutdown handler in `server/index.ts:515` registered on `SIGTERM`/`SIGINT` is **never invoked** during `node --watch` restarts on Windows. Verified empirically: zero `[SHUTDOWN]` log lines across 248 restarts in `/tmp/dev-server.log`. The watcher kills the process directly (no signal delivery), leaving port 3000 in TIME_WAIT for 2–3 minutes. Any long-running work in flight (LLM calls, pg-boss jobs, open DB transactions) is abandoned mid-flight. The graceful-shutdown handler is still useful in production (where SIGTERM is real), but dev-environment code must assume abrupt termination. Fix pattern applied in PR #159: add EADDRINUSE retry on `httpServer.listen()` so the restart cycle tolerates the port being stuck, and make long-running jobs crash-resumable from DB state rather than relying on in-memory progress.

### 2026-04-21 Pattern — DB is source of truth for completed expensive work; retry reconstructs state from DB, not memory

When a pipeline makes expensive external calls (LLM, paid APIs, scraping), the crash-resume invariant is: **"if a result exists in the DB, it is authoritative and must never be recomputed."** Applied in skill-analyzer Stage 5 via `listResultIndicesForJob(jobId)` → filter `llmQueue` → skip paid slugs. Reusable pattern for other subsystems with the same cost profile: `agent_runs` (agent execution loop), scraping runs, connector polling, outcome measurement. The in-memory pipeline state (e.g. `classifiedResults` array) is seeded from the DB on resume so downstream stages that read it still see every candidate — not just the ones newly processed.

### 2026-04-21 Gotcha — "Idempotent retry" that wipes state before re-processing is NOT idempotent

The skill-analyzer handler had a `clearResultsForJob(jobId)` call at Stage 1 labelled "Idempotent: clear any prior results (support for retries)." This was actively harmful — on every pg-boss retry it wiped the work the prior run had completed, forcing every classification to re-run and doubling LLM spend on every crash. Idempotency means "same effect regardless of how many times it runs," not "wipes state to start fresh." If a retry wipes anything non-trivial to recompute, the design is re-entrant, not idempotent. Rule: when reviewing retry logic, verify the retry PATH preserves expensive work rather than re-doing it. File: `server/jobs/skillAnalyzerJob.ts` (fix in PR #159).

### 2026-04-21 Gotcha — Application-level dedupe must `ORDER BY` or it's non-deterministic

`listResultIndicesForJob` originally walked DB rows in whatever order Postgres returned them, then kept-first in a `Set<number>` loop. If duplicate `(job_id, candidate_index)` rows existed with different `classification` values (possible here because the table has no UNIQUE constraint), the "winner" varied across runs — vacuum, HOT updates, or index rebuilds would flip which row was returned first. Fix: explicit `.orderBy(candidateIndex ASC, createdAt DESC, id DESC)` so latest-write-wins is an invariant, not an accident. Rule: any keep-first-in-loop dedupe against DB rows needs an ORDER BY on both the dedupe key AND a tiebreaker; "Postgres happens to return them sorted" is not a contract.

### 2026-04-21 Gotcha — Timeout layers aligned with their wrappers, not tuned independently

`SKILL_CLASSIFY_TIMEOUT_MS = 180_000` (the classifier's outer AbortController) was tighter than `PROVIDER_CALL_TIMEOUT_MS = 600_000` (the inner router cap). Slow-but-healthy classifications hit the 3-min cap before the provider could respond, surfacing as unexplained 499s on the Anthropic dashboard. Rule: when two layers bound the same operation, align the outer with the inner unless there's a specific reason to diverge (documented on the constant). A tighter outer cap is usually accidental, not intentional — verify by reading the adjacent wrapper constant before introducing one.

### 2026-04-21 Correction — Check for adjacent work-streams before drafting a multi-phase spec

Mid-way through drafting `tasks/hermes-audit-tier-1-spec.md`, the user surfaced a separate "cached context infrastructure" development brief (42 Macro ATH pilot, `reference_documents` + `model_tier_thresholds` schema, `cache_control` request builder, cache-attribution fields on the ledger). The briefs interact — cached-context will need new sub-fields on `llm_requests` (`cache_read_input_tokens`, `cache_creation_input_tokens`, ephemeral-TTL fields) that the Tier 1 per-run cost panel will later display. Rule: before drafting a multi-phase spec for a domain (cost / memory / routing), explicitly ask the user "is there any other in-flight brief or related work I should scope against?" and grep `tasks/` + `docs/` for adjacent drafts. Cheaper to check once than to redo file-inventory + deferred-items after the fact.

### 2026-04-21 Gotcha — `LLMCallContext` schema does not carry `correlationId`; use `idempotencyKey`

Wiring the Hermes Tier 1 Phase C breaker into `llmRouter.routeCall` started with spec pseudocode `ctx.correlationId ?? idempotencyKey`. The router's `LLMCallContextSchema` (zod `.object()`) strips unknown fields and does NOT declare `correlationId` — Slack + Whisper callers construct their own ctx object with `correlationId` as a first-class field, but the router does not. For the router, `idempotencyKey` is the stable per-call identifier threaded through every downstream log and is generated before the breaker check. Rule: when cross-referencing a primitive's caller contract, verify the caller's ctx schema before copying a pseudocode field name. If the schema doesn't declare the field, fall back to the closest equivalent that IS declared (idempotencyKey here) rather than accessing a stripped property at runtime.

### 2026-04-21 Gotcha — `agent_runs.hadUncertainty` column exists but is never written; runtime value lives in `runMetadata` jsonb

Phase B's `runResultStatus` derivation reads `hadUncertainty` as one of four inputs. The schema declares `agent_runs.hadUncertainty` as a boolean column with default false — but grepping the entire codebase finds exactly one writer (`clarificationTimeoutJob.ts`), which writes into `runMetadata.hadUncertainty` (the jsonb bucket), not into the dedicated column. At the terminal write site, the correct read path is `runMetadata?.hadUncertainty === true`. Rule: when a column exists on a schema but you cannot find any writer, check the jsonb metadata bucket on the same table before assuming the column is the source of truth — columns declared "for future use" often get shadowed by a metadata field written by the first caller that needed the signal.

### 2026-04-21 Gotcha — React Testing Library is ABSENT; don't treat a spec's "framing deviation" as dep approval

Hermes Tier 1 spec §9 acknowledged a first RTL test surface for `RunCostPanel.test.tsx`. Running `npx vite build` + checking `package.json` before writing the test revealed RTL is NOT installed — `@testing-library/*` is absent and the only existing client test (`DeliveryChannels.test.ts`) uses the extract-pure-logic pattern. Installing RTL would be a net-new dep addition outside the spec's file inventory. Resolution: match the existing codebase convention (extract pure logic into `RunCostPanelPure.ts`, test that with lightweight tsx) rather than install RTL. Spec §9.1's rendering-branch matrix is fully pinned by the pure module's `selectRenderMode` + formatted-string helpers. Rule: before writing a test that adopts a new dep or framework as a "framing deviation", verify the dep is actually installed. Spec approval of a deviation ≠ spec-time validation the tooling exists. Prefer the smaller move (match convention) over the larger move (add dep) when the smaller move still meets the coverage requirement.

### 2026-04-21 Gotcha — `Number.prototype.toPrecision(2)` emits scientific notation below ~1e-6

`formatCost` in `client/src/components/run-cost/RunCostPanelPure.ts` used `abs.toPrecision(2)` for sub-penny rendering. For magnitudes below ~1e-6 (V8 threshold), `toPrecision` switches to scientific notation — e.g. `(1.2e-7).toPrecision(2) === "1.2e-7"` — so the UI would render `$1.2e-7` instead of a decimal dollar amount. The fix is a simple detect-and-fallback: if the `toPrecision` output contains `'e'` or `'E'`, re-render via `abs.toFixed(12).replace(/0+$/,'').replace(/\.$/,'')` to preserve the two significant figures in decimal form. Rule: any number formatter that might touch values below $0.01 needs a scientific-notation guard. Prefer `toPrecision`-then-fallback over `toFixed` alone (which loses precision for very small numbers) or always-scientific (which is unreadable).

### 2026-04-21 Gotcha — pair visibility + aggregation in one atomic scan, not two queries

The first Hermes Phase C shape split the ledger breaker's visibility check (`SELECT id FROM llm_requests WHERE id = $insertedId`) from the SUM aggregate (`SELECT SUM(cost_with_margin_cents) FROM llm_requests WHERE run_id = $runId AND status IN (...)`). Reviewer caught three problems: (a) race window — between the two queries a concurrent commit can change the SUM without changing visibility, (b) visibility predicate was not the same as the aggregation predicate (the inserted row could pass visibility but contribute to a different SUM under a future refactor inserting into the wrong run), (c) two round trips where one suffices. Fix: merge into a single aggregate `SELECT SUM(...), COALESCE(MAX(CASE WHEN id = $insertedId THEN 1 ELSE 0 END), 0) AS found FROM ... WHERE run_id = $runId AND status IN counted`. The CASE expression binds visibility to the same predicate as the SUM; `found === 0` fails closed with `breaker_ledger_not_visible`. Rule: when a visibility check gates an aggregate, they should share one predicate and one scan. Split implementations are a latent race even if current callers happen to be serial.

### 2026-04-21 Gotcha — "hard ceiling" means `>=`, not `>`, when the check is post-cost-record

The original Phase C breaker tripped at `spent > limit`. Because the breaker runs **after** the cost is recorded, this allows spend to reach the limit exactly without tripping; the next cost-incurring call then overshoots by the size of that call before the breaker fires. For a $1.00 ceiling, a run could spend $1.00 + (one LLM call's worth). Reviewer asked for `spent >= limit` so the call that first hits the ceiling is the last one allowed. Rule: for post-record ceiling checks, `>=` gives the hard-ceiling contract callers expect. `>` gives a one-call overshoot window. Pre-record checks (rare — we don't do them because they're stale under concurrency) would use the opposite reasoning.

### 2026-04-21 Gotcha — `SELECT FOR UPDATE` only locks EXISTING rows; the INSERT that materialises the lockable row MUST share the transaction

The first cut of the provisional-`'started'`-row work in `llmRouter.ts` placed the `SELECT idempotencyKey FOR UPDATE` inside a `db.transaction` but the follow-up INSERT `ON CONFLICT DO NOTHING` *outside* the transaction. Reasoning at the time: keep blast radius small, avoid widening the lock scope. pr-reviewer correctly pinned this as blocking: when no row exists for a given `idempotencyKey`, there is nothing to lock. Two concurrent first-calls both pass the SELECT, both commit the (empty) transaction, both fall through to the INSERT, one wins, the loser is silently dropped by `onConflictDoNothing` — and *both* callers proceed to dispatch to the provider. That is the exact double-bill window the provisional row exists to close. Fix: put the INSERT inside the same transaction. A concurrent second caller blocks on the unique-constraint conflict, and after the first tx commits its own SELECT returns the newly-inserted row and takes the reconciliation branch. Rule: when `SELECT FOR UPDATE` is the guard, the write that materialises the lockable row MUST be in the same transaction. "Blast radius" reasoning that splits them is always wrong. See `server/services/llmRouter.ts` §4+7 for the shipped shape.

### 2026-04-21 Gotcha — Tighten terminal-transition WHERE to equality, not negation, to preserve reconciliation signals

All three terminal writes in `llmRouter.routeCall` originally used `WHERE status != 'success'` — "don't downgrade a success". That predicate is correct for the success-vs-error tie break, but it silently allows a late-arriving provider response to overwrite a sweep-written `provisional_row_expired` error: sweep wrote `error` with `errorMessage = 'provisional_row_expired'`; a late success arrives; success upsert passes `status != 'success'`; the sweep's signal vanishes. Reviewer asked for `WHERE status = 'started'` instead — equality with the expected pre-state. Rule: for a state-machine transition X → Y, the upsert guard should be `status = X`, not `status != Y-sink`. The negation preserves the *no-regression* invariant but loses the *intermediate terminal* signal. The equality preserves both and turns the late-arrival case from silent-overwrite into a ghost log (`llm_router.{success,failure,budget_block}_upsert_ghost`) the operator can reconcile.

### 2026-04-21 Pattern — Soft circuit breaker for fire-and-forget persistence

`server/lib/softBreakerPure.ts` is a reusable sliding-window breaker designed specifically for fire-and-forget persistence paths where blocking the primary flow is unacceptable but silent log-and-CPU-drain on DB degradation is equally unacceptable. Config: `windowSize`, `minSamples`, `failThreshold`, `openDurationMs` (defaults: 50 / 10 / 0.5 / 5min). API: `shouldAttempt(state, now)` before the write, `recordOutcome(state, success, now)` after — the return carries `trippedNow: true` exactly once per open cycle so the "breaker opened" log fires once rather than on every suppressed event. On trip the window is cleared so the half-open probe at expiry gets a fresh decision. Current consumer: `persistHistoryEvent` in `llmInflightRegistry.ts`. Pattern applies to any outbound observability write that must not block — webhook delivery audit, integration-event archive, telemetry forwarding. Rule: whenever a fire-and-forget path can fail repeatedly under a degraded dep, gate it with this breaker rather than adding a retry/backoff loop (which is a different shape — this primitive is for "just drop it gracefully", not "try harder later").

### 2026-04-21 Decision — Runtime `/^v\d+$/` assert on IDEMPOTENCY_KEY_VERSION catches what `as const` can't

TypeScript's `export const IDEMPOTENCY_KEY_VERSION = 'v1' as const` catches outright removal of the constant — any consumer `import` would fail to resolve. What it doesn't catch: the constant being set to an empty string, `null as any`, or an unprefixed value that still type-checks as `string`. The load-time assert in `server/lib/idempotencyVersion.ts` throws on any value that doesn't match `/^v\d+$/`. Rule: for runtime contracts where "shape is correct" matters more than "symbol exists", pair a type-level guarantee with a load-time runtime check. The cost is negligible (one regex at module-import), the payoff is catching the narrow refactor-gone-wrong case that would otherwise silently break dedup.

### 2026-04-22 Decision — Interactive review agents must surface decisions to screen; walk-away agents auto-defer

`chatgpt-pr-review` and `chatgpt-spec-review` are interactive — the user is present for every round. They must never auto-defer, auto-reject, or make scope decisions on behalf of the user. Architectural findings are printed to screen with a structured block (Finding / Impact / Recommendation / Reply with) and held in a `pending_architectural_items` register until the user responds. Walk-away agents (`dual-reviewer`, `spec-reviewer`) are the opposite: they must operate fully autonomously using framing assumptions as decision criteria and route all deferred items to `tasks/todo.md` without blocking. Mixing these two modes creates a "half-autonomous hybrid" that is both unsafe (silently losing user decisions) and annoying (blocking an unattended run). Rule: classify each review agent as interactive or walk-away at design time, and enforce that classification consistently through every decision step.

### 2026-04-22 Pattern — Architectural checkpoint needs a size filter to avoid over-blocking interactive agents

When an interactive review agent detects an architectural signal (finding_type is "architecture", changes a contract/interface, or touches >3 core services), it should not unconditionally surface the finding for user decision. Apply a size filter first: ≤30 LOC, single file, no contract break → implement directly and log "architectural signal but small fix — implementing". Only larger or multi-file changes surface the structured decision block. Without the filter, routine improvements that happen to touch a service boundary would require user input every round, making the interactive loop tedious. The threshold is conservative by design — when in doubt, surface rather than implement.

### 2026-04-22 Pattern — Pending decision registers prevent architectural decisions from being lost across rounds

When an interactive agent surfaces a decision for human resolution, re-stating it once is not enough. If the user starts the next round without replying, the decision is silently lost. The fix is a session-level `pending_architectural_items` list: items are added when surfaced and removed only when the user explicitly responds ("implement" / "defer" / "reject" — including "defer", which removes the item immediately by routing it to `tasks/todo.md`). At the start of every new round the list is re-printed before processing new feedback. At finalization, any remaining items downgrade "Ready to merge" to a hard warning. This pattern applies to any agent that surfaces blocking decisions: track state, re-surface on entry, gate completion.

### 2026-04-22 Convention — _index.jsonl must only receive final decisions; pending items are logged only after resolution

`tasks/review-logs/_index.jsonl` uses a strict enum for the `decision` field: `accept / reject / defer`. Writing a "pending" architectural item before the user has responded introduces an invalid enum value and pollutes downstream analytics. Rule: skip `_index.jsonl` writes for items still in `pending_architectural_items`. Write them only after the user resolves each item — at that point the decision is final and the correct enum value is known. The session log's Decisions table can carry "pending (architectural — awaiting your decision)" as a placeholder; the JSONL index should never see it.

### 2026-04-21 Gotcha — `AsyncIterable & { done: Promise<...> }` leaks UnhandledPromiseRejection if the for-await throws

The streaming adapter contract (`server/services/providers/types.ts::LLMProviderAdapter.stream?()`) returns `AsyncIterable<StreamTokenChunk> & { done: Promise<ProviderResponse> }`. Shipping code in `llmRouter.ts` iterated via `for await (const chunk of iterable)` and then `return iterable.done`. If the for-await loop exits via exception (network error, AbortSignal, timeout), the outer try/catch propagates the thrown error — but `iterable.done` is still an unobserved rejected Promise, so Node.js emits UnhandledPromiseRejection when the event loop drains. No adapter implements `stream()` yet so this is latent; it would bite the first adapter implementer. Fix: install a no-op `.catch(() => {})` on `iterable.done` *before* the for-await loop, then `return await iterable.done` at the end — both branches observe the same Promise and the pre-installed catch silences the abandoned-observation path. Rule: whenever a contract ships an "awaitable handle alongside an iterator", the caller must install the observation handler before the iterator can throw, or wrap the whole thing in a helper that owns the lifecycle.

### 2026-04-22 Correction — First-cut CRM free-text capability was a single skill; correct shape is a planner layer

Original recommendation on `claude/gohighlevel-mcp-integration-9SRII` (see `tasks/universal-chat-entry-brief.md` and the superseded dev brief) was a single `crm.live_query` read-only skill: one action in `actionRegistry.ts`, LLM intent parse, direct provider fetch. External reviewer correctly flagged this as too narrow — it locks in a single execution path and forces every future CRM read question to go through the expensive LLM-plus-live-provider path even when the answer already lives in canonical tables. Correct shape is a CRM Query Planner layer that sits between intent and execution and classifies every question as `canonical | live | hybrid | unsupported`, with separate executors per class. The planner is the reusable primitive; `crm.live_query` is at most one executor underneath it. Rule: when a new capability has multiple legitimate execution paths that a user should not have to choose between, the first-class abstraction is the router/planner, not any individual execution path. Skill-shaped "v1 shortcut" thinking produces dead-end architecture for this class of feature. Related: the result envelope is already committed as `BriefStructuredResult` / `BriefApprovalCard` / `BriefErrorResult` in `shared/types/briefResultContract.ts` — the planner must emit into this contract, not invent its own.
