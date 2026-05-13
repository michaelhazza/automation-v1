# Project Knowledge Base

Append-only register of patterns, gotchas, conventions, and corrections discovered during development.
Read this at the start of every session. Never edit or remove existing entries — only append.

> **Architecture decisions live in [`docs/decisions/`](./docs/decisions/), not here** (convention introduced 2026-05-03). KNOWLEDGE.md captures the "watch out for this" stream — observations, gotchas, learned conventions, user corrections. ADRs capture the "we chose X over Y because Z" stream — durable architectural choices with rationale and trade-offs. When in doubt, write a KNOWLEDGE entry first; promote to ADR if the decision keeps coming up.
>
> Entries before 2026-05-03 mix both streams (the convention didn't exist yet). They stay in place — splitting historical entries adds noise without adding signal. New entries follow the split.

## Size-bound policy

KNOWLEDGE.md is append-only and grows. At year 1, a healthy KNOWLEDGE.md is ~1,500–2,500 lines. Beyond ~3,000 it becomes noise — future sessions skim past entries that don't match their domain.

Two safety valves:

1. **Quarterly grouping pass.** Once per quarter, a maintainer (operator or `audit-runner` in a future mode) reads the file end-to-end and groups thematically duplicate entries with a short summary, citing originals by anchor. The originals stay; the summary becomes the entry future sessions read first. Never edit existing entries.
2. **Promote to ADR / architecture.md when an entry keeps being cited.** If a Pattern entry has been quoted in 3+ specs or review logs, promote it: write an ADR or extend `architecture.md`, then leave a final entry pointing future readers to the new home.

The file's value is in retrieval, not preservation. If retrieval slows down, the file is too big.

---

## How to Use

### When to write a KNOWLEDGE entry (proactively, not just on failure)
- You discover a non-obvious codebase pattern
- You find a gotcha that would trip up a future session
- You learn something about how a library/tool behaves in this project
- The user corrects you (always capture the correction)
- You learn a convention not documented elsewhere

### When to write an ADR instead (`docs/decisions/`)
- You make an architectural decision (chose X over Y) and the rationale matters for future sessions
- You lock in a contract or invariant the system depends on
- You set a policy (rate-limit, retention, security) that needs to be defended later

See [`docs/decisions/README.md`](./docs/decisions/README.md) for the ADR convention and template.

### Entry format

```
### [YYYY-MM-DD] [Category] — [Short title]

[1-3 sentences. Be specific. Include file paths and function names where relevant.]
```

### Categories (post-split)
- **Pattern** — how something works in this codebase
- **Gotcha** — non-obvious trap or edge case
- **Correction** — user corrected a wrong assumption
- **Convention** — team/project convention not documented elsewhere

The historical **Decision** category is retired for new entries — write an ADR instead. Existing Decision entries stay in place; future readers should treat them as observations rather than authoritative ADRs.

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

### 2026-04-22 Pattern — Contract-vs-spec separation in chatgpt-spec-review: defer cross-branch findings, apply in-spec ones

During spec reviews where the spec consumes a shared contract owned on another branch (e.g. `briefResultContract.ts` merged to main), a large fraction of review findings will target the contract doc rather than the spec under review. The correct triage is: if the finding's fix belongs in the contract file, defer it as a contract-revision task — never edit the spec to compensate for a contract gap. If the finding describes in-spec behaviour (resolver algorithm, client rendering obligations, error-code sync annotations), accept and apply. This was validated across 3 rounds on `docs/universal-brief-dev-spec.md`: 7 of 15 findings were pure contract territory and deferred cleanly; all 4 accepted edits were verifiably in-spec. Rule: before accepting a finding, ask "does the fix live in this spec file or in the shared contract?" If the contract, defer — with a pointer to the contract file and a note that it needs a separate PR against the branch that owns it.

### 2026-04-22 Correction — "Key files per domain" table moved from CLAUDE.md to architecture.md

Prior entries referencing "CLAUDE.md 'Key files per domain' table" (e.g. the update rule in the 2026-04-13 capabilities.md entry at line 70) are stale. The table now lives in `architecture.md § Key files per domain`. CLAUDE.md contains only a one-line pointer. Future entries referencing this table should cite `architecture.md`.

Similarly, the "Current focus" sprint state moved from CLAUDE.md to `tasks/current-focus.md`. Historical plans that say "update CLAUDE.md §'Current focus'" should now target `tasks/current-focus.md`.

### 2026-04-22 Gotcha — Spec auto-detection exclusion list must include known non-spec task files (seen 1 time in PR review)

`chatgpt-spec-review` detects the spec by filtering `git diff --name-only` for `tasks/**/*.md`. Any task-management file that changes on the same branch becomes a candidate. `tasks/current-focus.md` (the sprint pointer), `tasks/todo.md`, `tasks/**/progress.md`, and `tasks/**/lessons.md` can all appear in a diff but are never specs. If one of these is the only matching changed file, the agent selects it as "the spec" and runs the entire review loop against a pointer or backlog file. Fix: extend the exclusion list in the detection step to cover all known non-spec task files by path. Rule: every time a new infrastructure file matching `tasks/**/*.md` is introduced (pointer files, backlog files, lesson logs), immediately add it to the exclusion list in `chatgpt-spec-review.md`; don't wait for the failure to surface at review time.

### 2026-04-21 Gotcha — `AsyncIterable & { done: Promise<...> }` leaks UnhandledPromiseRejection if the for-await throws

The streaming adapter contract (`server/services/providers/types.ts::LLMProviderAdapter.stream?()`) returns `AsyncIterable<StreamTokenChunk> & { done: Promise<ProviderResponse> }`. Shipping code in `llmRouter.ts` iterated via `for await (const chunk of iterable)` and then `return iterable.done`. If the for-await loop exits via exception (network error, AbortSignal, timeout), the outer try/catch propagates the thrown error — but `iterable.done` is still an unobserved rejected Promise, so Node.js emits UnhandledPromiseRejection when the event loop drains. No adapter implements `stream()` yet so this is latent; it would bite the first adapter implementer. Fix: install a no-op `.catch(() => {})` on `iterable.done` *before* the for-await loop, then `return await iterable.done` at the end — both branches observe the same Promise and the pre-installed catch silences the abandoned-observation path. Rule: whenever a contract ships an "awaitable handle alongside an iterator", the caller must install the observation handler before the iterator can throw, or wrap the whole thing in a helper that owns the lifecycle.

### 2026-04-22 Correction — Delegating a research/audit task with a generic prompt misses spec-specific requirements

During Universal Brief Phase 0, the Sonnet session dispatched an Explore agent to produce the W4 retrieval audit (`tasks/research-questioning-retrieval-audit.md`) with a generic prompt about "retrieval pipeline questions" — embedding, RLS, dedup, logging, token budget, integration points. The brief §8.4 explicitly asked FIVE specific questions (memory block end-to-end trace, `agentBeliefs` influence, `workspaceMemoryEntries` citation rate over last 30 days, scope-precedence chain, context-bloat check). The generic prompt hit three questions tangentially and missed two entirely — `agentBeliefs` (documented in `server/services/agentBeliefService.ts` but not referenced in the dev spec, only in the brief) was missed completely, and the CRITICAL scope-precedence gap (memory block ranking uses scope as a filter not a ranking signal — `memoryBlockService.ts:161-168` + `memoryBlockServicePure.ts:107-135`) went undetected. Rule: when a spec or brief names specific questions an investigation must answer (brief §8.4 pattern), the Explore-agent prompt must quote those exact questions verbatim and require a per-question answer section. Generic topical prompts produce generic output; referenced-question prompts force structured investigation. Secondary rule: cross-check the audit output against the brief's question list before declaring the deliverable complete — not after someone else catches the gap.

### 2026-04-22 Insight — Sonnet-vs-Opus model choice: execution correctness was fine; judgment/investigation was the weak link

Same Phase 0 session as above. Sonnet produced all five Phase 0 code deliverables (`briefArtefactValidatorPure.ts`, `briefArtefactValidator.ts`, `briefArtefactBackstopPure.ts`, `briefArtefactBackstop.ts`, `briefContractTestHarness.ts`) with signatures matching the spec's §6.4 exactly, 67/67 tests passing, and one TS2352 fix correctly applied. The code-execution portion of Phase 0 had zero drift from spec. The weakness appeared in the audit — a judgment-heavy task requiring investigators to connect "what the code does" to "what the brief assumed it did," which is closer to spec-authoring territory than to code execution. Pattern to keep: match model to task type. Sonnet for code + tests + migrations (Phases 1, 2, 3, 5, 9 by type); Opus for investigations, architectural decisions, and spec-vs-implementation cross-checks. Independent of model: every phase should end with a spec + brief cross-check step before the "done" declaration — not as a separate review pass, as an inline verification inside the same phase. The cross-check surfaces gaps the execution pass can't see because the execution pass is inside the problem.

### 2026-04-22 Correction — First-cut CRM free-text capability was a single skill; correct shape is a planner layer

Original recommendation on `claude/gohighlevel-mcp-integration-9SRII` (see `tasks/universal-chat-entry-brief.md` and the superseded dev brief) was a single `crm.live_query` read-only skill: one action in `actionRegistry.ts`, LLM intent parse, direct provider fetch. External reviewer correctly flagged this as too narrow — it locks in a single execution path and forces every future CRM read question to go through the expensive LLM-plus-live-provider path even when the answer already lives in canonical tables. Correct shape is a CRM Query Planner layer that sits between intent and execution and classifies every question as `canonical | live | hybrid | unsupported`, with separate executors per class. The planner is the reusable primitive; `crm.live_query` is at most one executor underneath it. Rule: when a new capability has multiple legitimate execution paths that a user should not have to choose between, the first-class abstraction is the router/planner, not any individual execution path. Skill-shaped "v1 shortcut" thinking produces dead-end architecture for this class of feature. Related: the result envelope is already committed as `BriefStructuredResult` / `BriefApprovalCard` / `BriefErrorResult` in `shared/types/briefResultContract.ts` — the planner must emit into this contract, not invent its own.

### 2026-04-22 Correction — Planner-layer architecture was still too LLM-dependent; correct shape is deterministic-first

Second-round review of `tasks/crm-query-planner-brief.md` caught that even the planner-layer design I produced made the LLM the primary parser — every query paid LLM cost to reach a QueryPlan, with canonical routing a downstream LLM-output interpretation. Reviewer correctly pointed out that this dilutes the canonical advantage and makes cost scale linearly with usage. Correct shape is a 4-stage pipeline: **Stage 1 — Pattern matcher (deterministic, free)** → **Stage 2 — Plan cache (deterministic, free)** → **Stage 3 — LLM planner (fallback only)** → **Stage 4 — Deterministic validator**. Stages 1 and 2 never consult the LLM. Stage 3 runs only on cache miss. Validated plans write back to the plan cache so popular queries pay LLM cost exactly once. Paired change: the canonical candidate list must be promoted from prose to a first-class `canonicalQueryRegistry` with typed handlers — "do we cover X?" becomes a grep, not a prompt-engineering discussion. Rule: any planner design that gates every query on an LLM call has failed to absorb the deterministic-first lesson. The LLM is the expensive fallback, not the default path. Measured via `planner.llm_skipped_rate` — directional, not a v1 acceptance threshold. Related principle: route LLM calls through `llmRouter.routeCall` with a task-class tag so model-tier resolution is router-mediated and org-configurable; never hardcode a model inside the planner.

### 2026-04-22 Pattern — Keep capability routing and data-query routing on separate layers

Third-round review of the CRM Query Planner brief pinned a boundary risk: the Capability-Aware Orchestrator (`architecture.md` §Orchestrator Capability-Aware Routing) classifies every Brief into Path A/B/C/D based on *capability availability*. The CRM Query Planner classifies CRM-read questions into `canonical | live | hybrid | unsupported` based on *where the answer lives*. Without an explicit boundary these two classification layers can drift into duplicated or conflicting reasoning — an implementer might (for example) teach the Orchestrator to pre-classify `canonical vs live` and hand the Planner a narrower task, producing two sources of truth for the same decision. Fix: state the boundary explicitly. **Orchestrator owns capability routing (which capability to invoke). Planner owns data-query routing (how to execute that capability once invoked).** Chat surfaces call the Orchestrator, which calls the Planner — the Planner is one capability among many, not a peer of the Orchestrator. Rule: whenever two classification systems touch the same user intent, make one subordinate to the other by name, in docs, before either ships. "Everyone knows what each layer does" is not sufficient — architect handoffs and future sessions routinely get this wrong when it's implicit. Generalises beyond CRM: any future capability that itself makes routing decisions (e.g. a calendar-query planner, a finance-query planner) inherits the same subordinate relationship to the Orchestrator.

### 2026-04-22 Pattern — When two layers consume the same user intent, share the normaliser as a single utility

The CRM Query Planner's Stage 1 (registry-backed matcher) and Stage 2 (plan cache) both key off a "normalised intent" derived from the user's free-text query. If each stage owns its own normalisation (whitespace trimming, casing, tokenisation, synonym collapse, filler-word removal), the two stages drift — Stage 1 hits on "VIP contacts inactive 30d" but Stage 2 misses because it hashed "vip contacts inactive 30d" differently. Symptom: LLM Stage 3 runs unnecessarily because the cache lookup silently fails, `planner.llm_skipped_rate` tanks, and the cause is invisible in logs because both stages "worked" according to their own rules. Fix: the normaliser is a single shared utility that owns the full pipeline (casing / whitespace / tokenisation / synonym canonicalisation). Both stages consume `normaliseIntent(rawText): NormalisedIntent`; neither re-normalises or post-processes the result. Rule: whenever two layers derive a key from the same user input, the key derivation is one function used by both — not two implementations that happen to agree. Generalises: plan cache + registry matcher (CRM planner), idempotency key derivation + retry detection (llmRouter — already shipped as `IDEMPOTENCY_KEY_VERSION`), webhook signature verification across multiple entry points.

### 2026-04-22 Pattern — One terminal event per logical run: separate "structured log" status events from "execution-log completion" projection

In the CRM Query Planner, `plannerEvents.emit()` forwarded `planner.classified`, `planner.result_emitted`, AND `planner.error_emitted` to the agent-execution-log surface. A single successful planner request emits BOTH `classified` (stage decision marker) AND `result_emitted` (terminal success), so every run produced two `skill.completed` rows on the agent-execution timeline. Fix in PR #177 round 2: drop `planner.classified` from the forwarder's `isTerminal` set; it stays a structured-log-only status marker. Success-path terminal forward = `result_emitted`; error-path terminal forward = `error_emitted`; the two paths are mutually exclusive so exactly one terminal per run is written to the execution-log. Rule: when a subsystem emits multiple granular events to a structured logger, the caller that forwards events to an external "completion" surface (agent-execution-log, UI timeline, metrics rollup) must explicitly choose ONE terminal per logical run and drop all intermediate status events from the forward set. Add tests that assert exactly-one-append-per-run on both success and error paths; the bug is invisible to any single-event unit test. Applies to any subsystem where "status events" and "terminal events" share a structured-log channel but diverge on an external projection.

### 2026-04-22 Pattern — Split external-UX error code from internal-analytics error subcategory

In the CRM Query Planner's Stage 3 catch block (round 2 review), all fallbacks landed as `errorSubcategory: 'parse_failure'` — user ambiguity, LLM malformed response, router-side 402 rate-limit, generic internal errors. Operators couldn't distinguish "users asking unclear questions" (genuine ambiguity signal) from "our LLM provider is flaky" (infrastructure signal) from "we shipped a bad prompt" (software bug signal), so planner-quality metrics were unactionable. Fix: keep the external `errorCode` unified (`'ambiguous_intent'` — user-facing UX says "please rephrase" for every fallback), but split the internal `errorSubcategory` into three enum values — `'parse_failure'` (genuine ParseFailureError), `'rate_limited'` (402 / `isRateLimitedError`), `'planner_internal_error'` (anything else). Discriminator function `classifyStage3FallbackSubcategory(err)` owns the routing. The subcategory is an optional analytics-only field so the enum extension is additive and non-breaking. Rule: when an error code serves two masters (end-user UX and internal observability), split the concerns into two fields. A single enum that collapses three operational failure modes into one user-facing bucket destroys your ability to dashboard the health of each mode. Generalises: any surface where "what the user sees" and "what ops need to see" diverge — payment failures, quota errors, integration timeouts.

### 2026-04-22 Pattern — One top-level execution-mode flag on a staged trace beats nested per-stage inspection

The CRM Query Planner's `PlannerTrace` originally carried `stage1`, `stage2`, `stage3` as nested slots. Answering "did this query come from cache, a registry match, or a fresh LLM call?" required inspecting multiple sub-objects and inferring the winner from which one had `hit: true` — fine for one query in a debugger, unusable in aggregate log analysis or when explaining a "stale data" report to an operator. Fix in round 3: add a top-level optional `executionMode?: 'stage1' | 'stage2_cache' | 'stage3_live'` field, set at a single point per branch entry in the orchestrator (`trace.executionMode = 'stage1'` on stage-1 match, `'stage2_cache'` on cache hit, `'stage3_live'` immediately after `stage2_cache_miss`). Every downstream terminal emission inherits it without per-site plumbing. The field is optional so adding it is additive and non-breaking. Rule: when a staged pipeline emits a structured trace, include a single top-level summary field identifying which stage produced the result. Nested per-stage slots are necessary for deep debugging but insufficient for operator-level "one-glance" observability. The cost (one field, one assignment per branch) is trivial; the payoff (log-aggregation friendliness, dashboard simplicity) is outsized. Generalises to any multi-stage resolver: auth pipeline (session / token / basic), cache hierarchy (memory / redis / DB), retrieval system (BM25 / vector / rerank).

### 2026-04-22 Pattern — When the external reviewer cites a correctness concern that traces to a cache key derivation, add an invariant comment not a second version knob

Round 3 of the CRM Query Planner review flagged that `NORMALISER_VERSION` nominally gates cache correctness but its documented scope (§7.5 — "tokenisation, synonyms, stop-words, hash derivation") is narrower than the surface that actually reshapes plans (validator rules 8/9/10, registry matcher semantics, filter-translation outputs). The reviewer suggested a second version knob `PLANNER_CACHE_VERSION`. Fix applied: add a 20-line invariant comment above `makeCacheKey` codifying "`NORMALISER_VERSION` is the single knob; any change that alters plan shape for a given normalised intent must bump it" and enumerating the wider surface. No second knob — two knobs is worse than one because it invites drift between them, and the single-knob contract is enforceable by convention if the invariant comment is adjacent to the derivation point. Rule: when a reviewer asks you to add a parallel configuration knob to make an existing one "more explicit", prefer a load-bearing invariant comment adjacent to the cache-key derivation over a second knob. The second knob doubles the state space and nothing enforces consistency between them. The comment is free, visible at the exact edit site where drift would originate, and a grep-friendly search target. Applies to any cache / idempotency-key / signature derivation where the input surface is broader than the version field's literal scope.

### 2026-04-22 Decision — Mixed-mode review agents (auto-fix mechanical, route directional) are a new fleet pattern

Added `spec-conformance` to the agent fleet to close a silent-failure class the main dev session kept hitting: it would claim a spec-driven chunk was complete while missing spec-named files, exports, columns, or error codes. Architectural choices: **(1) Mixed mode, not pure-review.** The agent auto-fixes gaps where the spec explicitly names the missing item (path, export name, column, field) and routes anything else (missing validation, missing edge-case behaviour, "maybe also X?") to `tasks/todo.md`. Pure-review would have meant the main session re-opens every log and copies the same mechanical scaffolds the agent already saw — wasted roundtrip. **(2) Fail-closed classification.** The classifier asks "am I 100% sure this is mechanical?" — uncertain → DIRECTIONAL, not MECHANICAL. Prevents the agent from silently extending scope into design choices the spec didn't make. **(3) Mandatory scoping before checklist extraction.** If scope is ambiguous (no chunk named, no progress.md done-markers, no caller confirmation), the agent stops and asks. A partial implementation verified against the full spec produces false MECHANICAL_GAP findings that make the agent try to scaffold not-yet-built items. Rule for future review agents that fix-and-route: the fix path and the route path both need a "I'm certain this is the right bucket" gate; when uncertain, route to human — never default to fixing. Same posture as `spec-reviewer`'s mechanical/directional split; the spec-conformance variant adds a scoping layer because it operates on implementations-in-progress, not finished artifacts.

### 2026-04-22 Pattern — Mutation-path skeleton for any write that lands user or capability content: pure → validate → guard → write → signal → test

Universal Brief PR shipped two different mutation paths (artefact persistence, rule capture) and both converged on the same six-layer shape without anyone designing it explicitly. The shape only became visible when the ChatGPT review loop stopped finding new structural gaps — everything was already in the right layer. Capture it now so future mutation-class features start here instead of re-deriving it under review pressure.

The six layers, in call order:

1. **Pure** — all branch logic lives in a `*Pure.ts` module with no I/O. Given plain inputs, returns a plain decision. Reference examples: `briefArtefactValidatorPure.ts` (is this artefact shape valid?), `briefArtefactLifecyclePure.ts` (which tip wins in a chain?), `ruleCapturePolicyPure.ts` (should this rule start paused?). Tests run against this layer directly — no DB, no mocks.

2. **Validate** — per-item schema + enum check. Independent of state: "does this object obey the contract?" Runs before anything looks at the DB. Rejected items get logged and counted; callers see a per-item result so valid items can still proceed. Reference: `validateArtefactForPersistence`.

3. **Guard** — state-dependent invariant check at write time, built on a pure core + a thin async wrapper that fetches the existing state. Scope the guard narrowly to invariants that are unambiguous regardless of arrival order (e.g. "a parent can only be superseded once"). Out-of-order arrival and eventual-consistency cases stay for the UI layer to resolve — pushing them to the write path breaks legitimate reorderings. Reference: `validateLifecycleWriteGuardPure` + `validateLifecycleChainForWrite`.

4. **Write** — the single insertion point. No bypass routes. Every caller goes through the same function, which runs validate → guard in order, drops rejects via the same rejection pattern (log + increment `*Rejected`), and only then touches the DB. Reference: `writeConversationMessage` in `briefConversationWriter.ts`.

5. **Signal** — structured output back to the caller *plus* in-memory counters for dashboards. Return shape carries enough for the caller to render a precise user-facing message (not just a boolean). Counters follow the existing `getAgentExecutionLogMetrics`-style pattern — module-level `let` variables with a read-only getter, structured log events as the source of truth. Reference: `LifecycleConflictSignal` in the `WriteMessageResult` return shape, `getBriefConversationWriterMetrics()`.

6. **Test** — per-layer, not per-integration. Pure logic has the deepest coverage (branch-by-branch); validator + guard tested against the pure layer; write-path integration has one or two sanity checks of the full stack. Critical edge: *mixed valid + invalid in the same batch* — the write path must be partial-success, never all-or-nothing, and a dedicated test must assert this.

Why this shape wins: each layer can change independently. Policy tightens in the pure layer without touching the write path. New invariants land in the guard without touching validation. Signals extend without breaking callers. And because every layer has its own test seam, regressions stay scoped to the layer that actually changed.

**Rule**: any new mutation-class feature (writes, rule captures, approval dispatches, skill registrations, anything that persists user or capability content) starts by sketching which pure module it needs, which invariant the guard enforces, and what structured signal the write returns. If the feature doesn't slot into all six layers cleanly, that's a design-smell worth pausing on — it usually means the invariant isn't actually enforceable at write time, or the pure logic is buried inside the route handler, or there's no signal for operators. Don't ship mutation paths that skip a layer; add the missing layer first.

Applies beyond Universal Brief: next up are approval dispatch (`BriefApprovalCard` execution — needs a write-time "is this approval still current?" guard), rule idempotency (CGF6 — needs a pure key-derivation function + a DB-level guard), and any CRM write paths that come after the CRM Query Planner's read-only P0.

### 2026-04-23 Correction — UI mockups surfaced every backend capability as a dashboard instead of designing for the user task

Generated five mockups for the cached-context feature that were information-rich enterprise-grade monitoring dashboards — radial utilization rings per model tier, 7-day run-history calendars, prefix-hash identity panels with components JSON, "is caching making us money?" Usage Explorer with trend charts, bundle ranking, cost-split donut, per-tenant financial breakdown. User pushback: "way too complicated for what this app's supposed to be: easy to use. There's just way too much information being surfaced here." The actual need was simple attachment UX — how the user attaches document bundles to agents / tasks / scheduled tasks. Every dashboard screen was a data-model-first trap: the spec exposes `bundle_utilization`, `prefix_hash`, `cache_creation_tokens`, per-tenant rollups, so I surfaced all of it as UI. Rule going forward: **start with the user's primary task, not the capability surface.** Before any UI artifact, answer (a) who is the primary user, (b) what single task are they here to complete, (c) what's the minimum information needed, and default every metric dashboard / diagnostic panel / aggregated-cost view to HIDDEN or deferred. See [`CLAUDE.md` § Frontend Design Principles](CLAUDE.md) + [`docs/frontend-design-principles.md`](docs/frontend-design-principles.md) for the durable rule set. Backend specs stay comprehensive; frontend surfaces stay minimal — those are two different decisions. Generalises to every future UI artifact in this repo: mockups, components, pages, empty states, admin-only views.

### 2026-04-23 Pattern — Spec review arc converges on additive invariants after structural work lands

Closing out the cached-context spec after 5 rounds of external ChatGPT review + 2 `spec-reviewer` (Codex) iterations + 4 brief-review passes + 1 UX revision + 1 vocabulary rename. Total findings: 71, all applied, zero rejected, zero deferred to `tasks/todo.md`. The arc has a shape worth remembering for the next long spec review.

**Structural work lands first, invariant tightening lands last.** The `spec-reviewer` loop (Codex + Claude adjudication) produced the 35 mechanical fixes that shaped the spec's skeleton (uniqueness constraints, schema overlaps, sequencing bugs, missing verdicts). The UX revision restructured the user-facing noun layer. The pack → bundle rename eliminated vocabulary debt at the schema level before any code shipped. Only after all three of those landed did external ChatGPT review start producing meaningful findings — and those findings were almost exclusively additive invariant statements, not structural changes. Round 1: 13 findings, 0 structural. Round 3: 10 findings, 1 small schema addition (`degraded_reason` column). Round 4: 9 findings, 0 structural. Round 5: 3 cleanup items. Round 6: 1 optional polish. The decay is a convergence signal.

**Rule for future long spec reviews:** budget the review arc in three phases. (a) Structural: `spec-reviewer` loop + any product-led pivots, expect ~30-40 mechanical fixes across 2-3 iterations. (b) Vocabulary unification: if the spec introduces a new primitive with any internal-vs-external name split, rename immediately during review, not after implementation — one commit pre-implementation costs nothing, post-implementation it's a multi-week schema migration. (c) Invariant tightening: external review rounds produce additive invariants that protect against future drift; budget 5-10 per round and expect each round to surface fewer findings than the last.

**Rule for deciding when a review arc is done:** when consecutive rounds produce only optional polish items, or when a round explicitly clears the five standard late-stage failure-mode categories (cross-layer contradictions, identity/determinism leaks, snapshot integrity/concurrency, UX ↔ backend alignment, observability-without-UX-pollution), the arc has converged. Additional rounds will produce diminishing returns, not signal. This spec's round 6 was a verdict-only round with one optional polish — a clean convergence marker.

**Rule for vocabulary drift:** when a user or reviewer observes that a spec is using two names for the same concept (backend name vs UI name), rename to the single preferred name immediately, at every layer (schema, services, routes, types, error codes, prose, mockups). Do not "defer to implementation" — vocabulary inconsistency compounds with every layer it survives into. This spec's pack → bundle rename fixed 390+ references across 6 files in one commit because it happened pre-implementation.

### 2026-05-01 Convention — Coordinator handoff write ordering on abort (seen 1 time)

On any coordinator abort or hard-escalation path: always write `handoff.md` FIRST, then update `tasks/current-focus.md`. Never reverse this order. A crash between the two writes leaves current-focus.md pointing at a valid handoff (recoverable) rather than an updated current-focus with no handoff (ambiguous state that every subsequent coordinator launch will reject as a bug). Applied in §6.4.2 of `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`. Generalises to any two-file state machine where the second write is the pointer.

### 2026-05-01 Pattern — Commit file-scope invariant in coordinator-driven builds (seen 1 time)

When a coordinator stages files after a builder sub-agent run: (1) capture the builder's declared "Files changed" list, (2) run `git diff --name-only HEAD`, (3) hard fail if unexpected files appear — do NOT offer to stage only declared files. The "stage only declared files" option allows a distracted operator to accidentally commit cross-chunk bleed. Hard fail forces investigation. Never use `git add .` or `git add -A` from a coordinator. Always `git add <explicit file list>`. Applied in §2.9.3 of `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`.

### 2026-05-01 Pattern — Pre-resume typecheck gate for coordinator resume runs (seen 1 time)

When feature-coordinator resumes from an interrupted build (any chunk is `done` in progress.md): run one full `npm run typecheck` BEFORE processing any chunk-skip decisions. If it fails, do NOT skip any completed chunks — type drift from incomplete later chunks can make a previously-passing chunk look clean when it isn't. The typecheck gate is the cheapest way to catch integrated-state drift before acting on stale progress.md data. Applied in §2.9 of `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`.

### 2026-05-01 Convention — Doc-sync count enforcement (seen 1 time)

When enforcing a doc-sync gate (coordinator or review agent): count the registered docs in `docs/doc-sync.md`, then verify the verdict table in progress.md / session log has exactly that many rows. A row count shortfall is a gate failure, not a review comment. "Missing verdict blocks finalisation" is only enforceable if you verify count, not just presence of some verdicts. Applied in §2.12 and §3.9 of `docs/superpowers/specs/2026-04-30-dev-pipeline-coordinators-spec.md`.

**Rule for testing-posture framing in long specs:** if the spec inherits a framing default from a higher-level doc (e.g. `runtime_tests: pure_function_only` from `docs/spec-context.md`), and the spec defines tests that deviate from that default, declare the deviation explicitly in the spec's own framing-deviations section. Silence creates a cross-layer contradiction that reviewers will catch late. Caught in round 5 of this spec; worth doing proactively next time.

Applies to any implementation-readiness spec review: API contracts, primitive rollouts, cross-cutting concerns.

### 2026-04-23 Pattern — ChatGPT PR-review re-raises previously-adjudicated items under variant framing in follow-up rounds

During PR #183 (cached-context-infrastructure) the ChatGPT review loop went two rounds. Round 1 produced 6 findings: 1 implemented, 4 rejected, 1 deferred (with a documented spec-doc follow-up task). Round 2 produced 4 findings — and 3 of the 4 were the Round 1 rejections re-raised under slightly different framing (subaccount-isolation variant, concurrency-guarantee variant, retention-lifecycle variant). The fourth was a low-severity scope-creep suggestion outside the PR's stated phase. Net new signal in Round 2: zero. The user's correct posture was to reject all four. 

The failure mode: ChatGPT appears to pattern-match on the Round 1 discussion surface (the areas where it previously engaged) rather than re-reading the PR diff / spec state *post*-Round-1 fixes. The model re-opens discussions that were already closed with a recorded architectural rationale, hoping the variant phrasing will change the outcome. 

**Rules for future `chatgpt-pr-review` sessions:**

### 2026-05-03 Pattern — GHL agency-level OAuth uses a dual-table token architecture (seen 1 time)

GHL Module C introduces two distinct token tiers. (1) **Agency token**: one per `(organisationId, companyId)`, stored in `connector_configs` with `token_scope='agency'`, refreshed on a 24h cycle via the standard OAuth refresh_token path. Used for agency-scope endpoints only: `/locations/search` and `/saas/location/.../subscription`. (2) **Location tokens**: minted on demand by POSTing `{ companyId, locationId }` to `/oauth/locationToken` with the agency token as Bearer; cached in `connector_location_tokens` (new table) keyed by `(connector_config_id, location_id) WHERE deleted_at IS NULL`; TTL = 24h, refresh window = 5min. Used for all per-location endpoints (9 methods in ghlAdapter). Key invariants: (a) `connector_location_tokens` is an RLS-protected tenant-scoped table — add to `rlsProtectedTables.ts` in the same migration. (b) `getLocationToken` uses `INSERT ... ON CONFLICT DO NOTHING RETURNING *` as the mint concurrency guard — no additional application-level locking required for correctness. (c) Validate `LocationTokenResponse.companyId === agencyConnection.companyId` and `LocationTokenResponse.locationId === requestedLocationId` before persisting; mismatch → `LOCATION_TOKEN_MISMATCH`, do not persist. Spec: `docs/ghl-module-c-oauth-spec.md`.

### 2026-05-03 Gotcha — OAuth state must carry orgId + nonce; callback must not derive org from session (seen 1 time)

For GHL (and any agency-initiated OAuth install flow), the state parameter passed to the provider MUST contain `{ orgId, nonce }` together, not just a CSRF nonce. The callback is stateless — it arrives on whatever instance handles the redirect and may not have session context. Extracting `orgId` from the request session at callback time is wrong: it's either absent (session expired, different instance) or stale (re-install scenario). The state payload is the only place orgId can travel safely. Invariant: the `orgId` extracted from the validated state entry is the sole authoritative identity for the callback — never fall back to session, query param, or body. If `orgId` is absent after nonce validation, reject with HTTP 400. State store: in-process memory map with 10-min TTL, one-shot deletion on first use. Multi-instance caveat: in-memory state is only safe for single-instance deployments — multi-instance requires a shared store (DB/Redis) or sticky sessions.

### 2026-05-03 Gotcha — Webhook event dedupe row MUST commit AFTER side effects, not before (seen 1 time)

The GHL webhook dedupe row (keyed on `gohighlevel_webhook_id`) must be written only after all side effects for the event have committed successfully. If the dedupe key is written before side effects, a partial failure (side effect fails after the dedupe commits) silently drops the event — GHL's retry sees a committed dedupe key and treats the event as durably processed. Correct ordering: run side effects → commit dedupe row atomically. Any code path that exits before completing side effects must leave the dedupe key absent. The `xmax = 0` upsert guard on `subaccounts` makes side effects idempotent under replay, so re-delivery is safe. Before shipping Phase 5: verify `ghlWebhookMutationsService.ts` commits in this order; if it commits before side effects, reverse the ordering — it is a hard spec invariant, not a "check during implementation".

1. **After Round 1, expect Round 2 to re-raise the Round 1 rejects.** Budget it mentally — don't be surprised. The correct response to a re-raise is `reject` with rationale "already adjudicated in round 1 — no new information", not a fresh analysis as if the item were new.
2. **A round that produces only variant-reframings of prior rejections is a convergence signal, not a new round of signal.** Finalize after that round. Additional rounds will produce diminishing returns, not insight.
3. **In the Recommendations and Decisions table for a re-raise, explicitly reference the Round 1 item number in the rationale.** E.g. "Re-raise of R1 #2 under variant framing — spec §4.2 already pins `bundle_version`; no new information." This makes the regression pattern visible in the log and short-circuits future reviewers trying to evaluate the re-raise on its merits.
4. **Record the round-over-round regression count as a top-theme in the session log** so pattern frequency across PRs is grep-able. Theme vocabulary: `regression` (a re-raise of a prior round's rejected item), distinct from `scope` (new speculative polish) or architecture (a genuinely new structural concern).

This pattern is specific to `chatgpt-pr-review` (interactive PR loop). `spec-reviewer` (Codex, walk-away) shows a different shape — iterations genuinely converge on additive invariants as documented in the 2026-04-23 spec-review-arc entry above. The difference is that Codex is running over the *current* file state on each iteration; ChatGPT is threading a conversation and carries prior-round context forward as soft state.

### 2026-04-23 Pattern — Architecturally-sound PRs often need only one round of external PR review; stop at zero-new-signal

Related to the re-raise pattern above but framed for the decision: "is this PR review done?" For PRs that land with strong architectural framing (clear layer separation, named invariants, explicit deferrals to future phases, spec-conformance + dual-review already run), external ChatGPT PR review tends to produce meaningful signal only in Round 1. By Round 2 the well is usually dry — the reviewer has nothing structural to criticise, so it re-raises prior items or suggests speculative polish.

**Decision rule:** Treat a Round 2 that produces zero `implement` decisions as the finalization trigger. Don't keep running rounds hoping for signal — the signal would already be here if it existed. For PRs without that strong framing (missing layer boundaries, unclear invariants, first-cut architecture), multiple rounds are genuinely useful and the decay may take longer. Calibrate against the quality of the PR itself, not a fixed round count.

Observed round-decay patterns (this codebase):
- Universal Brief PR (#176): 6 rounds (architecturally complex first-cut, genuinely new signal through round ~4)
- CRM Query Planner PR (#177): 3 rounds (strong framing, converged early)
- cached-context-infrastructure PR (#183): 2 rounds (spec-reviewer + dual-reviewer already ran; ChatGPT had little to add)

Higher confidence in architecture → fewer productive ChatGPT rounds. The prior review-loop investment compounds — each reviewer that runs first narrows the signal surface available to the next reviewer.

### 2026-04-23 Pattern — Engine drift from contract is the dominant failure mode once the spec is clean; centralise enforcement and refuse in-workflow exceptions

Captured verbatim from ChatGPT's closing verdict on the riley-observations spec review (PR #179, 3 review rounds + closing):

> "As you move into implementation, watch for this: the biggest failure mode now is engine drift from contract, not spec gaps. Keep enforcement centralised. Avoid 'just this one exception' logic in workflows. Don't let execution logic reintroduce implicit behaviour. If you hold that line, this system scales cleanly."

The rule generalises beyond riley-observations to any system where a declarative contract (capability-layer, config, schema) is consumed by an imperative engine. After the spec stops producing new structural findings, the next failure class is not more spec work — it's the engine diverging from the contract at runtime. Three concrete failure shapes to watch for:

1. **Per-caller exception clauses.** A workflow / orchestrator / dispatcher gets an "edge case" that needs special handling, and the fix lands as a conditional branch in the execution layer ("if `workflowId === 'special-one'` skip the retry guard"). Every such branch is a contract violation that the spec cannot see — the contract still says `idempotent: false → no auto-retry`, but the engine now has a back door. Over time, back doors outnumber the contract.
2. **Implicit behaviour reintroduced during implementation.** The spec says `side_effects = 'unknown' → gateLevel: 'review'`; the engine codes "if `side_effects` is null treat as `'read_only'` for backward compatibility" and the most-restrictive-default guarantee silently evaporates. "Backward compatibility" and "smooth migration" are common rationalisations for this pattern. If the contract is the source of truth, a missing field either fails fast or applies the contract's explicit default — it never silently downgrades.
3. **Enforcement scattered across the consumer set.** Every workflow / dispatcher / queue worker re-implements the contract check ("validate the gate", "clamp the retries", "reject composition violations"). Scattered enforcement drifts because each site's implementation evolves independently; the contract loses its authority. The fix is one central enforcement point that every consumer calls through — spec-enforced at design time (§5.10a's authoring-validator + runtime-dispatcher dual-surface pattern is a working example).

**Rule:** when a capability contract ships, the first thing to build is the central enforcement layer (single function, single module, single predicate) that every consumer invokes. Refuse in-consumer exception logic categorically — if an exception is genuinely needed, it goes in the contract (new enum value, new override flag with logged opt-in, new error class), not in a caller's conditional branch. Any "just this one exception" that doesn't land in the contract is a contract violation; the pressure to add one is the signal that the contract needs extending, not bypassing.

**Complementary build-phase deliverable:** a thin execution test harness that exercises the contract's every branch before the full consumer build-out lands. The harness catches drift early — as soon as a caller diverges, the contract-branch test fails. For riley-observations this means a harness validating §5.4a (capability contract — gate-resolution defaults, non-idempotent retry guard, `overrideNonIdempotentGuard`, hard `maxAttempts ≤ 3` ceiling) + §5.10a (composition constraints — depth=1, no recursive Workflow calls, no callback composition, dispatcher one-step-one-webhook) before Part 2 implementation bakes assumptions in. Captured as a follow-up in `tasks/todo.md § Implementation-time follow-ups for riley-observations`.

Generalises to: any platform primitive with a declared contract and multiple consumers — LLM router task-class declarations, skill side-effects declarations, connection-scope resolution, rate-limit buckets, permission predicates, audit-event classification. The contract + central enforcement + thin execution harness trio is the shape that scales. Scattered enforcement + per-caller exceptions is the shape that collapses.

### 2026-04-23 Pattern — Defence-in-depth composition enforcement: authoring-time validator + runtime dispatcher guard, one is not enough

Shipped in the riley-observations spec §5.10a. The composition constraints (max depth=1, no recursive Workflow calls, no callback composition, dispatcher one-step-one-webhook) are enforced at **two** surfaces — authoring-time Workflow-definition validator on save, AND runtime step dispatcher at dispatch — with an explicit "neither surface is sufficient alone" opener paragraph.

Why both surfaces are required (the single-surface failure modes):

- **Authoring-only enforcement fails on mutated / imported / race-condition / storage-corruption states.** A Workflow definition can enter the persistence layer through multiple paths: the authoring UI (validator runs), a bulk import, a background migration, a test-fixture seed, a restored backup, a direct DB edit in production (rare but real), a race between concurrent edits where one write is validated against a now-stale version. None of these paths reliably invoke the authoring validator. If enforcement lives only at the authoring surface, any non-authoring write path bypasses it.
- **Runtime-only enforcement catches violations too late.** The first author to write the invalid definition gets a silent save; the violation surfaces at dispatch time with a runtime error every run until someone goes back and edits. The authoring UI had the signal at save time and threw it away. Authors discover the mistake via a failing production run, not an inline validation banner.
- **Runtime enforcement is engine-level; authoring enforcement is UX-level.** The two surfaces enforce the same invariant for different audiences — authoring is for the author's immediate feedback loop; runtime is the "nothing ever violates this invariant at execution time, regardless of how it got persisted" guarantee. Both enforce the same rules. Both emit discriminable error codes (`workflow_composition_invalid` authoring-time, `automation_composition_invalid` dispatch-time) so operators can tell an author-mistake-caught-at-authoring from a persisted-state-caught-at-runtime.

**Rule:** any invariant about persisted definitions (composition shape, permission scope, schema consistency, reference integrity) needs defence-in-depth enforcement — **both** the authoring-time surface that catches author mistakes early with good UX, **and** the runtime surface that catches every other write path as a safety net. Build both; document both in the spec with an explicit "neither is sufficient alone" paragraph so later implementers don't drop one "for simplicity". The cost is modest (two call sites share the same pure-function enforcement core); the payoff is that "how did this invalid state end up in production?" stops being a real question.

Generalises to: any spec that declares rules about persisted shapes — permission-set validation, skill frontmatter validation, connection-scope resolution, tenant-isolation invariants, migration-compatibility checks, resource-limit clamps, quota enforcement, approval-chain validity. Mentioned in riley-observations §5.10a as the pattern; reusable anywhere the same shape recurs.

### 2026-04-23 Pattern — Best-effort telemetry writes need a named swallow point + distinct WARN tag per surface

Every dual-write that backs up a best-effort primary telemetry surface needs its OWN risks-and-mitigations entry — not just the primary's. Caught in the hierarchical-delegation spec round 2: §15.6 covered `delegation_outcomes` write-failure as "swallow, WARN, do not fail the skill call" but the event-log dual-write into `agent_execution_events` (§4.3 promised that table as the lossless backstop for `delegation_outcomes` drops) had no mirror entry. A naive implementation would either fail the skill call when the event write threw, or swallow silently with no distinguishing tag, leaving operators unable to tell which telemetry surface was failing.

**Rule for spec authors.** Every best-effort write in the spec gets three things: (a) a named service method as the swallow point (e.g. `insertOutcomeSafe` in §10.3, `insertExecutionEventSafe` in §15.8) — never inline try/catch, because tests and runbooks need to target a name; (b) a distinct WARN tag per surface (`delegation_outcome_write_failed` vs `delegation_event_write_failed`) so operators tailing logs can tell which surface is degraded; (c) an explicit §15-style risk entry naming the swallow mechanism AND the escape hatch (in this case: the error is still returned to the caller's prompt, so the agent sees the rejection even when BOTH telemetry writes drop). The third piece is the one spec authors most often miss — "what still works when the telemetry layer is fully down" should be named, not implied.

**Generalises beyond delegation.** Any spec that introduces a dual-write telemetry pattern (primary + lossless-companion, or primary + audit-log) inherits this pattern. Inspect the spec for every `best-effort` or `fire-and-forget` phrase and confirm each one has a named swallow point + WARN tag + §15 entry. If two dual-writes share a single risks entry, the entry almost certainly misses one surface's failure mode.

### 2026-04-23 Pattern — Stable contract payloads need a serialised-size bound when they admit array-valued diagnostic fields

Shape and extensibility rules alone don't prevent prompt-window blowup or multi-megabyte log rows. Caught in the hierarchical-delegation spec round 2: §4.3's uniform error contract (round 1) pinned `code` enum, `message` posture, required `context` fields, and additive-only extensibility — but did not pin serialised size. One error example included `callerChildIds: string[]`; a manager with 3,000 children would produce a payload that (a) blows the agent's prompt context window when the error lands as a tool-result, (b) writes a multi-megabyte row into `agent_execution_events` every time the skill rejects.

**Rule for spec authors.** When a contract admits array-valued diagnostic fields — even one — pin two things in the contract block: (1) a serialised-size cap (4 KiB is the default; larger only with rationale); (2) a truncation convention with a named sibling flag (`truncated: true`) so consumers know the list is partial. The cap applies to the serialised JSON, not the object graph, so consumers can reason about wire size without re-serialising. First-N-elements is usually the right truncation strategy (preserves the ids most likely to be relevant to the agent's reasoning — the ones it just saw or is about to act on); keep it simple, avoid hashing or sampling.

**Detection heuristic for spec reviews.** Grep the spec for `context: {` or `payload: {` or `body: {` followed by any field that looks array-typed (`...Ids`, `...Names`, `Members`, `Items`). For each hit, confirm the contract block has a size bound or explains why unbounded is acceptable. If the contract says "stable shape, additive-only extensibility" but omits the size clause, that's the finding.

**Generalises beyond error contracts.** Applies to any durable contract surface — webhook payloads, event-bus messages, API response envelopes — where a diagnostic or telemetry field is array-valued. Unbounded arrays in stable contracts become production incidents on the first misbehaving caller.

### 2026-04-23 Pattern — Drizzle self-references break TS inference once a table crosses a width threshold

High-width Drizzle tables with a self-referencing FK column declared via `.references(() => tableName.id, { onDelete: ... })` eventually hit a TypeScript inference ceiling: the self-reference combined with enough sibling columns makes the compiler give up and mark the whole `export const <table> = pgTable(...)` declaration as `any`. The symptom is `TS7022: '<table>' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer` on the table's export line, often surfacing only after an unrelated merge adds columns. Downstream consumers that type-check against the table (every service, every `RunRow`, every join) collapse at the same moment.

Caught on `agent_runs` during the paperclip-hierarchy + cached-context merge: `handoffSourceRunId` declared `.references(() => agentRuns.id, { onDelete: 'set null' })` compiled cleanly before the merge; after main added five more columns, the whole table went `any`. Surgical fix was dropping the Drizzle-side `.references()` clause — the FK constraint lives in the migration SQL, same as the existing `parentRunId` and `parentSpawnRunId` patterns on the same table.

**Rule:** for high-width tables (15+ columns, or any table with two column groups from different subsystems), do NOT declare self-references in the Drizzle schema. Declare the FK in migration SQL only. Drizzle loses nothing — it never issues the FK anyway — and the type inference stays linear. Document the pattern in the schema file with a sibling-column reference so future editors don't re-add it.

**Detection heuristic for pre-merge reviews.** Before merging a branch that adds columns to an already-wide table, grep the schema file for `.references(() => <sameTable>.` (self-reference pattern). Each hit is a latent TS-inference trap that may fire on the next merge. Either drop the self-reference pre-emptively or acknowledge the risk in the merge checklist.

**Generalises beyond `agent_runs`.** Any table that participates in multiple subsystems (execution + context + delegation; runs + events + audit; etc.) inherits this pressure. The pattern shows up once the table crosses ~20 columns — not always predictable in advance. When it fires, the fix is always the same: migration SQL holds the FK, Drizzle declares the column as a plain `uuid(...)`.

### 2026-04-23 Pattern — Review-finding triage (technical vs user-facing) for high-volume review loops

When running a PR or spec review loop with more than a handful of findings, approving each finding one-by-one is friction that adds no judgement. The user's contribution matters on findings that shape visible product behaviour (UI copy, visible workflow, feature surface, permissions, pricing, notifications, auth UX, public API contracts). The user's contribution is near-zero on internal-quality findings (null checks, type safety, refactors, internal contracts, architecture, performance, test coverage, log tags, migrations without UX impact). Forcing approval for the second category is theatre.

The pattern: **triage each finding into `technical` or `user-facing` BEFORE producing a recommendation.** Technical findings auto-execute per the agent's own recommendation — implement, reject, or defer — and get logged for audit. User-facing findings route to the approval gate with recommendation + rationale. Default-to-user-facing on ambiguity (false escalation costs one extra user decision; false auto-apply silently changes product behaviour). Escalation carveouts for technical findings: `defer` recommendations escalate (silent defers accumulate invisible debt), `architectural` scope signals escalate, `[missing-doc]` rejects escalate, low-confidence fixes escalate.

**One more carveout from live use.** When the reviewer themselves pre-classifies a finding as "future, not now" or equivalent (i.e. the decision is already in the feedback), auto-defer without escalating. The user's standing preference to minimize consultation should prevail over the formal escalation rule when there is no judgement for the user to add. The auto-deferred item still lands in `tasks/todo.md` with full trigger conditions so no silent debt accumulates.

**Round summary contract.** The auto-accepted vs user-decided split must be visible in the round summary and in the commit body. `Auto-accepted (technical): <X>/<Y>/<Z>` and `User-decided: <X>/<Y>/<Z>` side-by-side. This is the accountability surface that makes auto-acceptance safe: the user can audit after the fact without being blocked during the session.

**Applied to:** `.claude/agents/chatgpt-pr-review.md` and `.claude/agents/chatgpt-spec-review.md` (Round 1 of the PR #182 review session generated the triage rewrite). First production use ran the 3-round PR #182 review with 11 findings — user approved 8 (7 implement, 1 defer), auto-accepted 5 (3 implement, 2 defer). User consulted on roughly half the findings instead of all of them.

**Generalises to any review loop with more than ~5 findings per round.** The more findings, the higher the friction cost of universal approval and the bigger the triage payoff.

### 2026-04-23 Pattern — Lock orthogonal-subsystem composition contracts explicitly at merge time

When a PR introduces or modifies a subsystem (delegation hierarchy, cached-context infrastructure, observability pipeline, feature-flag rollout), it nearly always coexists with at least one OTHER subsystem that touches the same primitives (`agent_runs`, `skillExecutor`, `conversations`). The implicit behaviour at the boundary — *"what happens at runtime when both subsystems engage on the same object?"* — is often undefined even when both subsystems work correctly in isolation.

Undefined composition boundaries become production bugs once real usage hits the seam: duplicated work, budget blowouts, inconsistent inputs, silent drift between two sources of truth. The reviewer on PR #182 round 2 caught this for paperclip-hierarchy × cached-context: the two subsystems coexisted but had no explicit contract about whether a delegated child run inherits the parent's `bundleResolutionSnapshot` or recomputes its own. The code happened to do the right thing (independent resolution per run) but the contract was implicit; without a locked statement, future edits could drift in either direction.

**Rule:** for every PR that introduces or substantively modifies a subsystem, before merge, add a named subsection to `architecture.md` titled `### Composition with <other subsystem>` for every other subsystem it touches. State three things: (a) the current contract — what happens at the boundary at runtime, (b) the rationale — why this is the right default, (c) the escape hatch — the future opt-in that would let the other direction happen on request. Even if the contract is "these subsystems don't interact" that's worth stating explicitly so future readers know nothing is implicit.

**Detection heuristic for pre-merge reviews.** Grep `architecture.md` for any pair of subsystems mentioned in the same paragraph or adjacent sections. If the paragraph does not contain the phrase `compose` / `composition` / `interact` / `boundary` or equivalent, the contract is probably implicit. Ask the PR author: *"What happens when both X and Y touch the same object?"* If the answer is a shrug or "the code just works", the contract needs locking.

**Generalises to any multi-subsystem PR.** Hierarchy × context (this case), routing × hierarchy, observability × billing, feature flags × A/B experiments, auth × delegation. Every seam is either an explicit contract or a future incident waiting for real usage.

### 2026-04-24 Correction — Consolidate duplicated code paths in situ, don't patch one path

When a reviewer flags a bug in a feature that has two functionally-equivalent code paths (e.g. a primary pipeline path and a retry/manual-invoke path), the instinct to fix only the broken path is wrong — the user's correction was *"should never be two code paths — fix this while you're looking at this"*. The underlying defect is the duplication itself; patching one path locks in the divergence and guarantees the next change cycle reintroduces the same bug. Classic example from this session: `skillAnalyzerJob.ts` Fix-1 fallback got updated (commit `55d8c089`) but the parallel `skillAnalyzerService.ts:classifySingleCandidate` retry path silently stayed on the old null-merge stub — reviewer retries produced "Proposal unavailable" for months. Fix was to extract `buildClassifierFailureOutcome` in `skillAnalyzerServicePure.ts` as the single source of truth and point both paths at it.

**Why:** Two paths producing the same outcome is an invitation for divergence on the next edit. Every future fix to one path must be mirrored to the other; it never is. The duplication is the bug.

**How to apply:** When the first bug finding in a feature is "path A works, path B doesn't," don't just fix path B. Read both paths, find the shared primitive (the thing they're both computing), lift it to a pure helper, route both callers through it. Run tests, commit together. If the larger consolidation risks scope creep (validation pipeline on retry, etc.), fix the immediate divergence and file the remaining consolidation as a tagged todo — but always do the immediate consolidation, not a one-path patch.

### 2026-04-24 Gotcha — `node --watch` restart silently kills in-flight long-running LLM jobs

`node --watch` drops all open TCP connections when it restarts (triggered by any file save on a watched path). In-flight Anthropic API calls are recorded by Anthropic as 499 "Client disconnected" and exit immediately. The pg-boss job entry stays in `active` state because the error handler in the worker never ran (process was killed mid-execution). This produces two symptoms: (1) the UI shows skills stuck mid-classification indefinitely; (2) the Resume button never appears because the DB job is still `classifying`, not `failed`. Production fix: don't run long-running classification jobs under `node --watch` — always use a stable process (e.g. `node dist/server.js`) for any batch that takes >30 seconds.

**Gotcha layer 2 — pg-boss ghost `active` lock.** After the worker dies, pg-boss keeps the job in `active` state until `expireInSeconds` (14400 = 4 hours). Any `resumeJob` call during that window throws 409 "already running." Fix in `skillAnalyzerService.ts:resumeJob`: when the DB job is `failed` but pg-boss still shows `active`, issue a direct UPDATE to `pgboss.job` to expire the ghost row, then proceed with resume.

### 2026-04-24 Gotcha — Resume seeding contract must declare all Stage 5c consumers of `libraryId`/`proposedMerge`

`skillAnalyzerJob.ts` Stage 5 resume seeding (the block that reconstructs `classifiedResults` from DB) historically set `libraryId: null` and `proposedMerge: null` with the comment *"safe — downstream consumers only read candidateIndex and classification."* That contract was accurate when written, but Stage 5c (`SOURCE_FORK`, `NEAR_REPLACEMENT`, `CONTENT_OVERLAP` checks) is an undocumented consumer of both fields. Setting `libraryId: null` caused Stage 5c to `continue` over all resumed entries, silently producing zero fork/overlap warnings.

**Fix:** The resume seeding block now calls the extended `listResultIndicesForJob` which returns `matchedSkillId` and `proposedMergedInstructions`/`proposedMergedName` from the DB, then hydrates both fields. The contract comment was updated to reflect all known consumers.

**Rule:** whenever Stage 5 reads a field from `classifiedResults` that seeding sets to `null`, that field must appear in the resume seeding block. Audit the seeding object against all Stage 5 field accesses before shipping any new Stage 5 check.

### 2026-04-24 Gotcha — Always seed `classify_state.queue` from the full `llmQueue`, not just the remaining subset

At Stage 5 start, `classify_state.queue` is written once and used by the UI to control the stable display order of AI-classifying skills in `SkillAnalyzerProcessingStep`. On a resume, if the queue is seeded with only the remaining unclassified slugs (e.g. 4 of 19), two UI bugs follow: (1) the 4 resumed skills jump to the top of the list because the stable-order logic is keyed on queue position; (2) after Stage 6/7 writes all result rows to the DB, hash-matched `DUPLICATE` skills appear as phantom entries in the `doneOnly` fallback path.

**Fix:** `classify_state.queue` is always set from the full `llmQueue` (all AI-classified candidates from Stage 4, in their original order), regardless of how many are remaining on resume. In the UI, `displaySlugs` was simplified to just `classifyQueue` — `DUPLICATE` skills are intentionally excluded because they resolve in Stage 6/7 and have no per-skill progress to show in the classifier view.

### 2026-04-24 Pattern — Discriminator-trust contract for half-migrated payloads

When a payload type adds optional structured fields alongside a legacy regex/string-shape fallback, the field-presence check (`if (!field) fall back to regex`) is the wrong gate. It conflates "emitter hasn't migrated" (`field === undefined`) with "emitter has migrated and explicitly says unknown" (`field === null`). The result: half-migrated emitters that explicitly set `null` for an unknown value silently get their human summary re-parsed by the regex bridge, producing the wrong answer or a phantom value.

**Rule:** the gate for the legacy fallback path should be the **structural discriminator**, not the field presence. If `payload.skillType === 'automation'` (or whatever the discriminator is), trust the structured payload entirely — including any `null`/`undefined` for unknown-but-structured values. The regex / legacy bridge only fires when no discriminator is present at all.

```ts
// Wrong — half-migrated emitters fall through to regex
let provider = p.provider;
if (!provider && p.resultSummary) { /* regex */ }

// Right — emitter's discriminator decides which contract applies
let provider = p.provider ?? undefined;
const isStructured = p.skillType === 'automation';
if (!isStructured && !provider && p.resultSummary) { /* regex */ }
```

**Detection heuristic.** In any "structured fields with legacy fallback" mapper, grep for falsy-checks on optional fields that decide whether to use the fallback (`if (!provider)`, `if (!errorCode)`, `if (!amountCents)`). If the check doesn't ALSO check the discriminator, half-migrated emitters will silently take the legacy path even though they meant the new contract.

**Applied to:** `client/src/components/agentRunLog/eventRowPure.ts:mapInvokeAutomationFailedViewModel` (Riley Wave 1 PR #186 round 3 R3-5). Generalises to every "v1 → v2 with bridge" mapper — billing event normalisers, webhook payload mappers, agent-result parsers, anything with optional structured fields + a string-summary fallback.

### 2026-04-24 Pattern — Migration-endgame phasing for "introduce → fallback → warn → measure → remove"

When you ship a forward-compatible migration that keeps a fallback alongside the new contract, the fallback rots into permanence unless you explicitly document the removal criteria up-front. Without a stated endgame, future maintainers preserve the fallback "just in case" — and the new contract never becomes the only contract.

**Rule:** every "introduce builder + keep fallback" PR must include a JSDoc block at the top of the affected module spelling out four phases:

```
Phase 1 (DONE): Builder + fallback shipped together
Phase 2 (DONE): Warn-on-fallback emits stable codes ops can grep
Phase 3 (PENDING): Wire counter metric when infra lands
Phase 4 (REMOVAL CRITERIA): When warn rate has been zero for ≥30 days, delete:
  (a) <specific fallback branch>
  (b) <specific bridge code>
  (c) <make optional fields required>
DO NOT preserve the fallbacks "just in case" — keeping them silently re-permits drift.
```

The "DO NOT preserve" line is load-bearing. Without it, the next maintainer reads the warn-on-fallback observability and concludes the fallback is "monitored, therefore safe to keep" — exactly backwards. The observability exists *to enable removal*, not to make the fallback permanent.

**Detection heuristic.** When reviewing a PR that adds a fallback path, ask: *"Where in the code is the deletion criteria written?"* If it's only in a slack thread, a PR description, or "I'll remember", the answer is wrong. It must be in the source file next to the fallback code — that's the only place the next maintainer is guaranteed to read.

**Applied to:** Module-level JSDoc in `client/src/components/agentRunLog/eventRowPure.ts` (Riley Wave 1 PR #186 round 3 R3-2 + R3-6). Generalises to every additive deprecation: shimmed schemas, dual-write database migrations, v1/v2 API endpoints, feature flag rollouts.

### 2026-04-24 Pattern — Stable warn codes with surface.signal namespacing for observable migrations

A migration with a fallback layer is only safe to remove if you can *prove* the fallback is unused in production. "Prove" requires either log-grepping for a stable string or a counter metric — both of which need a stable, queryable identifier per fallback branch. Free-form `console.warn('legacy provider parse')` messages don't satisfy this: log aggregators key on prefix patterns, not human strings, and a re-worded message silently breaks the alerting query.

**Rule:** when adding warn-on-fallback observability, define the codes in a `const FALLBACK_WARN_CODES = { ... } as const` block so they're typed, importable by tests, and grep-able in production logs. Use the dot-namespaced `<surface>.<signal>` shape:

```ts
export const FALLBACK_WARN_CODES = {
  legacySkillSlugDetection: 'event_row.legacy_skill_slug_detection',
  legacyProviderRegex: 'event_row.legacy_provider_regex',
} as const;
```

The surface prefix (`event_row.*`) lets log aggregation queries filter the entire surface with one pattern; the signal suffix is the specific fallback branch. Underscore-only codes (`event_row_legacy_provider_regex_used`) lose the prefix-filter affordance and risk collisions across surfaces.

Inject the warn sink as a parameter (`warn: WarnSink = defaultWarnSink`) so tests can capture calls without polluting test output, and assert on the stable code rather than the message text.

**Detection heuristic.** Grep the codebase for `console.warn(` with a string-literal first argument that contains the words "legacy", "fallback", "deprecated", or "transitional". If the string isn't drawn from a centralised `const` block, the migration's removal-readiness is unmeasurable — which means the migration will never end.

**Applied to:** `client/src/components/agentRunLog/eventRowPure.ts` `FALLBACK_WARN_CODES` constant + `WarnSink` type + injectable default (Riley Wave 1 PR #186 rounds 2 R2-1 and 3 R3-3). Generalises to every observable deprecation — billing-pipeline shims, schema-version branches, retry-policy migrations.

### 2026-04-24 Pattern — Display-threshold filters must preserve state-bearing items

When a UI list is filtered to hide "low-signal" entries (scores below a threshold, recommendations below a confidence bar, results below a relevance cutoff), the filter is correct only if the predicate also preserves any item that carries user-visible state — `selected`, `pinned`, `acknowledged`, `resolved`, `dismissed`. Hiding a state-bearing item below the threshold silently traps the state with no UI affordance to reverse it: the user cannot see the selection, cannot deselect it, and often doesn't know it exists.

**Wrong:**
```ts
// Hides low-score proposals — but also hides a below-threshold proposal
// that was already selected, so the user can't deselect it.
const proposals = allProposals.filter(
  (p) => p.isProposedNewAgent || p.score >= DISPLAY_THRESHOLD,
);
```

**Right:**
```ts
// State-bearing items pass through regardless of score.
const proposals = allProposals.filter(
  (p) => p.selected || p.isProposedNewAgent || p.score >= DISPLAY_THRESHOLD,
);
```

**Rule:** whenever a filter predicate uses a score/relevance/confidence threshold, ask "does any item in the source list carry user-visible state that survives renders?" If yes, the state predicate must appear in the OR alongside the threshold predicate.

**Detection heuristic.** Grep for `.filter(` predicates that contain `>= `, `>`, `< `, `<=` against a numeric score/confidence field. For each hit, check whether the same list carries a boolean state field (`selected`, `pinned`, `resolved`, `acknowledged`, `expanded`). If yes and the predicate doesn't reference that state field, the filter is a candidate trap.

**Applied to:** `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` `AgentChipBlock` — added `p.selected ||` to the `proposals` filter alongside the existing `AGENT_SCORE_DISPLAY_THRESHOLD` guard (PR #185 chatgpt-pr-review round 1 finding 1). Generalises to any approval / selection / pinning UI where items are hidden below a relevance threshold.

### 2026-04-24 Pattern — Dev-time invariant at module load catches partition/enum drift without runtime cost

When a module exports multiple partition sets that must jointly cover an enum (e.g. `FORMATTING_WARNING_CODES` vs the primary warning tier in a warning classifier, mid-flight vs terminal status subsets in a state machine), the partition and the enum live in separate files and drift apart silently as new enum members land. A new warning code added to `mergeTypes.ts` but not classified into either set falls into the default primary bucket — miscategorised, but with no compile error and no runtime signal.

**Rule:** at module load time, in non-production only, walk the enum and assert every member appears in exactly one partition. Use `console.warn` (not `throw`) so a partition drift doesn't hard-crash production even if it somehow slipped past build — but make the warning loud and specific enough that a developer running the app locally sees it immediately.

```ts
// At module scope, not inside a component.
if (process.env.NODE_ENV !== 'production') {
  for (const [code, tier] of Object.entries(DEFAULT_WARNING_TIER_MAP)) {
    if (tier === 'informational' && !FORMATTING_WARNING_CODES.has(code as WarnCode)) {
      console.warn(
        `[MergeReviewBlock] invariant violation: "${code}" is informational-tier ` +
        `but not in FORMATTING_WARNING_CODES — update the partition or reclassify the tier.`,
      );
    }
  }
}
```

**Why this is the right layer.** Type-level enforcement (union types, `satisfies`) can catch this at compile time but requires every enum consumer to opt into the type discipline, and TypeScript's narrowing doesn't always extend to `Set` membership. A unit test can catch it but only runs in CI — local dev changes that introduce drift won't surface until CI fails. A module-load check splits the difference: zero runtime cost in production, immediate feedback the moment a developer opens a page that imports the module.

**Detection heuristic.** Grep for `const FOO_SET = new Set([...])` or `const FOO_CODES = [...] as const` declarations that define a subset of a broader enum. If the enum lives in a separate file and there's no module-load check that cross-references them, the partition is a candidate for drift.

**Applied to:** `client/src/components/skill-analyzer/MergeReviewBlock.tsx` — added a dev-time loop at module load that warns if any informational-tier `MergeWarningCode` is missing from `FORMATTING_WARNING_CODES` (PR #185 chatgpt-pr-review round 1 finding 6). Generalises to every "enum-subset-as-partition" module: status classifiers, permission tier maps, event priority maps, alert severity partitions.

### 2026-04-24 Gotcha — Stale-job sweep window leaves a recovery-blocked gap for resume

A background sweep that marks ghost/stale jobs as `failed` after a threshold (e.g. 15 min of no heartbeat) interacts with a resume endpoint that checks the local row's status before force-expiring the worker-queue ghost lock. If the resume endpoint's force-expire branch only fires when `status === 'failed'`, there's a window — from the moment the worker dies until the sweep promotes the row — during which the local row is still mid-flight, the pg-boss ghost is still `active`, and the resume endpoint throws 409 "already running." The user sees a dead job that can't be resumed for up to `sweepThresholdMs`.

**Rule:** the resume endpoint's force-expire branch must cover both conditions — (a) the local row is already `failed` (sweep ran), and (b) the local row is still mid-flight but `updated_at` is older than a conservative stale bound (e.g. 2× the sweep threshold). Condition (b) closes the sweep-window gap without racing the sweep: if the sweep hasn't run yet but the row is clearly abandoned by any reasonable heartbeat standard, allow the force-expire. Add a structured log event (`<service>.resume_force_expired_ghost`) so ops can see when the gap-recovery path fires in production.

**Detection heuristic.** For any async job subsystem with (1) a "running/queued → failed" background sweep and (2) a resume endpoint that checks status before recovering from a worker-queue ghost state: read the resume endpoint's status check and ask "what does this do between the moment the worker dies and the moment the sweep promotes?" If the answer is "reject with a 409," there's a gap bug.

**Applied to:** `server/services/skillAnalyzerService.ts:resumeJob` force-expire branch — broadened to also cover mid-flight rows whose `updated_at` is older than 30 min (2× `STALLED_THRESHOLD_MS`), with a `skill_analyzer.resume_force_expired_ghost` log event (PR #185 chatgpt-pr-review round 1 finding 7). Complements the existing 2026-04-24 pg-boss ghost `active` lock gotcha above: that entry documents the ghost lock; this one documents the sweep-window gap in the recovery path.

### 2026-04-24 Pattern — Diff rendering must branch explicitly on empty-string inputs

Text diff libraries (`diffWordsWithSpace`, `diffChars`, etc.) handle empty-string inputs technically correctly but produce output that confuses downstream "did anything change?" checks. For `diffWordsWithSpace("", "foo")` the result is `[{added: "foo"}]` — which is right in principle, but any fallback path that asks "did at least one token survive unchanged?" flips to false and renders a misleading empty-strikethrough block ("nothing removed, nothing unchanged → must be a full replacement from X to Y"). The fallback is designed for genuine full replacements, not for the one-side-empty case.

**Rule:** before delegating to any diff library, branch explicitly on empty inputs. Empty baseline + non-empty value → render as pure addition. Non-empty baseline + empty value → render as pure removal. Both empty → render nothing. Only fall through to the library when both sides have content.

```ts
function InlineDiff({ baseline, value }: { baseline: string; value: string }) {
  if (baseline === '' && value === '') return null;
  if (baseline === '') return <Added>{value}</Added>;
  if (value === '') return <Removed>{baseline}</Removed>;
  // Both sides non-empty — library's edge cases are well-behaved here.
  const parts = diffWordsWithSpace(baseline, value);
  // ...
}
```

**Why the guard is not "just a polish."** The empty-string case is hit routinely — deleting a field, clearing an optional description, a newly-added value that didn't exist before. Every one of those flows through the fallback branch if the guard is missing, and the fallback renders incorrectly (empty strikethrough where pure addition is correct, or vice versa). This isn't a theoretical edge case; it's the normal code path for any add-or-remove field in a merge review UI.

**Detection heuristic.** Grep for `diffWordsWithSpace`, `diffChars`, `diffLines`, or any call to a diff primitive. For each hit, read the surrounding logic and check whether the empty-input cases are handled before the library call. If the code goes straight into `const parts = diff...()` without an empty guard, it's a candidate bug.

**Applied to:** `client/src/components/skill-analyzer/MergeReviewBlock.tsx` `InlineDiff` — added explicit empty-baseline and empty-value branches before the `diffWordsWithSpace` call (PR #185 chatgpt-pr-review round 1 finding 5). Generalises to any merge / review / before-after UI that diffs strings.

### 2026-04-24 Pattern — State-bearing items should surface first, not just pass the filter

Complement to the round-1 "Display-threshold filters must preserve state-bearing items" entry above. That rule ensures state-bearing items (selected, pinned, acknowledged) don't get silently hidden by a score threshold. This entry covers the visual corollary: once a state-bearing item has passed the filter, it should also render at the top of the list, not buried among unselected peers in the order the filter produced.

**Rule:** for any list that mixes selected + unselected (or pinned + unpinned, resolved + unresolved) items after filtering, sort state-bearing items to the top. Use `Array.prototype.sort` — stable in ES2019+ — so the secondary ordering (score, recency, alphabetic) is preserved within each group.

```ts
const visible = allProposals
  .filter((p) => p.selected || p.score >= DISPLAY_THRESHOLD)
  .sort((a, b) => Number(b.selected) - Number(a.selected));
// Selected chips render first; unselected preserve their score-ranked order.
```

**Why it matters.** The round-1 filter fix prevents silent state loss but doesn't solve discoverability: a selected below-threshold item that passes the filter can still render at position 12 of 15 chips, where a user searching for "what did I select?" won't see it without scanning. Sorting lifts it to the front.

**Pairing rule.** Whenever you add a state-predicate to a threshold filter (the round-1 rule), apply this sort rule in the same change. The two rules are complementary: the filter keeps state-bearing items from being hidden; the sort keeps them from being buried.

**Detection heuristic.** Grep for `.filter(` predicates that OR a boolean state field (`p.selected`, `p.pinned`, `p.resolved`) with a threshold comparison. For each hit, check whether the downstream render iterates in the filter's order. If yes and there's no sort applied, the list is a candidate for a visibility improvement.

**Applied to:** `client/src/components/skill-analyzer/SkillAnalyzerResultsStep.tsx` `AgentChipBlock` — appended `.sort((a, b) => Number(b.selected) - Number(a.selected))` to the `proposals` derivation alongside the round-1 `p.selected ||` filter predicate (PR #185 chatgpt-pr-review round 2 finding 5). Generalises to any chip list, row list, or card list where user-selected items should be surfaced before unselected peers.

### 2026-04-24 Gotcha — ChatGPT reviewers hallucinate "duplicate line" bugs by reading unified diffs as final state (seen 2 times in this review)

**Signature pattern.** ChatGPT (and similar LLM reviewers) cite what looks like two adjacent JSX / code lines in HEAD, both keyed identically, with *slightly different attributes*. When you verify against the actual file, only one line is present — the other is the `-` side of a unified diff for an edit that replaced the first with the second. The reviewer read both sides of a diff hunk as coexisting in the final file.

**Example (PR #187, ChatGPT review rounds 1 and 3 against the SAME file `SignalPanel.tsx`, same branch, within hours):**
```
Round 1 claim: "broken <li> — stray <span> duplicated outside structure"
Round 3 claim: "duplicated <li> opening — className 'flex items-center justify-between text-[13px]' and className 'text-[13px]' both present in HEAD"
```
Current file: exactly one `<li>` at one line, with `className="text-[13px]"`. The other className was the pre-edit value; both appear in the PR's cumulative diff as `-` / `+` lines, not both in HEAD.

**Why this matters here and not for a human reviewer.** A human reading `git diff main...HEAD` reads the `-`/`+` markers correctly; an LLM reviewer fed the diff as raw text can miss the markers when the two lines differ by only a few words and the surrounding context repeats the same key (`key={s.slug}`). The failure mode is *visual similarity without syntactic markers*.

**Review-agent response.** When ChatGPT flags "duplicated line" or "two versions coexist" in a file, **always verify directly against HEAD with `Read`** before taking action:
1. Read the specific lines called out.
2. Grep for *both* cited strings in the file (if only one is present, the other is a diff artefact).
3. Include the verbatim file excerpt in the Round block as rejection evidence — reviewers that hallucinate don't back down on hearsay.

**Same-session recurrence.** When the same hallucination pattern surfaces a second time in the same session on the same file, that is signal: the reviewer is anchored on the diff, not HEAD. No further rounds will recover signal from that anchor. Finalise the session rather than opening another round.

**Prior entries on this pattern:** 2026-04-17 Gotcha (rebase with merge conflicts), 2026-04-17 Correction (verify against PR diff perspective), 2026-04-17 Gotcha (GitHub unified diff commonly misread). PR #226 (system-monitoring-coverage, 2026-04-28) added two more on the same round: (a) reviewer claimed `SkillAnalyzerExecuteStep.tsx` had two `import RestoreBackupControl` lines — file actually has one; (b) reviewer suggested "improving" `useAsync = opts?.forceSync === true ? false : isAsyncMode()` to a snippet byte-identical to the existing line, plus a comment that already existed verbatim. Both were claimed at high (🔴) severity and verified false in under 30 seconds with `Read`. This is now **6 occurrences across 3 PRs** — a structural failure mode of LLM PR review, not a one-off. The right mitigation is in the review-agent contract (always verify with `Read` before acting), not in the codebase.

**Variant — "improvement" identical to existing code.** A second false-positive subclass: the reviewer's proposed "fix" is the same code already in the file, sometimes word-for-word, sometimes wrapping the existing line in a comment block that already exists. Detection: paste the reviewer's "after" snippet next to HEAD; if no token differs, reject with the diff as evidence. High severity claims by a reviewer do NOT prove the underlying issue is serious — the severity reflects how the reviewer felt about a pattern they think they saw, not whether the pattern exists. Verify the finding's substance before letting the severity claim drive escalation weight.

### 2026-04-24 Convention — Don't spot-fix a string if a deferred refactor already replaces the pathway

During round 3 of a ChatGPT PR review, the reviewer suggested rewriting a user-visible error copy ("already running" → "Worker is still shutting down — try again shortly") in `SkillAnalyzerProcessingStep.tsx` — the string extraction path that parses the 409 response body. The suggestion is valid in isolation. What made it a reject-not-defer is that a round-1 deferral already scoped a tagged-union response contract (`{ status: 'resumed' | 'already_running' | 'rejected', reason? }`) which replaces the error-string-parsing pathway entirely. Applying the copy fix now produces a spot-fix that must be reverted when the contract lands — pure rework.

**Rule:** before accepting a reviewer's polish suggestion on a code path, check the deferred backlog (`tasks/todo.md § Deferred from...` sections) for any entry that replaces or restructures that same pathway. If the deferred refactor will obsolete the line you're being asked to change, reject the polish with a pointer to the deferred item — do not queue both.

**Detection heuristic.** When a reviewer suggests a small-scoped copy / string / error-message change, grep `tasks/todo.md` for the file name or the adjacent function name. If a deferred item mentions the same surface, the polish is almost certainly a duplicate — reject and note the overlap in the round's Decisions table.

**Why this is a convention, not a gotcha.** The backlog is authoritative for "things already planned" regardless of whether the planner is the same reviewer or a prior one. Ignoring it produces PR-level churn (apply → revert → apply different version) and a split commit history that obscures the refactor's intent. Applies to every review-agent loop: ChatGPT PR review, Codex dual-reviewer, human reviewers.

**Applied to:** PR #185 ChatGPT review round 3 finding 6 — rejected the "already running" error-string rewrite because round-1 finding 3 had already deferred the resume tagged-union contract (see `tasks/todo.md § Deferred from chatgpt-pr-review — PR #185`). Session log: `tasks/review-logs/chatgpt-pr-review-bugfixes-april26-2026-04-24T11-55-28Z.md`.

### 2026-04-25 Pattern — Process-local counters in multi-instance services need explicit naming + first-consultation log

When a counter / set / map lives at module scope inside a service that runs in multiple instances (web pool, worker pool, multi-pod), the variable's identifier is the operator's only protection against silently confusing "this process saw N failures" with "the system saw N failures." A neutral name like `failureTimestamps` reads as global — the failure mode is invisible until production.

**Rule:** for any module-level mutable accumulator inside a multi-instance code path, the identifier must contain `processLocal`, `instanceLocal`, or an equivalent explicit qualifier — and the first consultation per process must emit a tagged log (e.g. `logger.warn('self_check_process_local_only', { window, threshold })`) gated by a `hasWarned*` latch so operators see the limitation in logs without spamming on every call.

```ts
// BAD — looks global, reads as "all failures"
const failureTimestamps: number[] = [];

// GOOD — name + warn-on-first-use latch
const processLocalFailureCounter: number[] = [];
let hasWarnedProcessLocal = false;

export async function runSelfCheck() {
  if (!hasWarnedProcessLocal) {
    logger.warn('self_check_process_local_only', { windowMinutes, threshold });
    hasWarnedProcessLocal = true;
  }
  // ...
}
```

**Why naming alone is insufficient.** The operator reading a JSON dashboard or running a query may never see the source. The tagged log gives them a search-string they can correlate across instances — N log entries = N processes participating, which is the actual signal they need to interpret the counter.

**Why it's a convention, not a hack.** The codebase already uses tagged-log-as-metric (see `delegation_outcome_write_failed` in `server/services/delegationOutcomeService.ts` and `architecture.md` notification/delegation section). Adding a dedicated metric counter for this kind of operational caveat is overkill and conflicts with the established pattern.

**Future evolution.** When the service genuinely needs cross-instance counting (real backpressure, shared rate limit), replace the process-local store with Redis or a DB row — the explicit `processLocal*` naming makes the migration target obvious. Until then, the name + warn keep the limitation visible without premature complexity.

**Applied to:** `server/services/incidentIngestor.ts` (rename `failureTimestamps` → `processLocalFailureCounter`) and `server/jobs/systemMonitorSelfCheckJob.ts` (added `hasWarnedProcessLocal` + `self_check_process_local_only` warn log) — PR #188 ChatGPT round 1 finding 3. Session log: `tasks/review-logs/chatgpt-pr-review-claude-system-monitoring-agent-PXNGy-2026-04-24T21-39-06Z.md`.

### 2026-04-25 Gotcha — Partial unique index predicate must match the upsert WHERE clause exactly

Postgres lets you create a partial unique index (`CREATE UNIQUE INDEX ... WHERE status IN (...)`) and use it as the conflict target via `ON CONFLICT (col) WHERE status IN (...)`. The two predicates must be **structurally identical**, not just semantically equivalent — a single status value missing from one side, a different ordering of an `IN` list with NULLs, or `IS DISTINCT FROM` vs `=` differences produce silent failures: the upsert misses the index and either creates a duplicate row (if the unique index is also missed) or throws `there is no unique or exclusion constraint matching the ON CONFLICT specification`.

**Verified-correct example (PR #188 system_incidents):**

```sql
-- Index
CREATE UNIQUE INDEX system_incidents_active_fingerprint_idx
  ON system_incidents (fingerprint)
  WHERE status IN ('open', 'investigating', 'remediating', 'escalated');

-- Upsert (Drizzle)
.onConflictDoUpdate({
  target: systemIncidents.fingerprint,
  targetWhere: sql`status IN ('open', 'investigating', 'remediating', 'escalated')`,
  set: { /* ... */ },
})
```

The two `WHERE` predicates are literally identical — same column, same operator, same value list, same order. That is the bar.

**Why this is a footgun.** When a new status is added to the lifecycle (e.g. `'paused'`) the developer typically updates the upsert (because the application code surfaces the new status) but forgets the index migration. The upsert path then either silently creates duplicate active rows under the new status or starts throwing in production after the first conflict. Both modes are subtle — the duplicate-row mode is only visible as drift, the throw mode only triggers when the second incident with the same fingerprint arrives.

**Detection heuristic.** Whenever you change the lifecycle status enum or any state-bearing column referenced in a partial unique index, grep for `CREATE UNIQUE INDEX.*WHERE` and `onConflictDoUpdate.*targetWhere` and diff the predicates side-by-side. If they don't match character-for-character (modulo whitespace and SQL casing), fix the migration before the next deploy.

**Applied to:** `server/db/schema/systemMonitoring.ts` + `server/services/incidentIngestor.ts` — verified by ChatGPT review round 2 (PR #188) as correct. Generalises to any "active record per fingerprint / per resource / per tenant" upsert pattern that uses a partial unique index for the active-state predicate.

### 2026-04-25 Convention — Tagged-log-as-metric is the project's metrics convention; resist adding new metric infrastructure without a scaling driver

The codebase deliberately treats `logger.error('event_name', { ...payload })` and `logger.warn('event_name', { ...payload })` as the metrics surface. The log pipeline (downstream sink — PostHog / Datadog / similar) counts occurrences of each `event_name` tag and builds rate / count / latency series from them. There is no in-process counter library, no `metrics.increment(...)` API, and no Prometheus registry — by design.

**Anchors in the codebase:**
- `server/services/delegationOutcomeService.ts` — `delegation_outcome_write_failed` tag is the metric for delegation-outcome write failures.
- `server/services/incidentNotifyService.ts` — `incident_notify_enqueue_failed` is the metric for notification-pipeline drops.
- `architecture.md` notification/delegation section documents the convention.

**Rule for review agents and contributors:** when a reviewer recommends "add a counter metric `foo_failures_total` + a 1-retry on best-effort path", check whether the relevant `logger.error` / `logger.warn` tag already exists. If it does, the metric is already wired via the log pipeline — adding a parallel counter creates two sources of truth and contradicts the codebase convention. The right action is to reject the metric suggestion and reference this convention.

**When to actually add metric infra.** When any of the following becomes true:
1. A specific scaling driver requires sub-log-pipeline latency (e.g. circuit-breaker decisions inside a hot loop where the log roundtrip is too slow).
2. A push-channel or external-alert surface needs a counter primitive that isn't satisfied by tagged logs (Phase 0.75+).
3. The log volume itself becomes a cost driver and downsampling is needed at the source.

Until one of those is on the roadmap, every "add a counter" suggestion gets rejected with a pointer to the existing tagged log.

**Why this looks like a hack but isn't.** Metric libraries solve cardinality, aggregation, and retention. The log sink already solves all three for tagged-event payloads — adding a separate counter library would mean reproducing the aggregation in two places and reconciling them. Single-source-of-truth wins.

**Applied to:** PR #188 ChatGPT round 1 finding 7 — rejected `incident_notify_failures_total` counter + retry suggestion because `logger.error('incident_notify_enqueue_failed', ...)` already IS the metric, and the "best effort" contract on the notify path explicitly excludes retry. Session log: `tasks/review-logs/chatgpt-pr-review-claude-system-monitoring-agent-PXNGy-2026-04-24T21-39-06Z.md`.


### [2026-04-25] Correction — Audit framework cited wrong file paths (RLS plumbing, client entry, scheduling/briefing services)

While drafting `docs/codebase-audit-framework.md`, the §4 Protected Files list and §3 Rule 13 cited several paths that were filename-shaped guesses, not facts. The reviewer caught five: (a) `withOrgTx` lives in `server/instrumentation.ts`, not `server/lib/withOrgTx.ts`; (b) `getOrgScopedDb` lives in `server/lib/orgScopedDb.ts`, not `server/lib/getOrgScopedDb.ts`; (c) the client entrypoint is `client/src/main.tsx`, not `client/main.tsx`; (d) `scheduleCalendarServicePure.ts` lives under `server/services/`, not `server/lib/`; (e) `agentBriefingService.ts` lives under `server/services/` and `agentBeliefs` is a schema at `server/db/schema/agentBeliefs.ts` (no separate `server/lib/agentBeliefs.ts` file exists).

**Rule for future doc authoring (especially canonical/protected lists):** never trust a recon agent's file path summary verbatim — every path that lands in a "Protected Files" or "must not delete" list must be verified by `test -f <path>` or a direct `grep -rn "export.*<symbol>"` before the doc is committed. Recon agents synthesise paths from descriptions and are wrong often enough that a list of 30 paths will typically contain 1-3 wrongly-shaped ones. Wrong paths in a protected-file list are dangerous because audit/cleanup passes use them to decide what is safe to delete; a wrong path can lead to deleting the real file (false-negative protection).

**Applied to:** v1.3 of `docs/codebase-audit-framework.md`. Path-verification sweep added as a pre-commit step for any future canonical doc that asserts file locations.

### [2026-04-25] Audit — Schema-as-leaf circular dependency root cause

When a `server/db/schema/` file imports from `server/services/` (even a `type`-only import), it creates a root circular dependency from which hundreds of `madge` cycles cascade. Schema files must be leaf nodes — no upward imports into services, middleware, or any other non-schema layer. In this codebase, `server/db/schema/agentRunSnapshots.ts` contained `import type { AgentRunCheckpoint } from '../../services/middleware/types.js'`, which drove all 175 server circular dependency cycles detected by `madge --circular`. The fix is to extract shared types to `shared/types/` or `server/db/schema/types.ts` and remove the import from the schema file. Verify the cycle count before and after with `npx madge --circular --extensions ts server/` to confirm the root fix resolved derived cycles.

### [2026-04-25] Audit — Audit framework gate-path stale reference

The codebase audit framework v1.3 §2 and §4 reference `scripts/gates/*.sh` as the location for gate scripts. The actual path is `scripts/*.sh` — there is no `gates/` subdirectory. Any session using the framework's path verbatim will fail to find or run the gate scripts. Always verify actual gate paths with `ls scripts/*.sh` before running. This stale reference should be corrected in a framework v1.4 bump. Added to the audit log as a §2 context block finding.

### [2026-04-25] Audit — Phantom RLS session variable pattern

RLS policy migrations can silently reference `app.current_organisation_id` instead of the canonical `app.organisation_id`. The phantom variable is never set by `withOrgTx` or `getOrgScopedDb`, so all RLS policies that reference it evaluate `current_setting('app.current_organisation_id', true)` as `NULL` and fail-open — every tenant can read every other tenant's rows on those tables. In this codebase, migrations 0205–0208 all contained the phantom var. The canonical var is `app.organisation_id`; see migration 0213 for the correct `current_setting('app.organisation_id', true)` pattern. Detect new occurrences with `verify-rls-session-var-canon.sh`. Fix via a new corrective migration — never edit an existing migration.

### [2026-04-26] Migration template — verify column existence on every target table

When a corrective migration applies a single canonical policy/RLS template across multiple tables, verify each target table actually has every column the template references before the migration ships. In PR #196's `migrations/0227_rls_hardening_corrective.sql`, the canonical template referenced `organisation_id = current_setting('app.organisation_id', true)::uuid` and was applied to 10 tables — but `reference_document_versions` (from migration 0203) does not have an `organisation_id` column at all (it scopes via parent `document_id` through an EXISTS subquery). Postgres would have raised `ERROR: column "organisation_id" does not exist` and the migration would have failed to apply. Pr-reviewer caught this pre-merge. Default discipline: for any "apply this canonical shape to N tables" migration, list each table's columns from its origin migration before composing the corrective; child tables that scope via a parent FK need the EXISTS-subquery variant, not the direct-column variant.

### [2026-04-26] Idempotency ≠ concurrency for jobs

A job being idempotent (same input → same effect) does not prevent two parallel runners from both doing the work and conflicting at write time. Two correctly-idempotent runs can still double-load the LLM, both upsert and race on the constraint, or both produce side effects (notifications, webhooks). Treat concurrency as a separate concern with its own per-job declaration. The standard form is a header comment naming both: `Concurrency model: advisory lock on <key>` (preferred — Postgres `pg_try_advisory_xact_lock`) OR singleton key OR queue-level exclusivity, plus `Idempotency model: upsert-on-conflict` (or claim+verify, etc.). Reject implicit "shouldn't happen" assumptions and reliance on scheduler timing as the concurrency story. Test signal: simulate parallel execution → exactly one effective execution path; the other is a no-op.

### [2026-04-26] Cross-service null-safety contract for derived data

Services that consume derived or asynchronously-populated data (rollups, bundle outputs, job-produced state, cached projections) must treat that data as nullable unless its existence is enforced by a DB constraint OR is synchronously produced inside the same transaction. Default to "assume populated" silently degrades when jobs run out of order, partial data exists mid-computation, or a consumer assumes completeness. Required pattern: on null, return `null` / empty list / sentinel — never throw; emit a WARN-level log line `data_dependency_missing: <service>.<field> for <orgId>` so operators see ramp-up gaps. Detect drift via an audit script that flags `.field!` non-null assertions and `if (!data) throw` patterns on known-async fields. Codified as H1 in the post-merge follow-up spec for PR #196.

### [2026-04-26] Pre-existing test failures unmask at large-diff scale

When `test:gates` and `test:unit` fail after a large change (PR #196 was 136 files / +38k lines), the failures often look like branch regressions but most are pre-existing. Standard verification: `git stash && git checkout main && <run gates>; git checkout - && git stash pop`. In PR #196 all 3 blocking gate failures (`verify-skill-read-paths.sh`, `verify-pure-helper-convention.sh`, `verify-integration-reference.mjs`) and all 4 failing unit-test files (`referenceDocumentServicePure`, `skillAnalyzerServicePureFallbackAndTables`, `skillHandlerRegistryEquivalence`, `crmQueryPlannerService`) were identical on `main` HEAD `ee428901`. Don't fix the wrong thing under deadline — verify branch attribution before chasing.

### [2026-04-26] Pattern — ChatGPT spec review reject ratio rises by round; trust the explicit stop signal

Across the 4-round system-monitoring-agent spec review (`tasks/builds/system-monitoring-agent/phase-A-1-2-spec.md`, PR #202), the reject ratio per round was: R1 18% (2/11), R2 0% (0/9), R3 40% (4/10), R4 50% non-spec items rejected outright (2/4). Pattern: ChatGPT exhausts genuine gaps in rounds 1-2; rounds 3+ shift toward restating already-covered rules under variant framing — same dynamic captured in the 2026-04-23 PR #183 entry above, now confirmed for the spec-review loop with a different feedback source. ChatGPT itself emitted an explicit "you're approaching over-specification risk" warning in round 3 round-up and a "Spec: Finalised — move to implementation" stop signal in round 4. **Trust the stop signal.** Continuing past it yields restatement findings, not new gaps. Combine with the 2026-04-23 spec-review-arc convergence rule for a complete late-stage triage: rising reject ratio + explicit reviewer stop signal + consecutive rounds of optional-only items = arc converged.

### [2026-04-26] Pattern — Cross-cutting rule + local mechanism pairs are not duplicates in well-structured specs

When a spec has a registry of cross-cutting axes (e.g. `§4.10 Cross-invariant interaction rules`) and per-domain applications of those axes (e.g. `§9.3 sweep partial-success`, `§12.3 logging conventions`), the registry and applications will appear to restate each other on a shallow read. They are not duplicates — they serve different reader entry paths. A reader entering at the rule registry (executor implementing a new path) needs to see the applications; a reader entering at a feature surface (executor implementing the sweep) needs to see the cross-cutting rule. The load-bearing pattern is **explicit cross-references between the two layers**, not collapsing into one. Detection: in the system-monitoring-agent dedup pass, six possible-duplicate candidates were evaluated (§4.10.1+§4.9.6+§4.10.4 retry trio, §4.10.10+§12.3 no-silent-fallback, §9.3+§4.10.3 partial-success, §9.8+§4.8 write_diagnosis idempotency, §9.11+§12.4 timeout, §4.8 collision paragraph+table). Zero were genuine duplicates — every pair was rule + mechanism with cross-references already in place. **Rule for dedup passes:** before collapsing, verify the candidates serve different reader paths. If both paths need the rule, leave it stated in both with cross-references; do not force readers to navigate to a third location.

### [2026-04-26] Pattern — Default-to-user-facing triage with internal-quality specs achieves 100% autonomy

Across the 4-round system-monitoring-agent ChatGPT spec review, every finding (34 total — 30 in rounds 1-3, 4 in round 4) was triaged `technical` and decided autonomously. Zero user-facing findings, zero user gates, zero user-input-required moments. The spec was internal-quality through and through: failure modes, contracts, schema evolution, observability invariants, idempotency keys, concurrency rules, defaults tables, status markers. **Pattern:** when a spec defines internal subsystems with no described user-visible surface (no UI copy, no workflow ordering, no feature naming, no pricing, no permission policy, no notification copy), the entire ChatGPT review loop is auto-executable under the technical bucket. The triage discipline (default-to-user-facing on ambiguity) does not produce false escalations on this spec class because the ambiguity surface is empty — there are no user-visible elements to mistakenly escalate. **Implication for spec authoring:** specs that intentionally hide user surface (deferring UI to architect, naming only internal types, deferring user-visible features to other specs) are the cheapest to review autonomously. Specs that bundle user-visible surface into internal-contract specs are the most expensive — every UI-string finding requires a user gate. Worth keeping the layers separate at spec time.

### [2026-04-26] Culture — If a gate fails, we stop. We don't workaround the spec. We fix the system.

Surfaced by ChatGPT in the closing verdict on the audit-remediation-followups spec review (PR #201, Round 5). When a static gate, test, or invariant fails, the default response must be **stop and fix the underlying system** — never add an exemption, raise the baseline, suppress the warning, comment the line out, or restructure the code so the gate stops noticing. Each of those reactions hollows out the gate without fixing what the gate was telling you.

**Why this matters in this codebase specifically.** The testing posture is `static_gates_primary` (per `docs/spec-context.md`) — runtime tests are scoped to pure functions only, frontend / API-contract / E2E tests are deliberately deferred. The static gates ARE the safety net. A bypassed gate doesn't just mute one alert; it removes a primary signal from the only signal layer the project currently runs against itself. The fix-the-system / don't-bypass-the-gate posture is therefore not stylistic — it is the operational contract that makes the rest of the testing posture coherent.

**Concrete decision rules:**
1. If a gate fires on your PR: assume the gate is right and your code is wrong until proven otherwise.
2. If proving otherwise takes more than 15 minutes, escalate — do not bypass while you investigate.
3. If the gate is genuinely wrong (false positive), fix the gate, add a regression test for the gate's logic, then re-run on your PR. Do not exempt your specific occurrence.
4. Baseline-count increases in `scripts/guard-baselines.json` always require a PR-description note explaining why (per §0.7 of the audit-remediation-followups spec). No silent baseline creep.
5. Rate-limit / DEBUG-downgrade discipline applies to operator log lines, not to gate signals — gate signals stay loud.

**Anti-patterns to reject in review:**
- "Add this file to the allowlist for now, we'll fix it later" → no, fix it now.
- "Bump the baseline by 1, the gate is too strict" → no, justify or fix.
- "Comment out the failing assertion, the test is wrong" → no, the test is asking a real question.
- "Wrap the call site in an exception so the runtime guard doesn't see it" → no, that's exactly what the guard is for.

**Applied to:** ChatGPT spec review session for `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md` (PR #201, Round 5 closing verdict). The spec itself codifies the supporting machinery — §0.1 gate quality bar, §0.5 no silent success on partial execution, §0.7 baseline-rot prevention, §4.1 per-item integrity check — but this culture rule is the human-side contract that makes them stick.

### [2026-04-26] Spec review pattern — Reviewer pressure surfaces blast-radius before the reviewer surfaces blockers

Across the 4 review rounds on the audit-remediation-followups spec, ChatGPT's first round produced 8 structural findings that were all variants of one theme: **the original sequencing concentrated blast radius and the reviewer caught it before any "blocker" surfaced**. A1 was a single 31-method API migration + gate flip in one PR; A2 shipped runtime-guard + schema-diff + migration-hook all at once; H1 enforcement gate started blocking on day 1; B2 sequenced four jobs as a single chunk. None of these were "wrong" — they were just brittle in execution.

The reviewer's actual contribution wasn't pointing at design defects. It was pointing at **where execution would crack first**. Round 1 produced 8 splits / phases / advisory-mode demotions; Round 2 produced 11 precision tightenings on the new edges those splits exposed; Round 3 produced 8 measurable-trigger refinements on the new precision edges; Round 4 produced 12 drift-prevention rules on the long-term failure modes the now-tightened version would face over time. Each round's findings were generated by the previous round's edits — the spec didn't get more "correct", it got progressively more **execution-resilient under pressure**.

**Reusable rule for spec authors:** when a reviewer's first round is structural (not factual), do not interpret it as "the spec is wrong". Interpret it as "the spec is brittle". Apply the splits and re-submit; expect the next round to be precision tightenings on the new seams. Plan for 3–4 rounds of this shape on any spec that is large enough to have real blast radius (~1500+ lines, multiple cross-cutting items, gates that touch CI). Do not stop after Round 1 — the structure-first / precision-second / drift-prevention-third shape is the pattern.

**Anti-pattern.** Treating Round 1 structural feedback as "blockers" and trying to defend the original shape. The spec was already approvable in Round 1 — but defending the unsplit A1 / unphased A2 / day-1-blocking H1 would have produced a worse outcome than splitting them and accepting the precision rounds that followed.

**Applied to:** ChatGPT spec review session for `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md` (PR #201) — 4 substantive rounds, 39 findings applied, 0 deferred, 1 closing verdict round. Session log: `tasks/review-logs/chatgpt-spec-review-audit-remediation-followups-2026-04-26T00-57-02Z.md`. Generalises to any spec ≥1000 lines with multiple cross-cutting items.

### [2026-04-26] Spec authoring — Cross-cutting `§0.X` meta-rule slots are the right home for execution-discipline rules that govern many items at once

The audit-remediation-followups spec accreted seven cross-cutting meta rules across four review rounds — §0.1 gate quality bar, §0.2 no new primitives unless named, §0.3 no cross-item scope expansion, §0.4 determinism over cleverness, §0.5 no silent success on partial execution, §0.6 architecture default lock scope, §0.7 baseline rot prevention. Each was extracted from a recurring failure mode that would otherwise have to be re-stated inside every relevant item.

**Why this works.** Once the §0.X slot exists, individual items reference the rule by section number rather than restating it. A1b cites §0.4. B2 cites §0.5 and §0.6. E2 cites §0.7. H1 cites §0.3 and §0.5. The cross-references compress the spec without losing precision and — more importantly — every later round's reviewer can write "extend §0.4" instead of "add a determinism note to A1b AND A2 AND B2 AND C3 AND D3 separately". The spec stays internally consistent because the rule lives in one place.

**Authoring heuristic.** When a review round produces three or more findings that are variants of the same architectural posture (determinism, scope control, observability volume, lock scope, partial execution, baseline discipline, primitive reuse), promote the posture to a §0.X slot rather than stamping each item. The conversion threshold is "three items would benefit" — under that, an item-local note is fine; at or above that, the meta rule earns its slot.

**Where NOT to use this pattern.** Item-specific contracts (e.g. "A2 requires `allowRlsBypass` be declared explicitly", "C1 [GATE] line is the last application-level line") stay inside the item. The §0.X slot is for posture that applies across items, not for any constraint that happens to be cross-cutting in surface area.

**Applied to:** `docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md` §0.1 through §0.7. Pattern generalises to any backlog spec with ≥6 items where cross-cutting architectural posture emerges across rounds of review.

## Post-merge observations: PR #196

Template entry — operator must fill in actual outcomes after running the runbook at
`tasks/runbooks/audit-remediation-post-merge-smoke.md`. This section records the live
results once the 7-step smoke test is executed against a deployed environment.

| Step | Outcome | Notes |
|---|---|---|
| 1 — Agent creation | (pending) | |
| 2 — Automation trigger | (pending) | |
| 3 — GHL webhook receipt | (pending) | |
| 4a — bundleUtilizationJob | (pending) | |
| 4b — measureInterventionOutcomeJob | (pending) | |
| 4c — ruleAutoDeprecateJob | (pending) | |
| 4d — connectorPollingSync | (pending) | |
| 5 — Log tail (10 min) | (pending) | |
| 6 — LLM router metrics | (pending) | |
| 7 — Final verdict | (pending) | |

Update this section and flip the §5 Tracking row to `✓ done` after the operator completes
all 7 steps cleanly. Any blocker from step 7 goes to `tasks/todo.md § Blockers`.

---

## Audit-remediation followups: pre-existing test triage

Files triaged (2026-04-26):

- `server/services/__tests__/referenceDocumentServicePure.test.ts` — `out.split('---\n')[1]` matched the `---DOC_START---\n` delimiter instead of the `\n---\n` metadata separator, so `parts[1]` was the metadata block rather than the content block. Disposition: **test-only bug** — fix: split on `'\n---\n'`.

- `server/services/__tests__/skillAnalyzerServicePureFallbackAndTables.test.ts` — assertion `includes('[SOURCE: library]')` was stale after `withSourceMarker` was updated to always embed the heading-qualified `sourceKey`, producing the extended form `[SOURCE: library "heading>cols"]`. Disposition: **test-only bug** — fix: prefix match `includes('[SOURCE: library')`.

- `server/services/__tests__/skillHandlerRegistryEquivalence.test.ts` — three handlers (`crm.query`, `ask_clarifying_questions`, `challenge_assumptions`) were added to `SKILL_HANDLERS` in `skillExecutor.ts` after the test's 163-entry baseline was set; the mirror list and count assertion were not updated. This test is an anti-drift gate — it MUST be updated in the same commit as any `SKILL_HANDLERS` addition. Disposition: **test-only bug** — fix: add 3 keys to `CANONICAL_HANDLER_KEYS`, bump count to 166.

- `server/services/crmQueryPlanner/__tests__/crmQueryPlannerService.test.ts` — file had no env-seeding preamble; `crmQueryPlannerService.ts` transitively imports `server/db/index.ts` which validates `DATABASE_URL`/`JWT_SECRET`/`EMAIL_FROM` via zod on module initialisation. Pattern: add `await import('dotenv/config')` + `process.env.X ??= 'placeholder'` **before** any service import. Because ESM static imports are hoisted, the service import must be a dynamic `const { x } = await import(...)` placed after the env-seed block. Disposition: **test-only bug** — see `skillHandlerRegistryEquivalence.test.ts` for the canonical pattern to copy.

**Reusable rule:** Any test file that imports a service which (directly or transitively) calls `server/db/index.ts` must apply the env-seeding + dynamic-import pattern. Static imports are hoisted in ESM and cannot be gated behind top-level `await` env setup.

### 2026-04-26 Gotcha — Adding `getOrgScopedDb()` to a log-and-swallow service must keep the resolution INSIDE the existing try/catch

When migrating a service from a module-top `db` import to function-scope `getOrgScopedDb('source')`, do NOT place the resolution above the existing try/catch — even if the call looks like setup. `getOrgScopedDb` throws `failure('missing_org_context')` when called outside an active `withOrgTx` ALS context, and that throw will escape any error boundary placed below it.

**Caught in PR #203 (Round 2) on `server/services/onboardingStateService.ts`.** Commit `86548956` (refactor(services): A3) moved `const db = getOrgScopedDb('onboardingStateService');` to the line immediately above the existing `try/catch`. The file's documented contract is "Failures are logged and swallowed — bookkeeping must never block execution," and 7 caller sites in `workflowEngineService.ts` and `workflowRunService.ts` invoke it after committing terminal `cancelled` / `completed` status updates with no surrounding try/catch of their own. With the resolution outside the catch, a contract violation by any caller (workflow path that bypassed `withOrgTx`) becomes a hard failure of workflow finalisation instead of a logged-and-swallowed bookkeeping miss.

**Rule.** For any service whose header contract says failures are log-and-swallow, the FIRST line inside the `try` block must be `const db = getOrgScopedDb(...)`. Resolution lives inside the boundary, not above it. Apply this consistently across the services that share this contract — onboarding state, telemetry dual-writes, audit-log inserts, "best-effort" event mirrors. The cost of the extra line of indentation is zero; the cost of a hard-failure regression on terminal workflow paths is a stuck queue.

**Detection heuristic.** When reviewing a service refactor that adds `getOrgScopedDb`, grep the diff for `getOrgScopedDb(` and confirm every hit is inside a `try {` block. If any hit is at function-scope above `try`, that's the regression. The same heuristic catches the inverse mistake (someone wrapping `getOrgScopedDb` in a try/catch where the contract should fail loudly — admin paths, hot paths that demand org context).

---

### 2026-04-27 Workflow — Always use TodoWrite for any "implement" instruction

**Rule.** When the user says "implement X" (or starts a session continuing a prior implementation), the FIRST action is `TodoWrite` with every sub-task broken out individually. Never start writing code before the task list exists.

**Why.** Long implementation sessions hit context limits and time out. A visible task list survives the break: the user can see exactly where work stopped, and the next session resumes from the right item without re-reading the whole conversation. Without a task list, context loss = work loss.

**How to apply.**
1. On any implementation request (new feature, phase, sub-task batch): call `TodoWrite` before touching a single file.
2. Mark each task `in_progress` immediately before starting it; mark `completed` immediately after — never batch.
3. At context compaction / pre-break: the task list is the handoff document. No separate progress file needed if the list is current.
4. Sub-tasks should be file-level or function-level — specific enough that any item can be resumed cold. "Update service X" is too vague; "Add `handleBriefMessage` to `briefMessageHandlerPure.ts`" is right.
5. The same rule applies to spec writing, audit runs, and review passes — any multi-step task with risk of interruption gets a task list.

### [2026-04-27] Gotcha — `feature-dev:code-architect` has no Write tool; use `architect` or `feature-coordinator` when output must persist to disk

When dispatching an architect agent to produce a large design document, `feature-dev:code-architect` returns its output as a response message — it cannot write files. If the output is 400+ lines, reconstructing it from the message is error-prone (line breaks, truncation, formatting loss). The correct agent types for architect work where the result must land as a committed file are:

- `architect` subagent type — has Write access, produces `.md` documents directly
- `feature-coordinator` — orchestrates the full pipeline including architect output as a file

The `feature-dev:code-architect` agent is useful for read-only design exploration where the output feeds the current session's reasoning, not when it needs to be committed as a spec artefact.

**Applied to:** Pre-launch hardening sprint Chunk 2 architect dispatch — first call used `feature-dev:code-architect`, returned 630 lines as a response message, had to re-dispatch via `feature-coordinator` to get the file written to `tasks/builds/pre-launch-hardening-specs/architect-output/schema-decisions.md`.

### [2026-04-27] Pattern — Long-doc-guard requires skeleton-first, Edit-append authoring for any doc over ~10,000 chars

`.claude/hooks/long-doc-guard.js` blocks single `Write` tool calls that exceed ~10,000 characters. Any documentation file over that threshold must use the chunked workflow:

1. `Write` the skeleton (header + table of contents + section headings only — no body text).
2. `Edit` to append each section's body. Mark its TodoWrite task `in_progress` before starting, `completed` immediately after. Never batch completions.
3. Never attempt to `Write` the full document in one call — the hook blocks it and returns `BLOCKED by long-doc-guard`.

This is not a soft suggestion — the hook is a hard block. The `Edit`-append pattern is the only exit. When authoring any spec, invariants doc, or checklist that will exceed 10K chars, plan the skeleton → section sequence in a TodoWrite task list before starting.

**Applied to:** All 6 per-chunk specs in the pre-launch hardening sprint + the consolidated `docs/pre-launch-hardening-spec.md` (~2080 lines). The skeleton + Edit-append pattern was used 9+ times across the sprint session.

### [2026-04-27] Pattern — Safe-by-default for binary-risk fields with future-contributor pressure

When a registry field controls a high-blast-radius behaviour (e.g. double-fire of an external side effect, irreversible delete, cross-tenant write), the default value of the field MUST be the safe one AND the pre-flight MUST refuse omission. "Default to the dangerous value, document the safe alternative" is a regression-by-inheritance trap — a future contributor adds a new entry, copies the shape from a neighbour, and inherits whatever default the field carries. Example from system-agents v7.1: `IdempotencyContract.reclaimEligibility` was originally documented `'eligible' (default)`; the safe value is `'disabled'` (no double-fire). Round-3 inversion: default → `'disabled'`, pre-flight (`verify-agent-skill-contracts.ts`) refuses to load any write-class skill that omits the field, AND declaring `'eligible'` requires a runtime-budget annotation comment in the source so the choice is auditable in PR review. The friction is the point. **Test the rule:** delete the field from a live entry → seed pre-flight exits 1 with a hard-fail message naming the skill. If a future contributor cannot accidentally inherit the dangerous default, the rule holds.

### [2026-04-27] Pattern — Defence-in-depth pair: static gate + test-mode runtime hook for highest-impact invariants

For invariants whose silent regression is unrecoverable (e.g. "no external side effect before idempotency claim"), a static gate alone is insufficient — non-adapter code paths bypass it (handler issues a side effect through a non-HTTP path the gate doesn't see). Pair the static gate with a pure-function test-mode predicate that throws if the invariant is violated, gated on `NODE_ENV === 'test'` so production is a true no-op. Pattern: `assertHandlerInvokedWithClaim(claimed: boolean): void` exported from the wrapper, called inside the side-effect-bearing branch with the live-state variable (NOT a literal `true` — the variable lets a future refactor's regression be caught). Pure (no DB / network / FS), so it fits `runtime_tests: pure_function_only` posture from `docs/spec-context.md`. Pure-function test cases: (a) `claimed=false` + `NODE_ENV=test` → throws; (b) `claimed=true` + `NODE_ENV=test` → silent; (c) `claimed=false` + `NODE_ENV=production` → silent. The pair is load-bearing: the gate catches the adapter-direct-call class; the test hook catches every other regression class. Either alone leaves a hole.

### [2026-04-27] Pattern — Late-round consolidation block as the load-bearing audit entry point

When a spec's invariants span 8+ sections (claim semantics, hash determinism, reclaim rules, terminal failure, side-effect ordering, state-machine closure, TTL + cleanup, etc.), the spread is an audit / onboarding / incident-response failure mode — readers can't see the full guarantee surface from any one section. Late-round consolidation block (added in round 3 of the system-agents v7.1 review at ChatGPT's "optional but high-leverage" suggestion) sits at the top of the execution-safety section as a 3-column table: Guarantee / Where it is established / **Where it is enforced**. The third column is load-bearing — it forces every guarantee to point at a code path or static gate; documentation-only rows are explicitly forbidden by a closing extension rule ("adding a guarantee requires a row + section reference + gate reference"). Prevents documentation lies. Cheap to add late (zero new symbols, pure consolidation); load-bearing forever after. **When to add:** if your spec has more than 6 distinct invariants spanning 4+ sections, the consolidation block is no longer optional — readers will silently miss guarantees without it.

### [2026-04-27] Pattern — Post-finalisation review rounds amplify the existing reject ratio; partial-applies dominate the apply column

System-monitoring-agent spec was already finalised at v1.0 after 4 rounds (2026-04-26 — see entry above). After a post-merge audit alignment commit reshaped the principal model + RLS posture + B2 job standard, a fresh ChatGPT pass produced 2 more rounds: Round 5 (v1.0 → v1.1, 9 findings) and Round 6 (v1.1 → v1.2, 9 findings). Reject ratio across the resumed loop was Round 5 22% (2/9) + Round 6 67% (6/9) — an even sharper rise than the original 4-round arc. **Pattern emerging from both sessions:** when a spec re-enters review after substantive author edits, ChatGPT defaults to proposing additions, but most of those additions were already implicit in the recent edits. The session's value comes from the **partial-applies** (3/9 in each round) — where the finding's *invariant statement* is worth promoting from implicit to normative even though the finding's *specific implementation* (a column, a key, a default-value bump) is wrong frame. Examples from Round 6: heuristic firing constraint (apply contract paragraph + new opt-in field; reject the proposed default-value bumps), sweep coverage (apply new synthetic check + invariant; reject per-entity column), event-time vs write-time (apply rule + optional metadata field; reject column-on-every-event). **Rule for resumed reviews:** triage every finding as "what's the invariant ChatGPT is reaching for" (often correct) vs "what's the proposed mechanism" (often wrong frame given existing primitives). Apply the invariant; reject the mechanism with explicit inline rationale; never apply the full finding-as-stated when the invariant is already covered by a different mechanism.

### [2026-04-27] Pattern — Stale non-goal entries survive multiple review rounds when the contradicting addition is in a different section

Round 1 of this session's review added §5.5 protocol-version stamping rule: "every generated `investigate_prompt` carries a `## Protocol\nv<n>` line at the top." Rounds 1 and 2 then operated on §5.5 directly without ever cross-checking §3.2 NG10 ("No prompt versioning") — a directly contradicted non-goal that survived two full rounds of review with integrity-check passes returning zero issues. ChatGPT itself only caught it in the final-verdict text after Round 2 ("Make sure NG10 is updated or removed"). **Why the integrity check missed it:** the integrity-check pass scans for forward references and missing inputs/outputs introduced *by this round's edits* — a stale non-goal from v1.0 isn't an integrity-check finding, it's a consistency finding across the spec's full text. **Rule for spec-review finalisation:** before declaring `done`, run a targeted grep for the spec's non-goal labels (NG1, NG2, …) against any new normative section added in the session. If a non-goal says "no X" and a new section says "we now do X", that's a finalisation-pass cleanup item — not a per-round integrity-check item. Add a finalisation grep to the chatgpt-spec-review contract: for each round's applied findings, grep the spec's non-goals section for the same vocabulary and reconcile or remove. The reconciliation is mechanical (technical-triage), but the detection requires a *different scan* than the per-round integrity check.

### [2026-04-27] Pattern — Default-to-user-facing triage holds across resumed reviews when the spec deliberately hides user surface

Confirmed for a second time on the same spec: across Rounds 5 + 6 + finalisation cleanup (19 total decisions), every single finding triaged `technical` and was auto-applied / auto-rejected without a user gate. Zero user-facing escalations across both the original 4-round loop AND the resumed 2-round loop. **Stronger form of the 2026-04-26 pattern:** a spec that intentionally defers UI to a separate architect spec (per the system-monitoring-agent §10 "UI surface" reference back to existing `SystemIncidentsPage` extension only — no new pages, no new copy strings, no new workflow steps) survives ChatGPT's review pressure across multiple sessions without producing any user-visible findings. The triage discipline produces zero false escalations because the user-visible surface is structurally empty. **Implication:** when authoring an internal-contract spec for a system that has a user-visible surface, the cheapest path to autonomous review is to extract the user surface into a separate spec (or defer to architect) so the contract spec can be reviewed under pure technical-triage. Bundling internal contract + user copy + workflow ordering into one spec forces every round to wait on user decisions for the UI-string findings.

### [2026-04-27] Pattern — Three-layer defence-in-depth for status writes (WHERE-guard / log-bridge / hard-assert)

When migrating status-write boundaries from a single guard layer (state-based `WHERE inArray(status, [...non-terminal])`) to a stronger guarantee (runtime `assertValidTransition`), do not flip every site at once. Use three layers concurrently and migrate sites between them over time:

1. **Pre-existing WHERE-clause guard** — already in place at every site; gives 0-row no-op on contract violation but is silent.
2. **Observability bridge** — `describeTransition({ ..., guarded: false })` log line emitted immediately before the UPDATE. Lets log queries quantify the unguarded-by-assert surface area while keeping migration incremental.
3. **Hard assert** — `assertValidTransition(...)` throws `InvalidTransitionError` on terminal→non-terminal, terminal→terminal, or unknown-status target. Adopted at high-blast-radius sites first.

The bridge layer is the load-bearing piece. Without it, a partial migration looks identical (in logs) to a fully-migrated codebase, so operators cannot tell when the migration is complete or surface unconverted sites for review. Adopt the log line at the same time you start adopting the assert.

**Applied to:** PR #211 R3-2 — `shared/stateMachineGuards.ts` exports both `assertValidTransition` (hard) and `describeTransition` (log). 5 sites adopted the assert (`workflowEngineService.ts`, `agentRunFinalizationService.ts`); 2 high-volume terminal-write sites in `agentExecutionService.ts` adopted the log with `guarded: false` and stayed on the WHERE guard pending the F6 follow-up spec. Operators query `event=state_transition guarded=false` to see remaining migration surface.

**When NOT to use this pattern.** If the new assert can be adopted everywhere in one PR (small surface, clear sites), skip the bridge layer — three-layer transition only earns its complexity when migration is incremental.

### [2026-04-27] Decision — Risk-class split for cached-context isolation rollout (read-leak vs write-leak)

Read leakage (one tenant queries data scoped to another) is **exposure** — bounded blast radius, contained per query. Write leakage (insert/update lands on the wrong tenant) is **corruption** — durable damage that compounds across reads. Cached-context isolation has both surfaces; rolling them out together obscures the urgency gap.

**Pattern.** Split the rollout by risk class:
- **Write side first, log-only:** ship `logCachedContextWrite({ table, operation, organisationId, subaccountId, hasSubaccountId })` at every write boundary. Cheap, surfaces the higher-blast-radius surface in observability before it becomes an incident. Promote log → hard assert under a follow-up spec when the explicit `{ orgScoped: true }` discriminator is defined.
- **Read side later, mechanical:** the F2a follow-up — shared `assertSubaccountScopedRead(query, subaccountId)` helper + grep/CI gate. Lower urgency because exposure is bounded per query.

Splitting also makes the spec-author's job tractable — each half can carry its own decision (failure mode, discriminator design, gate type) without entangling the other.

**Applied to:** PR #211 R2-2 — original F2 finding split into F2a (read, deferred) and F2b (write, partial-shipped). `server/lib/cachedContextWriteScope.ts` is the F2b log helper; full assert promotion routed to `tasks/todo.md § CHATGPT-PR211-F2b`.

**Reusable test.** When a reviewer flags a single mechanical-enforcement gap that has both a read side and a write side, ask: would each side need a different failure mode (log vs throw) or a different discriminator? If yes, split the rollout. If no, ship them together.

### [2026-04-27] Pattern — Bypass annotations bind to function name, not file

When introducing a doc-rule that requires an annotation at every caller of an allow-listed primitive (RLS-bypass functions, admin-DB scopes, raw-SQL escape hatches), the annotation MUST cite the immediately-following function name verbatim, not just the file or table. Form:

```
// @rls-allowlist-bypass: <table_name> <function_name> [ref: <invariant-or-spec-§>]
async function fooJob() { ... }
```

**Why.** Files accumulate functions over time. Without name binding, an allow-listed file silently grows new bypass call sites because the file itself is "covered" by the annotation. Binding the annotation to a specific function name closes that gap — if a developer renames the function, moves it, or copy-pastes the bypass into a sibling function, reviewers can grep for `@rls-allowlist-bypass` and spot orphaned annotations whose third token no longer matches the next declaration.

**Why no CI gate.** A new gate is a new primitive (`DEVELOPMENT_GUIDELINES § 8.4` — prefer existing primitives). At current call volume, grep is sufficient: `grep -nE "@rls-allowlist-bypass" server/` lists every annotated caller, and reviewers spot-check whether the line below each annotation declares a function whose name matches the third token. The gate becomes worth its cost only when allow-list size × code churn makes the manual grep error-prone.

**Applied to:** PR #211 R3-5 — `scripts/rls-not-applicable-allowlist.txt` format-rules header. The allow-list itself is currently empty by design (every tenant table is registered); the rule fires when the first real entry is added.

**Anti-pattern.** Annotating the file (`// rls-bypass file: foo.ts`) without naming the function — silent drift as the file grows.

### [2026-04-27] Pattern — Stable-tiebreaker sort for distributed event reconciliation

When a client merges optimistic local writes with WebSocket-streamed events into a single ordered list, sort by `(serverTimestamp, immutableId)` — never by `serverTimestamp` alone. ISO timestamps with second precision can collide across multi-server fan-out; without a tiebreaker, the merged list oscillates as new events arrive, causing list re-rendering, scroll jumps, and visible flicker.

**Comparator shape:**

```ts
items.sort((a, b) => {
  if (a.serverCreatedAt !== b.serverCreatedAt) {
    return a.serverCreatedAt < b.serverCreatedAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;  // tiebreak by immutable, unique ID
});
```

The tiebreaker must be immutable (artefact ID, message ID, decision ID — not a derived field that can change between renders) and unique (collision-free by construction).

**Applied to:** PR #211 R3-1 — `client/src/pages/BriefDetailPage.tsx` `mergeArtefactById` sorts by `serverCreatedAt` primary + `artefactId` secondary. Server stamps `serverCreatedAt` at write time; client re-sorts only on stamped incomings (legacy optimistic inserts without timestamps fall through to replace-or-append).

**When this matters.** Any UI surface that merges live data from multiple sources where ordering visibly affects UX — chat threads, run timelines, audit logs, notification streams. Less critical for tables sorted by paginated cursor (cursor stability is a different problem).

### [2026-04-27] Pattern — Pre-merge sanity check pass: 4 read-only confirmations after a multi-round review iteration

After a multi-round ChatGPT/Codex review iteration concludes with "you're done" verdict, run 4 read-only confirmation checks targeted at the riskiest invariants the iteration introduced. Cost: ~30 seconds × 4. Value: catches any regression introduced during the review rounds themselves at zero implementation cost.

**Check shapes:**

1. **No silent bypass** — the new infra adds a guard or assertion. Confirm no path skips both the new infra AND the pre-existing fallback (e.g. WHERE-clause guard). Grep for the assert call sites; verify each is wired or replaced by a logged-and-WHERE-protected variant.
2. **No dead instrumentation** — new logging / observability hooks are imported and called from at least one real, callable production path. Grep the import; trace the call chain to a route handler / job entry / scheduled tick.
3. **No wrong-position assumption** — if the iteration introduced new sorting or ordering, confirm no existing code assumes "last item in array = latest" (or first = oldest). Grep for `[length - 1]`, `.at(-1)`, `.pop()` on the affected types.
4. **No theoretical-only enforcement** — if the iteration introduced an annotation rule, doc-rule, or convention, confirm it has at least one real call site. If not, document explicitly that it's empty-by-design (see "Empty-allowlist-by-design is correct" below).

**When to skip.** Trivial PRs (single-file fix, no new infra). When the reviewer's "you're done" comes after only one round of substantive feedback (no iteration to regress against).

**Applied to:** PR #211 Round 4 — all 4 checks run; 3 pass; check 4 N/A by design (empty allowlist). Recorded in `tasks/review-logs/chatgpt-pr-review-impl-pre-launch-hardening-2026-04-26T23-59-09Z.md § Round 4 § Sanity check results`.

### [2026-04-27] Convention — Empty-by-design allow-lists / registries are correct, not a flaw

When a doc-rule introduces a registry (allow-list, exception-list, opt-out catalog) and the registry is empty at the time the rule lands, that is the **expected** state — not a flaw to fix by adding placeholder entries. The rule fires when the first real entry is added; until then, the rule is intentionally theoretical.

**Why.** The rule's value is preventing future "just add it to the list" reflexes by codifying the entry format upfront. Adding a fake entry to "validate the rule" mechanically would dilute the registry (placeholder vs real entries get confused over time) and contradict the rule's purpose.

**Detection.** When a reviewer flags "rule is theoretical / not exercised", confirm the registry is empty by design (file header should say so) before treating the finding as a gap. If the file header doesn't document the empty-by-design state, that's the actual fix — annotate the file, not the rule.

**Applied to:** PR #211 Round 4 sanity-check 4 — `scripts/rls-not-applicable-allowlist.txt` is empty; file header explicitly states "Currently empty — every tenant table on `main` is registered in `rlsProtectedTables.ts`. Add new entries below as needed." Reviewer's "rule is theoretical" finding correctly closed as N/A-by-design.

### [2026-04-27] Pattern — Reviewer follow-up may overturn round-1 defer when cost-curve evidence emerges

When a reviewer iteration produces a Round 1 finding that is reasonable to defer, do NOT treat the defer as locked. If the reviewer's Round 2 follow-up cites cost-curve reasoning ("cheap now, very expensive later") on the same finding, that is the strongest signal to overturn the round-1 defer in the same session.

**Why this works.** Round 1 defers are usually decided on scope/architectural grounds ("new primitive, multiple call sites, escalate"). Round 2 follow-ups have access to the round-1 decision and can refute it specifically — when the refutation is cost-curve evidence (not a re-litigation of scope), it carries more weight than the original scope concern. Acting in the same session preserves the iteration's coherence; deferring further would create an open thread the next session has to re-discover.

**How to apply.**
1. When a round-1 finding is deferred on scope grounds, leave a marker (`tasks/todo.md` entry with rationale).
2. If the reviewer's next round cites the deferred finding with cost-curve reasoning, escalate to user with the round-2 quote.
3. User-directed implement overturns the round-1 defer; capture the overturn in the log so future review sessions can read the trail.
4. Apply the minimum coverage scope per the reviewer's round-2 advice — not the full original scope — to keep the overturn cheap.

**Applied to:** PR #211 R2-6 (`assertValidTransition`) — Round 1 deferred F6 on architectural-scope grounds (multiple call sites, new primitive). Round 2 ChatGPT marked it "the most important decision in this round" / "cheap now, very expensive later". User explicitly directed implement — minimal coverage shipped (terminal-write boundaries only, 5 sites), remaining coverage routed to `CHATGPT-PR211-F6 (FOLLOW-UP)`.

**Anti-pattern.** Honouring the round-1 defer mechanically when round-2 cost-curve evidence has emerged. The defer was a routing decision, not a contract.

### [2026-04-28] Pattern — "Suppression is success" under single-writer invariants

A single-writer event emitter (one process / one row / one path is authoritative for a given fact at a given time) sometimes loses a coordination race — another writer got there first, or a stamped-newer payload made this write redundant. The losing path must NOT return `success: false`. It must return `success: true, suppressed: true` (with a `reason` if useful).

**Why.** `success: false` is "this thing didn't happen and is broken." Suppression is "this thing didn't happen because it didn't need to — the invariant is intact." Returning failure on a coordination loser triggers four downstream regressions:

1. **Retry storms.** Caller retries on `success: false`; every retry re-loses the coordination race and amplifies the storm.
2. **False incident signals.** Alerting fires on the failure rate; oncall sees an "outage" that is the system working as designed.
3. **Broken metrics.** "Write success rate" drops; the chart is meaningless because half the failures are healthy suppressions.
4. **Alert fatigue.** Operators learn to ignore the alert. The next time it fires for a real reason, they ignore it too.

**Pattern shape.**

```ts
// Coordination loser path:
if (existingTimestamp >= incomingTimestamp) {
  return { success: true, suppressed: true, reason: 'stale_payload' };
}

// Or:
if (alreadyClaimedBy(otherWriter)) {
  return { success: true, suppressed: true, reason: 'lost_claim' };
}
```

The shape `{ success: true, suppressed: true, reason }` lets callers distinguish "wrote new state" from "no-op'd safely" without treating the latter as failure. Metrics that care about throughput should bucket suppressed separately; metrics that care about correctness should treat suppressed as success.

**Where it applies.** Any single-writer emitter that can lose a coordination race:
- Diagnosis writers (system-monitoring `writeDiagnosis` — already enforces this; PR #218).
- Status-transition writers under last-write-wins ordering (terminal status reached via a different path).
- Cache populators where a fresher value already landed.
- Idempotent webhook receivers where the same event-id was processed by a sibling pod.
- Notification dedup paths where the same digest was sent N seconds ago.

**Where it does NOT apply.** Multi-writer or non-coordinated paths where `success: false` genuinely means "broken": database connection lost, malformed payload, permission denied, downstream API 5xx. The pattern is specifically for the class where "another writer beat me" is a healthy outcome.

**Architectural anchor.** `architecture.md § Home dashboard live reactivity` (line 1515) — names the pattern at the point where it's first enforced. Any new single-writer emitter should cite that anchor or extend it.

**Applied to:** PR #218 — `writeDiagnosis` in the system-monitoring agent emits `{ success: true, suppressed: true }` on coordination losers; the home-dashboard reactivity client treats suppressed-success identically to fresh-success for metric and freshness purposes (no retry, no error toast). Forward-looking codebase-wide enforcement (reusable utility + lint/grep guard) routed to `tasks/todo.md § PR Review deferred items / PR #218`.

**Detection heuristic.** When reviewing a single-writer emitter, grep the diff for `success: false` returns. Each hit must be either: (a) a genuine failure mode (DB / network / permission / malformed input), or (b) a coordination loser that should be flipped to `success: true, suppressed: true`. The grep pattern + a follow-up lint guard are the path from "well understood" to "impossible to violate quietly".

**ChatGPT review framing.** Both PR #218 review rounds reinforced this — Round 1 flagged the pattern as forward-looking standardisation; Round 2's optional follow-up explicitly named "codify suppression = success as a reusable utility or invariant check + add a lightweight lint or grep-based guard to prevent regressions" as the highest-leverage next step. The review rounds form the canonical citation for why the pattern matters at the codebase level, not just the system-monitoring level.

---

### [2026-04-28] Correction — Spec contracts MUST be declarative invariants, not verification instructions

When applying review feedback to a spec, contracts that the implementation must hold MUST be written declaratively ("X MUST hold") with the failure mode explicitly forbidden, not as advisory verification steps ("verify X holds" or "the existing guard handles this").

**Why:** Verification instructions become stale on the next refactor — they describe how to inspect the current code, not what the code must do. ChatGPT's second-round review of `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md` flagged four such gaps in my first-round edits:

1. §1.1 sequence ordering — I wrote "emitter sequence allocation is atomic per `agentExecutionEventService`" (an implication based on the existing primitive); the contract needed to be "both events MUST be emitted through the same `agentExecutionEventService` sequencing context" (a declarative MUST that survives a future refactor splitting the emit calls across tx boundaries).
2. §1.3 dispatch idempotency — I wrote "dispatch MUST be called only on the winner branch" with verification instructions to confirm placement; the contract needed to enumerate forbidden placements ("MUST NOT occur before the decision-row write, outside the post-commit boundary, in the unique-violation catch path, or in a fire-and-forget side-task").
3. §1.3 retry semantics — I wrote "does not re-decrement retry counters" (one direction only); the contract needed to forbid increment AND decrement AND reset, and enumerate the partial-state edge cases.
4. §1.7 throttle time source — I made fake-clock usage required in tests but didn't pin the production code's time source; a future "perf optimization" using `performance.now()` would have silently broken every fake-clock test.

**How to apply.** When applying spec review feedback, for every "verify X" or "rely on Y" phrase in the diff, ask: "What MUST hold for this to be safe?" — and write that as a MUST statement in the spec, with the failure modes explicitly forbidden. Verification instructions belong in the implementation checklist, not in the contract section. The contract is what survives refactors; the verification instruction is what loses.

**File reference:** `docs/superpowers/specs/2026-04-28-pre-test-backend-hardening-spec.md` §§1.1, 1.2 (purity contract), 1.3 (idempotency + retry), 1.7 (time source), 1.8 (hook-presence) — second-round edits applied 2026-04-28.

---

### [2026-04-28] Pattern — Post-commit websocket emit primitive via AsyncLocalStorage

`server/lib/postCommitEmitter.ts` implements request-scoped emit deferral using `node:async_hooks` `AsyncLocalStorage<PostCommitStore>`. Emits enqueued during a request are flushed on `res.finish` (2xx/3xx) or dropped on 4xx/5xx and premature disconnect (`res.close`). The middleware (`server/middleware/postCommitEmitter.ts`) MUST be mounted AFTER auth/org-tx middleware (`subdomainResolution` block) so the ALS store is inherited by all async children including `withOrgTx` callbacks — this ensures emits deferred inside a transaction actually fire after the transaction commits.

**Three states:** open (enqueue appends), closed (enqueue fires immediately — closed-state fallback for post-`res.finish` async continuations), absent (no store bound — job workers emit inline, logged as `post_commit_emit_fallback { reason: 'no_store' }`). Closed-state fallback is critical: without it, an async continuation that runs after `res.finish` silently drops its emits.

**Three structured log events:** `post_commit_emit_flushed { requestId, emitCount }` (gated on `emitCount > 0`), `post_commit_emit_dropped { requestId, droppedCount, statusCode? }` (gated on `droppedCount > 0`), `post_commit_emit_fallback { reason: 'no_store' | 'closed_store' }`. Both quantitative logs gate on a non-zero count to keep log volume tractable — without the gate every successful 2xx/3xx response that did not enqueue any work would emit `flushed { emitCount: 0 }`.

**Scope:** currently wired only in `briefConversationWriter.writeConversationMessage`. Any other service that emits websocket events inline after a DB write should migrate to the same pattern to close the ghost-emit failure mode.

---

### [2026-04-28] Ledger-canonical / payload-best-effort consistency contract (§1.1 LAEL)

When an event record (the "ledger") and a companion content-payload record exist in the same transaction, the consistency model MUST be explicit: one is canonical and must succeed; the other is best-effort and must NOT roll back the canonical record on failure.

**Implementation pattern (from `server/services/llmRouter.ts`):**
1. The canonical ledger write is in the main transaction tx.
2. The payload insert is inside a `try { ... } catch (err) { logger.warn('...'); payloadInsertStatus = 'failed'; }` block still inside the same tx — the catch swallows the insert failure so the outer tx commits regardless.
3. A defensive `DELETE WHERE pk = rowId` runs inside the same catch, before the outer tx commits, to ensure no partial row is visible post-commit. Without this, the post-commit invariant `payloadInsertStatus === 'failed' ↔ no row exists` could be violated by a partial insert that committed partially.
4. The canonical event (e.g. `llm.completed`) carries `payloadInsertStatus: 'ok' | 'failed'` so downstream consumers can distinguish "payload genuinely absent" from "payload write failed silently" without querying the payload table.

**Why:** If the payload insert failure is allowed to roll back the ledger write, the system loses a permanent record of the LLM call — the ledger is the single source of truth for billing, audit, and retry. The payload is a debugging aid, not a contract.

**How to apply:** Any time a "main record + companion content row" pattern is introduced, ask: (a) which is canonical? (b) does a companion failure silently discard the canonical record? (c) is the failure mode observable on the canonical event?

---

### [2026-04-28] Post-commit winner-branch rule for dispatch on approval-resume (§1.3)

When an approval decision produces a side-effect (webhook dispatch, downstream job, state transition), that side-effect MUST be placed strictly after the decision-row commit AND only on the winner code path.

**Structural enforcement (from `server/services/workflowRunService.ts` + `workflowEngineService.ts`):**
- The winner is determined by an atomic `UPDATE ... WHERE status = 'awaiting_approval' RETURNING *` (compare-and-swap on row status). If no row returns, the caller is the loser and returns without dispatching.
- Dispatch (`resumeInvokeAutomationStep`) is called by the caller that got a row back — i.e., strictly post-commit on the winner branch.
- Concurrent callers that hit the no-return path return immediately with `alreadyResumed: true` and DO NOT dispatch.

**The rule in one sentence:** Dispatch MUST NOT occur before the guard write, outside its post-commit boundary, in the conflict-loser branch, or in a fire-and-forget side-task that races the guard write.

**Why:** Placing dispatch before the write creates a window where two concurrent callers can both dispatch before either commits; placing it in the loser branch causes double-dispatch on races; placing it in a fire-and-forget side-task breaks the post-commit guarantee.

**Tracing tag:** The approval-resume dispatch path emits `dispatch_source: 'approval_resume'` on the tracing event so operators can distinguish initial dispatch from resume dispatch in logs/timeline.

---

### [2026-04-28] `__testHooks` seam promotion rule for deterministic race testing (§1.8)

When a service has a race window between a "claim" write and its commit that must be tested deterministically, the `__testHooks` seam pattern provides a controlled injection point without coupling tests to wall-clock timing.

**Pattern (from `server/services/reviewService.ts`):**
```ts
// At the bottom of the service file (development/test seam only)
export const __testHooks: {
  delayBetweenClaimAndCommit?: () => Promise<void>;
} = {};
```
Inside the transaction, after the claim UPDATE and before commit:
```ts
if (__testHooks.delayBetweenClaimAndCommit) {
  await __testHooks.delayBetweenClaimAndCommit();
}
```

**Usage rule — hook-presence contract (MUST hold):** Any test that promotes to this pattern MUST assert the hook is available at test-setup time — `assert.ok(__testHooks !== undefined && 'delayBetweenClaimAndCommit' in __testHooks)` — and bail before any test body runs if missing. This prevents the test from silently regressing to non-deterministic `Promise.all` if the hook is removed in a refactor.

**When to promote:** Try natural `Promise.all` first. If any CI run shows the loser branch not surfacing the expected `idempotent_race` discriminant (i.e., both calls returning `proceed`), promote immediately. Do not accumulate CI runs "to be sure" — the first sign of non-determinism is the trigger.

**Prior art:** `server/lib/ruleAutoDeprecateJob.ts:86` — the canonical reference for this pattern in this codebase.

---

### [2026-04-28] Lock the contract you already have — single canonical block over implied-across-comments

When an invariant is enforced by multiple distributed code sites (e.g. three independent emit sites + a finally fallback all upholding "exactly one X for every Y"), do NOT rely on per-site comments to convey the contract. Add ONE canonical block at the entry point that names the invariant, lists the enforcement sites, and states the failure-state collapse rules.

**Pattern (from `server/services/llmRouter.ts` round-1 ChatGPT-review fix):**

At the top of the function, beside the flag declarations:
```
// INVARIANT (locked): every emitted llm.requested is paired with exactly
// one llm.completed. Three independent emit sites uphold this — success
// path (§12c below), failure path (callStatus loop exit), and the
// finally-block fallback. The two flags + wrapping try/finally enforce it.
```

At the section header where a contract has multiple failure-state collapse cases:
```
// PAYLOAD CONTRACT (locked): an agent_run_llm_payloads row exists IFF the
// emitted llm.completed event carries `payloadInsertStatus === 'ok'`.
// Failure cases collapse to the same observable state … (a)/(b)/(c)
// To distinguish them in debugging, look for the `lael_payload_insert_failed`
// logger.warn — only case (b) emits it.
```

**Why it matters:** Future contributors otherwise have to read every emit site to verify the invariant holds. With a canonical block, one read confirms the contract; per-site comments become reinforcement, not the primary record. `(locked)` is the load-bearing word — signals to future readers "do not silently change this without renegotiating the contract."

**How to apply:**
1. When a code review surfaces "this invariant is implied across multiple comments," that's the trigger.
2. The canonical block belongs at the highest scope where all enforcement sites are visible — function header, module top, or section anchor.
3. List the enforcement sites by name (line numbers age out fast) and the collapse rules (which observable states are indistinguishable, and the breadcrumb that disambiguates them).
4. Mark with `INVARIANT (locked):` or `CONTRACT (locked):` so a future text-search retrieves it.

---

### [2026-04-28] External-reviewer false-positive rate is non-zero — verify before applying

ChatGPT / external review feedback contains a measurable false-positive rate. On `pre-test-backend-hardening` round 1, 3 of 11 findings (27%) were factually incorrect on a literal codebase read — the reviewer described the code as it WOULD have looked at an earlier point, not as it is.

**False positives observed:**
- "Stub tests give false sense of safety" — the stubs were already `test.skip(...)` not `assert.ok(true)`; the recommended fix was already in place.
- "Duplicate `ingestInline` declaration" — a single multi-line function signature was misread as two declarations.
- "`requireString` then `requireUuid` double-validates" — the two helpers were never stacked on the same field.

**The rule:** Before applying ANY external-review finding, open the cited file and verify the claim. The receiving-code-review skill's "verify before implementing" loop is not paranoia — it has a measurable backstop against shipped-because-the-reviewer-said-so churn.

**How to apply:**
1. For each finding: open the file at the cited line, read enough surrounding context to confirm the claim is current.
2. If the finding describes "this looks like X" — verify X is actually present, not "X-like."
3. If the finding describes a ratio or count (e.g. "12 console.* calls") — confirm whether they are NEW in the current branch's diff or pre-existing.
4. False positives get pushed back with the verifying read in the response, not silently dropped.

**What this does NOT mean:** External review is not low-value. The same round 1 produced 2 high-leverage findings (lock the LAEL contract, lock the pairing invariant) that the author of the code did NOT spot. The verify-before-applying loop is what separates the value from the noise.

---

### [2026-04-28] Record the rejected option in deferred-decision todos, not just the accepted one

When deferring a decision with a tracked todo, record BOTH the chosen option AND the rejected option's rationale on the same entry. Future-you reading the todo at trigger-time should not have to re-derive "why didn't we just do the safer thing now."

**Pattern (from `tasks/todo.md` migration-0240 deferred entry):**
```
- Decision (2026-04-28): accepted as-is for this PR per "table is small, pre-launch, …".
- Rejected option (2026-04-28): `CREATE UNIQUE INDEX CONCURRENTLY` with phased rollout.
  Rejected for this PR because (a) `CONCURRENTLY` cannot run inside a transaction, (b) …
  Becomes the correct option once the trigger condition above is met.
```

**Why:** A todo that says only "we accepted X" forces future-you to re-research "why not Y?" at trigger-time. A todo that says "we rejected Y for reasons (a)(b)(c)" tells future-you whether Y is now the right call (the reasons may have evaporated) or still wrong (the reasons still hold). Closes the audit loop.

**How to apply:** Any deferred-decision todo where there was a credible alternative — operational migration, security/perf trade-off, "wrap this in a transaction vs not" — gets a `Rejected option (date):` line beside the `Decision (date):` line. The trigger condition for revisiting goes on the decision line; the criteria that flip the rejected option become the canonical option goes on the rejected line.

---

PR #215 round 3 #3 (system-monitor): when a reviewer surfaces a coordination constraint between two deferred items, enriching the deferred entry with the constraint is documentation work — not a code change. Specifically: the deferred staleness-guard fix (round 2 #4) and the deferred rate-limit retry idempotency fix (round 1 #7b) both touch `triage_attempt_count` on incident rows. A naive implementation of the staleness guard (flip `'running' → 'failed'` after timeout) would double-charge a single never-completed attempt unless coordinated with 7b's `(incidentId, jobId)`-keyed idempotency. Documenting the constraint in `tasks/post-merge-system-monitor.md` under item 4 is mechanical, low blast radius, and prevents the post-launch implementer from building one fix on top of the other's not-yet-finished assumptions. **Rule:** defer-enrichment (markdown-only edit to a deferred-items file capturing newly-surfaced coordination constraints) is a valid technical auto-apply path under the chatgpt-pr-review triage. Treat it as `technical-implement`, no user gate, low severity. Do NOT route the *constraint itself* to the deferred file as a separate item — fold it into the existing entry it constrains. **Watch for:** any reviewer comment of the form "when X is implemented, ensure it does Y" where X is already deferred — that's a defer-enrichment, not a new item.

### [2026-04-28] Dev-tool LLM CLIs bypass the production llmRouter on purpose

`scripts/chatgpt-review.ts` calls `https://api.openai.com/v1/chat/completions` via raw `fetch` — it does NOT route through `server/services/providers/llmRouter.ts` or any of the provider adapters under `server/services/providers/`. This is intentional, not an oversight, and the spec at `docs/superpowers/specs/2026-04-28-dev-mission-control-spec.md § A1` pins it.

**Why it matters:** `llmRouter` is the financial chokepoint for application LLM calls. It carries org budget enforcement, llm_usage write paths, the resolver/registry chain, and the cost-attribution model that production agents rely on. Mixing developer-machine review-tool calls into that pipeline would pollute production cost dashboards, force the dev tool to fabricate a synthetic org context, and create a backdoor where a developer's local key counts against a tenant's budget.

**The rule:** any dev-tool that calls an LLM provider gets its own env var (`OPENAI_API_KEY` directly), its own raw fetch, no imports from `server/services/providers/`. If cost tracking is ever needed for dev tools, build a separate dev-cost log — do NOT extend `llmUsageService` to cover both.

**Detector for code review:** an `import` from `server/services/providers/` inside any file under `scripts/` or `tools/` is a smell. If you see one, ask "is this dev-tool code, and if so why is it routing through the production chokepoint?"

---

### [2026-04-28] `dataPartial` signal — distinguish "intentional null" from "fetch errored" in aggregator APIs

When an API composes data from multiple sources (filesystem, third-party APIs, cache), a `null` field is ambiguous: it can mean "this thing genuinely doesn't exist" OR "the underlying fetch failed silently." The dashboard at `tools/mission-control/server/lib/inFlight.ts` solves this by:

- Each external fetch returns `{ value: T, errored: boolean }` (e.g. `FetchResult<PRSummary | null>` from `github.ts`).
- The cache stores the `errored` flag alongside the value so a cached error stays flagged.
- The composer reads the flag and sets `dataPartial: boolean` on each composed item.
- The wrapping response carries a top-level `isPartial: boolean` rollup.
- The UI surfaces both signals (per-item amber pill + top-level banner) so the operator knows which cards to trust.

**Why it matters:** silent degradation is a worse failure mode than visible failure. A card that renders "PR: clean, CI: passing, no review" with `dataPartial: true` tells the operator "trust these fields with reservations"; the same card without the signal silently lies.

**The rule:** any aggregator that fetches from sources where errors are returned as null (instead of thrown) needs a per-source `errored` channel that propagates to the consumer. The signal MUST be plumbed through the cache too — caching an error without flagging it is the same silent-degradation bug, just delayed.

**Detector:** an aggregator API where a single `null` field can mean either "no data" or "fetch failed" without a separate signal. Smell test: if a downstream consumer cannot tell the difference between "intentional absence" and "transient error", you have this bug.

---

### [2026-04-28] Verdict header convention — make agent outputs machine-readable so downstream tooling doesn't depend on prose parsing

Every review-agent log under `tasks/review-logs/` now MUST include a single line matching `/^\*\*Verdict:\*\*\s+([A-Z_]+)\b/m` within the first 30 lines. Per-agent enums are locked in `tasks/review-logs/README.md § Verdict header convention`. Trailing prose on the same line is allowed (`**Verdict:** APPROVED (3 rounds, 4 implement / 7 reject)`); only the enum value is captured.

**Why it matters:** agent outputs are written for humans (prose, narrative, context) but ALSO consumed by downstream tooling (the Mission Control dashboard scrapes verdicts to render "what's in flight"). Without a stable header, the consumer is forced into fragile prose parsing — "look for the word 'verdict' in the conclusion paragraph and try to figure out which sentiment came after." That works until it doesn't, then silently breaks.

**The pattern:** a single header line at the top of every agent log, with a fixed enum per agent. Add new enum values via spec amendment, never silently. The trailing-prose tolerance via word boundary `\b` (not `\s*$`) is the load-bearing detail — it lets the agent say `**Verdict:** APPROVED (3 rounds)` without breaking the parser.

**The general rule (beyond verdicts):** any agent or tool whose output is consumed by both humans AND downstream code needs a stable machine-readable section, not just prose. Header lines, JSON envelopes, fenced code blocks with stable tags — pick one and lock it. The bookkeeping cost of the convention is paid once; the cost of fragile prose parsing compounds every time the agent's output style drifts.

**Detector:** any "agent emits markdown that another tool greps" pattern without a contract. If you see a regex against agent prose anywhere in production code paths, ask whether the agent should emit a stable header instead.

---

### [2026-04-28] Correction — Validation procedures must explicitly defeat known masking conditions

Phase 0 code-intel cache (branch `code-cache-upgrade`, commits 1–3 of `scripts/build-code-graph.ts`): I declared three commits "validated" using `npm run code-graph:rebuild` re-runs to confirm byte-identity and exercise the watcher edit cycle. Every validation run printed `[code-graph] watcher: lock held by another process — exiting` because an orphaned watcher from the previous session still held `references/.watcher.lock`. That lock-contention exit path was masking a real defect: when the spawn actually succeeds (no prior holder), the watcher's `stdio: 'inherit'` (in `spawnWatcher` at `scripts/build-code-graph.ts`) keeps npm's pipe open across its detached lifetime, and `npm run code-graph:rebuild` / `npm run dev`'s predev step hangs forever. The bug surfaces on the modal first-encounter case (fresh checkout, no prior watcher) — exactly the case the validation was supposed to cover. Fixed in commit 4 by routing watcher stdio to `references/.code-graph-watcher.log` (append mode) and adding a "Verification preconditions" step at the top of plan.md's Done criteria. **Rule:** when a verification step has a known masking condition (a fast-exit path that bypasses the code under test), the verification procedure must explicitly defeat that condition before running. For watcher-spawn validation: kill any running watcher process and delete `references/.watcher.lock` + `references/.watcher.lock.lock` before the cold-start command. **Detector:** if a "validates X" command can succeed in two different paths (X exercised vs. X bypassed), the validation harness must select for the X-exercised path; "looks fine" with the bypass path is not validation. **Rule applies beyond watchers:** any feature with conditional fast-exits (cached results, lock holders, idempotency keys, feature flags off) needs verification preconditions that force the slow path.

### 2026-04-28 Pattern — Invariant + test pairing in spec authoring

`docs/superpowers/specs/2026-04-28-system-monitoring-coverage-spec.md` (Rounds 1–2 of the ChatGPT spec review): every critical invariant in the spec has a paired verification artefact — a unit test, a `grep -n` command, or a runtime throw — never prose alone. Examples: §3.2 DLQ derivation pairs the "deadLetter must be `<queue>__dlq`" invariant with both a runtime throw AND a `dlqMonitorServicePure.test.ts` `wrong-name` case; §3.4 forceSync invariant pairs a comment-block invariant with a unit test (`dlqMonitorServiceForceSyncInvariant.test.ts`) AND a grep verification; §5.2 createWorker no-double-tx invariant pairs the rule with a per-handler `grep -n "withOrgTx" <file>` plus a decision table.

**Why:** an invariant with no verification artefact is a wish. A future refactor removes the comment, no test fails, no grep flags it, and the contract silently degrades. Pairing every invariant with a CI-checkable artefact (or at minimum a deterministic grep) makes the contract durable across refactors.

**Generalises to:** any spec authoring where a "MUST X" rule appears. If there is no test, no grep contract, and no runtime throw paired with the rule, the spec author has not finished the work. ChatGPT's Round 1 feedback explicitly called this out: prefer "MUST X enforced by Y, verified by Z" over "MUST X" alone — the latter is interpretive, the former is verifiable.

**Detection heuristic for spec reviews.** Grep the spec for "MUST", "INVARIANT", "must not", "shall". For each hit, check the surrounding paragraphs for a test reference, a `grep -n` block, or a runtime-throw code example. Hits with none of those are the findings.

### 2026-04-28 Pattern — Spec-as-runbook via `grep -n` + decision table

`docs/superpowers/specs/2026-04-28-system-monitoring-coverage-spec.md` §5.2: the rule "a handler passed to `createWorker` MUST NOT open its own org-scoped transaction" was originally proposed as a comment-block invariant. The user's refinement converted it into a runbook: (a) per-handler verification step `grep -n "withOrgTx" <file>` against each converted handler, (b) a decision table mapping each grep result to the correct action — `(no withOrgTx)` → convert as documented; `(withOrgTx + org from job.data.organisationId)` → remove inner `withOrgTx`; `(withOrgTx + org from another source)` → set `resolveOrgContext: () => null` and keep the inner transaction.

**Why:** soft rules are interpretive — two reviewers can read the same invariant and apply it differently to the same code. A `grep -n` command produces a deterministic output. A decision table maps each output to exactly one action. The pair turns "make sure no double-tx" into a procedure that produces the same outcome regardless of who runs it.

**How to apply:** when a spec contains a rule that needs to be verified across multiple call sites (every `createWorker` handler, every `recordIncident` invocation, every controller using a guard, every migration referencing a deprecated column), express it as: (1) the canonical grep that lists all relevant call sites, (2) a decision table whose rows enumerate every plausible grep outcome and the action per outcome. The decision table must be **exhaustive** — a row for every possible match shape — otherwise reviewers fall back to interpretation for the missing rows.

**Generalises to:** RLS-policy verification (grep `.where(eq(table.org_id, ...)` outcomes), service-tier conformance (grep `pure-functions` directory imports), idempotency invariants (grep `recordIncident\(` for required options), capability-contract enforcement (grep `side_effects:` per Automation), migration-completion (grep deprecated symbol per file). Every "rule reaches every call site" verification step is a candidate.

### 2026-04-28 Pattern — Self-consistency via file-inventory lock

`docs/superpowers/specs/2026-04-28-system-monitoring-coverage-spec.md` §2 (file inventory): the spec carries a §2.1 (new files) and §2.2 (modified files) inventory of every implementation artefact the spec touches. Every spec edit that introduces a new test file, a new code module, or a contract-changing modification to an existing file MUST update §2 in the same edit. Round 1's integrity-check second pass detected three drifts after Item #1 (forceSync invariant) was applied: a new test file was referenced in §3.4 but missing from §2.1; `incidentIngestor.ts` needed a new `forceSync` option but was not in §2.2; the existing `dlqMonitorService.ts` §2.2 entry needed a bullet for the `forceSync: true` requirement. All three were auto-applied under §2's file-inventory-lock rule and logged as `file-inventory-drift` findings.

**Why:** drift between spec prose and the implementation surface accumulates silently. A spec that says "add option X to function Y" but doesn't list `Y.ts` in §2.2 reads correctly to ChatGPT and to the spec author, but the implementer working from §2.2 may miss the change entirely. The inventory is the implementer's checklist; if it's wrong, the implementation will be wrong.

**How to apply:** make §2 (or equivalent) a hard contract. Treat any drift between prose and inventory as a `file-inventory-drift` finding — mechanical, auto-apply, no user gate. The integrity-check pass after each round of spec edits should explicitly validate: every file referenced in prose appears in §2; every §2 entry's bullet list matches the changes described in prose; new artefacts (test files, type files, migration files) introduced by an edit appear in §2 in the same edit.

**Generalises to:** any spec template where the inventory section is the implementer's source of truth. Common shapes: "files modified," "schema migrations introduced," "endpoints added," "feature flags introduced," "new env vars." Drift in any of these is a `file-inventory-drift` and the integrity-check pass should auto-fix on detection.

**Detector heuristic for spec reviews.** After applying any spec edit that changes the implementation surface, grep the edit's diff for filenames (`*.ts`, `*.test.ts`, `*.sql`, `*.tsx`). For each filename in the diff, confirm it appears in §2.1 or §2.2 (whichever is appropriate). Each missing filename is a `file-inventory-drift` finding.

### [2026-04-28] Pattern — Test harness register/restore: prior-state capture beats unique-key discipline

When a test fixture mutates a global registry (provider adapter map, hook table, etc.), the natural rule is "tests must use distinct keys OR run sequentially". That rule is fragile — every new test file has to remember it, and parallel test runs can violate it silently. Spec `2026-04-28-pre-test-integration-harness-spec.md` §1.2 round 1 review surfaced this as a "shared global registry = hidden coupling" red flag.

**Pattern:** the registration function captures the prior state at the key (present-and-was-this-adapter vs. absent) and returns a `restore()` function that puts the registry back to **exactly** that prior state. `restore()` is idempotent; tests always call it in `finally` (NOT just on the happy path). Same-key sequential AND parallel test registrations stop interfering structurally — no key uniqueness convention required.

**Implementation contract** (`server/services/providers/registry.ts`):
```ts
export function registerProviderAdapter(key, adapter): () => void {
  const wasPresent = Object.prototype.hasOwnProperty.call(registry, key);
  const priorAdapter = wasPresent ? registry[key] : undefined;
  registry[key] = adapter;
  let restored = false;
  return function restore() {
    if (restored) return;          // idempotent
    restored = true;
    if (wasPresent && priorAdapter !== undefined) registry[key] = priorAdapter;
    else delete registry[key];     // exact prior state — absent, NOT bound-to-undefined
  };
}
```

**Key invariants:**
- "Absent" and "bound-to-undefined" are different post-states. Use `Object.prototype.hasOwnProperty.call` + `delete` to honour the distinction.
- The restore function carries a closure-captured `restored` boolean for idempotency — calling restore twice in succession is a no-op the second time.
- Test self-test MUST include a parallel-execution variant (`Promise.all([taskA, taskB])` both registering at the same key, both restoring in `finally`). The sequential-only variant doesn't exercise the prior-state-capture contract; the parallel one does.

**Where to apply:** any test fixture that mutates a global registry, hook table, env-shaped config, or process-local cache. Not just provider adapters — same pattern works for skill registries, route handlers, MCP server lookup tables, etc.

### [2026-04-28] Pattern — Fake HTTP receiver: body-fully-read + lowercase-header-keys are load-bearing invariants

The fake webhook receiver shipped in `server/services/__tests__/fixtures/fakeWebhookReceiver.ts` (spec §1.1) is a thin Node `http.createServer` wrapper that records every incoming request for direct assertion. Two non-obvious invariants emerged during ChatGPT round 2 review:

1. **Body fully read BEFORE record-or-drop decision.** The harness calls `Buffer.concat` on `data` events and awaits the `end` event before pushing the call onto the recorded array. Recording mid-body (or destroying the socket mid-stream) would let a later `body` assertion silently pass against truncated input — a false-pass class that breaks every webhook test downstream.

2. **Headers normalised to lowercase keys; multi-value headers joined with `, `.** Node's HTTP stack already lowercases incoming header keys, but the harness must NOT rely on that being preserved through any future transformation. Tests assert against `headers['x-signature']`, never `headers['X-Signature']`. Multi-value headers (Node represents these as `string[]`) get joined into a single string so the assertion shape is uniform.

**Why these matter:** a webhook test that asserts on body content + signature is the canary for "did the production code actually post what we expected". A harness that under-records the body or carries inconsistent header casing turns "test passes" into "test silently lies". Both invariants are documented on the type itself + asserted by the harness's own self-test.

**Bonus invariant:** `setDropConnection(true)` destroys the socket WITHOUT writing a response, but ONLY after the body has been fully read AND the call has been recorded. Tests can still assert "the request reached us with the complete body" even when the response was dropped — necessary for timeout-path tests where the production code's behaviour depends on whether the request was sent vs. just queued.

**Where to apply:** any harness that captures inbound HTTP requests for test assertions. `parseBody` should fall through to raw `Buffer` on JSON-parse failure rather than masking malformed-body bugs as harness errors.

### [2026-04-28] Pattern — Dual-layer assertions (HTTP + DB) defeat single-layer false-passes

Spec `2026-04-28-pre-test-integration-harness-spec.md` §1.4 Test 2 has a load-bearing rule: a "concurrent double-approve fires the webhook exactly once" test must assert at BOTH the HTTP layer (`receiver.callCount === 1`) AND the DB layer (single workflow_step_runs row with `attempt === 1` reaching `completed`). The two are NOT redundant — they protect different failure modes:

- **HTTP-only assertion:** missed by a regression where dispatch fires twice but the receiver's idempotency layer swallows the second call. Production exactly-once semantics broken; test still passes.
- **DB-only assertion:** missed by a regression where the dispatch attempt happens but the HTTP layer is misconfigured (e.g. wrong webhookPath, missing HMAC). Production never actually fires the webhook; test passes because the DB shows one dispatch row.
- **Both:** the test fails on either failure mode, catching both classes.

The same dual-layer pattern shows up symmetrically in the negative direction (Test 3 — rejected step fires no webhook): `callCount === 0` AND zero `attempt > 1` rows. A regression that triggers dispatch but fails before HTTP transmission would leave `callCount === 0` while still corrupting the DB-side state — only the dual assertion catches it.

**Where to apply:** any "side effect happens exactly N times" invariant in integration tests — webhook dispatches, queue inserts, audit writes, side-channel notifications. The HTTP layer alone is insufficient when an idempotency layer exists; the DB layer alone is insufficient when the production code path can fail between "intent to dispatch" and "actual transmission". Always pair them.

### [2026-04-28] Convention — Pure tests assert on TS-shape; integration tests assert on DB-shape; the two can diverge

When extending a column to be nullable + a builder function to accept null, the pure test (`buildPayloadRow({ response: null }) → { response: null, ... }`) asserts the TS object shape. The integration test then asserts the DB row's `response IS NULL` (the column nullability is what makes this possible). The two are complementary, NOT redundant — the pure test pins the function's contract; the integration test pins the persistence pipeline's contract. A regression that strips null from the function output (e.g. converts to `{}`) would be caught by the pure test even before any DB is involved. A regression that fails to map TS null to SQL NULL during INSERT would slip through the pure test but be caught by the integration test.

**Decision rule:** if a function's contract includes "accepts and returns null", the pure test asserts on `out.response === null`. If the column's nullability is part of the contract, an integration test (or a follow-up failure-path integration test) asserts on `response IS NULL` at the SQL level. The pure test's `null` is a TS object property; the integration test's `NULL` is a SQL atom — different things, both important.


### [2026-04-28] Correction — Test harness register/restore needs STACK semantics, not closure-captured prior state

**Supersedes the 2026-04-28 "Test harness register/restore: prior-state capture beats unique-key discipline" entry above.** The closure-captured prior-state pattern works only under strict LIFO restore order. Parallel tests where restores fire in non-LIFO order (entirely possible with `Promise.all` + microtask interleaving) produce wrong final state: the inner restore re-installs a stale prior because the outer restore already ran first.

**Trace of the failure mode** (registry initially empty, key `k`, two parallel tasks both registering at `k`):
1. Task A registers A → captures `{wasPresent: false}`, `registry[k] = A`.
2. Task B registers B → captures `{wasPresent: true, prior: A}`, `registry[k] = B`.
3. Task A finishes first: `restoreA()` deletes `registry[k]`. Correct so far.
4. Task B finishes: `restoreB()` reads its captured `{wasPresent: true, prior: A}` and writes `registry[k] = A`. **Final state: bound to A even though A was supposed to be uninstalled.**

**The fix** (`server/services/providers/registry.ts`): per-key registration STACK + a single `originalStates[key]` snapshot taken on the FIRST register. The restore function:
- Removes its own entry from the stack by token (NOT by position — a parallel restore may have removed an entry deeper in the stack first).
- If the stack is now empty, restores from the original snapshot and clears both maps.
- If the stack is non-empty, re-installs the top of the stack as the currently-active adapter.

**Invariants the stack pattern provides:**
- Order-independent restore: any permutation of restores produces the original state at the end.
- Idempotent: repeat-restore is a no-op via a closure-captured `restored` boolean.
- Pre-existing state preserved: if the key was bound before any test registered, that binding is what the last restore re-installs.

**The non-LIFO test case is what makes the bug visible.** A `Promise.all([taskA, taskB])` parallel test that happens to end LIFO (B restores first, then A) is INDISTINGUISHABLE from the broken implementation — the broken impl works by luck under that ordering. The detector test (`fakeProviderAdapter.test.ts` Case 12 / Case 13) explicitly registers A then B, restores A FIRST while B is still active, and asserts `registry[k] === b` afterward. That assertion fails under closure-capture, passes under stack semantics.

**Where to apply:** any registry mutation pattern that supports nested or parallel test scoping. Provider adapters, hook tables, skill registries, MCP server lookup tables — wherever "save state, replace, restore" lives in test code.

### [2026-04-28] Pattern — Co-located cleanup helper with scope-safety pre-flight + post-flight count match

The integration tests in `server/services/__tests__/llmRouterLaelIntegration.test.ts` and `workflowEngineApprovalResumeDispatch.integration.test.ts` (spec §1.3 / §1.4) use a co-located `assertNoRowsForRunId` (and analogous `cleanupWorkflowScope`) cleanup helper. The pattern's three invariants:

1. **Scope-safety pre-flight check.** Before issuing any `DELETE`, the helper SELECTs the rows it intends to delete and verifies every returned row's scoping column matches the supplied scoping value. If any row's scoping column doesn't match, the helper THROWS BEFORE issuing the DELETE — never silently widens the predicate. Defends against a copy-paste regression (e.g. accidentally dropping the `WHERE run_id = $1` clause) that would silently wipe unrelated test rows while making downstream tests "pass" against a corrupted DB.

2. **Post-flight count match.** After the DELETE, the helper compares the DELETE's reported row-count against the SELECT's row-count. If DELETE > SELECT, throws — indicates a concurrent insert under the same scoping key while cleanup ran (itself a test-isolation regression worth surfacing).

3. **Type union narrows to scopable tables only.** The helper's table parameter is a literal-union type containing ONLY tables keyed by the scoping value. Tables that aren't scoped that way (e.g. `cost_aggregates`, keyed by `(entityType, entityId, periodType, periodKey)` not `runId`) are EXCLUDED from the union. A silent no-op branch that accepts the table at compile time but does nothing at runtime breaks the invariant "the helper is the only place these queries are written" — exclude the table from the union and force callers to handle suite-level cleanup separately.

**For non-runId-scoped ledger rows** (e.g. `sourceType: 'system'` calls write `llm_requests` rows with `runId: null`): use a per-test-invocation unique `featureTag` and a sibling `cleanupLedgerByFeatureTag` helper that scopes by `featureTag` instead of `runId`. Same scope-safety contract; different scoping column.

### [2026-04-28] Pattern — Dual-layer assertion via `mock.method` spy at the boundary BEFORE the side-effect site

Spec `2026-04-28-pre-test-integration-harness-spec.md` §1.4 Test 2 demands a "concurrent double-approve fires the webhook exactly once" test with HTTP-layer + DB-layer assertions. The first attempt used `workflow_step_runs.attempt === 1` as the DB-side proxy — but `attempt` is set at seed time and never incremented on the supervised approval-resume path, so the assertion was a tautology that provided no protection beyond the existing status check.

**The fix:** spy on the HMAC-signing call site (`webhookService.signOutboundRequest`) via `node:test`'s `mock.method`. The signing call happens between the engine's race-resolving UPDATE and the outbound `fetch` — a boundary distinct from the HTTP receiver count. A regression that signed-then-crashed-before-fetch (headers mutated after signing, fetch threw before transmission, request body builder failed) would produce `receiver.callCount === 0` while still indicating broken backend exactly-once semantics; the spy catches that class.

**Pattern:**
```ts
const signSpy = mock.method(webhookService, 'signOutboundRequest');
try {
  // ... exercise the production code ...
  const callsForThisStep = signSpy.mock.calls.filter(
    (c) => c.arguments[0] === seed.stepRunId,
  );
  assert.equal(callsForThisStep.length, 1, '...');
} finally {
  signSpy.mock.restore();
}
```

**Why filter by scoping value:** parallel-running tests against the same module pollute `signSpy.mock.calls` with each other's invocations. Scoping the assertion to the test's own `stepRunId` (or whatever scoping value the spied function takes) makes the assertion test-local. Same defence as the cleanup helper's scope-safety predicates.

**Where to apply:** any "side effect happens exactly N times" invariant whose downstream observable (HTTP receiver, queue insert, audit row) could be racing or coalesced. Spy on a stable upstream boundary that fires exactly once per intended dispatch — the boundary count is structurally distinct from the downstream count, and both must agree.

### [2026-04-28] Correction — Decision-engine scripts cannot fall back to wider-than-correct data

`scripts/code-graph-health-check.ts` (PR #224) originally had `resolveProjectDirs()` fall back to scanning every directory under `~/.claude/projects` when no exact-match or sibling-collision project dir was found for the cwd. Reviewer flagged this as P1: cross-project contamination silently mixes adoption / correction / volume signals from unrelated codebases, producing a misleading "this repo's cache is healthy" report when the truth is "this repo has no transcripts at all." Fixed by removing the fallback entirely — the function now returns `[]` on miss, and the downstream `transcriptsAvailable === false` codepath surfaces "no session data found." **Rule:** any script that produces a verdict (status banner, decision recommendation) must never silently widen its data scope to keep producing output. Missing-input → explicit YELLOW + "no data" verdict, never → "make do with whatever data is around." **Class of bug:** silently-widened scope is worse than missing data because the reader can't tell the difference between "this works" and "this is misleading." **Detector:** any `if (matches.length === 0) { /* fall back to broader scan */ }` block in code that drives a verdict is a candidate for this defect.

### [2026-04-28] Correction — Recommendation gates must align semantically with the action they trigger

Same script (`computeVerdict()` in `scripts/code-graph-health-check.ts`): the `ESCALATE` recommendation was originally gated on `proratedPerMonth >= ESCALATE_QUERIES_PER_MONTH && d.adoption.references > 0`. ESCALATE means "volume justifies Phase 1 automation review." But `references > 0` is a near-vacuous gate — 60 architecture queries with 1 cache reference still fired ESCALATE, even though that's the inverse of the right action (TUNE adoption first, automation later). Reviewer (P2) pointed out the contradiction with the function's own comment ("AND adoption healthy"). Fixed by introducing `const healthyAdoption = references >= 3 && !hasCacheLinkedYellow && !zeroAdoptionMeaningful` and gating ESCALATE on it. The threshold of 3 mirrors the existing "marginal adoption" YELLOW boundary so the rule cells line up. **Rule:** for every recommendation, the gate condition has to actually satisfy the recommendation's *meaning*, not just its lexical preconditions. Cross-check: read the comment that justifies the recommendation; if the gate doesn't enforce what the comment says, the gate is wrong. **Detector:** in any rule-based decision engine, look for branches whose guard is much weaker than the action's stated precondition (e.g. "X > 0" guarding "X is healthy"). Those guards are bugs in waiting.

### [2026-04-28] Pattern — Programmatic scan to resolve reviewer disputes about duplicates or missing changes

When an external reviewer insists a bug exists (or a fix wasn't applied) after you've already pushed back with a manual read, use a programmatic scan rather than re-reading the source. A 5-line Node.js or bash script produces objective, citable evidence in under a second.

**Template for "does any block contain both X and Y?":**
```js
const fs = require('fs');
const text = fs.readFileSync('path/to/file.ts', 'utf8');
const re = /blockStartPattern[\s\S]*?blockEndPattern/g;
let m, dups = 0;
while ((m = re.exec(text)) !== null) {
  const block = m[0];
  if (/fieldA/.test(block) && /fieldB/.test(block)) { dups++; console.log('Found at byte', m.index); }
}
console.log('Total duplicate blocks:', dups);
```
**Template for "is this pattern present or absent?":**
```bash
grep -c "pattern" file.ts  # 0 = absent, >0 = present
```
Applied in this PR to settle 3 consecutive rounds of disputed findings (LAEL duplicate fields, status regex not applied, agentRunPayloadWriter type duplication) — all three proved false against current code.

**Rule:** "The reviewer says it exists" is a claim to verify, not a fact to accept. Programmatic verification is evidence; re-reading by eye is not.

### [2026-04-28] Pattern — `.match()` vs `.matchAll()` for regex extraction inside a scan loop

`.match(re)` returns only the FIRST match regardless of the `g` flag when called on a string. `.matchAll(re)` requires the `g` flag and returns an iterator over ALL matches. When extracting values from a block of text inside a loop (e.g. scanning each `AutomationStepError` literal block for `status:` values), always use `matchAll` so the scan is exhaustive. Today's blocks may have one match; future blocks may have more — `match()` silently discards all but the first.

**Applied in:** `invokeAutomationStepErrorShapePure.test.ts` Case 4 regex upgrade.

### [2026-04-28] Pattern — Lazy ESM registry import for test files that have env-free and env-dependent sections

When a test file mixes tests that don't need production env vars with tests that do (because the tested code imports a module that calls `envSchema.parse(process.env)` at load time), split the import boundary inline using a deferred `await import()`:

```ts
// Tests 1-6: adapter-only, no env deps — run unconditionally.
await test('case 1', ...);
// ...
await test('case 6', ...);

// Deferred import: only executed when the test runner reaches this point.
// Fails fast here rather than before test 1 if env vars are missing.
const { registerProviderAdapter, getProviderAdapter } = await import('./registry.js');

// Tests 7-13: registry-dependent, require env vars.
await test('case 7', ...);
```

This preserves the "standalone runnable" promise for env-free tests and gives a clean failure point (after test 6, before test 7) when env vars are absent — rather than crashing before any test runs.

**Applied in:** `fakeProviderAdapter.test.ts` between Case 6 and Case 7.

### [2026-04-28] Pattern — Use RETURNING to get fresh column values after an UPDATE that races with a concurrent write

When a service does SELECT → UPDATE and a concurrent path can write a column between those two statements, the pre-read value is stale. The fix is to add that column to the `.returning()` clause — PostgreSQL's RETURNING returns the full row state at the moment the UPDATE lock is held, including columns not in the SET list.

**Concrete case:** `agentRunCancelService.cancelRun` reads `ieeRunId` via SELECT, then runs the cancelling UPDATE. Between the two, `agentExecutionService` can transition the run to `delegated` and write `ieeRunId`. Because `'delegated'` is in the UPDATE's WHERE list, the UPDATE succeeds but the in-memory `ieeRunId` is still null — `cancelIeeRun` is skipped and the worker continues. Fix: `.returning({ id, ieeRunId })` and use `updated[0].ieeRunId` downstream.

**Rule:** Any column read pre-UPDATE that a concurrent writer can change before the UPDATE lock should be read via RETURNING, not the pre-read snapshot.

### [2026-04-28] Pattern — `cancelling` is a transient non-terminal status; treat it like a write-once signal, not a stable state

`agent_runs.status = 'cancelling'` is set once by `agentRunCancelService` and must resolve to a terminal value promptly:
- In-process loops: exit at the next iteration, write `'cancelled'`.
- IEE-delegated runs: `cancelIeeRun` writes `iee_runs='cancelled'` + enqueues `iee-run-completed`; finaliser parks the parent.
- If the pg-boss event publish fails: `reconcileBackends` sweeps `status IN ('delegated','cancelling')` after 120 s and calls `finaliseAgentRunFromBackend`. (Pre-2026-05-10: `reconcileStuckDelegatedRuns` / `finaliseAgentRunFromIeeRun` — renamed under the execution-backend-adapter-contract build.)

**Divergence case:** if the IEE worker completes before observing the cancel, the parent can transition `cancelling → completed` (not `cancelled`). This is logged as `agentRunFinalization.cancel_intent_divergence` and is expected best-effort behaviour, not a bug.

**Do not add `'cancelling'` to terminal checks.** It is in `IN_FLIGHT_RUN_STATUSES`. The cancel button hides on `isTerminalRunStatus || status === 'cancelling'` — that guard is UI-only and does not make `cancelling` semantically terminal.

### [2026-04-29] Pattern — Join conditions on soft-deletable tables must always include the deletedAt guard

Any `innerJoin` or `leftJoin` on `agents`, `subaccounts`, or `systemAgents` must include `isNull(X.deletedAt)` directly in the join condition — not just in the WHERE clause. Joins on `subaccountAgents` that return current operational state must include `eq(subaccountAgents.isActive, true)` in the join condition.

**Wrong:**
```ts
.innerJoin(agents, eq(agents.id, someTable.agentId))
```
**Correct:**
```ts
.innerJoin(agents, and(eq(agents.id, someTable.agentId), isNull(agents.deletedAt)))
```

**Historical/audit contexts:** convert `innerJoin → leftJoin` with the same guard so that records referencing a subsequently-deleted entity are preserved in history but the deleted entity's metadata resolves to null rather than leaking stale data. Never use a bare `innerJoin` on these tables in historical queries — a hard-deleted row would silently drop the entire history record.

Enforced in branch `fix-logical-deletes` (2026-04-29): 11 files, 24 join sites fixed (12 Category A unconditional, 12 Category B historical).

### [2026-04-29] Pattern — Server typecheck requires `-p server/tsconfig.json`; root `tsc` only covers `client/src`

Running `npx tsc --noEmit` from the project root silently checks only `client/src` — it does NOT typecheck `server/`. To catch server-side type errors, run `npx tsc --noEmit -p server/tsconfig.json`. Discovered during dual-review of `fix-logical-deletes`: root tsc showed 63 errors (all client), while `server/tsconfig.json` exposed 2 additional real errors in `delegationGraphService.ts` that the root check missed entirely.

**Implication for verification:** the CLAUDE.md "Verification Commands" table uses `npm run typecheck` — confirm that script invokes `server/tsconfig.json` (or both tsconfigs). If it only wraps root tsc, the gate is incomplete.

### [2026-04-29] Correction — Persistent context switcher already exists in the UI

The leftmost sidebar already implements a persistent org/subaccount context switcher (visible in the layout screenshot). Do not recommend building this as if it were missing. When discussing scope/routing architecture, treat the active org/subaccount in the sidebar as the resolved session context that the ask bar and New Brief modal should read from — it is already the source of truth for "where the user is."

### [2026-04-29] Correction — ChatGPT (and likely other LLMs) frequently misread unified diff format in PR review

ChatGPT routinely treats both `-` (removed) and `+` (added) lines in a unified diff as if both are present in the final source. When ChatGPT claims a "double join", "duplicate assignment", "redundant innerJoin + leftJoin", or any other "two near-identical statements coexist" pattern in code review of a diff, **verify by reading the actual file (or `git show origin/<branch>:file`) before accepting the finding**. The `-` line was removed; only the `+` line exists in HEAD.

Both Round 1 and Round 2 of the `fix-logical-deletes` ChatGPT review (PR #232, 2026-04-29) made this exact error on the same code (`server/services/delegationGraphService.ts` lines 50 and 98 — single `.leftJoin` per query, no `.innerJoin`). Round 1 framed it as "Critical — incorrect join structure"; Round 2 framed it as "Double-join pattern (minor observation)" and "Normalize join pattern for soft-deleted relations" follow-up. Same hallucination, different severity framing. Reviewer-self-correction does not happen across rounds — the agent did not recognise it had already raised the same false claim.

Operational rule: when an LLM reviewer cites a diff hunk verbatim and reasons about both `-` and `+` lines as if both ship, treat the finding as suspect-by-default. Read the file. The shorter the cited hunk and the closer the two lines are textually, the higher the prior on misread. Builds on the 2026-04-17 entry "GitHub unified diff format is commonly misread as 'both lines present'" — that earlier entry was about human reviewers; this one extends the pattern to LLM reviewers (seen 2 times in PR #232 review alone). Session log: `tasks/review-logs/chatgpt-pr-review-fix-logical-deletes-2026-04-29T00-29-56Z.md`.

**PR #234 additional occurrences (2026-04-29, seen 3 more times):** ChatGPT Round 1 raised F1 ("duplicate brief_created response shapes"), F3 ("login rate limit runs before validation"), and F4 ("file.buffer and createReadStream both set") as blockers. All three were false positives — the current code had already unified the type, already ordered validateBody before the asyncHandler, and already removed file.buffer. ChatGPT was reading the `-` (deleted) sides of those diff hunks as still-present code. Verification in each case: single `Read` of the file confirmed the `-` line did not exist. This brings the total to **5 false positives of this type across PRs #232 and #234** — treat any diff-citing "still present" claim as suspect-by-default.

### [2026-04-29] Pattern — Server-authoritative context updates: id is source of truth, name falls back to stored value

When the client receives a server response carrying resolved context (`organisationId`, `subaccountId`), key state updates on the id alone — never gate the update on both id AND name being present. The name should fall back to the existing stored value (`getActiveOrgName() ?? ''` / `getActiveClientName() ?? ''`) when the server omits it. Gating on `id && name` creates a partial-state hazard: server returning id without name (e.g. `/api/session/message` Path C returns `organisationName: null` and `subaccountName: null` when context did not change) silently skips the update and pins the next request to the old localStorage values. PR #233 ChatGPT review hit this same shape three times (F4, F11, F14) before all paths were corrected. Canonical example: [client/src/components/global-ask-bar/GlobalAskBar.tsx:38-58](client/src/components/global-ask-bar/GlobalAskBar.tsx#L38-L58). Also: subaccount-clearing should be unconditional on `subaccountId === null` — not gated on `orgChanged` — since the server response is authoritative on whether subaccount context exists.

### [2026-04-29] Convention — Every brief-creation route requires `requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE)`

`/api/briefs` (POST) gates on `BRIEFS_WRITE`; any new endpoint that calls `createBrief` (or a successor) must apply the same middleware at the route layer, before the handler runs. PR #233 introduced `/api/session/message`, which calls `createBrief` from Path B (with remainder) and Path C (plain brief submission), but originally only had `authenticate` — letting users without `BRIEFS_WRITE` create briefs through GlobalAskBar. ChatGPT review F10 (round 2) caught this. Detection: any new route file that imports `createBrief` and lacks `requireOrgPermission(ORG_PERMISSIONS.BRIEFS_WRITE)` on a `POST` handler is suspect. Pattern at [server/routes/briefs.ts:21-22](server/routes/briefs.ts#L21-L22) and [server/routes/sessionMessage.ts:30-34](server/routes/sessionMessage.ts#L30-L34).

### [2026-04-29] Pattern — DB-canonical now_epoch must be threaded through any time-delta computation derived from a rate-limit check

When a Postgres rate-limit query returns `extract(epoch from now())` as `now_epoch`, that value is the authoritative "current time" for the entire request. Any downstream computation that computes a time delta from the query result (e.g. `Retry-After` = `resetAt - now`) must use `now_epoch * 1000` as the reference point — not `Date.now()`. Using `Date.now()` introduces cross-instance clock skew that can produce negative or inflated `Retry-After` values under load.

**Pattern:** include `nowEpochMs: number` in the rate-limit result type; update all callers to pass it into `getRetryAfterSeconds(resetAt, nowEpochMs)`. The default-to-`Date.now()` fallback is acceptable only when calling `getRetryAfterSeconds` outside a DB-backed check context (e.g. in tests). Applied in PR #234 to `inboundRateLimiter.ts` and all 9 call sites across 7 route files.

### [2026-04-29] Convention — Discriminated union types used on both client and server belong in shared/types/

When a TypeScript discriminated union arm (e.g. `{ type: 'brief_created' } & BriefCreationEnvelope`) is used in both a server route file and a client component, do not define it in the server file alone. Define it in `shared/types/` so both sides import the same type — TypeScript cannot catch cross-boundary drift when each side has its own inline definition. The canonical example: `BriefCreatedResponse` was initially extracted as a local server-side type alias in `server/routes/sessionMessage.ts`, but `client/src/components/global-ask-bar/GlobalAskBarPure.ts` maintained its own `({ type: 'brief_created' } & BriefCreationEnvelope)` inline. PR #234 Round 3 promoted `BriefCreatedResponse` to `shared/types/briefFastPath.ts`; both sides now import it from there. Rule: if `BriefCreationEnvelope` (or any shared contract type) already lives in `shared/types/`, the derived union arm should too.

### [2026-04-29] Correction — When incorporating spec-review feedback, audit for second-order gaps the fix itself creates

While incorporating round-1 ChatGPT spec feedback into [docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md](docs/superpowers/specs/2026-04-29-pre-prod-tenancy-spec.md), I added a `ctid`-based dedup `DELETE` to migration `0244`'s pre-step (§4.2), moved gate-wiring to step 1 of §3.5, and required Phase 3 advisory-lock audits as "a paragraph in progress.md". Round 2 caught all three as second-order gaps: ctid is physical-row-position not write-order so "highest ctid wins" silently keeps the wrong row; gate-wiring-first creates a multi-commit known-red CI window with no documented reviewer expectation; "paragraph in progress.md" is soft-enforcement that hand-waves easily. The fix in each case was to make the round-1 mechanism explicit and bounded: replace ctid-default with `§4.2.0 mandatory pre-check + STOP unless deterministic rule + LOCK TABLE`, add `§3.5.1 expected red-CI window` with squash-on-merge disposition and "evaluate PR head only" reviewer contract, harden audit to three places (commit-message line, PR-description block, reviewer-checklist reject criterion). Lesson: when round-N adds a mechanism (a `DELETE`, a step reorder, a deliverable requirement), explicitly enumerate what new failure modes the mechanism enables before considering it complete — `pr-reviewer` and the user's round-N+1 review will find them otherwise. Detection heuristic: any spec edit that adds "the implementer MUST do X" needs a follow-up "and the failure mode if they don't is Y" — soft enforcement of process steps is a recurring blind spot.

### [2026-04-29] Pattern — Decay/increment-style UPDATEs are NOT idempotent; advisory lock must span mutation, not just enumeration

A maintenance job that subtracts a delta (e.g. `quality_score = currentScore - BLOCK_DECAY_RATE`), increments a counter, or otherwise computes the new value from the row's pre-update content is NOT idempotent under independent-transaction reads. Two overlapping runners that both read 0.50 and write 0.48 are fine; runner 2 reading 0.48 (after runner 1 commits) and writing 0.46 is **cumulative decay** — the bug. State-based UPDATEs (e.g. `WHERE deprecated_at IS NULL` + `SET deprecated_at = now()`) ARE idempotent because the second sweep's SELECT excludes the row already mutated; delta-based UPDATEs are not.

The original Phase-3 audit for `ruleAutoDeprecateJob` ([progress.md § Phase 3 §5.2.1 audit — ruleAutoDeprecateJob](tasks/builds/pre-prod-tenancy/progress.md)) classified it Pattern A on the (incorrect) premise that "score unchanged" meant the SELECT returns no rows — but the SELECT only excludes `deprecated_at IS NOT NULL`, not "score has been decayed already". So the decay step DOES re-fire. ChatGPT PR #235 review round 1 caught this; the fix was to switch from Pattern A (enumeration-only lock) to Pattern B (lock spans full sweep), implemented per DEVELOPMENT_GUIDELINES.md §2 as SAVEPOINT subtransactions inside the outer admin tx that holds the global advisory lock. Bounded-runtime contract is now load-bearing — any future "remove the org LIMIT" or "fan out per-org work in parallel" change must be paired with idempotent decay (e.g. a `last_decayed_at` predicate) or per-org locks.

**Detection rule for the next audit:** an UPDATE is NOT idempotent if either (a) the SET clause references the column being updated (`x = x - 1`, `score = score - rate`, `count = count + 1`), or (b) the new value is computed from a SELECT-then-UPDATE pair where the SELECT can return the row a second time after mutation. The audit checklist must verify the SELECT predicate would EXCLUDE rows already mutated — if it doesn't, lock scope must span the full sweep. Session log: [tasks/review-logs/chatgpt-pr-review-pre-prod-tenancy-2026-04-29T08-49-10Z.md](tasks/review-logs/chatgpt-pr-review-pre-prod-tenancy-2026-04-29T08-49-10Z.md).

### [2026-04-29] Pattern — Replacing advisory-lock+NOT-EXISTS dedup with ON CONFLICT requires an explicit "no upstream side effects before insert" invariant

When a job is refactored from `pg_advisory_xact_lock + SELECT ... WHERE NOT EXISTS` to `INSERT ... ON CONFLICT (key) DO NOTHING` against a UNIQUE constraint, correctness now depends on a previously-implicit invariant: every code path between the eligibility SELECT and the INSERT must be either a pure read or itself idempotent. Without the lock, two overlapping runners both pass NOT-EXISTS (a soft pre-filter, no longer a guarantee), both compute their (read-only) decisions, and only the second's INSERT becomes a no-op via ON CONFLICT. Anything else that has side effects — an external API call, a metric increment, an email send, a queue dispatch — fires from BOTH runners.

`measureInterventionOutcomeJob` was the canonical case: PR #235 replaced `advisory lock + NOT EXISTS` with `ON CONFLICT (intervention_id) DO NOTHING` against the migration-0244 UNIQUE constraint. ChatGPT PR #235 review round 1 surfaced the unstated invariant; the remediation was a load-bearing INVARIANT comment on the file header explicitly naming `recordOutcome` as the SOLE mutation per processed row. Equivalent test (deferred to follow-up): run the job twice concurrently against the same eligible row and assert exactly one INSERT plus zero duplicated upstream side effects.

**Rule:** any refactor of the form "replace lock-around-work with ON-CONFLICT-at-write" lands a load-bearing invariant comment AND a regression test in the same PR. The comment must name the invariant explicitly ("recordX is the SOLE mutation per Y; everything before it must be a pure read OR idempotent") and the test must verify it under concurrent-runner conditions. ON CONFLICT only deduplicates the final write — never the work leading up to it.

### [2026-04-29] Correction — Brief + GlobalAskBar + orchestrator IS the single-prompt fan-out primitive

I underrated our orchestration in a Google-Cloud-Next comparison, calling it "less polished" than Gemini Enterprise's single-prompt-fans-out demo. That was wrong. The brief stack (`server/services/briefCreationService.ts:14`, `server/services/briefMessageHandlerPure.ts:62`, `server/routes/sessionMessage.ts:28`, `server/services/scopeResolutionService.ts`, `server/jobs/orchestratorFromTaskJob.ts`, `server/services/delegationGraphService.ts`, `client/src/components/global-ask-bar/GlobalAskBar.tsx`, `client/src/pages/BriefDetailPage.tsx`, `client/src/components/run-trace/DelegationGraphView.tsx`) implements the same primitive with a classified fast-path (`cheap_answer | simple_reply | needs_clarification | needs_orchestrator`), persistent debuggable delegation graph (`agent_runs.parentRunId / handoffSourceRunId / delegationScope / hierarchyDepth`), inline ILIKE disambiguation, and server-side scope re-validation. The honest gap vs Gemini Enterprise is content surfaces (Workspace canvas mode, in-flow VO3 video / Slides decks), not orchestration. Future agent / Cloud-Next comparisons must read these files before claiming a gap.

### [2026-04-29] Decision — Workspace identity uses canonical pattern (mirrors CRM), one workspace per subaccount

Designing "agents are real employees with their own Gmail / 365 / native identity" must mirror the CRM canonical pattern: provider-agnostic `canonical_workspace_identities` / `canonical_messages` / `canonical_calendar_events` / `canonical_documents`, with `connector_configs.connector_type` extended to include `google_workspace | microsoft_365 | synthetos_native`, per-provider adapters under `server/adapters/`, and provenance tracked via the `connector_config_id` FK edge (not duplicated columns). Both `agents.workspace_identity_id` and `users.workspace_identity_id` point at the same `canonical_workspace_identities` table — agents and humans share one identity space. Workspace tenant is per-subaccount (one provider per `(organisationId, subaccountId)`), not per-agent: per-agent is overkill because a company's identity domain is single-tenant, inter-agent collaboration breaks across tenants, and it mirrors the one-CRM-per-company logic. This deliberately diverges from the CRM's org-level `(organisationId, connector_type)` unique constraint — workspace must be `(organisationId, subaccountId, connector_type)`. Native (`synthetos_native`) ships first to avoid being blocked by Google/Microsoft API integration; Google adapter (service-account + domain-wide delegation) is the launch wedge against Gemini Enterprise's "agent uses the human's permissions" model.

### 2026-04-30 Pattern — Per-action loading + error state on multi-action UI cards

When a UI component exposes several mutating actions (e.g. `IdentityCard`'s suspend / resume / revoke / archive / toggle-email), don't drive each from its own ad-hoc `await`-then-`setState` handler. Pattern: hoist a single `pendingAction: <ActionId> | null` and `actionError: string | null` to the parent, run every mutation through one helper (`runIdentityAction(id, fn)` in `client/src/pages/SubaccountAgentEditPage.tsx`), and pass both back into the card. The card uses `pendingAction` to disable every other button while one is in-flight, shows `…ing` text on the active button, and renders `actionError` in an inline banner. Avoids double-clicks, gives users error feedback when an action fails, and keeps refresh-after-success in one place. Don't fall back to "optimistic-without-rollback" patterns — re-fetch on success instead.

### 2026-04-30 Pattern — Server returns effective config; client never hardcodes literals derived from server config

The native workspace email domain (`NATIVE_EMAIL_DOMAIN`) is configurable per-deployment and may also be overridden per-subaccount via `connectorConfig.configJson.domain`. The right shape is: `GET /api/subaccounts/:id/workspace` resolves the effective domain (per-subaccount override → env default → `'workspace.local'` last-resort) and returns it as `emailDomain`. UI components like `OnboardAgentModal` render `<localPart>@<emailDomain>` from that response — never from a literal. Same rule applies to any other config-derived display string (regions, tenants, billing addresses, etc.): the server resolves, the UI displays.

### 2026-04-30 Gotcha — Lifecycle state guards belong on the server, not just in UI gating

`PATCH /api/agents/:agentId/identity/email-sending` had the right permission check (`AGENTS_TOGGLE_EMAIL`) but no state check — meaning a revoked or archived identity could still have its email-sending flag flipped via a direct API call, even though the UI hides the toggle for terminal states. Pattern: every lifecycle-aware mutation should reject 409 when the entity isn't in an actionable state (`active` / `suspended` / `provisioned` for the email toggle). UI hiding is a UX courtesy, not a security boundary. Keep the allowed-status list as a `ReadonlyArray<string>` const at the route, not buried in conditionals.

### 2026-04-30 Gotcha — Agent permission scope must come from the canonical actor row, not the link table

`subaccount_agents` is a many-to-many link table — the same `agentId` can be linked to multiple subaccounts in the same org. Resolving `(agentId, organisationId) → subaccountId` via that table with `LIMIT 1` and no ordering is non-deterministic and can let a caller authenticate against the wrong subaccount's permissions. The canonical scope for any per-agent route (mailbox, calendar, identity lifecycle) is the agent's home actor row: `agents.workspaceActorId → workspace_actors.subaccountId` — both are single-FK columns, so the resolution is deterministic. Pattern: every `resolveAgentSubaccountId` helper goes through `agents → workspace_actors`, never through `subaccount_agents`. Fixed in `server/routes/workspace.ts`, `workspaceMail.ts`, `workspaceCalendar.ts` during PR #237 review.

### [2026-04-30] Correction — chatgpt-pr-review must check PR merge state before resuming

When invoked on a branch whose PR is already merged, the `chatgpt-pr-review` agent should detect that and stop rather than continuing to triage findings against a stale `git diff main...HEAD`. Today the agent only checks "does a PR exist?" via `gh pr view`, not "is it open?". On `feat/agents-are-employees`, PR #237 had been merged (state MERGED, mergedAt 2026-04-29T22:48:40Z) but the agent continued the review session because `gh pr view` still returned the PR record. The agent definition in `.claude/agents/chatgpt-pr-review.md § On Start` step 3 should filter `gh pr view --json state` and short-circuit if state is `MERGED` or `CLOSED` — surfacing "PR #N is <state>; nothing to review on this branch" and asking whether the user wants to cut a new branch.

### 2026-04-30 Pattern — Soft-then-hard invariant promotion across phase boundaries

When introducing a new compile-time → DB invariant (e.g. `SYSTEM_AGENT_BY_SLUG` mirror of `system_agents` rows), don't ship the hard fail-fast version on day one — ship the warn-only variant first. Pattern: a `validate*Registry()` function that diffs the two sets, logs `JSON.stringify({ codeOnly, dbOnly })` via `console.warn` if either set is non-empty, and returns early on no drift (zero per-boot log spam). Wire it next to existing boot validators so it runs after the DB is reachable but before `httpServer.listen()`. The next phase that actually depends on registry/DB parity promotes the warn to a `throw`. This avoids "deploy fails because a slug is slightly wrong" operational risk while still surfacing drift early. See `server/services/systemAgentRegistryValidator.ts` for the warn-only template; `validateSystemSkillHandlers` for the hard-fail template after the contract is locked.

### 2026-04-30 Pattern — Inline column comments beat a dedicated invariant doc

When two columns are easy to confuse (`auditEvents.actor_id` = auth/request principal, polymorphic; `auditEvents.workspace_actor_id` = canonical domain identity, FK to `workspace_actors`), put the guard at the column declaration in the drizzle schema, not in a separate "invariant doc". Authors writing joins read the schema; they don't grep the docs for naming policy. Two-line comments at the column site ("Do NOT join across — different identity spaces.") prevent the misuse at the point of decision and don't drift like docs do. `architecture.md § Workspace identity model` still carries the prose explanation — the inline comments are the lightweight in-code mitigation, not a replacement.

### [2026-04-30] Pattern — Test-runner-API leaks survive a runner cutover; gate the new runner's contract

After migrating from `node:test` to Vitest (PR #238), four integration tests still failed with `mock is not defined` because they kept calling `mock.module(...)` (the node:test global mock API) instead of `vi.mock(...)` (Vitest's API). The conversion scripts swept assertion patterns (`assert.*` → `expect()`, `node:test` imports → `vitest` imports) but did not catch global API references — `mock` is unprefixed and unimported, so a grep for `from "node:test"` doesn't find it. The same class of leak exists for `t.mock.*` (test-context mock API), `mock.timers` (only available in node:test by default), `before`/`after` hooks (Vitest names them `beforeAll`/`afterAll`), and any other top-level binding the previous runner exposed implicitly. **Detection rule:** after any test-runner cutover, the new gate must include grep checks for the OLD runner's global API surface, not just its import paths. For node:test → Vitest specifically: forbid `\bmock\.module\(`, `\bmock\.timers\b`, `\bbefore\(`/`\bafter\(` (without `All`), `t\.mock\.`. The `verify-test-quality.sh` gate currently catches handwritten-harness leftovers and forbidden imports — extending it to API-surface leaks closes the same class of post-migration silent failure. Source: ChatGPT PR #239 review round 1; session log `tasks/review-logs/chatgpt-pr-review-vitest-migration-2026-04-29-2026-04-30T03-25-03Z.md`.

### [2026-04-30] Pattern — Hardcoded UUIDs in integration tests require explicit seeding, not shared assumption

Multiple integration tests (`briefsArtefactsPagination.integration.test.ts`, `conversationsRouteFollowUp.integration.test.ts`) used `TEST_ORG_ID = '00000000-0000-0000-0000-000000000001'` and `STUB_USER_ID = '00000000-0000-0000-0000-000000000002'` as hardcoded constants, but no `beforeAll` / global setup seeded `organisations` or `users` rows with those IDs. Tests passed locally because dev DBs happen to have a matching seed; CI failed with `insert violates foreign key constraint` because `automation_os_test` is empty. The fix is a centralised `testBootstrap()` / `withTestDb()` helper that seeds canonical org/subaccount/user before any integration test runs (deferred to TI-005 follow-up — see `docs/superpowers/specs/2026-04-30-integration-tests-fix-brief.md`). **Rule:** any hardcoded UUID in a test that is the LHS of an FK is an implicit seed contract — either the file owns its seed (in `beforeAll` with cleanup in `afterAll`) or there is a single bootstrap helper that seeds all canonical fixtures once. Anything in between (test-author-assumed-and-never-verified) is a CI-only failure waiting to fire. Source: ChatGPT PR #239 review round 1; session log `tasks/review-logs/chatgpt-pr-review-vitest-migration-2026-04-29-2026-04-30T03-25-03Z.md`.

### [2026-04-30] Decision — Gate-script regexes that match path segments must use `(^|/)segment/` to handle root-level paths

`scripts/verify-test-quality.sh` Rule 1 used `grep -q "/__tests__/"` to detect test files outside the discovery directory, but the leading slash anchored to "after a directory" — root-level test files like `__tests__/foo.test.ts` failed to match and were false-flagged. The fix is `grep -qE "(^|/)__tests__/"` so the regex matches both start-of-path and after-a-slash. **Rule for any path-segment regex in shell:** when matching `segment/` anywhere in a relative path, always use `(^|/)segment/` — never bare `/segment/`. This applies to all gate scripts under `scripts/verify-*.sh` and `scripts/gates/*.sh` that match directory components. Source: ChatGPT PR #239 review round 1 + bot comment; session log `tasks/review-logs/chatgpt-pr-review-vitest-migration-2026-04-29-2026-04-30T03-25-03Z.md`.

### [2026-04-30] Pattern — Drift-acknowledgment notes go stale once the underlying drift is fixed; coherent fixes touch both sides

When an agent definition (or any implementation file) carries a "known drift" / "this contradicts spec X" comment to acknowledge a divergence from a spec, fixing the spec to align with the implementation must ALSO retire the drift note. Otherwise the drift note itself becomes the new inconsistency: future readers see the agent claiming a drift that no longer exists, and the next reviewer round flags it as a fresh contradiction.

**Applied to:** PR #243 chatgpt-pr-review Round 2 f-001 — `docs/agentic-engineering-notes-dev-spec.md:113` was rewritten from "Same auto-detection logic as `spec-conformance`" to caller-provides-set posture; the same edit removed the obsolete "The spec § 4.2 wording... is a known drift" note from `.claude/agents/adversarial-reviewer.md` Input section. Both edits ship in one commit (c83bd8cb). Session log: `tasks/review-logs/chatgpt-pr-review-claude-agentic-engineering-notes-WL2of-2026-04-30T20-06-11Z.md`.

**Generalises to:** Any review-pipeline fix where the implementation file documents an acknowledged spec divergence. The fix isn't done until both sides agree AND the divergence acknowledgment is retired. Drift notes are temporal markers — they decay into staleness as soon as the drift resolves. Same principle as removing temporary `// TODO: remove once X` comments after X ships, except for cross-file coherence rather than within-file cleanup.

### [2026-05-01] Gotcha — chatgpt-pr-review automated mode must use the same diff exclusions as manual mode

`chatgpt-pr-review` had two diff paths: manual mode (user provides the diff) and automated mode (agent runs `git diff main...HEAD`). The automated path had NO exclusions — it piped the raw full diff to the OpenAI API, resulting in 1,719 files / ~7.7M tokens and a rate-limit error on gpt-4.1. Manual mode already had a 15-exclusion set (`tasks/review-logs`, `tasks/builds`, `tasks/todo.md`, `KNOWLEDGE.md`, spec/docs directories, `.chatgpt-diffs`, etc.). Fix: automated mode now uses the exact same exclusion set. **Rule:** whenever you maintain two paths to the same diff (manual entry vs. automated generation), treat the exclusion set as shared state — if one path changes, both must change. Deduplication candidate: a single shell function/variable shared by all three diff invocations (round 1 automated, round 1 manual, round N+1 manual) would make future drift structurally impossible. Source: fix-doco-may2026 Phase 1; log `tasks/review-logs/pr-review-log-fix-doco-may2026-2026-05-01T00-30-00Z.md`.

### [2026-05-01] Gotcha — chatgpt-pr-review manual mode must generate round N+1 diff before printing the round summary

In manual mode, `chatgpt-pr-review` was printing the round summary after each round completed but NOT generating the `.chatgpt-diffs/pr<N>-round<N+1>-code-diff.diff` file that the user needs to upload to ChatGPT for the next round. Root cause: Per-Round Loop step 9 described "upload the file to ChatGPT" but did not include the bash command to generate it first. The user discovered this after round 2 when round 3's diff was missing. Fix (commit e9012ea5): step 9 now states "Do not print the round summary until the diff file exists on disk" and "The diff link MUST appear in the same message as the round summary." **Rule:** round summary and diff link are a single atomic message in manual mode — never print one without the other. Applies to every `chatgpt-pr-review` manual session with more than one round. Source: fix-doco-may2026 review session round 3 user feedback.

### [2026-05-01] Pattern — Resolver version belongs in the cache key, not as a metadata column only

When a content resolver can change its normalisation logic between versions (e.g. Google Drive plain-text extraction), the cache key must include `resolver_version` as a discriminant — not just as a metadata column. Without it, a rolling deployment can have v1 and v2 resolver instances reading the same cache row, causing v2 to serve v1-normalised content. The `document_cache` table uses `UNIQUE(provider, file_id, connection_id, resolver_version)`, and the resolver's `resolverVersion` constant is exposed on the resolver object so `runContextLoader.ts` can reference it without hardcoding. **Rule:** when a cache entry's validity depends on the processing version (not just the source revision), the version is part of the cache key — not a separate migration field you can check after the fact. Source: ChatGPT PR #242 review; migration 0264.

### [2026-05-01] Gotcha — CRLF line endings in gate fixture files cause grep pattern mismatch

`scripts/derived-data-null-safety-fields.txt` had Windows CRLF (`\r\n`). The fixture-self-test gate reads it with `while read line` (strips LF but not CR), so each pattern becomes e.g. `utilizationByModelFamily\r` — the trailing `\r` is invisible in the shell but causes every `grep -q "$line" <source>` call to return false, making ALL fixtures appear unverified. The gate then reports a false-positive failure. **Fix:** strip CRLF before committing any fixture file on Windows (`sed -i 's/\r//' <file>` in Git Bash). **Rule:** every fixture file that feeds a shell grep loop must be LF-only. Add a `.gitattributes` rule (`scripts/*.txt text eol=lf`) if the repo is regularly edited on Windows to enforce this at checkout. Source: gate fix session during PR #242.

### [2026-05-01] Gotcha — verify-integration-reference gate requires primary slugs, not taxonomy aliases

`scripts/verify-integration-reference.mjs` validates that capability slugs in each integration block's `capabilities:` list appear in the taxonomy's primary slug column — not in any alias array. A slug that exists only as an alias is treated as "unknown capability" and fails the gate. In practice: `document_read` is an alias for `page_read` in the capabilities taxonomy — using `document_read` in the Google Drive integration block fails the gate even though the alias is legitimate. **Fix:** use the primary slug (`page_read`), and add any genuinely new capabilities (e.g. `spreadsheet_read`) to the taxonomy's `read_capabilities` section with their own primary slug before adding them to the integration block. **Rule:** before adding a capability slug to an integration block, confirm it is a primary slug in the taxonomy, not just an alias. Source: gate fix session during PR #242.

### [2026-05-01] Gotcha — chatgpt-pr-review diff must use `origin/main`, not local `main`

The `chatgpt-pr-review` agent previously used `git diff main...HEAD` to generate diffs. The local `main` pointer only advances when you explicitly `git pull` or `git fetch && merge` — it can be stale by many commits. Using stale `main` as the diff base produces a bloated diff (1,283 files vs the real 67 in PR #242) because the merge-base is computed against an old commit, dragging in work that is already on the real main.

**Fix:** always use `origin/main` (the remote tracking ref, which is updated on every `git fetch`) as the diff base: `git diff origin/main...HEAD`. The remote tracking ref matches what GitHub computes for the PR diff, giving the correct scope.

**Rule:** any script or agent that generates a diff for PR review must use `origin/<base-branch>`, not the local branch pointer. Applied to all 8 occurrences in `.claude/agents/chatgpt-pr-review.md`.

### [2026-05-01] Correction — async handlers passed as effect deps need useCallback

In React, a plain `async function` declared inside a component body creates a new function reference on every render. If that function is passed as a prop to a child component and the child's `useEffect` lists it as a dependency, the effect re-fires on every parent rerender. This pattern bit `handlePick` in `TaskModal.tsx` — passed as `onPick` to `DriveFilePicker`, whose effect called `openPicker(...)` whenever `onPick` changed reference, reopening the Google Picker SDK on rerenders while the picker was already open. **Rule:** any callback passed as a prop into a child component that has a `useEffect` depending on it must be wrapped in `useCallback` with stable dependencies. Caught in ChatGPT PR #242 review Round 1 F2.

### [2026-05-01] Pattern — Token-based idempotency breaks when the token is consumed before the idempotency check runs

In `agentResumeService.ts`, the first resume call cleared `integration_resume_token = NULL` as part of the blocked-state UPDATE. A retry then looked up the run by `WHERE integrationResumeToken = tokenHash` — which returned 0 rows because the column was NULL — and threw RUN_NOT_FOUND instead of the expected `already_resumed`. The code's own comment ("The idempotent check above handles the already-resumed case before reaching this point") was wrong: the idempotent check was unreachable because the SELECT that precedes it found nothing. **Rule:** when a token-based lookup is the only path to an idempotency guard, do not clear the token as part of the "success" write — preserve it so retries can reach the guard. Replay is already prevented by the state predicate in the UPDATE WHERE clause (e.g. `blocked_reason = 'integration_required'`), not by clearing the token. Fix applied in commit ecafc6c6; PR #244 R4.

### [2026-05-01] Pattern — URL path params extracted in route handler must appear in every relevant WHERE clause

`server/routes/conversationThreadContext.ts` declared the route as `/api/agents/:agentId/conversations/:convId/thread-context` but the ownership query only filtered by `conversationId + organisationId`, ignoring `agentId`. Within the same org, a request with a mismatched `agentId` in the path would still succeed — a subtle cross-agent data leak. **Rule:** every param in the URL path that scopes the resource (agentId, subaccountId, etc.) must appear in the DB query's WHERE clause. After any route edit, grep for `req.params` extraction and verify each param either appears in the query or is explicitly justified as unused (e.g. for routing purposes only). Fix applied in commit ecafc6c6; PR #244 R4.

### [2026-05-01] Gotcha — local `main` ref is stale; always use `origin/main` for PR diffs

The local `main` branch pointer only updates when you check out that branch or run `git fetch`. If you've been on a feature branch for a while, `git diff main...HEAD` uses a stale commit as the base, producing an inflated diff (e.g. 588 files instead of the real 20). `origin/main` is always fresh after `git fetch`. **Rule:** every review agent that generates a diff must (1) run `git fetch origin main` first, and (2) use `git diff origin/main...HEAD` — never the local `main` ref. Both `chatgpt-pr-review` and `chatgpt-spec-review` were updated to enforce this. Discovered during PR #246 lint-typecheck-baseline session where the code-only diff was 4.4MB/501 files vs. the correct 100KB/19 files.

### [2026-05-01] Pattern — Subaccount scope guards must use null-safe checks to preserve org-level connection validity

Route guards checking `conn.subaccountId !== subaccountId` wrongly reject connections where `subaccountId` is `null` (org-level connections) — `null !== 'some-uuid'` evaluates to `true`. The correct form is `if (conn.subaccountId && conn.subaccountId !== subaccountId)`. Apply this pattern to any route guard that scopes a shared resource (connection, credential, shared integration) to a subaccount while leaving org-level access open. Source: deferred-items-pre-launch spec review R2/F1.

### [2026-05-01] Pattern — Spec step-shorthand ("same injection as above") silently drops side-effect writes

When a spec uses shorthand like "apply the same injection (same two lines)" to describe a repeat call, implementers often copy the primary lines (build + format + prepend) but miss secondary side-effects (like writing `runMetadata.threadContextVersionAtStart`). Always enumerate every side-effect explicitly in each step — shorthand saves spec words but generates implementation bugs. Found in deferred-items-pre-launch spec review R1/F2 (§2.2 Step 3 resume path).

### [2026-05-01] Correction — chatgpt-spec-review manual mode prints spec as a copy-paste payload

In manual mode, `chatgpt-spec-review` prints the full spec inside a `--- Copy into ChatGPT ---` block per the agent design. If the user has already submitted the spec to ChatGPT independently, this block looks like instruction-dumping. Future sessions should briefly state "printing the ChatGPT payload" before the block so the user understands its purpose and can skip it if they submitted manually.

### [2026-05-01] Pattern — Pre-submit access verification prevents silent rebind failures

When a UI action binds a new credential to a resource (e.g. rebinding a broken Drive reference to a new connection), calling a lightweight access-check endpoint on connection select — rather than waiting for the full submit — surfaces failures at decision time instead of after the user commits. `ExternalDocumentRebindModal` now calls `verifyAccess(connId, fileId)` on the connection `<select>` onChange, shows an inline error, and disables the confirm button until access is confirmed. **Rule:** for any "bind credential to resource" flow, add a verify-before-confirm step using any existing lightweight probe endpoint; post-submit failures confuse users because the error arrives after they have mentally moved on. Source: ChatGPT PR #242 review Round 2 F4.

### [2026-05-02] Correction — "Newest at bottom" is event order, not container alignment

When designing a chronological event log that should show newest-at-bottom (matching chat conventions: terminal output, build logs, Slack), the events should flow from the top of the container downward in natural document order. Do NOT use `flex-col justify-end` to pin a short list to the bottom of the panel — that creates ugly empty space above and only "looks right" by accident when the list grows enough to overflow. **Rule:** for activity-style streams that should anchor to bottom on overflow, use a top-anchored container with `overflow-y-auto` and oldest-events-first ordering; auto-scroll-to-bottom logic handles the "show newest" requirement when events arrive. Discovered while building `prototypes/workflows/07-open-task-three-panel.html`, `08-task-progression-states.html`, `10-ask-step-runtime.html` — all three had the same wrong pattern.

### [2026-05-02] Pattern — Timestamps on activity events need an "ago" suffix

In an activity log where each event has a relative-time stamp, bare numbers like `38s` or `4m` are ambiguous: they read like task duration, not "time since this event." Append `ago` so the meaning is explicit: `38s ago`, `4m ago`, `1d 3h ago`. Exception: `just now` stays as-is (no `ago`). **Rule:** any relative-time label on activity-style streams uses `Xs ago` / `Xm ago` / `Xh ago` / `Xd Yh ago` format. Surfaced during workflows mockup review.

### [2026-05-02] Pattern — Engine writes use state-based CAS predicates as the canonical idempotency mechanism

The workflow engine's V1 execution model (declared in `docs/workflows-dev-spec.md` §4.0) is **at-least-once dispatch with idempotent handlers**. The dominant idempotency mechanism is state-based concurrency control: every state-transition write uses an `UPDATE ... WHERE status = X` predicate; 0 rows updated means "another writer already won" and the API resolves the call as either an idempotent-hit (200) or an external-transition rejection (409). The unique-constraint pattern (e.g. `UNIQUE (gate_id, deciding_user_id)` per spec §5.1.1) is used as a secondary mechanism where multi-writer per-step deduplication is required. **Why not exactly-once via global idempotency keys:** distributed exactly-once is a known impossibility outside a single transactional context; a `(run_id, task_id, step_id, attempt)` key would be redundant with the per-endpoint state-based posture and would not solve the underlying determinism problem. **Rule:** every new engine endpoint MUST declare its idempotency posture inline per `docs/spec-authoring-checklist.md` §10, and MUST verify a re-execution does not double-count or double-write. Any handler that wraps an external API call without a deduplicating key MUST surface that constraint upstream rather than silently retry.

### [2026-05-02] Gotcha — Idempotent endpoint responses must distinguish race-won-by-decider from external-transition

When a CAS predicate fails (`UPDATE ... WHERE status = X` returns 0 rows), the API has to determine WHY it failed before responding. Two distinct cases need different responses: (a) **race won by another decider** — the row's current status IS the next valid terminal state (e.g. `approved` or `rejected`); the API returns `200 { idempotent_hit: true, existing_review_id }` because there is a real winning decision to surface to the losing caller; (b) **external transition** — the row's current status is NOT a decision-style terminal (e.g. the run was Stopped, the parent fan-out cancelled the step); the API returns `409 { error: 'step_already_resolved', current_status }` because there is no winning decision to surface and the client needs a deterministic signal to remove the UI. Returning the same 200-idempotent-hit response for both cases creates **ghost-log entries** — approval rows recorded with no real effect, and stuck UI cards that never collapse. Codified in `docs/workflows-dev-spec.md` §5.1.1; the rule applies to every endpoint that uses a state-based CAS predicate against a row that can transition externally (Stop, fan-out cancel, timeout, admin override). Discovered during ChatGPT spec review of workflows-dev-spec, F12 round 2.

### [2026-05-02] Pattern — Gate-snapshot model isolates in-flight gates from live state changes

`workflow_step_gates` (per `docs/workflows-dev-spec.md` §3.3) holds a frozen `approver_pool_snapshot` (and `seen_payload`, `seen_confidence`) at gate-open time. Every gate decision evaluates membership against the snapshot column, **never against live `teams` / `team_members` / org state**. The single mutation path is the explicit `POST /api/tasks/:taskId/gates/:gateId/refresh-pool` admin endpoint (spec §5.1.2), which overwrites the snapshot in a guarded `UPDATE ... WHERE resolved_at IS NULL` predicate and emits an `approval.pool_refreshed` event so all open clients update their cards. **Asymmetry between gate kinds on refresh:** Approval gates preserve decisions already recorded against the prior snapshot (`No effect on existing reviews`); Ask gates evaluate eligibility against the current snapshot at submit time, so a user removed by `/refresh-pool` between gate-open and submit gets a 403. **Rule:** any gate-style HITL primitive in this codebase MUST use the snapshot-at-open + explicit-refresh-endpoint pattern rather than reading live state at decision time. Live reads create non-deterministic decision behaviour when org membership changes mid-flight (e.g. employee leaves a team while their approval is queued).

### [2026-05-01] Pattern — Implementation spec hard stop conditions must use explicit "stop" language, not implied success

When a sequencing spec has a task boundary where proceeding on failure causes wasted work (e.g. applying `!` assertions to test files while production type errors remain), the verification step must use explicit "If non-zero, stop — do not proceed to Task N" language. An implied success condition ("must return 0 lines") is insufficient — implementers in execution mode continue past soft failures. The Task 2.4 → Task 3 boundary in `docs/superpowers/specs/2026-05-01-lint-typecheck-post-merge-spec.md` was the canonical example: 127 test-file `!` fixes applied on top of unfixed production errors = wasted session. The corrective pattern: hard stop at each major task boundary where downstream work is invalidated by upstream failure, plus a Task-N pre-condition that re-states the same check as an entry gate.

### [2026-05-01] Gotcha — ESLint flat config global rule insertion is silent if placed in the wrong position

In `eslint.config.js` (flat config format), a global `{ rules: { 'no-undef': 'off' } }` object is silently overridden if placed BEFORE `js.configs.recommended` (which re-enables it). The rule must appear AFTER both `js.configs.recommended` and `...tseslint.configs.recommended` but BEFORE any `files:`-scoped override blocks. There is no warning when the placement is wrong — the rule simply has no effect and the lint output is unchanged. Verification: `npx eslint --print-config <any-file-outside-scoped-globs> | grep '"no-undef"'` must return `["off"]`. If it returns `["error"]`, the global object is in the wrong position. Source: `docs/superpowers/specs/2026-05-01-lint-typecheck-post-merge-spec.md` Task 4.2.

### [2026-05-01] Pattern — Sustained-reject discipline in spec review: re-raises with no new evidence should stay rejected

When a spec reviewer raises the same finding 3 consecutive rounds with the same example and no new evidence, the correct response is to maintain the rejection rather than accepting under persistence pressure. The over-assertion guard (`>3 !` threshold) and exhaustiveness guard verification step were both raised across all 3 rounds of the lint-typecheck-post-merge spec review. Accepting them would have added: (a) an arbitrary threshold that generates false positives on legitimate deep-object assertions, and (b) a "deliberately break the code to verify the guard works" step for a standard TypeScript discriminated-union pattern. Rule: when a reviewer re-raises without new evidence, add a one-line note to the session log ("Round 1 FN re-raised; rationale unchanged") and reject. Accepting re-raises for their persistence is a common way specs accumulate bureaucratic noise. The Recommendation Criteria ("stylistic preference with no functional impact", "adds complexity without necessity") are stable across rounds — new evidence changes a recommendation, repetition alone does not.

### [2026-05-01] Correction — chatgpt-pr-review duplicate findings auto-apply per prior decision

When `chatgpt-pr-review` surfaces findings in Round N (N ≥ 2) that are substantive duplicates of decided findings from prior rounds (same finding_type + same file/code area, no new evidence — even when rephrased with stronger language like "must-fix" or "not optional"), auto-apply the prior round's decision and log as `auto (<prior decision>) — duplicate of Round X / F<id>`. Do NOT re-surface to the user via the approval gate, even when severity / defer / user-facing carveouts would normally trigger escalation. The carveouts protect the FIRST decision; once the user has actually made it, repetition adds zero judgment value. Source: PR #247 round 2 — user feedback "these are all technical so shouldn't be surfaced to me, go with your recommendations" after I re-presented 6 round-1 duplicates with the same recommendations.

### [2026-05-01] Pattern — External reviewers misread codebase canonical RLS without architecture.md context

ChatGPT consistently flags the codebase canonical RLS pattern (`current_setting('app.organisation_id', true) IS NOT NULL AND ... <> '' AND organisation_id = current_setting(...)::uuid` with `, true`) as a "silent denial bug" and recommends removing `, true` for fail-fast behaviour. The pattern is intentional and documented at `architecture.md` §Canonical org-isolation policy template (lines 1451-1474). The `true` flag (`missing_ok = true`) returns NULL when the GUC is unset; the explicit NULL / empty guards then close the policy fail-closed. Admin paths bypass RLS entirely via `SET LOCAL ROLE admin_role` (BYPASSRLS), so the `true` flag avoids throwing on legitimate admin operations that don't set `app.organisation_id`. Surfaced 3× in PR #247 review (rounds 1, 2, 3). **Rule:** when this finding appears, reject and reference the architecture.md section; do NOT change the pattern unless undertaking a codebase-wide RLS convention audit.

### [2026-05-01] Pattern — Verdict-based gates need evidence-bearing verdicts, not trust-based ones

When a finalisation gate enforces "for each X, declare yes/no/n/a" (doc-sync sweeps, conformance checks, security reviews), the agent can declare `no — already accurate` after a quick skim and miss issues the diff actually invalidated. The verdict format itself must require evidence: either grep terms checked against the target and found absent, or a specific reason the update trigger genuinely doesn't apply. Without an audit trail in the verdict, the gate becomes trust-based and degrades silently — the failure mode is "declared clean, actually stale" with no way to retroactively notice. **Rule:** any verdict-based gate must require the verdict to cite the evidence that justified it; bare or unsubstantiated verdicts are treated as missing. Applied to `docs/doc-sync.md` § Investigation procedure + § Verdict rule (PR #248). Source: operator-observed failure mode in PR #247 finalisation where stale `architecture.md` references were missed because the doc-sync sweep declared `no` without opening the doc.

### [2026-05-01] Pattern — ChatGPT PR-review diff misreading: treat "" claims as needing grep verification

ChatGPT-web reviewing a PR diff frequently treats `-foo` (removed line) and `+bar` (added line) as both present in the current file, producing "duplicate code" findings that do not exist on disk. In PR #249 (lint-typecheck-post-merge-tasks), 3 of 17 findings across 3 rounds were diff-misreadings — HelpHint double toggle (R1 F2 / R2 F1 / R3 F1), duplicate `onClick` in McpServersPage (R2 F2 / R3 F2), duplicate try/catch — each resolved to one line in the file. **Rule:** when ChatGPT claims a "duplicate" pattern in code, verify with `grep -c <pattern> <file>` or read the file before acting. If grep returns 1, the claim is a diff misreading; auto-reject and document. If grep returns ≥ 2, the duplicate is real. Cost of grep is ~1 sec; cost of "fixing" a hallucinated duplicate is unwinding it later. Source: `tasks/review-logs/chatgpt-pr-review-lint-typecheck-post-merge-tasks-2026-05-01T08-50-17Z.md`.

### [2026-05-01] Pattern — Post-increment on the last use of a local is a no-op; `no-useless-assignment` correctly removes it

`var++` on the LAST use of a local variable inside a function passes the current value (correct semantics) and increments (unobservable, since the variable goes out of scope on the next line). The post-increment is dead — the new value is never read. `@typescript-eslint/no-useless-assignment` flags these correctly; removing the `++` does not change behavior. Reviewers may incorrectly claim "regression" or "duplicate React keys" — verify by tracing the value PASSED at the call site, not the value ASSIGNED after. PR #249 examples: `client/src/pages/AgentChatPage.tsx:80`, `client/src/pages/ConfigAssistantPage.tsx:62` — both `parts.push(...renderInlineMarkdown(remaining, keyIdx++))` → `parts.push(...renderInlineMarkdown(remaining, keyIdx))` immediately before `return parts;`. Keys still unique because `renderInlineMarkdown` namespaces by `baseKey * 10000`.

### [2026-05-01] Pattern — chatgpt-pr-review session close after 2 unproductive rounds

When 2 consecutive `chatgpt-pr-review` rounds produce 0 new valid findings AND the failure mode is structural (diff misreading, scope confusion, hallucination), close the session — do not push for round 3+. The model is not getting new context between rounds; persistence does not improve signal. PR #249 R2 produced 5 reject + 1 no-op + 0 implements; R3 was 4 reject (all duplicates of R1/R2) + 0 implements. Recommend operator close at end of R2 in similar cases. The chatgpt-pr-review agent definition encodes this as a stop signal — `tasks/review-logs/chatgpt-pr-review-lint-typecheck-post-merge-tasks-2026-05-01T08-50-17Z.md` is the worked example.

### [2026-05-01] Correction — Apply ready-to-merge label MUST be paired with ScheduleWakeup, not stop

After `gh pr edit --add-label ready-to-merge` fires CI on this repo, the main session must immediately schedule a wake-up to poll CI status. Cadence per CLAUDE.md §12 line 172: 90-120s default (CI on this repo typically completes in 1-2 min). Stopping after applying the label and waiting for the operator to come back is wrong — it pushes the merge timeline by however long the operator is away, when the work was already CI-bound and pollable. **Rule:** `gh pr edit --add-label ready-to-merge` and `ScheduleWakeup` with `delaySeconds: 90-120` are a single atomic operation; one without the other is a process bug. After the wake-up fires, run `gh pr checks <N>` and either re-schedule (still running) or proceed (green/red). Source: PR #249 finalisation, 2026-05-01 — operator caught the miss after CI completed silently for ~3 min.

### [2026-05-02] Pattern — Subaccount-scoped UI signals need both event filtering AND listener lifecycle cleanup

For per-subaccount client state driven by socket events (e.g. `liveAgentCount` badge in `client/src/components/Layout.tsx`), TWO orthogonal correctness rules apply, and either alone leaves a bug class open. (1) **Event filtering at handling time**: filter by `activeClientId` at the moment each event is handled, not at subscription time — late events from a previous subaccount otherwise produce ghost counts and flicker. Use a ref or pass `activeClientId` through the handler argument list rather than closing over it. (2) **Listener lifecycle**: `useSocketRoom` (and any direct `socket.on` registration) must cleanup in the `useEffect` return — without this, every subaccount switch adds another handler for the same event, so one inbound message produces N badge increments. The event-filtering rule does NOT mask within-subaccount listener duplicates (the events are correctly scoped, just counted N times). Source: `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md` §4.4 + §4.5 (chatgpt-spec-review rounds 1 + 3, 2026-05-02). Architecture.md line 1579 already documents the lifecycle expectation ("Joins the room on mount, leaves on unmount"); the spec adds the event-filtering rule as a sibling invariant.

### [2026-05-02] Pattern — Per-callsite audit tasks need explicit stop conditions to prevent drift into refactor

Audit tasks (eslint-disable hygiene, `Record<string, unknown>` classification, `any` cast review, dead-code sweep) drift into refactor projects when callsite-level analysis is unbounded. Two safeguards keep an audit an audit: (1) explicit stop condition — "if classifying a single callsite takes more than 2 minutes of investigation, classify as the safe default and move on"; (2) named fallback classification — Category C "kept" for type casts; "kept with one-line justification" for eslint-disables. The 2-minute bound is empirically the point where a callsite-level decision becomes a type-design decision; the latter belongs in a separate spec. Source: `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md` §5.2 + §6.2 (chatgpt-spec-review round 1, 2026-05-02). Apply this pattern to any future audit-classification spec; do NOT pull substantive refactors into a hygiene PR.

### [2026-05-02] Pattern — `Record<string, unknown>` at network or actionType boundaries should default to keeping the cast

When auditing `Record<string, unknown>` casts, classify boundary values (route handler input/output, webhook payload, external API response, persisted JSONB column read, dynamic-`actionType` polymorphic structures) as "keep" by default unless the type is closed and exhaustively known and demonstrably so. **Mis-narrowing a boundary value produces RUNTIME bugs** (`undefined` access, wrong-shape calls) that typecheck cannot catch — `JSON.parse` output is `unknown` to the type system regardless of how it is annotated downstream, and dynamic-discriminator structures (e.g. ClientPulse intervention payloads keyed by `actionType`) admit shape variants the typechecker does not enforce. The narrowing is invisible at typecheck time and only surfaces at runtime. **Rule:** at a boundary, default to keep (Category C); narrow only when you can demonstrate the closed type. Source: `docs/superpowers/specs/2026-05-02-pr-249-followups-spec.md` §6.2 (chatgpt-spec-review round 1, 2026-05-02).

### [2026-05-02] Pattern — JSONB column reads via Drizzle `$type<>()` must not be narrowed at the persistence layer

Drizzle JSONB columns typed as `.$type<Record<string, unknown>>()` (e.g. `agentExecutionEvents.payload`, `agentRuns.runMetadata`) return `Record<string, unknown>` at read time. Do NOT add a narrowing cast at the read site — the schema's `$type<>()` declaration IS the type contract; a redundant cast adds noise without safety. Do NOT remove the `Record<string, unknown>` typing to narrow to a domain shape at the persistence layer — that narrowing belongs in the service/caller that owns the field's semantics, not at the DB boundary. Distinction: removing a *double-cast* (`(x as Record<string,unknown>) as Record<string,unknown>`) is correct cleanup (Category A); removing the single persistence-layer cast is a Category C keep. Source: F6 audit on `pr-249-followups` (2026-05-02).

### [2026-05-02] Pattern — Policy expansions for a deferred refactor must defer with the refactor

When a hygiene PR adds a contributor-facing policy doc (`CONTRIBUTING.md`, design principles, convention guide) that codifies *current* patterns, and a reviewer suggests adding policy *for a deferred refactor* in the same PR, defer the policy addition to land with the refactor. Concrete case: PR #251 added a lint-suppression policy section while ChatGPT recommended also adding a "React effect dependency policy" section. The React-effect refactor (`useRef`/`useCallback` migration across ~10 components) was already deferred out of the PR. Adding the policy now would document a *target* pattern not yet present in code; adding it later (with the refactor) keeps doc and code agreed at landing. **Rule:** policy describes the code state at the moment of landing. If pattern X is deferred, policy for X is deferred. If pattern X is in-tree, policy for X belongs in the same PR. Source: `tasks/review-logs/chatgpt-pr-review-pr-249-followups-2026-05-02T08-30-45Z.md` round 3 P2.4.

### [2026-05-02] Pattern — Material-change thresholds combine relative AND absolute floors

Threshold-based detection that uses ONLY a relative threshold (e.g. `delta / prev >= 10%`) fails on small values: `$5 → $5.50` is +10% but operationally trivial. Pure absolute thresholds fail on large values: `$1000 → $1010` is +$10 absolute but irrelevant. **Rule:** pair every relative threshold with an absolute floor; both branches must hold. For rate-based predicates (rates, percentages), additionally require a minimum supporting-count floor — a "10pp change in rate" against `total_decisions=2` is meaningless. The full pattern: `(relative_delta >= X% AND absolute_delta >= Y unit) AND (supporting_count >= Z AND supporting_count_delta >= W)`. Document the rationale per-category in a single table — see `docs/sub-account-optimiser-spec.md § Material-change thresholds` for the worked-example shape with cost / latency / rate / token predicates. The same predicate shape generalises to any threshold-driven trigger (cost breakers, alert rules, drift detectors). Source: ChatGPT spec-review subaccount-optimiser R1+R2 (R1 added relative-only; R2 surfaced the small-value failure mode and added absolute floors).

### [2026-05-02] Pattern — Cap-aware priority eviction with implicit cooldown rotates the surface fairly

When a finite cap is reached on a recommendation/finding/action surface, three failure modes exist: (1) silently drop new items (mainly hides important findings), (2) drop oldest first (loses recent context), (3) drop lowest-priority first (correct but oscillates if low-priority items keep getting regenerated). The full pattern: **on cap hit, compare new candidate's priority tuple to the lowest-priority open item; if higher, atomically evict the lowest and insert the new one with a short implicit cooldown (6h) on the evicted row**. Priority tuple should put `updated_at` at position 2 (after severity, before category/dedupe_key) so eviction rotates by freshness rather than alphabetical category bias — without this, alphabetically-earlier categories systematically dominate the cap forever. Plus: emit structured logs for both the drop path (`*.dropped_due_to_cap`) AND the eviction path (`*.evicted_lower_priority`) so silent suppression and displacement are both auditable in production (per the tagged-log-as-metric convention). Source: ChatGPT spec-review subaccount-optimiser R1 (initial eviction logic) + R2 (implicit cooldown + drop log) + R5 (priority-tuple position-2 fix).

### [2026-05-02] Pattern — Render-cache key for LLM-rendered copy MUST include render_version

When LLM-rendered copy is cached (e.g. operator-facing summary text generated from raw evidence), the cache key tuple must include a `render_version` axis alongside content keys (category, dedupe_key, evidence_hash). Without it, prompt-template tweaks silently produce stale copy in already-stored rows: the evidence hasn't changed, so the cache hit serves old prompt's output. **Rule:** export `RENDER_VERSION` as a single integer constant from `<service>/renderVersion.ts`, include it in every render cache lookup, and bump on (a) prompt-template change, (b) per-category evidence-shape contract change, (c) output-format contract change. The bump invalidates ALL cached copy across the service in one step — no migration, no partial-state risk. Source: ChatGPT spec-review subaccount-optimiser R1 (initial design) + R5 (propagation fix when stale references in §5/§13 used the 3-tuple instead of 4-tuple).

### [2026-05-03] Pattern — Canonical terminal-state table prevents invariant drift across long specs

In a state-machine-heavy spec, terminal state semantics get described in multiple places (state table, rules section, invariants, audit events). Without a single canonical reference, sections drift over rounds of review — one section says `succeeded` is terminal, another doesn't mention it. **Rule:** nominate one section as "Canonical Terminal State Reference" with an explicit "contradictions here are bugs" header; every other section defers to it. The table structure that worked well: four classification rows (truly-terminal, provisionally-terminal, functionally-settled, non-terminal) with a "Outbound transitions" column that makes exceptions visible. Source: `tasks/builds/agentic-commerce/spec.md §4`, added at chatgpt-spec-review round 4 after 4 rounds of incremental invariant additions created interpretation risk across §4, §9.4, and §10.

### [2026-05-03] Pattern — Webhook supremacy + timeout reversibility are separate invariants that must both be named

Financial state machines that use webhooks for confirmation need two distinct invariants, not one. (1) "Webhook wins over in-app completion signals" — when a worker/job and a webhook race for the same row, the external source of truth (Stripe) is authoritative. (2) "Timeout failure is reversible by webhook" — a row failed by a timeout job is a *provisional* failure; if the external system later confirms success, the override MUST be applied and MUST NOT be optimised away. These are logically distinct: (1) is about concurrent-write precedence; (2) is about post-terminal recoverability. Both need to be named explicitly in the spec because future engineers will see them as "fixes" to optimise. Source: `tasks/builds/agentic-commerce/spec.md §4 + §10 invariants 20, 7`, surfaced across chatgpt-spec-review rounds 1 and 3.

### [2026-05-03] Pattern — Defense-in-depth for financial value tampering needs two independent layers

A charge system with worker-mediated execution (worker fills a payment form using a token) needs two independent checks to prevent value tampering: (1) idempotency key — prevents *duplicate* charges for the same intent; (2) webhook amount/currency match — prevents *value-tampered* charges where the worker submits a different amount or currency than was approved. These are orthogonal: idempotency alone allows a worker to charge $5000 instead of $50 (different amount, not a duplicate). The webhook check catches this at confirmation time by comparing the webhook's reported amount against the ledger row's `amount_minor`. A mismatch blocks the `→ succeeded` transition and fires a critical alert instead, leaving the row in `executed` for manual reconciliation. Source: `tasks/builds/agentic-commerce/spec.md §10 invariant 24`, added at chatgpt-spec-review round 2, extended to include currency and ISO 4217 minor-unit exponent at round 3.

### [2026-05-02] Pattern — Static-analysis single-writer test enforces the architectural invariant at test time

A single-writer invariant ("exactly one file performs INSERT/UPDATE on table X") is normally enforced architecturally (call sites route through one service) and at runtime (`pg_advisory_xact_lock` prevents races between *concurrent* writers). Both layers leave a gap: a future contributor can copy a `db.insert(table)` into a different file, and the architectural invariant silently breaks — runtime locks won't catch it because the second writer just queues behind the first; tests pass; the behaviour stays correct on the happy path but the cooldown / cap / eviction logic now bypasses the canonical service. **Rule:** for any single-writer table, ship a static-analysis test (`*.singleWriter.test.ts`) that walks `server/**/*.ts` and greps for `INSERT INTO <table>` / `UPDATE <table>` SQL patterns and `db.insert(<schema>)` / `db.update(<schema>)` Drizzle patterns, asserting exactly one source file matches. Run as a normal unit test (no DB needed) so it surfaces in PR review locally. Pattern shipped in `agent_recommendations` (PR #250, chunk 1) — see `server/services/__tests__/agentRecommendations.singleWriter.test.ts`. Combine with: (a) `pg_advisory_xact_lock` for concurrent-writer races, (b) "Suppression is success" return-value rule for coordination losers (architecture.md § *Home dashboard live reactivity*), (c) this static check for new-writer-introduction. The three layers together make the invariant impossible to violate quietly.

### [2026-05-04] Pattern — Shared register-X-schedule function for backfill + create-hook

When two code paths (backfill script and a route hook) both need to register the same pg-boss schedule for a system agent, extract a single `registerXSchedule(entityId)` function that owns both the `INSERT ... ON CONFLICT DO NOTHING` for the entity-agent row and the `updateSchedule` call. Duplicating logic in two writers creates divergence risk (e.g., stagger formula changes only applied in one place).

Applied in: `agentScheduleService.registerOptimiserSchedule` (Chunk 6, stream-2-optimiser-finish).

### [2026-05-04] Pattern — Materialised view emptiness signals partial-mode, not failure

When a cross-tenant aggregate materialised view is empty (e.g., on first deploy or before the nightly refresh runs), the consuming scan category should return an empty result and emit `optimiser.scan.partial` rather than throwing an error. The orchestrator continues with the other 7 categories. This avoids a "cold start" failure that would block recommendations for all categories just because the peer-baseline view has not been populated yet.

Applied in: skillLatency category, `peerMediansViewIsPopulated()` check in runOptimiserScan (stream-2-optimiser-finish).

### [2026-05-04] Pattern — median_version snapshot determinism for materialised views

When a scan reads a materialised view for baselines, read `SELECT MAX(median_version)` once before the scan loop and thread it into every JOIN as `AND view.median_version = $expectedVersion`. This guards against a concurrent REFRESH bumping the version mid-scan and producing mixed-version evidence. If no rows match after the version check, emit partial-mode — same path as empty view.

Applied in: runOptimiserScan + skillLatency query (stream-2-optimiser-finish, invariant 32).

### [2026-05-05] Gap — renderRecommendation RENDER_VERSION invalidation is a no-op

`server/services/optimiser/renderRecommendation.ts` stores `RENDER_VERSION` from `renderVersion.ts` but does NOT persist it to the DB. Bumping `RENDER_VERSION` does not auto-invalidate cached renders. To invalidate: run `UPDATE agent_recommendations SET evidence_hash = '' WHERE category LIKE 'optimiser.%'` after a prompt-template change, or add a `render_version` column (migration 0269 or later) and AND it into the cache lookup. Tracked in tasks/todo.md. Do NOT add version prefix to the stored `evidence_hash` — that column is used by `materialDelta` comparison in `agentRecommendationsService` and must remain the bare sha256.

### [2026-05-05] Gap — renderRecommendation cache lookup uses bare `db` (RLS bypass)

`renderRecommendation.ts` queries `agent_recommendations` using the raw `db` pool (no `app.organisation_id` session variable). With FORCE RLS enabled, this returns empty rows — the LLM render cache never hits. Workaround: pass an org-scoped tx handle from `runOptimiserScan` into `renderRecommendation`. An `organisationId` filter was added (2026-05-05) as defence-in-depth against cross-tenant copy leakage, but the root fix (org-scoped connection) is deferred. Tracked in tasks/todo.md.

### [2026-05-05] Bug — backfill advisory lock is session-scoped but acquired on a pool connection

`scripts/backfill-optimiser-schedules.ts` acquires `pg_try_advisory_lock` via the shared Drizzle pool. The lock is session-level and only holds for the Postgres backend that ran the `SELECT`. Subsequent `db.execute` calls may use different pool connections, so the lock provides no mutual exclusion. Use `client` (the raw postgres-js client, also exported from `server/db/index.js`) with a dedicated connection for both the lock acquisition and all subsequent queries. Pre-existing bug; not introduced by stream-2-optimiser-finish. Tracked in tasks/todo.md.

### [2026-05-03] Pattern — ChatGPT diff-misreading: grep-verify every cited line before triaging

When ChatGPT reviews a diff (especially a large one) and produces "critical" findings citing specific lines or symbols (e.g. `(updated as unknown as Record<string, string>).accessToken returns encrypted token`), do NOT pre-accept the verdict — grep the cited symbol against HEAD before triaging. Pattern observed on chatgpt-pr-review PR #254 round 1: 3 of 4 "critical" findings cited code that did not exist in the branch (hallucinated casts, false retry-policy claims, false ordering invariants), and the verified TRUE finding was already covered by an existing spec deferral. Net code-change-required from a "4 critical / 4 high-impact" review: 0 in round 1, 1 surgical observability commit in round 2 after a re-prompt asking for operational checks rather than line citations. **Rule:** every ChatGPT finding that names a file, line, symbol, or invariant gets a `grep` (or `Read`) verification round before going on the triage table. Mark verdicts FALSE and reject them when grep returns zero matches; mark verdicts TRUE and triage normally when the cited code actually exists. Without this gate the review loop wastes time chasing ghosts; with it, ChatGPT becomes a cheap second pair of eyes for behavioural review while you maintain code-truth as the source of truth. Source: chatgpt-pr-review PR #254 ghl-module-c-oauth round 1 (3-of-4 critical findings hallucinated against HEAD).

### [2026-05-03] Pattern — Observability-as-leverage: cross-provider filter field + lifecycle boundary log emits

The cheapest leverage on a multi-provider integration surface is making logs filterable. Two mechanical disciplines pay off compoundingly:

1. **Cross-provider filter field on every log site touching that surface.** For a GHL/HubSpot/Stripe-style fan-out, every `logger.info` / `logger.warn` / `logger.error` envelope carries `provider:'ghl'` (or equivalent). Operators filter `provider:ghl` once and see the whole subsystem. PR #254 added `provider:'ghl'` to 22 sites in one round-2 commit; the alternative is grepping by event-name patterns and missing the half that drift into different naming conventions over time.

2. **Explicit lifecycle-boundary emits, not "just attempt logs".** Every state-machine transition gets its own log (e.g. `ghl.token.mint`, `ghl.token.refresh`, `ghl.token.refresh_failure`, `ghl.agency_token.revoked`). Without these, the only signal during an incident is `withBackoff.attempt_failed` — a generic library log that does not say *what state the system just transitioned to*. With them, the 3 AM trace `install → mint → refresh → failure → disconnected` is a single grep instead of an inference exercise.

**Rule:** when adding any new integration / connector / external-service surface, ship the per-provider filter field AND the per-lifecycle-boundary log emits in the FIRST commit, not as a ChatGPT review-driven afterthought. The marginal cost is one helper field and N log lines; the marginal value is "operator can debug without you" the first time it breaks in production. Source: chatgpt-pr-review PR #254 ghl-module-c-oauth round 2 (added 22 `provider:` sites + 3 explicit `ghl.agency_token.{refresh,refresh_failure,revoked}` events in commit `5b6368b6`).

### [2026-05-03] Pattern — ChatGPT "ship with confidence" + "do NOT run another round" is the terminal close signal, regardless of remaining checklist size

ChatGPT review loops do not have a deterministic stop condition; the model will happily produce another checklist round if asked. The reliable terminal signal is when ChatGPT itself opens a round with both "you're basically there / ship with confidence" framing AND closes with explicit "Do NOT run another PR review loop / past diminishing returns" instruction. When both phrases co-occur, treat as CLOSED — even if the round opens with a 6-item or 7-item checklist (those checklists are operational verification items the operator runs against staging, not blockers for code change). PR #254 round 3 opened with "ship with confidence" and a 6-item checklist; treating it as a verification + cleanup pass (rather than another find-bugs round) yielded 1 surgical fix (silent-failure logs) + 1 documentation deliverable (pre-prod validation procedure) + 0 architectural changes — and respecting the close signal saved a round-4 hallucination spiral. **Rule:** detect the dual signal in the FIRST paragraph of any ChatGPT review response; when present, the next round is a cleanup pass not a triage pass, and there will be no round-after-next regardless of model output. Source: chatgpt-pr-review PR #254 ghl-module-c-oauth round 3 close.

### [2026-05-04] Pattern — Trigger-enforced caller-identity GUC for state-machine transitions

**Date:** 2026-05-04
**Source:** finalisation-coordinator finalisation pass on PR #255 (slug: agentic-commerce)

When a state-machine table has transitions that are *only* legal when invoked by a specific subsystem (e.g. "the `failed → succeeded` post-terminal override is permitted only for the Stripe webhook", "DELETE is permitted only for the retention-purge job"), enforce the caller identity at the **DB-trigger** layer rather than (or in addition to) the application layer. Pattern:

1. Define a closed enum of valid caller names: `CREATE TYPE agent_charge_transition_caller AS ENUM ('charge_router','stripe_webhook','timeout_job','worker_completion','approval_expiry_job','retention_purge')`.
2. Application sets the caller via `SET LOCAL "app.spend_caller" = '<name>'` inside the `withOrgTx` transaction, immediately before the gated UPDATE/DELETE.
3. A `BEFORE UPDATE` trigger reads `current_setting('app.spend_caller', true)` and raises an error when the transition shape requires a specific caller and the GUC value does not match.
4. The GUC is **NOT** an RLS variable — it does not appear in any policy USING clause. It is a one-shot caller-identity assertion within a transaction, separate from organisation/principal context.

Why this beats app-layer-only enforcement: application code paths multiply over time (new entry points, new resume paths, jobs running outside the canonical service). A trigger fails closed regardless of which file did the UPDATE — it cannot be bypassed by adding a new writer. The closed ENUM also prevents typo drift; an unknown caller value becomes a SQL error, not a silent permission grant. Pattern shipped on `agent_charges` (migration 0271). The codebase's existing append-only tables (`llm_requests`, `audit_events`, `mcp_tool_invocations`) all use app-layer-only enforcement; `agent_charges` is the first DB-trigger-enforced state-machine table and the template for any future financial / audit / regulated state machine where caller-identity gates transitions.

### [2026-05-04] Pattern — Webhook `connectionStatus` allowlist (NOT exclusion-list) when secret persists across state changes

**Date:** 2026-05-04
**Source:** finalisation-coordinator finalisation pass on PR #255 (slug: agentic-commerce)

When a webhook handler dispatches to per-tenant business logic gated on the parent connection's status, and the per-connection signing secret persists across state transitions (revoked, error, paused), the gate MUST be expressed as an **allowlist of permitted statuses**, not an exclusion-list of forbidden ones. The danger of an exclusion-list is silent: a future migration adds a new state value (e.g. `'suspended'`, `'pending_revoke'`, `'compromised'`); the exclusion-list does not list it; behaviour silently routes the new state to the "process normally" branch. By the time the bug is found, the new state has been processed as if active for some period.

Pattern: hard-code the closed set of statuses that are valid to process (`['active', 'connected']` for most surfaces; some integrations also accept `'pending'` for handshake flows) and reject every other value with an explicit log + 4xx response. New states default to "do not process" instead of "process". The webhook secret outliving connection lifecycle is a feature, not a bug — it lets late-arriving events from before a revoke land in a structured rejection rather than a 500 error — but combined with an exclusion-list gate it becomes a footgun.

Shipped at `server/routes/webhooks/stripeAgentWebhook.ts:155` (adversarial-reviewer Finding 2.2 fix in PR #255). Generalises to every webhook handler where the parent connection has a status field with more than two states.

### [2026-05-04] Pattern — DB-layer idempotency (partial UNIQUE + 23505 catch) beats API-layer idempotency for soft-delete-tracked uniqueness

**Date:** 2026-05-04
**Source:** finalisation-coordinator finalisation pass on PR #255 (slug: agentic-commerce)

For an "at most one active row per (parent, child)" invariant where past inactive rows are kept as audit history (soft-delete via `active=false` + `revoked_at`), DB-layer idempotency wins over service-layer idempotency:

```sql
CREATE UNIQUE INDEX <table>_active_unique
  ON <table> (parent_id, child_id) WHERE active = true;
```

Paired with a service-layer `SELECT ... WHERE active = true → INSERT → catch 23505 → re-SELECT` race-handler, the partial UNIQUE provides:

1. **Race-tight:** double-clicks, retries, and concurrent writers all land in either a successful INSERT or a 23505 caught and resolved against the existing active row. No app-layer locking required.
2. **Audit-clean:** revoked rows remain in the table with `active=false` for the full audit trail; the UNIQUE only constrains the live state.
3. **Drift-resistant:** future contributors who add a new INSERT path automatically inherit the guarantee; they cannot accidentally create a duplicate active row even if they skip the service-layer dedupe.

Shipped on `org_subaccount_channel_grants` (migration 0275, chatgpt-pr-review round 1 Finding 2 fix). Pairs with the existing KNOWLEDGE.md entry `[2026-04-25] Gotcha — Partial unique index predicate must match the upsert WHERE clause exactly` — that entry covers the maintenance discipline; this entry covers the *first decision* to use the pattern. Together they form a "use this pattern by default, here's what breaks if you don't maintain it" pair. **Rule:** for any "at most one active per (X, Y) with audit history" requirement, ship the partial UNIQUE in the same migration as the table, before the service code that depends on it.

### [2026-05-04] Pattern — Pre-insert + post-resolution-snapshot for state-machine rows that need to lock during creation

**Date:** 2026-05-04
**Source:** finalisation-coordinator finalisation pass on PR #255 (slug: agentic-commerce)

When a state-machine row's *initial* values must be derived from policy/budget/capacity data that requires advisory-lock-protected reads, two write paths exist:

1. **Read-then-insert:** Read budget/policy under lock, INSERT the row, COMMIT. Problem: the row does not exist between the read and the INSERT, so a concurrent transaction reading the same budget cannot see the in-flight reservation. Capacity overruns are possible.
2. **Insert-then-snapshot (pattern):** INSERT the row in `proposed` state with placeholder values, acquire `pg_advisory_xact_lock(budget_id)`, SELECT current capacity (which now includes this in-flight row), evaluate policy, UPDATE the row to `approved | denied | pending_approval` with the resolved snapshot of `spending_policy_id`, `policy_version`, `mode`, etc. The trigger that protects post-insert immutability of these snapshot fields carves out the `proposed → X` transition (any other UPDATE that touches the snapshot fields raises an error).

Why pattern 2 wins: capacity computation sees the in-flight row, so two concurrent proposals against the same budget serialise correctly under the advisory lock. The trigger carve-out is the cost — a single well-named exception path — and it pays for itself by making the snapshot fields immutable everywhere else. Documented as the resolution to a code-vs-trigger contradiction at `tasks/builds/agentic-commerce/spec.md §305-307`. Generalises to any state-machine row whose initial state requires lock-protected reads on related tables (budget reservations, capacity grants, queue admission, license counter consumption). **Rule:** if you find yourself reaching for "lock the parent, read capacity, insert child", invert the order — insert child in placeholder state, lock parent inside the same transaction, snapshot derived values onto the child via UPDATE before COMMIT.

### [2026-05-04] Rule — Do not introduce "future-use" schema columns without active invariants

During workflows-v1, `workflow_step_gates.superseded_by_gate_id` was introduced as a future seam (unused in V1). Review flagged it as a lifecycle inconsistency against the enforced unique index, despite no runtime usage.

**Lesson:** Unused schema fields are not neutral. They:
- Increase cognitive load during review
- Invite incorrect invariant assumptions
- Create apparent contradictions with enforced constraints

**Rule:** Only introduce schema fields when:
1. The behaviour is implemented, AND
2. The invariants governing that field are defined

If future behaviour is anticipated:
- Document it in the spec
- Add the column in the migration that introduces the behaviour

Avoid pre-emptive schema seams.

---

### 2026-05-04 Pattern — Version authority for parallel framework artefacts: source is canonical, deployment is a marker (seen 1 time)
**Date:** 2026-05-04
**Source:** finalisation-coordinator finalisation pass on PR #257 (slug: framework-standalone-repo)

When a repo carries the *source* of a framework AND a *deployment* of that same framework (e.g. `setup/portable/.claude/` is the canonical bundle that ships, while `.claude/` is the version currently deployed for THIS repo's sessions), the two `FRAMEWORK_VERSION` files do NOT have equal authority. Treating them as competing authorities produces ambiguous validation rules and forces drift-detection tooling (validate-setup, doctor) to ask "which one wins?" — a question that has no correct answer if both are framed as canonical.

**Pattern:** declare one as canonical; declare the other as a deployment marker that may lag the canonical version transiently. Drift is bounded one-way: deployment may lag canonical, never *exceed* it. validate-setup warns only on the forbidden direction (deployment > canonical), not on lag (deployment < canonical).

**Why it matters:** the parallel-artefact shape will recur every time we ship infrastructure that has a "kit" plus a "live deployment" in the same repo (frameworks, code-graph caches, capability registries that mirror to a generated file, future sync engines). Without explicit version-authority framing, every consumer downstream gets stuck in the same "which file is right?" debate. With explicit framing, the rule is short: source is canonical; deployment catches up via self-adoption.

**Applied to:** `.claude/CHANGELOG.md` § *Version authority — single source of truth* and `setup/portable/.claude/CHANGELOG.md` 2.2.0 *Notes* (the latter cross-references the former). `CLAUDE.md` § *Framework version* updated to surface the canonical-vs-deployment distinction so future sessions don't re-derive it. Future drift-detection tooling reads the file relevant to scope, not as competing authorities — "what version is *deployed* here?" → root file; "what version does the artefact *ship*?" → canonical file. Generalises to any future "source + mirror" pair this codebase introduces.

---

### 2026-05-04 Gotcha — chatgpt-pr-review can re-flag a Round-N applied fix in Round N+1 as if it never landed (seen 1 time)
**Date:** 2026-05-04
**Source:** finalisation-coordinator finalisation pass on PR #257 (slug: framework-standalone-repo)

**Distinct from existing entries.** This is NOT the same shape as the 2026-04-23 "re-raise of Round 1 *rejections*" pattern (line 338) — that's about ChatGPT re-opening items that were rejected with rationale. And it's NOT the 2026-04-28 "external-reviewer false-positive rate" pattern (line 1261) — that's about ChatGPT misreading the codebase as it stands. The new shape: ChatGPT in Round N+1 flags an item that **was actioned and committed in Round N** as if the fix never landed. Most likely cause: the diff view ChatGPT was working from in Round N+1 was stale relative to the most recent commit, or the model dropped Round-N context between turns and re-read the original PR diff.

**Concrete instance:** In PR #257 Round 2, ChatGPT listed `F4: Build script zip dependency unaddressed` as a finding. Round 1 had already added `assertZipBinaryAvailable()` preflight to `scripts/build-portable-framework.ts` (commit `5e2163ce`, lines 188–198) — verified by reading HEAD. ChatGPT was effectively working from a pre-Round-1 view.

**Rules for handling:**

1. **Verify the cited code at HEAD before triaging.** If `Read` of the file at the cited lines shows the fix is already present and the commit log shows it landed in a prior round, the finding is a false positive — do NOT re-implement.
2. **Reject as false positive with evidence in the log.** Cite the round + commit hash + file:line where the fix landed. The triage row gets `**reject** (false positive)` with a one-line note. Burning a Round N+1 noise commit to "address" an already-addressed finding is worse than the false-positive log entry.
3. **Don't extend the round to chase phantom items.** If the round produces zero net new signal once false positives are removed, that's still convergence. Close the loop on Round N+1's *real* signal; don't artificially extend rounds because half the findings were previously-addressed re-flags.

**Generalises to:** any external-reviewer loop where the reviewer threads a conversation across multiple rounds (`chatgpt-pr-review`, future ChatGPT-style spec reviewers). Less applicable to walk-away reviewers like Codex (`spec-reviewer`, `dual-reviewer`) which read current file state on each iteration.

---

### 2026-05-04 Pattern — TDD on adversarial-reviewer findings: write the failing test from the reviewer's trace before fixing (seen 1 time)
**Date:** 2026-05-04
**Source:** finalisation-coordinator finalisation pass on PR #257 (slug: framework-standalone-repo)

When `adversarial-reviewer` reports a HOLES_FOUND verdict with concrete attack traces (path-traversal payload, race-condition timing, shell-injection vector), the right execution order is **test-from-trace → fix → confirm green**, not fix-then-test or fix-without-test.

**Why this is the right order:**
1. The trace is already structured as a failing-test specification — adversarial-reviewer hands you the inputs, the expected protective behaviour, and the failure mode if absent. Skipping the test step throws away that gift.
2. A test written from the trace BEFORE the fix locks in the regression boundary. Future drift cannot silently re-open the hole — the test red-flags it on next CI run.
3. The test also validates that the trace was *real* (not a hallucinated attack). If the test passes against the unfixed code, adversarial-reviewer was wrong about the hole — surface that and re-triage. Fix-without-test means you can ship a "fix" for a hole that didn't exist.

**Applied to PR #257:** the `assertWithinRoot` defence picked up two rejection tests written directly from adversarial-reviewer's path-traversal trace; the `writeStateAtomic` PID-suffix race fix landed alongside a concurrent-write test that was red against the pre-fix code.

**When to skip:** trivial spec-deviation findings where the "trace" is just "this string is missing from the doc" — no behaviour to test. Apply selectively to *behavioural* security findings.

---

### 2026-05-04 Pattern — adversarial-reviewer escalates findings that pr-reviewer treats as nits (seen 1 time)
**Date:** 2026-05-04
**Source:** finalisation-coordinator finalisation pass on PR #257 (slug: framework-standalone-repo)

`pr-reviewer` and `adversarial-reviewer` are not interchangeable. Even when both run over the same diff, they triage the same code differently:

- `pr-reviewer` looks at code quality, correctness, maintainability — and tends to triage filesystem-writing-from-external-data items as "consider sanitising paths" (Strong, often deferred).
- `adversarial-reviewer` reads the same code as a **threat model** — and triages the same items as `HOLES_FOUND` with concrete attack traces (path-traversal payload through manifest globs, shell-metacharacter injection through `execSync`, atomic-write race collision under concurrent processes).

**Rule:** if the diff includes filesystem writes whose target paths are influenced by external data (manifest entries, glob patterns, user-supplied config, downloaded artefacts), run `adversarial-reviewer` even when not in the auto-trigger surface defined in `feature-coordinator §5.1.2`. The pr-reviewer "consider sanitising" pass is structurally insufficient for this shape — it produces gentle nits where the actual signal is "this code is exploitable."

**Generalises to:** sync engines, build scripts, asset pipelines, downloaded-artefact processors, anything that writes to `${root}/${external-data}` paths.

---

### 2026-05-04 Pattern — Defence-in-depth path-containment: assert at expand time AND at write time, never just one (seen 1 time)
**Date:** 2026-05-04
**Source:** finalisation-coordinator finalisation pass on PR #257 (slug: framework-standalone-repo)

For any module that takes a root path plus external relative-path inputs and writes files inside the root: the path-containment assertion (`resolved.startsWith(root + sep)`) MUST live in BOTH the path-expansion phase AND each writer call site. Single-site enforcement is structurally fragile.

**Why both, not one:**
- Expansion-time only: a future caller bypasses expansion (passes a pre-expanded path directly to a writer) and the assertion never fires.
- Writer-time only: every writer must remember to call the assert; one missed call site = one hole. Adversarial-reviewer found exactly this in PR #257's pre-fix sync engine.
- Both sites: the assertion is defence-in-depth — even if expand-time was bypassed by mistake, the writer catches it; even if a writer forgot the call, expand-time caught it. The redundancy is intentional.

**Applied to PR #257:** `setup/portable/sync.js` `assertWithinRoot()` is called both in `expandGlob()` (expansion phase) and at every `fs.writeFileSync` / `fs.copyFileSync` / `fs.unlinkSync` call site that takes a derived path.

**Generalises to:** any pure-function-plus-side-effect-writer pair where the pure function is "validate" and the writer is "execute." Don't trust single-site enforcement for security-critical paths. Cost is negligible (one resolved-path check); savings on a missed-bypass attack are large.

### 2026-05-04 Pattern — Two-layer event-source dedup for live-projection hooks

When a UI hook ingests events from both a WebSocket socket and an HTTP replay endpoint, replay-vs-socket overlap will duplicate events into the projection unless dedup is explicit. Pattern that survived chatgpt-pr-review:

- **Layer A (hook boundary):** `seenEventIds: Set<string>` ref, FIFO eviction at a soft cap (~2000 entries = ~15 min at typical event rates, exceeds the full-rebuild interval). Every event-application path (socket callback, full rebuild, delta reconcile) calls `noteSeen(eventId)` first; returns false if already applied. Full rebuild resets the Set alongside resetting state.
- **Layer B (pure reducer):** cursor short-circuit at the top of the reducer — `if ((event.taskSequence, event.eventSubsequence) <= (prev.lastEventSeq, prev.lastEventSubseq)) return prev`. Idempotent regardless of caller.

Either layer alone is correctness-sufficient. Together they survive (a) reducer regressions (Set still dedups), (b) Set eviction past cap (cursor still dedups), (c) socket/replay race. See `client/src/hooks/useTaskProjection.ts` + `client/src/hooks/useTaskProjectionPure.ts:30-46`.

### 2026-05-04 Gotcha — Cleanup jobs on FORCE-RLS tables MUST use withAdminConnection

A pg-boss handler that runs `db.delete(...)` directly on a FORCE-RLS table silently affects 0 rows on every tick. Background handlers run outside `withOrgTx` context — `current_setting('app.organisation_id', true)` returns an empty string — and the RLS policy's `<> ''` predicate evaluates false, making every row invisible. The DELETE succeeds with rowcount 0; nothing logs an error.

Pattern: cross-org maintenance sweeps MUST use `withAdminConnection({source, reason}, async tx => { await tx.execute(sql\`SET LOCAL ROLE admin_role\`); ... })`. Every other cleanup job (`agentRunCleanupJob`, etc.) follows this. The original `workflowDraftsCleanupJob` shipped without it and was caught by adversarial-reviewer; fixed in commit `28fb2e25`.

### 2026-05-04 Pattern — Single chokepoint for INSERT into a uniqueness-protected table

When a table has a partial unique index that maps to a typed API error (e.g. `workflow_runs_one_active_per_task_idx` → `TaskAlreadyHasActiveRunError → 409`), every INSERT path MUST go through one helper that catches SQLSTATE 23505 and translates. Direct `db.insert(table)` in service code surfaces the raw Postgres error as a 5xx.

Pattern: extract a small module like `server/services/workflowRunInsertHelper.ts` with `insertRunRowWithUniqueGuard(tx, values, taskId)`. Place it in its own file to avoid cycles between caller services. Every service that creates rows calls the helper. CI grep gate names the helper as the only allowed match.

### 2026-05-04 Gotcha — Date.now() poisons cursor-based projection delta polling

Per-task event-source projection uses `(taskSequence, eventSubsequence)` as the delta cursor — client polls `?fromSeq=N&fromSubseq=M` and the reducer advances `lastEventSeq = max(prev, taskSequence)`. If any emitter passes `Date.now()` as a placeholder for `taskSequence` (≈1.7e12), the reducer pins the cursor to that value, all subsequent delta polls return empty, and live deltas are silently dead.

Pattern: allocate `task_sequence` atomically inside the same transaction as the state change — `UPDATE tasks SET next_event_seq = next_event_seq + 1 WHERE id = $1 AND organisation_id = $2 RETURNING next_event_seq`. Never use `Date.now()` as a placeholder, even temporarily. See `server/services/taskEventService.ts:appendAndEmitTaskEvent`.

### 2026-05-04 Pattern — Server-side validation parity via shared module

Form validators live on the client for inline UX, but the client validator is NOT the contract enforcement boundary — the server is. If only the client validates, an attacker bypasses validation by hitting the API directly with malformed values.

Pattern: move the pure validator to `shared/types/<feature>ValidationPure.ts`. Client re-exports via a one-line shim from its old location (preserves call sites). Server imports the shared module directly and calls it inside the submission service before any state change. On failure throw `{statusCode: 400, message, errorCode: 'invalid_form_values', fieldErrors}`. Route surfaces `field_errors` to the client; the client renders them inline alongside its own pre-submit errors. Same pure module = no contract drift. Implemented for ask-form submission in commit `7e61f350`.

### 2026-05-04 Pattern — 404 (not 403) for cross-subaccount disclosure prevention

Routes that resolve a resource by primary ID (no `:subaccountId` path segment) cannot use `resolveSubaccount` upfront — they need to load the resource first to know the subaccount it belongs to. After loading (org-scoped), if the caller doesn't have access to the resource's subaccount, return 404 — NOT 403. A 403 confirms the resource exists, which is itself a disclosure. A 404 is indistinguishable from "resource does not exist".

Pattern: `await userCanAccessSubaccount(userId, dbRole, resource.subaccountId)` from `server/lib/userSubaccountAccess.ts`. If false, return the same 404 you'd return for "not in this org". Implemented for `workflowDrafts` route in commit `28fb2e25`.

### 2026-05-04 Gotcha — agent_execution_events.run_id NOT NULL blocks task-level event persistence

Workflows-v1's `appendAndEmitTaskEvent` is the emit path for non-agent-run-shaped task events: pause/resume/stop, gate transitions, orchestrator chat cards, milestones. None of these have an associated `agent_runs` row. The `agent_execution_events` table requires `run_id NOT NULL REFERENCES agent_runs(id)`. So persistence is impossible without a schema migration.

Today: emit is WebSocket-only — the live socket records state, but a client opening the page after an event fired sees stale projection until the next forced refresh. The replay endpoint cannot reconstruct these events.

### [2026-05-05] Pattern — System agents on a dedicated queue must be excluded from the generic schedule registrar
**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #262 (slug: stream-2-optimiser-finish)
**Pattern:** When a system agent runs on its own pg-boss queue (e.g. `optimiser-scan`) instead of the generic `agent-scheduled-run` queue, the boot-time scheduler MUST exclude that system agent from the generic registration path. `agentScheduleService.registerAllActiveSchedules` LEFT JOINs `system_agents` (or equivalent SA marker) and skips rows where the SA owns its own queue; a parallel `registerAllOptimiserSchedules` (one per dedicated-queue feature) handles boot-time self-heal for the dedicated queue. Without the exclusion, every active subaccount-agent for that SA gets registered on BOTH queues at boot, causing each scheduled run to fire twice. The self-heal path inside `registerOptimiserSchedule` MUST also do an inline DB UPDATE for the cron rather than calling the generic `updateSchedule()` which would re-register on the wrong queue.
**Why it matters:** The double-execution failure mode is silent in dev (runs are idempotent) but doubles cost, doubles LLM-render fan-out, and pollutes the recommendations table with duplicate evidence in production. The pattern generalises to any future dedicated-queue feature: when introducing a new queue for a system agent, audit the boot-time registrar in the same PR.

### [2026-05-05] Pattern — Boot-time recovery summary log carries actionable counts, not a single integer
**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #262 (slug: stream-2-optimiser-finish)
**Pattern:** When a service runs a boot-time self-heal sweep over an enabled-rows table (e.g. `registerAllOptimiserSchedules`), the summary log MUST split the total into actionable buckets — `totalEnabled`, `registered` (newly created), `skipped_duplicate` (already present), `failed` — rather than a single `Registered N optimiser schedules on startup` line. The single-integer log conflates "everything was already fine" with "we just created N rows" and hides per-row failures from the dashboard. Pattern: emit a structured `<feature>.startup.recovery_summary` event at the end of the loop, plus per-row `<feature>.schedule.{registered,skipped_duplicate}` events from the inner write path.
**Why it matters:** A boot-time sweep failing for 1 of 200 rows shows up as "registered 199" in the integer model — operationally invisible. The split-counts model exposes the failure rate as a first-class field; partial failures fire dashboards instead of disappearing into a successful-looking log line.

Required follow-up: schema migration making `agent_execution_events.run_id` nullable (or adding `workflow_run_id uuid` with at-least-one-of constraint), then plumb `persistAs: { runId, sourceService }` through `appendAndEmitTaskEvent`. Tracked in `tasks/todo.md` Tier C as deferred S1.

### 2026-05-05 Resolution — task_events table (migration 0279) closes the persistence gap above

**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #261 (slug: pre-launch-hardening)
**Resolves:** the 2026-05-04 gotcha immediately above.

Pre-launch hardening D-P0-5 sidesteps the `agent_execution_events.run_id NOT NULL` problem by writing task-shaped events to a **separate** table — `task_events` (migration 0279, FORCE RLS) — keyed `(task_id, seq)` and indexed by `(task_id, seq, created_at)`. `appendAndEmitTaskEvent` now performs the seq allocation and the durable INSERT inside the same `db.transaction()`; the WebSocket emit fires only after commit so the DB row is the source of truth. Replay endpoint can now reconstruct historical task events for clients that join late.

Trade-off accepted: two physically separate tables (`agent_execution_events` for run-scoped events, `task_events` for task-scoped events) instead of one. The original "make `run_id` nullable + add `workflow_run_id` with at-least-one-of" plan was heavier (schema migration on a hot table, validator changes, query path changes across the LiveAgentExecutionLog read path); the dedicated `task_events` table is additive and ships independently. Cross-table reads at the UI layer (per-task drilldown showing both event sources) remain a future optimisation; today the OpenTaskView only consumes the task_events stream.

### 2026-05-05 Gotcha — db.transaction() opened from module-level pool runs WITHOUT GUC; FORCE-RLS writes silently no-op

**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #261 (slug: pre-launch-hardening). Surfaced TWICE in the same branch — `taskEventService.ts` (D-P0-5) and `workflowRunPauseStopService.ts` (migrated to `getOrgScopedDb` mid-build).

The fail mode: a service imports `db` from `server/db/index.js` at module top, opens its own `await db.transaction(async (tx) => ...)`, and writes to a FORCE-RLS table. The transaction inherits no `app.organisation_id` GUC because the pooled connection was not entered via `withOrgTx` / `getOrgScopedDb`. FORCE-RLS policies fail-closed: `WITH CHECK` rejects every INSERT silently (0 rows affected, no error thrown — Postgres returns "command complete"). The read side is similarly invisible: `SELECT` returns zero rows even when rows exist.

Two ways out, used in this branch:

1. **Explicit GUC inside the tx** — first statement in the transaction is `await tx.execute(sql\`SELECT set_config('app.organisation_id', \${ctx.organisationId}, true)\`)`. The `true` third argument scopes the setting to the transaction so it does not leak back into the connection pool. Used by `taskEventService.appendAndEmitTaskEvent` (the service is fire-and-forget — its callers are not guaranteed to be inside an outer `withOrgTx`, so the service must own the GUC).
2. **Migrate to `getOrgScopedDb`** — replace the module-level `db` import with a function-scope `const db = getOrgScopedDb('serviceName')`. The wrapper requires an active `withOrgTx` ALS context and throws `failure('missing_org_context')` if absent — converts the silent fail into a loud one. Used by `workflowRunPauseStopService` (callers always pass through an authenticated route or job handler that has `withOrgTx`).

Choice rule: services on hot/authenticated paths use option 2 (loud fail catches caller misuse). Fire-and-forget / unauthenticated-path services use option 1 (the explicit GUC is the contract — there's no upstream context to inherit). The wrong combination — option 2 on a fire-and-forget caller, or option 1 inside a service that ALWAYS runs inside `withOrgTx` — produces either a hard crash on legitimate calls or duplicates the GUC unnecessarily.

Detection heuristic: grep `db\.transaction\(` in services that touch FORCE-RLS tables. Every hit must either (a) be inside `getOrgScopedDb`'s contract, or (b) issue `SELECT set_config('app.organisation_id', ...)` as the first statement. A bare `db.transaction()` on a FORCE-RLS table is the bug.

### 2026-05-05 Pattern — `app.set('trust proxy', N)` MUST be a hop count, not `true`

**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #261 (slug: pre-launch-hardening), adversarial-reviewer AR-2.1.

Express's `req.ip` derivation reads `X-Forwarded-For` from right-to-left and returns the leftmost address that is NOT a trusted proxy. The setting controls "how many hops to trust":

- `app.set('trust proxy', 1)` — trust the FIRST upstream proxy only (the one directly fronting the app). The right-most XFF address is treated as the proxy; everything to its left is taken at face value. This is what production behind a single load balancer (Replit, Render, Vercel, AWS ALB → app) needs.
- `app.set('trust proxy', true)` — trust ALL proxies in the chain. Any client can spoof `req.ip` by setting their own `X-Forwarded-For` header, because Express will walk the entire chain looking for a non-trusted address and find none. **Security regression** — rate limiters keyed on `req.ip` are now per-X-Forwarded-For-claim, not per-real-client.
- `app.set('trust proxy', false)` (default) — trust no proxies. `req.ip` is always the proxy's address. Behind a load balancer, this means every client looks like the same IP — rate limiters become global locks.

Rule for new app configs: pick the integer that matches the deployment's hop count. Never `true`. Never `false` if a load balancer is in front. Re-validate when the deployment topology changes (e.g. adding a CDN in front of the existing LB takes the count from 1 to 2). Implemented in `server/index.ts` (`isProduction → app.set('trust proxy', 1)`) per pre-launch S-P0-5 / AR-2.1.

### 2026-05-05 Gotcha — `db.execute(sql\`...\`)` returns `QueryResult`, not a bare array

**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #261 (slug: pre-launch-hardening), chatgpt-pr-review round 2 (real-bug catch in `oauthStateCleanupJob.ts`).

When using Drizzle with the node-postgres driver, `await db.execute(sql\`...\`)` returns a `QueryResult` object whose row data lives on `.rows`. Treating the return as a bare array (`result.length`, `result.map(...)`, `result[0]`) silently returns wrong values — for `RETURNING`-style DELETEs the count is consistently 0 even when rows were deleted.

The cleanup job ran for two months silently reporting `rowsDeleted: 0` because the `(result as unknown as Array<...>).length` cast compiled fine and produced a number, just always wrong. The bug was invisible until ChatGPT round 2 read the diff carefully.

Fix shape:

\`\`\`ts
const result = await db.execute<{ ok: number }>(sql\`DELETE … RETURNING 1 AS ok\`);
const rows = (result as unknown as { rows?: Array<{ ok: number }> }).rows ?? [];
return { rowsDeleted: rows.length };
\`\`\`

Detection: any service / job that uses `db.execute(sql\`...\`)` and reads `.length` or indexes into the result directly is wrong. Drizzle's typed query builder (`db.select()`, `db.delete().returning()`) returns the bare array as expected — `db.execute(sql)` is the escape hatch and carries the QueryResult shape.

### 2026-05-05 Pattern — Catch blocks around fire-and-forget enqueues must log; the enqueue itself does not

**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #261 (slug: pre-launch-hardening), chatgpt-pr-review round 2.

The pre-launch GHL onboarding migration replaced an inline call with a pg-boss enqueue (`enqueueGhlOnboarding`). Several callers wrapped the new enqueue in `try { ... } catch { /* swallow */ }` because the original inline call was best-effort and the surrounding webhook handler must always return 200. **The enqueue function itself does NOT log on internal failure** — pg-boss client errors throw raw, and the per-call context (orgId, subaccountId, webhook event id) lives only at the call site.

Rule: when a fire-and-forget enqueue is wrapped in a swallow-catch, the catch block must `logger.warn(...)` with all available context BEFORE swallowing. The job-side handler will not log this failure — it never ran. The on-call engineer needs the call-site log to even know the enqueue failed.

Wider rule: utility functions whose contract is "throw on failure" require their callers to either propagate the throw or log+swallow with full context. A bare `catch {}` on such a function is a silent-failure regression. Audit when introducing a new "thin wrapper around external system" function: the wrapper either logs internally and never throws, or it throws and forces every caller to choose. Mixed contracts ("sometimes I log, sometimes I throw") are the worst — callers can't reason about coverage.

### 2026-05-05 Gotcha — `withOrgTx({ tx: db })` in unauthenticated callbacks fakes ALS context without setting a GUC

**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #261 (slug: pre-launch-hardening), adversarial-reviewer AR-3.1 worth-confirming (deferred).

Pattern in `server/routes/oauthIntegrations.ts` (and a few other unauthenticated callback paths): `withOrgTx({ tx: db, organisationId }, async () => { ... })`. Passing the module-level `db` as `tx` makes the ALS context "look right" — `getCurrentOrgContext()` returns the orgId — but no actual GUC is bound to any DB connection. Code inside the closure that uses `getOrgScopedDb()` to get a connection will receive a connection with no `app.organisation_id` set, and FORCE-RLS writes will fail-closed silently (per the gotcha above).

Today this works in the OAuth callback because `autoEnrolAgencyLocations` opens its own per-location `db.transaction()` with explicit `SET set_config(...)`. The fragile invariant is "the closure body must never rely on inherited GUC". Any future refactor that introduces a `getOrgScopedDb()` call inside the closure will silently break.

Fix shape (deferred to Phase 2): replace `withOrgTx({ tx: db }, ...)` with `withOrgTx({ organisationId }, ...)` (no `tx` override) so the wrapper opens a real transaction and binds the GUC properly. The current `tx: db` override exists because the callers want to defer DB-pool acquisition until per-location work — a refactor to acquire connections later still works but needs explicit GUC management at each acquisition site.

Detection heuristic: grep `withOrgTx\(\{[^)]*tx:\s*db` — every hit is either a deliberate optimisation (currently 1 site in `routes/oauthIntegrations.ts`) or a misuse. Document the deliberate sites with an inline comment so future refactors don't propagate the pattern unaware.

### 2026-05-04 Correction — Riley waves ship independently

W1 shipped via PR #186 + migrations 0219-0222. W2 schema landed in migration 0230 out-of-band from `pre-launch-hardening`; W2 services / UI did not. W3 and W4 unstarted in code. Don't conflate the four waves when reading Riley docs — check migrations and `server/lib/tracing.ts` for actual state.

### 2026-05-04 Pattern — F1 Sub-Account Baseline Artefacts (migration 0277)

Migration 0277 added `memory_blocks.tier` (1=always-pinned, 2=domain-matched), `memory_blocks.applies_to_domains` (TEXT[]), and `subaccounts.baseline_artefacts_status` (versioned JSONB). Six reserved-slug artefacts are captured at onboarding via the `baseline-artefacts-capture` workflow. Tier-1 blocks prepend to the system prompt via `memoryBlockService.getTier1Blocks` (sorted by name ASC for hash-stable prefix caching). Tier-2 blocks load when `applies_to_domains @> ARRAY[agentDomain]` matches. Tier-3 lives in `workspace_memory_entries` under `domain='baseline'`.

F1 to F2 contract: `memoryBlockService.getBaselineVoiceTone(orgId, subaccountId)` returns `BaselineVoiceTone | null` (null when voice_tone artefact status is not 'completed'). F2 imports from F1 only.

JSONB shape locked by `shared/schemas/subaccount.ts:baselineArtefactsStatusSchema` with `version: 1` gate. Service code calls `assertVersionGate(raw, 1)` before mutating. Tier-1 and Tier-2 artefacts cannot be skipped. Tier-3 can be skipped with `markArtefactSkipped`. JSONB updates use atomic `jsonb_set` SQL, never JS read-modify-write.

### 2026-05-05 Pattern — Sentinel-row dependencies are validated at boot, not caught at write time

**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #264 (slug: pre-launch-phase-2), chatgpt-pr-review Round 2 Finding 1.

When code depends on a known DB row existing (e.g. the `SECURITY_AUDIT_SENTINEL_ORG_ID` org row that anchors `auth.login.failure` events when no real org is known), validate at boot — don't catch the silent FK failure at write time. The precedent is `validateEncryptionKeyOrThrow()`; the new instance is `validateSecurityAuditSentinelOrgOrThrow()`. Both run inside `server/index.ts::start()`, both throw in production, both downgrade to `console.warn` in development.

The failure mode without boot validation: the audit-write path catches the FK violation, logs it, returns. The write silently drops. The on-call engineer doesn't see the missing event until they go looking for it during an incident — by which point the original audit context (request, headers, IP) is gone. Boot validation makes the dependency visible at deploy time, when fixing it is a `psql` paste-in away.

Detection heuristic: any service that imports a DB row by hard-coded UUID — sentinel orgs, system agents, well-known principal IDs — needs a boot-time validator. Grep for `'00000000-` literals; each hit either has a validator already or needs one.

### 2026-05-05 Pattern — JWT `iat` invalidation comparisons must align both sides to whole seconds

**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #264 (slug: pre-launch-phase-2), chatgpt-pr-review Round 1 Finding 2.

JWTs encode `iat` (issued-at) as whole seconds. The natural way to invalidate a token after a state change (password changed, session revoked) is "if `passwordChangedAt > token.iat * 1000`, reject". This is wrong by ~1s on average: `passwordChangedAt` is millisecond-precision, `token.iat * 1000` is whole-second × 1000, so a token issued in the same wall-clock second as the state change is mistakenly revoked on first use.

Fix is two-sided: floor the state field at write time (`new Date(Math.floor(now.getTime() / 1000) * 1000)`) AND compare in seconds at read time (`Math.floor(passwordChangedAt.getTime() / 1000) > token.iat` — strict greater, not `>=`). Either side alone leaves the off-by-one. Apply to: password change, signup (welcome email links), invite acceptance, any future session-revocation path.

The read-side fix (`server/middleware/auth.ts`) and the write-side fix (`server/services/authService.ts::resetPassword`) ride together — neither is sufficient alone.

### 2026-05-05 Pattern — Per-route body-size caps install BEFORE the global JSON parser, not after

**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #264 (slug: pre-launch-phase-2), chatgpt-pr-review Round 1 Finding 3.

Express middleware ordering matters here. The standard setup is `app.use(express.json({ limit: '10mb' }))` early in the chain. To enforce a tighter cap on a specific route (`/api/client-errors`, audit endpoints, anything where authenticated abuse can inflate downstream layers), the path-scoped tight parser must register BEFORE the global parser:

```ts
app.use('/api/client-errors', express.json({ limit: '16kb' }));  // tight, first
app.use(express.json({ limit: '10mb' }));                          // global, second
```

Mechanism: once the tight parser populates `req._body`, the global parser short-circuits (Express `req._body` semantics — `bodyParser` skips when already set). Reverse order means the global parser fires first and accepts up to 10mb regardless of the tight registration. The tight cap returns 413 only when it runs first.

Detection heuristic: grep `app.use('/api/.*express\.json` — every hit must register BEFORE the global `app.use(express.json` call. Order is enforced by source position in `server/index.ts`, not by mount path specificity.

### 2026-05-05 Pattern — `logAndSwallow` is "don't propagate", not "don't observe"

**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #264 (slug: pre-launch-phase-2), chatgpt-pr-review Round 1 Finding 5.

The `logAndSwallow` helper in `client/src/lib/silentCatchHelper.ts` exists to keep best-effort client calls from breaking the page when they fail. The contract is "don't propagate the error to the render path", NOT "don't observe the error". Always emit `console.debug` (not gated on `NODE_ENV`) so support engineers can surface swallowed errors with devtools open. Never gate logging on environment for swallow helpers — production users won't see `console.debug` unless they explicitly enable it, but a support engineer investigating an issue can.

Wider rule: any "swallow" helper (server or client) that gates its observability on environment is a regression magnet. `console.debug` is the right level — present, but quiet by default — and the gate, if any, lives at the caller, not in the helper.

### 2026-05-05 Pattern — `leftJoin` + `isActive(table)` predicate must live in the JOIN ON clause, not the WHERE clause

**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #264 (slug: pre-launch-phase-2), chatgpt-pr-review Round 2 Finding 5 (verify-clean confirmation).

Drizzle's `leftJoin(table, condition)` preserves left-side rows even when the right side has no match. Adding a predicate on the right-side table to the `WHERE` clause silently converts LEFT semantics to INNER: rows where the right side is `NULL` (no match) are filtered out by the WHERE.

For soft-deletable tables (`agents`, `systemAgents`, `subaccounts`, etc.), the soft-delete filter (`isActive(table)` from `server/lib/queryHelpers`, or raw `isNull(table.deletedAt)`) MUST live in the join's ON clause:

```ts
// CORRECT — preserves LEFT semantics
.leftJoin(systemAgents, and(
  eq(systemAgents.id, agents.sourceTemplateId),
  isActive(systemAgents)  // here, not WHERE
))

// WRONG — silently converts to INNER
.leftJoin(systemAgents, eq(systemAgents.id, agents.sourceTemplateId))
.where(isActive(systemAgents))
```

This is now §8.27 in `DEVELOPMENT_GUIDELINES.md`. The verify-clean grep pattern: search server/ for `leftJoin` + `isActive` co-located in a `.where(...)` clause. Round 2 Finding 5 verified the only co-located instance (`subaccountAgentService.ts:522`) sits in the JOIN ON clause and is correct — but the grep is the recommended detection going forward.

### 2026-05-05 Pattern — Two-layer rate-limit key normalisation is intentional defence-in-depth, not redundant

**Date:** 2026-05-05
**Source:** finalisation-coordinator finalisation pass on PR #264 (slug: pre-launch-phase-2), chatgpt-pr-review Round 2 Finding 7 (verify-clean confirmation).

The rate-limit key construction has two normalisation layers:

1. **Call site** — `server/routes/auth.ts` lines 26 (signup), 60 (login), 131 (forgot) call `email.trim().toLowerCase()` before building the key.
2. **Key builder** — `server/lib/rateLimitKeys.ts:rateLimitKeys.authSignup` lowercases the email internally.

ChatGPT initially flagged this as redundancy. It's not — it's defence-in-depth. If a future caller forgets the call-site normalisation, the key builder still produces a normalised key. If the key-builder implementation is refactored (e.g. switched to a hash that doesn't normalise), call-site normalisation still produces case-equivalent keys. Either layer alone is one regression away from a case-sensitivity bypass (`Foo@example.com` vs `foo@example.com` getting separate buckets, doubling the abuse budget).

The pattern generalises: any "construct a key from user input" path that depends on canonical form should normalise at both the call site AND the builder, with a pure test pinning the case-equivalence invariant (`server/services/__tests__/rateLimitKeysPure.test.ts:19`). Single-layer normalisation works today but rots silently the first time someone touches either layer.

### 2026-05-05 Pattern — chatgpt-pr-review meta-level Round 1 without diff visibility

When ChatGPT is given only the GitHub PR summary (no diff), Round 1 produces a *meta-level pass*: generic recommendations about determinism, observability, idempotency, lifecycle drift — not pinpoint findings against actual code. The reviewer typically signals this themselves ("Right now this is a meta-level review… If you paste the actual code diff, I'll run a true deep pass").

Adjudication shape for these rounds: each "concern" is a verification request, not a defect claim. Treat them as `reject` with a verification-trail rationale, not as `implement` or `defer`. The session log carries the verification (e.g. "verified by partial UNIQUE index `subaccount_baselines_active_uniq` in migration 0280") rather than a code change. Round 2 onwards (with the diff bundle uploaded) sharpens to specific findings; substantive duplicates of Round 1 concerns auto-apply the prior-round decision per the duplicate-detection rule.

Worked example: `tasks/review-logs/chatgpt-pr-review-baseline-capture-2026-05-05T10-17-27Z.md` — 3 rounds, 15 rejections, 0 code changes, APPROVED verdict. Round 1 raised 6 generic concerns; Round 2 sharpened to 5 (3 new, 2 duplicates of R1); Round 3 dropped to 4 paranoia-level concerns. The verification trail in the log is the audit artifact, not the (empty) implementation diff.

### [2026-05-06] Correction — Calendar period navigation: keep nav controls inline with the period label, not clumped with view switchers

In `prototypes/consolidation-2026-05-06/calendar.html` Round 6, I placed the previous/next chevrons in the same top-right cluster as the period view selector (Week/Fortnight/Month). User flagged this as non-conventional. Standard practice (Google Calendar, Outlook, every well-designed calendar): `[Today] < period-label >` is one cluster on the LEFT inline with the calendar content, and the view switcher (Week/Fortnight/Month) is a separate cluster on the RIGHT. Period nav belongs WITH the period label it controls, not with the view selector. Lesson: when designing dense control bars, group controls by what they ACT on, not by physical proximity. View switcher acts on which view; period nav acts on the period label — different concerns, different clusters.

### [2026-05-07] Pattern — Phase-0 cross-cutting frontend-primitive specs: lock contracts at the start, not during build

**Date:** 2026-05-07
**Source:** chatgpt-spec-review on `tasks/builds/consolidation-foundation/spec.md` (3 rounds, APPROVED verdict).

When a programme decomposes into N parallel feature specs (here: A/B/C consuming the same primitives), a Phase-0 spec that ships the cross-cutting primitives MUST lock the contract surface BEFORE downstream specs draft. The natural lock surfaces, learned across this review:

1. **Sort comparator semantics** — comparator algorithm per type (`localeCompare { sensitivity: 'base' }`, numeric subtraction, NaN→string fallback), null handling (always bottom regardless of direction), mixed-type fallback rules, stability as a contract (not implementation detail).
2. **Filter identity** — deterministic key derivation (`String(getValue(row) ?? '__NULL__::${column.key}')`), with a column-scoped sentinel to avoid both real-data collision and cross-column option overlap.
3. **Persistence-key versioning** — namespaced + versioned prefix (`<scope>:v1:<key>`); component owns the version, callers pass the unversioned identifier.
4. **Overlay z-index ladder** — layer constants (Modal 1000, Drawer 900, backdrop -1, nested +10) so stacking is predictable.
5. **Scroll-lock ownership** — mount-counter + deferred restore so closing one of two stacked overlays does not leak `overflow: auto` while the other is still mounted.
6. **Hook-owned illegal-transition handling** — when N consumers would each implement the same edge case (e.g. `setViewMode('workspace')` with no active client), the hook returns `boolean` + an optional callback (`onRequireClientSelection`); consumers do not detect rejection by reading state.
7. **Spacing contract at the page-shell level** — `<PageShell bottomPadding={N}>` instead of relying on per-page bottom-padding comments; the primitive that USES the contract (FormFooter) does NOT inject its own spacer.

**The shape of a good Phase-0 review:** ChatGPT round 1 surfaced 9 of these 7 surfaces; rounds 2-3 tightened the rest (NaN guard, sentinel collision, padding default, persistence versioning, sort stability, scroll-lock ownership). Each round was APPROVED with tightenings — meaning every surface was a real ambiguity, not a stylistic preference. **If a Phase-0 spec for cross-cutting primitives does not surface findings on these areas, the review is not done.**

### [2026-05-07] Pattern — Versioned localStorage key prefix for component-owned persistence

**Date:** 2026-05-07
**Source:** Same review session, finding F18 (round 3).

Format: `<scope>:v<N>:<key>` (e.g. `table:v1:spending-ledger`). The version segment is owned by the component, not the caller. Callers pass an unversioned, unscoped identifier; the component prepends both. When the persisted shape (e.g. sort tuple, filter selections, column-key set) changes incompatibly, bump `v1` → `v2`; the old keys become absent rather than corrupted state. Zero migration cost; zero risk of de-serialisation crashes when an old client meets a new schema.

The pattern generalises to any component that owns localStorage state with a non-trivial shape: list-view toggles, column-visibility prefs, collapsed-section state, draft autosave. Without versioning, the first incompatible shape change either corrupts state silently or forces consumer migrations.

### [2026-05-07] Pattern — Hook-owned illegal-transition handling instead of consumer-side guards

**Date:** 2026-05-07
**Source:** Same review session, finding F3 (round 1) + F15 (round 2).

When a state-transition hook serves multiple consumers, illegal-transition handling MUST live in the hook, not in each consumer. Shape: `setViewMode(next): boolean` returns `true`/`false` for the transition outcome, with an optional `onRequireClientSelection` callback (configured at hook construction) invoked for the specific failure case (`'workspace'` with no `activeClient`). The hook also publishes a locked side-effect table (`'org'` clears `activeClient`; `'system'` enables override flag; etc.) as a refactor invariant.

Before: each of three consumers (Layout, sidebar, badge) would implement the same "no active client → open picker" branch. After: one consumer (Layout) wires `onRequireClientSelection`; the others consume `setViewMode` and react to the boolean. The pattern prevents 3 divergent implementations and centralises the rule for future maintainers.

Generalises to any state-transition hook with N>1 consumers: workspace switching, mode switches, draft saves with conflict resolution, optimistic-update rollbacks. The signal that you need it: when the same edge-case branch starts appearing in multiple consumers, the hook is the right owner.

### 2026-05-05 Pattern — Branded type with single-constructor invariant beats grep gates for input-normalisation enforcement

**Date:** 2026-05-05
**Source:** chatgpt-spec-review pre-launch-phase-3-deferred-backlog rounds 1-3 (NormalisedEmail brand pattern).

When a function depends on a string being in a normalised form (lowercase, trimmed, hashed, sanitised), the canonical enforcement is **a branded type constructed by exactly one function**, NOT a grep gate that scans for normalisation calls.

Pattern shape (TypeScript):

```typescript
// In server/lib/<helper>.ts — the ONLY constructor
export type NormalisedEmail = string & { readonly __brand: 'NormalisedEmail' };
export function normaliseEmail(input: string): NormalisedEmail {
  return input.trim().toLowerCase() as NormalisedEmail;
}

// In any consumer
export function loginEmailOnlyKey(email: NormalisedEmail): string { ... }
```

Three rules make the brand load-bearing:

1. **Type is structurally unconstructable from raw `string`** — the `readonly __brand` intersection means TypeScript treats the type as nominal-flavoured.
2. **Exactly one exporter** — the single constructor is the only legitimate path; any helper that accepts the branded type must take it as input, not produce it.
3. **Consumer signatures take the branded type, never raw string** — the type system rejects raw-string callers at the helper signature.

The single escape hatch is the `as NormalisedEmail` cast. A grep gate scoped to "find this exact cast pattern outside the constructor file" is a cheap supplement to the type system — not the primary control. Data-flow tracing approaches are explicitly **rejected**: static grep cannot reliably trace value flow across a typed module boundary, and false negatives compound silently as the codebase grows.

**Where it generalises.** Any normalisation gate where the cost of forgetting to normalise is silent correctness drift: rate-limit keys (case-sensitivity bypass), URL/slug builders (path injection), sanitised user input (XSS surface), hashed identifiers (lookup miss). The pattern is heavier than a grep gate AND more robust — pick it whenever the consumer set is more than one or two callers.

**Anti-pattern.** Two exporters of the branded type (e.g. `normaliseEmail` AND `lowercaseEmail` both returning `NormalisedEmail`). The second exporter defeats the single-constructor invariant — adding it should be a blocking PR finding, not a nit.

### 2026-05-05 Pattern — Factory const-object as the ONLY source for closed string-enum values

**Date:** 2026-05-05
**Source:** chatgpt-spec-review pre-launch-phase-3-deferred-backlog rounds 1-3 (auditEvent factory).

When a closed set of string values represents a domain enum (event names, action types, error codes, audit categories), prefer a **factory const-object** as the sole source of values, with the discriminated union derived from it via `typeof`. Do NOT export the union directly without a factory.

Pattern shape (TypeScript):

```typescript
// In shared/types/<domain>.ts
export const auditEvent = {
  auth: { loginFailed: 'auth.login_failed', loginSucceeded: 'auth.login_succeeded' },
  oauth: { stateExpired: 'oauth.state_expired', stateConsumed: 'oauth.state_consumed' },
  security: { crossTenantAttempt: 'security.cross_tenant_attempt' },
} as const;

type Namespace = keyof typeof auditEvent;
type Event<N extends Namespace> = typeof auditEvent[N][keyof typeof auditEvent[N]];
export type SecurityAuditEventName = { [N in Namespace]: Event<N> }[Namespace];

// In any producer
recordSecurityEvent(auditEvent.auth.loginFailed, ...);  // ONLY way
```

Three properties make this beat a raw union:

1. **Producer ergonomics** — `auditEvent.auth.loginFailed` is autocomplete-friendly and structurally namespaced; raw `'auth.login_failed'` invites typos.
2. **Bypass-cast detection is grep-able to a single token** — `as SecurityAuditEventName` becomes the one and only escape hatch; grep `as <UnionTypeName>` and fail on hits.
3. **Per-event metadata is a property, not a parallel registry** — extending the factory entry to `{ name: '...', severity: '...' }` keeps name + classification co-located. Severity (or any classifier) is bound at declaration site, NOT at the call site — the recordEvent type signature reads metadata from the factory entry, callers cannot override.

**Where it applies.** Any closed enum of string values used at write/emit time where (a) producers should not write raw literals and (b) downstream consumers may need per-value metadata for routing/alerting/severity tiering. Telemetry events, audit events, action types in command buses, error code registries, status enums.

**Anti-pattern.** Define the union directly (`type EventName = 'a' | 'b' | 'c'`) and rely on a grep gate to forbid raw literals. The grep gate is a backstop; the structural source must be the factory. A grep-only enforcement decays the moment a developer writes `'a' as EventName` to silence a type error — the cast bypasses both the union and the grep.

### 2026-05-05 Pattern — Single-writer pg-boss job: connection-scoped singletonKey + cursor in payload

**Date:** 2026-05-05
**Source:** chatgpt-spec-review pre-launch-phase-3-deferred-backlog round 1 finding F2 + round 2 finding F1 (GHL pagination).

For any pg-boss job that processes a paginated upstream (cursor-based API, batched DB scan, multi-page external resource) and re-enqueues itself for the next page, the singleton key MUST be scoped to the **resource being mutated**, NOT to the page cursor. The cursor lives in the job payload.

```typescript
await pgboss.send('ghl:auto-enrol-locations-page', {
  connectionId, runId, pageCursor, pageIndex
}, {
  singletonKey: `ghl-enrol:${connectionId}`,  // resource-scoped
});
```

Why cursor-scoped is wrong: two jobs with different cursors slip past the singleton check and run concurrently against the same resource. If the upstream API's pagination is non-stable (same item appears across two pages due to a write between requests), both jobs do work for the overlapping item. DB constraints handle the data correctness via ON CONFLICT, but progress-event emission becomes non-deterministic — duplicate "enrolled X" events from two writers. Observability silently degrades.

Connection-scoped singleton + cursor-in-payload gives:

- **True single-writer per resource** — at most one job per connection runs at any moment, regardless of which page.
- **Crash recovery is intentional** — if a worker crashes mid-page, the next worker picks up the chain via re-enqueue (or fresh dispatch) and resumes from `pageCursor` in payload with the SAME `runId`. Per-item idempotency (DB partial-unique constraint with ON CONFLICT DO NOTHING) backstops correctness.
- **runId is the chain identifier** — globally unique (`crypto.randomUUID()`), preserved across re-enqueues, NEVER reused on operator-driven re-trigger.

**Where it applies.** Any job pattern where (a) the work is paginated, (b) processing-per-item must be idempotent, and (c) you care about deterministic observability events. Webhook back-pressure handlers, full-table scans, large-list syncs, multi-page enrolment flows.

**Anti-pattern.** `singletonKey: \`ghl-enrol:${connectionId}:${pageCursor}\`` — looks safer (stronger key) but lets concurrent cursors race on the same resource. The cursor is a position in a sequence, not an identifier — it doesn't belong in a uniqueness key.

### 2026-05-05 Pattern — Three-state job chain: terminal vs non-terminal checkpoint

**Date:** 2026-05-05
**Source:** chatgpt-spec-review pre-launch-phase-3-deferred-backlog rounds 2-3 (GHL pagination state machine).

A long-running job that may legitimately stop short of completion (cap reached, operator wants to resume later, scheduled boundary) needs a **third closing state** that is chain-closing but NOT terminal. Forcing every closing event to be `completed | failed` mis-classifies safety aborts as failures and inflates failure rates in post-launch monitoring.

The three-state model:

| State | Closes the chain? | Counted as success? | Counted as failure? | Resumable? |
|-------|-------------------|---------------------|---------------------|------------|
| `completed` | yes (terminal) | yes | no | no — fresh chain only |
| `failed` | yes (terminal) | no | yes | no — fresh chain only |
| `partial` | yes (checkpoint) | no | no | yes — fresh chain with new chain identifier |

Critical invariants:

1. **Terminal exclusivity AND chain-closure.** Once any of the three closing events fires for a `(resource, chainId)`, NO further events of any type may emit. Late retries are dropped at the handler. Per-item idempotency (DB constraint) is the correctness backstop; the explicit handler-level drop is the contract.
2. **`partial` is chain-closing.** A chain that emits `partial` cannot be resumed in-place — the chain ends at the checkpoint. Resumption requires a fresh chain with a new chain identifier; the resume-trigger preserves the cursor (or other progress state) but mints a new `runId`.
3. **`failed` is reserved for unrecoverable errors.** Auth-token revoked, API 5xx beyond retry budget, schema constraint violations not absorbed by ON CONFLICT. Safety aborts (page-cap reached, scheduled-stop window hit) emit `partial`, NEVER `failed`.

**Where it applies.** Any job where the three categories — succeeded fully / failed fatally / stopped at a safe checkpoint — are operationally distinct. Pagination jobs with caps, batched migrations with maintenance windows, scheduled-pause sync jobs, multi-step workflows with operator-controlled gates.

**Anti-pattern.** Re-using `failed` for both unrecoverable errors AND safety aborts. Post-launch dashboards show "failure rate spike" and waste investigation cycles on what was actually a deliberate cap. Or worse: the team starts ignoring "failure" alerts because so many are noise, and a real failure goes unnoticed.

### 2026-05-05 Pattern — Audit logs are observational, not causal: chain identifiers are the only ordering source

**Date:** 2026-05-05
**Source:** chatgpt-spec-review pre-launch-phase-3-deferred-backlog rounds 2-4 (audit causality posture).

A multi-writer append-only audit table (`security_audit_events`, `agent_execution_events`, anything `INSERT`-only with a `created_at` timestamp) is **NOT a source of truth for causality**. Two complementary directives are required to prevent future misuse:

**Negative directive (forbid the misuse):** consumers MUST NOT infer "X happened before Y" from `created_at` timestamps across concurrent writers. Cross-writer same-millisecond ordering is undefined; clock skew between hosts compounds it; `ORDER BY created_at DESC` is a display convention, not a serialisability guarantee.

**Positive directive (prescribe the alternative):** consumers requiring causal ordering MUST use explicit chain identifiers carried in the event `context` payload — `runId`, `connectionId`, transactional lock keys, FK relationships. Every event that participates in a multi-step flow MUST carry the chain identifier in `context`. Dashboards, alerting rules, and post-mortem queries query by chain identifier first, use timestamps only for display ordering within a chain.

**Append-only is absolute.** Rows in the audit table MUST NEVER be UPDATEd or DELETEd post-insertion. Corrections, retractions, and amendments insert a NEW event with `context.supersedes = '<original_event_id>'`; the original row stays as-is. Forensic and observability integrity depend on this — any future feature proposing UPDATE/DELETE on the audit table is a blocking finding requiring a spec amendment.

**Why both directives matter.** Without the positive directive, consumers default to the most natural query (`ORDER BY created_at DESC`) and silently produce wrong causality. Without the negative directive, future maintainers add a "fix" that uses timestamps + a tiebreaker and feel they've solved the problem. Without immutability, retention/cleanup features quietly destroy forensic capability.

**Where it applies.** Any append-only event stream consumed by dashboards or post-mortems. Distinguish from transactional logs (which DO carry happens-before via the lock manager) and trace systems (which carry causality via parent-span IDs). Audit logs sit between — observable but not causal — and the documentation must say so explicitly.

### 2026-05-05 Pattern — chatgpt-spec-review terminal round produces zero findings; that IS the closure signal

**Date:** 2026-05-05
**Source:** chatgpt-spec-review pre-launch-phase-3-deferred-backlog round 5 (terminal zero-findings round).

A multi-round chatgpt-spec-review converges when ChatGPT produces a round with no actionable findings AND an explicit "FINAL" or "BUILD WITH CONFIDENCE" verdict. The zero-findings round is not a wasted iteration — it is the closure signal that confirms the spec is locked.

Operational shape:

- **Round N-1 verdict:** "APPROVED — BUILD WITH CONFIDENCE" or equivalent, with optional micro-tightenings.
- **Round N (terminal):** ChatGPT produces zero findings, explicit "FINAL" verdict, optional non-actionable observation about post-launch evolution (e.g. "you'll likely derive a chain summary; not a spec change").
- **Operator instruction:** "lock down" / "finalise" / "done" — finalisation triggers.

The terminal round IS logged with full session-log structure (raw response, decisions table — empty, integrity-check — n/a, summary). Skipping the log for "no findings" loses the convergence signal; future audit queries can't tell whether the spec ran 4 rounds and stopped or 5 rounds and converged.

**Heuristic for declaring convergence early.** If round N produces only "nice-to-have" findings already labelled optional by the reviewer, AND the verdict has stabilised at APPROVED for two consecutive rounds, AND the operator has signalled finalisation intent, run the zero-findings validation round explicitly to confirm. This prevents premature finalisation on a spec that has lurking issues the reviewer hasn't surfaced yet.

**Anti-pattern.** Treating a terminal zero-findings round as "wasted" and skipping it. The convergence signal is the audit artifact — without it, the spec's "ready to build" status is operator assertion, not reviewer-confirmed.

### D.6 advisory-lock scope (2026-05-06)

`pg_try_advisory_xact_lock` in `workflowEngineService.ts` `tick()` is NOT in the same transaction as `pgboss.send()`. The lock runs in auto-commit mode via `db.execute` (no wrapping `db.transaction`), so it releases at statement end — it does NOT span the full tick() handler. `pgboss.send()` runs on a separate auto-commit connection. Contention detection still works (two concurrent handlers racing on the same runId will observe `got=false`), but there is no serialisation gate. A full fix (wrapping tick() in a single `db.transaction`) is deferred — tracked in `tasks/todo.md` under `## Deferred`. AR-3.1 noted in-situ in the source file.

### [2026-05-06] Gotcha — GHL subaccount INSERTs that omit `external_id_namespace` bypass the partial unique index entirely

Migration 0285 added a partial unique index on `subaccounts` scoped to `WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL`. The index only covers rows where both predicates are true. An INSERT that writes a row without `external_id_namespace` (leaving it NULL) satisfies neither predicate — the index is never consulted, and the ON CONFLICT clause that references it never fires.

**Practical failure mode:** `ghlAgencyOauthService.ts` (inline enrol path) and `ghlWebhookMutationsService.ts` (`location_create` branch) originally omitted `external_id_namespace` from their INSERT column lists. Re-running either path with the same GHL location ID silently created duplicate subaccount rows instead of hitting the ON CONFLICT DO UPDATE path. The deduplication guarantee was completely inactive for these two paths despite the migration having run.

**Fix:** add `external_id_namespace: 'ghl_location'` to both the INSERT VALUES list and the ON CONFLICT target:
```sql
INSERT INTO subaccounts (
  id, organisation_id, name, slug, status,
  connector_config_id, external_id, external_id_namespace, created_at, updated_at
) VALUES (...)
ON CONFLICT (organisation_id, external_id)
  WHERE external_id_namespace = 'ghl_location' AND deleted_at IS NULL
DO UPDATE SET name = EXCLUDED.name, updated_at = now()
```

**Detection rule:** any INSERT into a table with a partial unique index should include every column in the index predicate in the INSERT column list. An INSERT that omits a predicate column silently prevents the index from enforcing the invariant. Grep for `INSERT INTO subaccounts` in any new writer; confirm `external_id_namespace` is present.

### [2026-05-06] Pattern — Migration RAISE EXCEPTION safety checks must be scoped to the rows the migration targets

A `DO $$ ... IF remaining > 0 THEN RAISE EXCEPTION ...; END IF; $$` block in a migration is a pre-flight guard that aborts deployment if the preceding data migration (backfill) left any rows in a bad state. These blocks fail correctly only if the `WHERE` clause in the `SELECT COUNT(*)` is scoped to the exact set of rows the migration actually touched.

**Failure mode:** migration 0285 originally used `WHERE external_id IS NOT NULL AND external_id_namespace IS NULL` to verify the GHL backfill. On any database with manually-created subaccounts, subaccounts from disconnected connectors, or future non-GHL subaccounts that have `external_id` set but no `external_id_namespace`, the guard fires on rows the migration never touched and never intended to fix — causing `RAISE EXCEPTION 'backfill incomplete'` for state that is entirely expected and correct.

**Fix:** add `AND connector_config_id IN (SELECT id FROM connector_configs WHERE connector_type = 'ghl')` to scope the check to GHL-linked rows only:
```sql
SELECT COUNT(*) INTO remaining
  FROM subaccounts
 WHERE external_id IS NOT NULL
   AND external_id_namespace IS NULL
   AND connector_config_id IN (
     SELECT id FROM connector_configs WHERE connector_type = 'ghl'
   );
```

**Rule:** for any migration `RAISE EXCEPTION` safety check, derive the WHERE predicate from the UPDATE/backfill statement in the same migration — not from a general "this column should be set" condition. The check certifies that THIS migration's work is complete; broader conditions produce false-positive failures on rows outside the migration's scope.

### E.5 setOrgGUC — canonical replacement for the withOrgTx({tx:db}) anti-pattern (2026-05-06)

**Date:** 2026-05-06
**Source:** pre-launch-phase-3-deferred-backlog Chunk E, adversarial-reviewer AR-3.1 residue.

`server/lib/orgScoping.ts` exports `setOrgGUC(tx: OrgScopedTx, orgId: string): Promise<void>`. This is the canonical way to set the per-transaction organisation_id GUC for code that must open its own `db.transaction()` block outside the request middleware path (background jobs, unauthenticated callbacks, maintenance scripts).

Usage pattern:
```typescript
await db.transaction(async (tx) => {
  await setOrgGUC(tx, orgId);
  // ... rest of the transaction body
});
```

This replaces the `withOrgTx({ tx: db, organisationId }, ...)` anti-pattern (passing the module-level `db` connection as `tx`). The anti-pattern fakes ALS context without binding a GUC to any real DB connection — code inside the closure that calls `getOrgScopedDb()` receives a connection with no `app.organisation_id` set, and FORCE-RLS writes fail silently. The correct pattern either (a) uses `setOrgGUC` inside a real `db.transaction()` block, or (b) uses the standard `withOrgTx({ tx, organisationId, ... })` pattern where `tx` is the Drizzle transaction handle from an enclosing `db.transaction()` call.

### Closed-enum string-grep gates need a dedicated dynamic-construction pass

**Date:** 2026-05-06
**Source:** finalisation-coordinator finalisation pass on PR #267 (slug: pre-launch-phase-3-deferred-backlog), chatgpt-pr-review round 1.

When a closed-enum string set is enforced by a grep gate (e.g. "no raw `eventType: 'auth.x'` literals outside the factory"), three classes of bypass exist:

1. **Raw literal at call site** — `eventType: 'auth.loginFailed'` — caught by a literal-string grep.
2. **Type-cast bypass** — `eventType: rawString as SecurityAuditEventName` — caught by a separate cast-pattern grep.
3. **Dynamic construction** — `eventType: \`auth.${suffix}\`` (template literal) or `eventType: 'auth.' + suffix` (string concat) — NOT caught by either of the above, because no fixed substring matches the closed-enum pattern.

A robust grep gate must include a dedicated pass for class 3. Pattern shape:

- Pass 4a: flag template-literal `eventType:` in single-line call expressions — match `eventType:\s*\`` followed by `\${`.
- Pass 4b: flag string-concat `eventType:` — match `eventType:.*\+` where the right operand is non-literal.

Pair the gate with a deliberately-bad fixture per pass to prove the gate trips. The TypeScript type system (closed-enum union derived from a const-object factory) remains the canonical defence; class 3 is the residual escape hatch when a developer side-steps `auditEvent.x.y` syntax. The grep gate is defence in depth.

**Where it generalises.** Any closed-string-set grep gate (audit events, action types, error codes, RLS policy names, capability slugs). If your gate only checks raw literals + casts, expect a dynamic-construction bypass to land within the first few PRs after the gate ships.

**Anti-pattern.** Trusting a single-pass grep ("no literal X anywhere") to enforce a closed enum. The bypass cost is one keystroke (`'` → `` ` ``); the detection cost is one extra pattern in the gate.

### The "indirect constant aliasing" bypass class is doc-only enforcement, not grep-detectable

**Date:** 2026-05-06
**Source:** finalisation-coordinator finalisation pass on PR #267 (slug: pre-launch-phase-3-deferred-backlog), chatgpt-pr-review round 2.

For closed-enum factories (e.g. `auditEvent.auth.loginFailed`), a fourth bypass class beyond raw-literal, cast, and dynamic-construction exists: **indirect aliasing**.

```typescript
// All grep gates pass; type system passes; the call site reads "clean".
const e = auditEvent.auth.loginFailed;
void recordSecurityEvent({ event: e, ... });
```

The aliased variable carries no semantic signal that grep can latch onto. A grep gate would have to perform local data-flow analysis to prove `e` originated from the factory, which is beyond the contract of a one-line grep gate. The type system already accepts this: `e` is `SecurityAuditEventName`, the call site is type-correct.

**Enforcement is doc-only**, surfaced at:

- `architecture.md § Layer 4 — Security audit stream` — one-line agent-facing rule per CLAUDE.md §13.
- `docs/security-audit-namespace.md § Indirect constant aliasing is a blocking finding` — fuller explanation with worked anti-pattern.
- Code review and ChatGPT PR review treat indirect aliasing as a blocking finding.

**Where it generalises.** Any closed-enum factory where the call-site convention is "use member access". The same class will appear with `errorCode`, action types, capability slugs. Three rules carry the load instead of grep:

1. Type system rejects the worse cases (raw literal, cast).
2. Grep covers the moderate cases (raw-literal slip, cast bypass, dynamic construction).
3. Convention + code review covers the residual aliasing class — it cannot be automated reliably.

Don't over-engineer a grep gate to chase aliasing. Document, review, and accept that the type system + grep gates already shut down the worse-cost bypass classes. Rejecting an alias at PR review is cheap; building a static-analysis tool to catch them is not.

### [2026-05-06] Correction — Synthetos is not agency-only; sub-account is a standalone product surface
When framing product strategy or recommendations, do not default to "agency operator looking down at clients." The three-tier structure (system / org / sub-account) is deliberate: a sub-account can be sold standalone to an end-client (SMB, solo operator) with no agency above them, and the product must self-contain at that level. Agency-resold sub-accounts are one go-to-market, not the only one. When discussing operator-facing surfaces (Pulse, supervision home, watchers, proactive nudges, calibration), cover both lenses: (a) the agency operator managing many sub-accounts and (b) the end operator running their own business directly inside one sub-account. The video's "my mom" archetype maps to lens (b), not (a).


### [2026-05-07] Spec authoring — cursor pagination contract (4 invariants every paginated API spec must state) (seen 2 times)

When speccing a cursor-paginated endpoint, always state four things explicitly or ChatGPT/reviewers will flag it:

1. **Encoding:** cursor encodes `(sortKeyValue, id)` in the **effective sort order** (see #4) — the id tiebreaker makes ordering deterministic. SQL: `ORDER BY <sortKey> <dir>, id <dir>`.
2. **Invalidation:** cursor is invalidated when `sortKey`, `sortDir`, or any filter changes between pages. Server ignores/resets on mismatch.
3. **Stability:** every sort order must include `id` as a secondary key (prevents row flickering across pages).
4. **Tiebreaker direction symmetry:** the `id` tiebreaker direction MUST follow the primary sort direction (`ORDER BY confidence ASC, id ASC` — never `ASC, id DESC`). Mixing directions produces skip/duplicate rows when paginating ASC. (Added in consolidation-govern round 2 — round 1 spec said "always end with id DESC" which was wrong for ASC sorts.)

Missing any one of these causes non-deterministic pagination (duplicate rows or skipped rows under concurrent writes, sort/filter changes, or ASC overrides).

### [2026-05-07] Spec authoring — filterOptions count semantics (faceted search rule) (seen 2 times)

For APIs that return `filterOptions` alongside paginated results: always state that counts are computed against the **full result set** (current scope + q), **ignoring pagination**, but **respecting active filters except the dimension being counted**. This is the standard "faceted search" rule. Without it, a user filtering by `type=email.sent` would see 0 counts on the `type` dimension — which is misleading.

Two operational invariants to add (consolidation-govern rounds 2 + 3):

- **Same-snapshot:** counts MUST be computed from the same base-query snapshot as the row results (single SQL statement / CTE) so counts and rows cannot diverge under concurrent writes.
- **SQL ordering:** sort `filterOptions` (typically `count DESC, value ASC`) in SQL, not via post-query JavaScript. Same-snapshot ordering avoids drift if the route ever splits the query and JS orders separately.

### [2026-05-07] Spec authoring — masking/redaction token contract

When speccing role-aware masking on a backend projection:

1. Lock the exact redaction token as a string constant: `"<redacted>"` — never `null`, never omit the field.
2. Truncated fields (e.g. first 200 chars of a result body) must include `truncated: true` so the renderer knows without inspecting string length.
3. These two rules prevent frontend branching creep (renderer never needs to branch on field presence or null-check mask values).

### [2026-05-07] Spec authoring — per-user localStorage key scoping

When a dismissal/seen flag is stored in localStorage (e.g. `somethingSeen=1`), add a userId prefix: `somethingSeen:{userId}`. Without it, the flag is shared across users in a shared-browser environment (kiosk, shared login), silently suppressing the UI for subsequent users.

### [2026-05-07] Gotcha — PostgreSQL `READ COMMITTED` snapshot is **per-statement**, not transaction-scoped

Common mis-citation in specs and code: "we use a single transaction so counts are snapshot-consistent under READ COMMITTED". Wrong. PostgreSQL's `READ COMMITTED` (the default) takes a fresh snapshot at the start of each statement — multiple statements in the same transaction can each see a different snapshot if other writers commit between them. Transaction-scoped snapshot consistency requires `REPEATABLE READ` (or `SERIALIZABLE`).

Practical rule for cross-table aggregators that want mutual count consistency:

- **Preferred:** issue a single SQL statement (a CTE that joins / unions the sources). Default `READ COMMITTED` is sufficient because the per-statement snapshot covers all sources in one shot.
- **Acceptable:** if multiple statements are required, escalate isolation to `REPEATABLE READ` and accept the extra overhead (no concurrent updates can change the view between statements).
- **Wrong:** "use a transaction with READ COMMITTED" — provides no extra consistency over not-using-a-transaction.

Caught in consolidation-govern round 2 — round 1 wording mis-cited READ COMMITTED as transaction-scoped.

### [2026-05-07] Spec authoring — external-call timeout determinism (3 invariants)

When a backend route makes an outbound network call with a stated timeout, the spec MUST lock three things or implementations will silently honour the timeout symbolically while violating it operationally:

1. **Monotonic clock:** measure the budget against a monotonic clock (`process.hrtime.bigint()` in Node) — never wall clock. NTP jumps and clock skew must NOT extend or shorten the window.
2. **Inclusive scope:** the clock starts immediately before the outbound call — DNS, TCP, TLS, and HTTP all count against the budget, not just the HTTP response wait.
3. **Bounded SDK retries:** any HTTP client, OAuth SDK, or provider SDK on the call path MUST disable internal retries (or bound them within the same envelope). A 10s spec-stated timeout that hides 60s of internal SDK retry storms violates the contract while technically "respecting" it.

Caught in consolidation-govern round 2 (connection-test endpoint).

### [2026-05-07] Spec authoring — body hash canonicalisation must include Unicode NFC

When using a body hash for idempotency keys (`UNIQUE(parent_id, body_hash)`), canonicalise in this order before hashing:

1. **Unicode NFC normalisation** — visually-identical strings can have different byte representations (composed vs decomposed accents, ligatures). Without NFC, a user pasting the same text from two sources can produce two different hashes.
2. Whitespace canonicalisation: trim ends, collapse internal runs to single spaces.
3. Decide and document case-sensitivity (case-sensitive for human-authored override text in our spec; case-insensitive for canonical identifiers).
4. Hash function: SHA-256, hex-encoded, lower-case (deterministic encoding).

Skipping NFC produces long-tail duplicate revision bugs that are nearly impossible to reproduce. Caught in consolidation-govern round 2.

### [2026-05-07] Pattern — Drawer / Modal focus-trap escape recovery

**Date:** 2026-05-07
**Source:** finalisation-coordinator finalisation pass on PR #270 (slug: consolidation-foundation), chatgpt-pr-review Round 1 finding F1.
**Pattern:** A standard Tab-cycle focus trap (first ↔ last focusable inside the panel) handles the "Tab past last" and "Shift+Tab before first" cases — but it misses the case where focus has already escaped the panel entirely (devtools, programmatic focus calls into a different region, browser chrome handing focus back to the document body). On the next Tab inside the panel handler, `document.activeElement` is neither the first nor the last focusable, so the standard branches do not match and the trap is a no-op. Add a guard before the first/last comparisons: if `document.activeElement` is not contained in the panel ref, pull focus back to the first focusable. Three-line addition; closes the only realistic escape route.
**Why it matters:** Accessibility-grade overlay components are expected to keep keyboard focus inside the overlay until it closes. The "trap" is incomplete without the escape-recovery branch — and the failure is invisible in normal manual testing because escape requires a side-channel focus shift.

### [2026-05-07] Pattern — Visibility helper: `offsetWidth || offsetHeight || getClientRects().length`, not `offsetParent !== null`

**Date:** 2026-05-07
**Source:** Same review session, chatgpt-pr-review Round 1 finding F2.
**Pattern:** When determining "is this element visible enough to receive focus" inside a focus-trap or any DOM walker that filters out hidden nodes, do NOT use `offsetParent !== null`. That predicate returns `null` for any `position: fixed` element regardless of visibility — meaning fixed-position focusable elements (sticky toolbars inside drawers, floating action buttons) are silently excluded from the trap and the visible-focusables walker. Use the jQuery-style `el.offsetWidth || el.offsetHeight || el.getClientRects().length > 0` instead — visible iff any of width/height/client-rect exists. Standard a11y-library shape.
**Why it matters:** Common a11y trap. Modal/Drawer code that uses `offsetParent` will skip fixed-position children, so Tab order silently drops them and screen-reader walks of "focusable elements in this region" exclude them. The bug surfaces only when fixed-position content is added inside an overlay months after the trap shipped.

### [2026-05-07] Pattern — Shared CSS keyframes belong in `index.css`, not inline `<style>` blocks per component instance

**Date:** 2026-05-07
**Source:** Same review session, chatgpt-pr-review Round 1 finding F3 (also flagged by pr-reviewer N3).
**Pattern:** When a component injects its own animation via `<style>{`@keyframes drawer-fade-in {...}`}</style>` inside its render output, every mounted instance writes a duplicate `<style>` element into `<head>` (or inline). For an overlay primitive that may render multiple times across a page (open/close cycles, unmounted-then-remounted nested overlays), this leaks duplicate keyframe definitions and pays parse cost on every render. Move shared keyframes to `client/src/index.css` once, reference by name from the component. Trade-off: the keyframe name becomes a global contract, so prefix it with the owning-primitive name (`drawer-fade-in`, `drawer-slide-in-right`) to prevent cross-component collisions.
**Why it matters:** DOM hygiene. The pattern is invisible in dev — animations work fine — but `<head>` accumulates `<style>` duplicates over a long-running session. Lighthouse a11y/CSS audits flag it; production performance audits flag it.

### [2026-05-07] Pattern — `import.meta.env.DEV` for Vite client code (NOT `process.env.NODE_ENV`); requires `client/src/vite-env.d.ts`

**Date:** 2026-05-07
**Source:** Same review session, chatgpt-pr-review Round 1 finding F4.
**Pattern:** Inside any code that ships through Vite to the browser bundle, gate dev-only branches with `import.meta.env.DEV` (boolean, true in dev / false in production). Do NOT use `process.env.NODE_ENV === 'development'` — `process` is a Node.js global, not present in the browser, and Vite doesn't shim it; the comparison silently returns `false` in production AND in dev (because `process.env.NODE_ENV` is `undefined`), so the dev-only branch never fires. For TypeScript to resolve `import.meta.env`, the project must include a triple-slash reference: create `client/src/vite-env.d.ts` containing `/// <reference types="vite/client" />`. One-time setup; thereafter every `.tsx`/`.ts` file in `client/src` resolves the type without further imports.
**Why it matters:** Dev-only code paths (extra logging, prop-validation warnings, "this should never happen" assertions, error-state stack traces) are a primary debugging surface. If they silently never fire because the gate is `process.env.NODE_ENV`-shaped, you ship blind. The fix is mechanical, but the verification — actually confirm the dev branch fires in dev and is dead-code-eliminated in production — is not, so it usually slips past.

### [2026-05-07] Pattern — `aria-labelledby` + `useId` for dialog/drawer accessible names when a visible title exists

**Date:** 2026-05-07
**Source:** Same review session, chatgpt-pr-review Round 1 finding F5.
**Pattern:** When an overlay (Modal, Drawer) renders a visible title, the accessible name should come from `aria-labelledby={titleId}` (pointing at the rendered heading), NOT a hand-typed `aria-label="Drawer"`. Screen readers announce the actual visible heading rather than a generic role. Generate the id with React's `useId()` so it's stable across renders and unique per instance. Fall back to `aria-label` only when no visible title is rendered. Apply both attributes pattern: `{title ? { 'aria-labelledby': titleId } : { 'aria-label': fallback }}`.
**Why it matters:** WCAG 2.1 AA expects the accessible name to match the visible label when one exists. A static `aria-label="Drawer"` overrides the visible heading for screen-reader users — they hear "Drawer" instead of "Edit Client" — and fails name-from-content auditing.

### [2026-05-07] Pattern — Document JS-engine assumptions when pure helpers depend on ES spec guarantees

**Date:** 2026-05-07
**Source:** Same review session, chatgpt-pr-review Round 1 finding F7.
**Pattern:** When a pure helper relies on a JS-engine guarantee that is technically a runtime-environment assumption (e.g. `Array.prototype.sort` is stable per ES2019+, all modern engines comply), document it in the file-level JSDoc as a "Runtime invariant" paragraph. Note the assumption (stable sort), the path forward if the helper is ever ported to a non-compliant engine (add an explicit insertion-index tiebreaker to the comparator), and the pure tests that pin the invariant. Tests alone do NOT communicate the assumption to the next author — the JSDoc does.
**Why it matters:** Stability of sort is an unspoken default assumption. A future port to a constrained runtime (an embedded engine, a polyfilled environment, an old node target) will silently violate the assumption — sort still works, but tiebreaker order changes, and any consumer relying on insertion order for equal keys gets nondeterministic UI. The JSDoc is the only place this assumption surfaces in time to prevent the regression.

### [2026-05-07] Pattern — Reference-counted scroll-lock singleton with `Symbol.for(...)` HMR-safe key

**Date:** 2026-05-07
**Source:** Same finalisation pass — design pattern from build (chunks involving Modal + Drawer overlay coordination, encoded in `client/src/components/overlayScrollLock.ts`).
**Pattern:** When two overlay primitives (Modal, Drawer) both want to lock body scroll while open, naive per-component `useEffect(() => { document.body.style.overflow = 'hidden'; return () => { ... = ''; } }, [open])` produces a leak: closing one overlay restores `overflow: ''` even though the other is still mounted. Solution: a reference-counted singleton helper (`acquireScrollLock()` / `releaseScrollLock()`) that increments a shared mount counter and only restores the original `overflow` value when the counter returns to zero. The original value is captured on first acquire (deferred restore). To survive HMR (hot module reload during dev — multiple module copies attaching their own counter), key the singleton with `Symbol.for('app.overlay.scroll-lock')` on `globalThis` so all module copies converge on the same counter object.
**Why it matters:** Cross-overlay scroll-state coordination is a well-known overlay-system trap. The reference count handles concurrent stacked overlays (Modal opens, then Drawer opens on top, then Modal closes underneath — body must stay locked). The `Symbol.for` key handles HMR. Without both, dev shows phantom scroll-restore mid-flow that production never reproduces (or vice-versa, depending on which copy wins).

### [2026-05-07] Pattern — Branded route-pattern type with `buildRoute` regex using negative lookahead `(?![A-Za-z0-9_])`

**Date:** 2026-05-07
**Source:** Same finalisation pass — design pattern in `client/src/config/routes.ts`.
**Pattern:** Centralise app-route patterns in a literal-tuple constant (`APP_ROUTE_PATTERNS = ['/agents/:id', '/agents/:idFoo/edit', ...] as const`), brand the resulting union type as `AppRoute`, and provide `buildRoute(pattern: AppRoute, params: Record<string, string>)` and `staticRoute(pattern: AppRoute)` helpers. Inside `buildRoute`, replace `:name` placeholders using a regex with a negative lookahead: `new RegExp(\`:\${param}(?![A-Za-z0-9_])\`, 'g')` — NOT `:${param}`. Without the lookahead, `:id` matches inside `:idFoo` and corrupts unrelated placeholders. The negative-lookahead version requires the placeholder to be terminated by a non-identifier character (a slash, end-of-string, etc.).
**Why it matters:** Hand-rolled string substitution for path params is a recurring source of silent corruption. The brand type prevents path strings from leaking into `<Link to="...">` / `useNavigate(...)` outside the registry; the lookahead-regex prevents the substitution itself from corrupting prefix-overlap cases. The bug surfaces months after deployment when someone adds a new param like `:idType` next to existing `:id`.

### [2026-05-07] Pattern — Co-locate React-wrapper component with pure-helper module; test the pure half via `npx tsx`

**Date:** 2026-05-07
**Source:** Same finalisation pass — design pattern from `SortableTable.tsx` + `sortableTablePure.ts` (and `useViewMode.ts` + `useViewModePure.ts`).
**Pattern:** When a UI primitive contains non-trivial logic (sorting, filtering, mode-derivation, transition rules), split into two files: `Foo.tsx` (the React wrapper — hooks, state, event handlers, render) and `fooPure.ts` (the deterministic helpers — sort comparators, filter predicates, derivation rules, transition guards). The pure module exports plain functions with explicit input/output types and zero React dependency. Tests live next to the pure module under `__tests__/fooPure.test.ts` using the existing convention: `npx tsx <test-path>` runs them in isolation, no test runner setup, fast feedback. The React wrapper's behaviour is verified by integration of the pure module's contract — the wrapper itself does not need its own unit suite if the pure module is fully covered.
**Why it matters:** UI logic is normally locked behind component-render machinery and is hard to test deterministically. The split moves the testable surface out from under React, eliminates jsdom setup, runs in milliseconds, and produces a stable contract surface that downstream specs (Specs A/B/C consuming the same primitives) can rely on without rebuilding test infrastructure. Locks in the existing repo convention (`*Pure.ts` + `*Pure.test.ts` as the unit-test surface).

### [2026-05-07] Gotcha — `agentTriggers` has no `agentId` FK; triggers are scoped through `subaccountAgents`

**Date:** 2026-05-07
**Source:** Consolidation-build C11 doc-sync pass.
`GET /api/agents/:id/full` (in `server/routes/agents/agentTabs.ts`) joins through `subaccountAgents` to get agent-scoped triggers — NOT through a direct `agentId` on `agentTriggers`. The `agentTriggers` table does not have an `agentId` foreign key; trigger rows are linked to a sub-account agent via the `subaccountAgents.agentId` join. Any query that tries to filter `agentTriggers` directly by `agentId` will return nothing silently.

### [2026-05-07] Gotcha — `AgentFull.budget` fields are Phase 1 placeholders; writes accepted but not persisted

**Date:** 2026-05-07
**Source:** Consolidation-build C11 doc-sync pass.
`AgentFull.budget` (`dailyCapUsd`, `monthlyCapUsd`, `warnThresholdPct`) are always null/zero. The `spendingBudgets` table is for agentic commerce spend (external transactions), NOT for LLM cost caps. Budget cap fields on agents have no backing schema yet — writes to the budget tab in `AgentEditPage` are accepted by the server but not persisted. This is an explicit Phase 2 deferral. Do not build features that assume these fields are live without first checking whether the backing schema has landed.

### [2026-05-07] Gotcha — `WRITE_ORDER` in `AgentEditPage` intentionally excludes `schedule` and `budget` tabs

**Date:** 2026-05-07
**Source:** Consolidation-build C11 doc-sync pass.
`AgentEditPage.tsx` defines a `WRITE_ORDER` constant that controls which tabs participate in ETag-gated saves. The `schedule` and `budget` tabs are excluded from this list. Trigger editing is done via the existing per-workspace override page (not consolidated into `AgentEditPage`). Budget caps have no backing schema yet. A future developer who sees the missing tabs should consult the ADR `docs/decisions/0007-consolidation-build-page-retirement.md` before assuming the omission is a bug.

### [2026-05-07] Gotcha — `startRunAsync` in `agentExecutionService.ts` uses bare fire-and-forget (non-durable)

**Date:** 2026-05-07
**Source:** Consolidation-build C11 doc-sync pass.
`startRunAsync` is a fire-and-forget invocation — if the process crashes after the call site returns but before the run completes, the run is not recovered. This is a known PLAN_GAP documented in `tasks/builds/consolidation-build/migration-gaps.md`. Do not rely on this path for durable task execution. The durable path is through the pg-boss job queue.

### [2026-05-07] Gotcha — `formatFireCondition` in `recurringTasksServicePure.ts` handles a subset of the RRULE spec

**Date:** 2026-05-07
**Source:** Consolidation-build C11 doc-sync pass.
`formatFireCondition` parses FREQ, BYDAY, BYMONTHDAY, and INTERVAL from RRULE strings and returns a human-readable label. Any RRULE pattern using other components (BYSETPOS, BYHOUR, COUNT, UNTIL, WKST, etc.) falls back to returning the literal RRULE string unchanged. This is intentional for Phase 1 — do not add a full RRULE parser unless the product requirement explicitly calls for it.

### [2026-05-07] Gotcha — `PUT /api/agents/:id/triggers` rejects added triggers with 501 in Phase 1

**Date:** 2026-05-07
**Source:** Consolidation-build dual-reviewer Codex finding F4.
`agentService.replaceTriggers` accepts updates and soft-deletes of existing triggers but throws `{ statusCode: 501, errorCode: 'TRIGGER_ADD_NOT_SUPPORTED' }` if any new triggers are in the diff. Reason: triggers are subaccount-scoped (`subaccountAgentId` FK, not `agentId`) so an org-level insert via this route would be orphaned — the row would not appear in `getFull` (which filters by `subaccountAgentId`) and would not fire (the trigger service fires by `subaccountId`). The new tab-scoped UI Schedule tab is `readOnly={true}` in Phase 1 and `WRITE_ORDER` excludes `'schedule'`, so no caller exercises this path today. Phase 2 should resolve a default `subaccountAgentId` (e.g. via the org subaccount) and remove the 501 guard. See `tasks/builds/consolidation-build/migration-gaps.md` § "Triggers schema — no direct agentId column".

### [2026-05-08] Pattern — Legacy route telemetry and deprecation tracking

**Date:** 2026-05-08
**Source:** Consolidation-build Round 2 ChatGPT tightening (task 4).
Legacy routes from the pre-consolidation UI (`/admin/agents`, `/admin/skills`, `/admin/skill-studio`, `/system/skill-analyser`, etc.) are consolidated into `/agents`, `/recurring-tasks`, and `/projects`. Today, client-side `<Navigate>` components in `client/src/App.tsx:401-511` redirect old bookmarks silently. Future telemetry: add a middleware or custom Navigate wrapper to emit structured logs with `sourceRoute`, `destinationRoute`, `userAgent`, and `timestamp`. Monitor redirect volumes in logs; after traffic drops below a threshold for N days, routes can be retired entirely. See `docs/doc-sync.md` § Legacy Route Deprecation for the tracking process. (Phase 1: redirects active, no telemetry. Phase 2: add telemetry emit. Phase 3+: retire routes.)

### [2026-05-08] Pattern — Skill Studio iframe recursion protection pattern

**Date:** 2026-05-08
**Source:** Consolidation-build Round 2 ChatGPT tightening (task 7).
Skill Studio is no longer embedded as an iframe in the consolidation-build UI. If a future phase embeds Skill Studio (or similar recursive-openable components), apply the `embedded` prop pattern: pages accept an optional `embedded?: boolean` prop; when true, suppress recursive-open affordances (e.g., "Edit in modal", "Open in new window", "Open Skill Studio"). Example in existing codebase: `client/src/pages/AdminBoardConfigPage.tsx` and `AdminCategoriesPage.tsx` check `!embedded` before rendering navigation affordances. Pattern: wrap recursive-open buttons in `{!embedded && (<button>...</button>)}`. (Phase 1: SkillsTab uses a modal picker, not an embedded Skill Studio, so no protection needed yet. Phase 2+: if embedding is added, apply this pattern.)

### [2026-05-08] Pattern — Closed-enum service-boundary mapping for typed error.code contracts

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #273 (slug: consolidation-govern); pr-reviewer blocker B-1 (testConnection error.code widening).

When a route returns a typed error.code field whose contract is a tight closed enum (e.g. spec defines `error.code: 'TIMEOUT' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'PROVIDER_ERROR'`), the service that produces the value MUST map every internal error state — including the catch-all/unknown branch — to one of the four codes at the boundary. SDK-level error codes (`NO_CREDENTIALS`, `TOKEN_EXPIRED`, `SERVER_ERROR`, raw axios codes, etc.) MUST NOT leak into the contract value. The mapper lives in the service (e.g. `connectionTokenService.testConnection`), not in the route handler — so every caller of the service gets the same canonical mapping, and the contract is enforced at one location. Concrete shape:

```ts
// In connectionTokenService.testConnection
function mapErrorToCode(err: unknown): 'TIMEOUT' | 'AUTH_FAILED' | 'NETWORK_ERROR' | 'PROVIDER_ERROR' {
  if (isAbortOrTimeout(err)) return 'TIMEOUT';
  if (isAuthFailed(err))     return 'AUTH_FAILED';
  if (isNetworkErr(err))     return 'NETWORK_ERROR';
  return 'PROVIDER_ERROR'; // catch-all — every unmapped class lands here
}
```

Why it matters: the contract enum is a public commitment to the client. If the service leaks new SDK codes the moment a new SDK is added, every consumer's exhaustive switch silently breaks. Pair this rule with §8.30 in DEVELOPMENT_GUIDELINES.md (SQL CASE enum mappers use `ELSE NULL`) — same family of failure mode (unknown values silently coerced past the safety guarantee), same family of fix (force the mapping at the typed boundary, fail-closed on unknown).

### [2026-05-08] Pattern — Targeted `onConflictDoNothing(target)` for partial-unique idempotency

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #273 (slug: consolidation-govern); pr-reviewer strong-recommendation 2 (overrideEntry onConflictDoNothing scope).

`onConflictDoNothing()` without a `target:` argument silently swallows ANY unique-constraint violation on the row, including constraints unrelated to the idempotency key. For body-hash idempotency on `memory_block_versions` (partial unique on `(memory_block_id, body_hash) WHERE body_hash IS NOT NULL`), the correct shape is:

```ts
.onConflictDoNothing({ target: [memoryBlockVersions.memoryBlockId, memoryBlockVersions.bodyHash] })
```

Untargeted `.onConflictDoNothing()` would also swallow a hypothetical version-counter collision (if the schema gained one), letting the buggy state persist silently. Targeted form ensures unrelated constraint violations bubble as errors so the caller can retry. Rule: any `onConflictDoNothing` MUST name the column set whose conflict is the intended dedupe key. A bare `.onConflictDoNothing()` is a code-review blocker.

### [2026-05-08] Pattern — Migration-number collision after S2 sync requires renaming on the feature branch

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #273 (slug: consolidation-govern); main landed `0286_consolidation_build_schema_additions` while `ui-consolidation-govern` was authoring `0286_govern_auto_update_disabled`.

When the S2 sync surfaces a migration-number collision (same number, different content on both sides of the merge base), the feature branch renames its migration to the next free integer. Renaming is correct because main's migration has already shipped to production (or imminently will via the merge that's already on main); the feature branch is the side that hasn't shipped yet. The rename also cascades to:

1. The migration file itself (header comment + filename)
2. The down-migration file
3. `architecture.md` § Key files per domain (any row referencing the migration filename)
4. NOT plan.md — historical artefact, leave the original number for archaeology

Verification after rename: `grep -rn '<old-number>_<slug>' .` should return only `tasks/builds/*/plan.md` historical references and zero hits in source / docs / migrations. Down migration MUST also be renamed in lockstep so the rollback path tracks the forward path.

### [2026-05-08] Pattern — App.tsx route-handler regression after upstream page deletions during S2 sync

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #273 (slug: consolidation-govern); G4 regression guard caught 10 missing identifiers after S2 merged `consolidation-build` (PR #271) and `operate-stream` (PR #272) which deleted `AdminAgentsPage`, `AdminAgentEditPage`, `AdminSkillsPage`, `AdminSkillEditPage`, `SystemAgentsPage`, `GoalsPage`, `SkillStudioPage`, `SkillAnalyzerPage`, `ScheduledTasksPage`.

When a parallel branch lands a UI consolidation that deletes pages, the feature branch's `client/src/App.tsx` will compile-fail post-S2 because the JSX route declarations still reference the deleted page identifiers — even after the lazy-import lines are dropped (which TypeScript checks at routine compile time). The fix pattern: for each broken route, replace the JSX element with either:

- `<Navigate to="<canonical-new-path>" replace />` — for direct redirect of the old path
- a small redirect helper (`function RedirectAgentEdit() { const { id } = useParams(); return <Navigate to={\`/agents/${id}/edit\`} replace />; }`) — for parameterised redirects where the path segment must be reshaped
- the new page component, registered under the new canonical route — for the canonical destination itself

Always cross-check against the consolidating branch's App.tsx (`git show origin/main:client/src/App.tsx`) for the canonical mapping; do not invent route names. After the rewrite, also remove any duplicate redirect elsewhere in the file (e.g. an old `<Route path="/agents" element={<Navigate to="/" />} />` that conflicts with the new canonical `<Route path="/agents" element={<AgentsListPage />} />`).

### [2026-05-08] Pattern — Coordinators run INLINE in the main session, never dispatched as sub-agents

**Date:** 2026-05-08
**Source:** Phase 2 launch attempt for `trust-verification-layer` build. Operator typed `launch feature coordinator`; main session called `Agent({subagent_type: "feature-coordinator", ...})`; the dispatched coordinator immediately hit `No such tool available: Task. Task is not available inside subagents.` when it tried to invoke `architect` at Step 3. Same constraint applies to `spec-coordinator` (mockup-designer + spec-reviewer + chatgpt-spec-review dispatches) and `finalisation-coordinator` (chatgpt-pr-review + builder dispatches).

**Pattern:** the three coordinators (`spec-coordinator`, `feature-coordinator`, `finalisation-coordinator`) and `audit-runner` run INLINE in the main Claude Code session. The operator's entry phrase (`launch feature coordinator`, `launch finalisation`, `spec-coordinator: <brief>`, `audit-runner: <mode>`) signals the main session to ADOPT the playbook — read the agent file at `.claude/agents/<name>.md` and execute its steps directly. It does NOT mean call `Agent({subagent_type: "<coordinator>"})`.

**Why this matters:** the Claude Code runtime returns a hard error when a dispatched sub-agent attempts to dispatch a further sub-agent. The coordinator playbooks are built around sub-agent dispatch (architect, builder, the four reviewers, mockup-designer, chatgpt-pr-review, chatgpt-spec-review). Nesting a coordinator inside an `Agent` call breaks the pipeline at its first dispatch step. The main session has top-level `Agent` access — that's where the dispatches must issue from.

**Two valid entry paths:**
1. Fresh session: open a new Claude Code session, type the entry phrase as the first message, the main session adopts the playbook.
2. In-flight adoption: operator types the entry phrase mid-session, the current main session reads the agent file and follows it directly. Same outcome.

The agent definitions at `.claude/agents/feature-coordinator.md`, `.claude/agents/spec-coordinator.md`, and `.claude/agents/finalisation-coordinator.md` each carry an `## Invocation` section with this rule. CLAUDE.md's "Common invocations" section codifies the constraint for all four (three coordinators + audit-runner).

### [2026-05-08] Pattern — Cross-tenant source-pill compression rule

**Date:** 2026-05-08
**Source:** Trust & Verification Layer spec §6.8, Chunk 7.

Scorecard source pills compress based on the viewer's scope, not the scorecard's scope. `compressSourcePill(scope, viewerScope)` returns five canonical values: `system`, `organisation`, `this_subaccount`, `platform`, `custom`. The rule: `subaccount`-scoped scorecards always show `this_subaccount`; `system`-scoped show `system` to org_admins and `platform` to workspace viewers; `org`-scoped show `organisation` to org_admins and `custom` to workspace viewers. This compression prevents org-name leakage to subaccount-scope viewers. Pure function in `scorecardServicePure.ts`; mirrored in `ScorecardSourcePill.tsx` for client-side rendering without a round-trip. Permutation test in `server/services/__tests__/scorecardServicePure.test.ts` covers all four `(scope, viewerScope)` combinations.

### [2026-05-08] Pattern — Three-tier authority lock model for scorecards

**Date:** 2026-05-08
**Source:** Trust & Verification Layer spec §6.4, Chunk 7.

Scorecard authority resolves in three tiers: system > org > subaccount. When an agent has two attachments for the same scorecard slug — one from a higher tier and one from a lower tier — `resolveAuthority(attachments)` always picks the higher-tier source. Attachments at the same tier conflict only if the same org/subaccount owns two rows for the same slug; that is a data invariant violation, not a normal state. The resolver is a pure function in `scorecardServicePure.ts`, never hits the DB. Any route that surfaces "which scorecard is active" must pass the full attachment list through the resolver before responding.

### [2026-05-08] Pattern — Single-share-toggle visibility primitive

**Date:** 2026-05-08
**Source:** Trust & Verification Layer spec §6.3, Chunk 7.

Scorecard visibility is controlled by a single `isShared` boolean. `isShared: true` makes the scorecard visible to all subaccounts under the owning org. `isShared: false` (default) makes it visible only to the owning org admins and the subaccount that created it. There is no per-subaccount sharing list, no ACL, no role-based filter — just one toggle. This keeps the permission surface minimal. Route-level visibility is enforced by `getVisibleScorecards(organisationId, subaccountId?)` in `scorecardService.ts`, which applies the `isShared` predicate in SQL rather than in application code.

### [2026-05-08] Pattern — Idempotent UPSERT on operator correction capture

**Date:** 2026-05-08
**Source:** Trust & Verification Layer spec §10.1, Chunk 13.

Correction capture uses `onConflictDoUpdate` with a partial unique index target: `(organisation_id, source_run_id) WHERE captured_via = 'operator_correction' AND deleted_at IS NULL`. This means the operator can correct the same run multiple times and each subsequent correction silently updates the existing block (last-write-wins) rather than inserting a duplicate. The `targetWhere` clause in the Drizzle `onConflictDoUpdate` maps to the partial index predicate. Without `targetWhere`, Drizzle cannot locate the partial index and the UPSERT falls through to an error. Always specify both `target` columns and `targetWhere` when the conflict target is a partial index.

### [2026-05-08] Pattern — Runtime check three-state UI collapsed from five internal states

**Date:** 2026-05-08
**Source:** Trust & Verification Layer spec §6.2, Chunk 5.

Internally, runtime check results carry five states: `pending`, `running`, `pass`, `fail`, `inconclusive`. The UI collapses these to three visual groups: loading (pending + running), pass, not-pass (fail + inconclusive). `inconclusive` is surfaced distinctly from `fail` in the drawer detail — `fail` means the check fired and found a problem; `inconclusive` means the check could not determine a verdict (e.g. model output was ambiguous or the check function threw). Never merge `fail` and `inconclusive` at the data layer — they carry different operator actions. Merge only at the UI summary level, and always expose both labels in the detail view.

### [2026-05-08] Pattern — `verify` shape on actionService-wrapped skills always evaluates inconclusive

**Date:** 2026-05-08
**Source:** Trust & Verification Layer fix-loop, Codex P1 finding.

`runtimeCheckService.dispatchEvaluation` reads the tool result's top-level `statusCode` / `status` field. Skills that go through `proposeAction` / `executeWithActionAudit` (review-gated AND most auto-gated skills) return the action service envelope `{ status: 'pending_approval' | 'approved' | 'completed', actionId, ... }` — `status` is a STRING, not a numeric HTTP status. So `verify: { kind: 'api_status_2xx' }` declared on these skills will resolve to `inconclusive` every time. With `blastRadius: 'external'` that maps to the same pause/inbox path as `fail` per spec §11.2 — every successful action would pause for inbox review.

**Rule:** before declaring a concrete `verify` shape on an `ACTION_REGISTRY` entry, trace the actual handler path. If the handler routes through `executeWithActionAudit` or any other action service wrapper, declare `verify: null` with a justification ("Review-gated: HITL approval is the verification boundary; actionService wrapper has no comparable post-check shape" or "External read — backfill candidate; current actionService wrapper hides the inner field from the runtime-check dispatcher"). A future follow-on can teach the runtime-check dispatcher to unwrap the actionService envelope before evaluation.

### [2026-05-08] Pattern — Position-match against agent_execution_events.sequence_number is wrong for toolCallsLog

**Date:** 2026-05-08
**Source:** Trust & Verification Layer fix-loop, Codex P2 finding.

`runAgenticLoop` pushes one entry to `toolCallsLog` per tool dispatch, but does NOT emit `skill.invoked` / `skill.completed` events for every tool call. Those event types are emitted only by special paths (`crmQueryPlanner.plannerEvents`, `chargeRouterService`). A naive position-match — Nth toolCall ↔ Nth skill.completed event ordered by `sequence_number` — produces two failure modes: (a) ordinary tool calls resolve to `null` (they have no matching event), and (b) when special-path events DO exist, an event from one slug may be attached to a tool call from a different slug.

**Rule:** when reconciling toolCallsLog entries to event-log rows, match by `(skillSlug, ordinal-within-slug)`, not by global position. Group events by `payload.skillSlug` and pair the Nth toolCall whose `tool === foo` with the Nth `skill.completed` event whose `payload.skillSlug === foo`. Tool calls without matching events resolve to `null` cleanly. See `linkToolCallsToEventIds` in `server/services/agentRunMessageServicePure.ts`.

### [2026-05-08] Pattern — Cross-subaccount IDOR slips past RLS in agent-scoped routes

**Date:** 2026-05-08
**Source:** Trust & Verification Layer adversarial-review S-3.

Subaccount-scoped routes that carry both `:subaccountId` and `:agentId` in the URL (e.g. `DELETE /api/subaccounts/:subaccountId/agents/:agentId/scorecards/:id`) are protected by RLS at the org level but NOT at the subaccount level — RLS on the writes-target table (`scorecards`, `agents`, etc.) filters rows to the caller's org via `app.organisation_id`, but does not enforce that the named agent belongs to the named subaccount. A power user with `subaccount.X.manage` on subaccount A could target an agent in subaccount B (same org) and the route would proceed.

**Rule:** for any subaccount-scoped route that carries both `:subaccountId` AND a target-resource id (`:agentId`, `:templateId`, etc.), add an explicit application-layer assertion that the resource has an active link to the named subaccount via `subaccount_agents` (or the relevant join table). Fail-403 not 404 — 404 leaks the resource's existence in another subaccount; 403 is the standard cross-tenant rejection envelope. Pure verdict-shaping helper (`assertAgentSubaccountMembership`) keeps the route → HTTP mapping testable.

### [2026-05-08] Pattern — Workers that opt out of `createWorker` auto-org-tx must wrap FORCE-RLS reads in a short org-scoped tx before any external I/O

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); dual-reviewer iter 1 (3 P1 fixes in `documentChunkEmbedJob`, `documentReembedJob`, `documentPromotionFinaliseJob`).

When a pg-boss handler is built with `createWorker({ resolveOrgContext: () => null, ... })` (because the spec mandates the embedding API call run OUTSIDE any DB tx, e.g. spec §1.5 #9 in auto-knowledge-retrieval), it explicitly opts OUT of the auto-org-tx wrapper. Any `db.select(...)` against a FORCE-RLS table that the worker issues at module-top scope will then run with no `app.organisation_id` GUC — and FORCE-RLS policies that require `current_setting('app.organisation_id', true) <> ''` return **zero rows silently**. The worker then short-circuits with a `version_not_found` warn or similar, and the job is dead in the water for that document forever.

**Pattern:** for workers that opt out of auto-org-tx, every FORCE-RLS read MUST be inside a short org-scoped read tx that explicitly sets the GUC, BEFORE the I/O the spec wants to keep tx-free:

```ts
const { row } = await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('app.organisation_id', ${organisationId}, true)`);
  const [row] = await tx.select(...).from(forceRlsTable).where(...);
  return { row };
});
// embedding API call / external I/O happens HERE, outside any tx.
```

Combine multiple back-to-back FORCE-RLS reads into one tx where possible — they share the same GUC scope and a single tx is cheaper than multiple short ones. Spec invariants like "embedding API call runs outside any DB tx" are PRESERVED because the read tx ends before the I/O starts.

**Detection heuristic.** Grep the worker for `db.select(` / `db.transaction(` and confirm: (a) the file contains `resolveOrgContext: () => null`, AND (b) every read against a FORCE-RLS table is inside a tx that issues `set_config('app.organisation_id', ...)` as the first statement. If a worker has (a) but a read fails (b), it is the bug. The adversarial-reviewer's "Additional observations" section may flag this without routing it as a tracked finding — promote to a fix anyway.

This is a stricter form of the existing 2026-05-04 (cleanup jobs need `withAdminConnection`) and 2026-05-05 (`db.transaction()` must set the GUC) patterns. The new wrinkle: workers can legitimately opt out of `withOrgTx` (because the spec mandates I/O outside tx), but that opt-out CANNOT extend to reads against FORCE-RLS tables — those still need their own short-lived org-scoped tx.

### [2026-05-08] Pattern — Embedding inputs must NEVER be silently truncated — log when they are

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); pr-reviewer Strong-1 (8192 magic-number truncation in `documentEmbeddingService.embedChunks`).

Embedding services frequently apply a per-call byte cap to avoid provider 4xx errors (OpenAI text-embedding-3 at 8192 tokens, ~32k chars worst case, but the input cap can be set lower for cost). When the chunker produces semantically-coherent chunks but a non-Latin / sentence-resistant chunk hits the byte-window fallback path and exceeds the cap, the embedding represents only the first N chars while the chunk row persists FULL content. Result: vector search returns the chunk's truncated-text similarity, the agent loads the full chunk, and operators have no signal that retrieval quality has silently regressed.

**Pattern:** every embedding-input cap must (a) live as an exported constant (`EMBEDDING_INPUT_BYTE_LIMIT = 8192` etc.), NOT a magic number, AND (b) emit a structured `logger.warn('document.embed.input_truncated', { chunkIndex, originalLength, truncatedLength, embeddingModel })` on every truncation event. Without the log, the regression is invisible. With it, ops can dashboard `truncation_rate_per_org` and tune chunk size before quality degrades.

**Detection heuristic.** Grep `\.slice\(0, \d+\)` and `\.substring\(0, \d+\)` inside any service that emits an embedding call. Every hit is a candidate truncation site — if no `logger.warn` fires alongside, route it as a Strong recommendation.

This generalises beyond embeddings: the same pattern applies to summary inputs, search-query truncation, ranker payloads. Silent truncation is always a quality regression hiding in the metrics.

### [2026-05-08] Pattern — Pure helpers used for their return value MUST have their return value consumed; side-effect-free helpers called for "side effects" are the bug

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); pr-reviewer Blocker B-2 (`groupCandidatesByDocument` called with return value discarded in `retrievalService.ts`).

A frequent bug shape during ranker / pure-helper refactors: a function declared as `(input: T[]) => U[]` is called for what looks like a side effect — but pure helpers HAVE no side effects. If the return value is not assigned, used, or written, the pure helper has done nothing the caller observed. The spec's intended invariant (e.g. "document-level relevance is `MAX(chunk.finalScore)`") is therefore not delivered at runtime, even though the pure helper was implemented correctly and tested correctly.

**Detection heuristic.** During PR review, grep the changed services for `^\s*<helperName>\(` (helper call as a statement, not as an assignment / argument). Every hit needs justification: if the helper's signature shows a non-void return, the call is almost certainly a bug. Pure-helper Convention §8 already says "pure helpers must be deterministic and side-effect-free" — combine that with: "if you call one as a statement, you have written a no-op."

This complements the existing pure-helper-input-mutation entries in KNOWLEDGE.md: the inverse failure mode is **calling a pure helper for side effects that don't exist** (this entry); the dual is **mutating an input expecting it to be returned later** (covered earlier). Both are reviewable mechanically — either no return value is consumed, or an input is mutated.

### [2026-05-08] Pattern — Retrieval-version completeness invariant requires an active production read-path filter, not just a write-side guard

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); pr-reviewer Blocker B-3 (`filterDocumentChunks` exists + tested but not called from `retrievalService`).

When the spec says "X invariant must hold at read time" (e.g. auto-knowledge-retrieval §13.1: "`retrieval_version_id` MUST always reference a version whose full chunk set exists for `active_embedding_model`"), implementing the invariant ONLY in the chunking job's atomic-swap commit path is insufficient. A test that exercises the pure helper that enforces the invariant (e.g. `documentRetrievalServicePure.filterDocumentChunks`) but is never wired into the production read path passes green — and the read path silently does its own inline filter that checks pointer alignment but NOT chunk-count completeness. Result: a partial-write race window or any future invariant deviation goes undetected.

**Pattern:** for any spec invariant that includes "must hold at read time", the doc-conformance check is "find every read site for this data and confirm it routes through the canonical filter." The pure helper having a green test is necessary but not sufficient. PR reviewers should ALWAYS grep the production read path for the canonical filter call — if the test exists but the production call doesn't, the test is dead.

This is closely related to the existing "test coverage that doesn't exercise production paths" anti-pattern, but framed for invariant-enforcement specifically: a write-side guard is fine, a read-side guard is fine, both is best, and a tested-pure-helper-without-production-wiring is the bug.

### [2026-05-08] Pattern — Document-promotion atomicity needs an audit-row idempotency anchor inside the inline transaction

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); architectural pattern from spec §6.5 + adversarial-reviewer AKR-ADV-6 + dual-reviewer §3 (FORCE-RLS reads on `document_promotion_audit`).

When a one-click "promote source X to durable Y" flow has both an inline tx (for the user-visible "marked durable" instant feedback) and a post-commit job (for slow side effects like flipping `expires_at` to NULL or far-future), there is a race window: if the post-commit job runs after the source row's expiry sweep also fires, the source could be pruned before the durability flip lands. The promotion path then re-runs (UI retry, idempotency replay, etc.), and the system either creates a duplicate target row or 23505s.

**Pattern:** write an append-only audit-ledger row inside the inline tx with `UNIQUE (file_id) WHERE deleted_at IS NULL`. The audit row IS the idempotency anchor — its existence proves promotion already started, and the post-commit job reads it under the same RLS context to know whether to flip durability. Auto-knowledge-retrieval's `document_promotion_audit` table (migration 0294) is the canonical implementation: written inside the same tx as the new `reference_documents` row + link rows, then read by `documentPromotionFinaliseJob` (in a short org-scoped read tx — see the worker-opt-out pattern above) to prove the promotion is real before flipping `execution_files.expiresAt`.

**Detection heuristic.** Any "instant durability + post-commit side effects" pattern needs the audit-ledger anchor. If you see `promotionService.promote` followed by a fire-and-forget `enqueueFinaliseJob`, ask: how does the finalise job know the inline tx committed and isn't a phantom retry? The answer should be a row in an audit table, written inline, with a UNIQUE constraint that idempotency-keys the source-id.

### [2026-05-08] Pattern — Retrieval rankers should share a generic core; primitive-specific filters wrap it

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); spec decision §3.3.3 (extract generic ranker, keep block-specific filters).

When a project gains a second knowledge primitive that needs ranking (auto-knowledge-retrieval added document chunks alongside the pre-existing memory blocks), the temptation is to copy the ranker. Don't. Extract the generic ranker into a pure module that operates on a polymorphic `RetrievalCandidate` shape (id, kind, scope-tier columns, embedding, tokenCount, finalScore inputs); leave primitive-specific FILTERS (mode handling, version pinning, owner-agent semantics, divergence flags) in the primitive's own service that wraps the generic ranker.

This is what `retrievalServicePure.ts` (generic ranker) + `documentRetrievalServicePure.ts` (document-specific filter) + `memoryBlockRetrievalServicePure.ts` (block-specific filter) shipped together in PR #274. Future cross-encoder re-ranking, learned thresholds, and new knowledge primitives all benefit from concentrating the algorithm.

**Convention:** any new knowledge-style primitive that needs ranking goes through `retrievalServicePure`. Primitive-specific code lives upstream (pre-ranking filter) or downstream (post-ranking truncation / formatting). The comparator chain `finalScore DESC, scopeTier DESC, updatedAt DESC, id ASC` is locked — `id ASC` is the determinism anchor. Tests in `retrievalServicePure.test.ts` pin it; reordering or dropping a column is a spec amendment.

### [2026-05-08] Pattern — Bounded observability payloads with deterministic top-N truncation are the right shape for retrieval traces

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); spec §11.4 + §10.8 (ranking determinism), `retrievalObservabilityService` design.

Retrieval traces tempt unbounded JSON payloads (every candidate, every score component, every rejection reason). Two failure modes:
1. Storage cost grows linearly with candidate-pool size, which itself grows with org maturity.
2. Replay determinism fails: a re-emit with `JSON.stringify` of the same candidate set produces a different byte sequence if Map iteration order or floating-point serialisation drifts.

**Pattern:** every retrieval-trace event has a strict byte-bound contract — top-N items per array (sort + slice, fixed N), constants exported from the observability service, and replays MUST be byte-identical given the same candidate set. Tests assert `Buffer.byteLength(emit) === Buffer.byteLength(replay)`. Truncation is silent in the payload (no per-event "5 more truncated" wording — the constant is the contract); a separate truncation-indicator-rate metric tells ops when caps need raising via the documented escalation path (migrate to a dedicated `retrieval_events` table — DON'T raise the inline cap).

This is the spec §11.4 design pinned in `retrievalObservabilityServicePure.test.ts`. Mirror it for any future high-cardinality observability event (rule-firing trace, capability-discovery trace, etc.) — bounded payload + dedicated escalation path beats unbounded inline payload every time.

### [2026-05-08] Pattern — Always-available document budget needs a preventive UI surface, not a runtime safety net

**Date:** 2026-05-08
**Source:** finalisation-coordinator finalisation pass on PR #274 (slug: auto-knowledge-retrieval); spec §11.5 + chatgpt-spec-review item A (operator chose option a — telemetry-driven preventive surface).

When a feature lets operators flag documents as "always available" (loaded on every run, bypassing relevance ranking), there's a temptation to handle starvation at runtime: degrade gracefully when the always-available block alone exceeds budget. That works mid-run, but it's the WRONG primary surface — operators only learn about the misconfiguration after a degraded run lands, and they have no signal in the configuration UI to tell them they're approaching the cliff.

**Pattern:** the primary surface is preventive, in the configuration tab. Soft warning fires at thresholds well below the runtime cliff (`doc_count >= 30` OR `token_cost >= 30000` for v1) and surfaces in the Documents tab as an inline chip. The runtime degradation path still exists as the last-line-of-defence safety net, but operators see the chip first and reconfigure before any run degrades. Constants live in `retrievalObservabilityService` for v1; per-org overrides explicitly deferred to a post-launch amendment once production telemetry exists to inform tuning.

**Convention.** When designing any "soft cap" feature where operators can over-configure, the question to ask is: *does the operator see the warning before the bad outcome, or only after?* If only after, the design is wrong; redo with a configuration-time surface.

### [2026-05-09] Pattern — Single-node SSE topology with reconnect-snapshot recovery

`agentPresenceStreamPublisher.ts` uses an in-process singleton `Map` keyed by scope (no Redis, no message broker). Each scope holds a sorted ring buffer (300 events, canonical order `(eventTimestamp ASC, eventId ASC)`). On reconnect the route calls `replaySinceLastEventId(lastEventId)` to replay the ring buffer. The `Last-Event-ID` request header always supersedes the `lastEventId` query param when both are present; query param is consulted only when the header is absent. Multi-node fan-out is explicitly deferred (spec §18 Agent Workspace). File: `server/services/agentPresenceStreamPublisher.ts`; routes: `server/routes/agentPresenceStream.ts`.

### [2026-05-09] Pattern — Monotonic-clock hysteresis for working time

`agentWorkingTimeService.ts` uses `process.hrtime.bigint()` for elapsed measurement to avoid `Date.now()` wall-clock drift and NTP adjustments. Elapsed accumulates into a per-run bucket in `agent_working_time_buckets`. UTC half-open intervals `[start, end)` prevent double-counting at midnight: runs that cross midnight are split into two buckets inside the pure helper `splitIntervalAcrossBuckets`. The monthly compact job (`workingTimeRollupCompactJob.ts`) keeps per-day rows for 1 year then collapses to monthly resolution. File: `server/services/agentWorkingTimeService.ts` + `agentWorkingTimeServicePure.ts`.

### [2026-05-09] Pattern — Bounded-payload pattern reuse applied to SSE (KNOWLEDGE.md 2026-05-08 retrieval pattern applied)

`agentPresenceStreamPublisher.ts` applies the same bounded-observability-payload pattern from `retrievalObservabilityService`: per-event hard cap is 32KB measured via `Buffer.byteLength(JSON.stringify(event.data), 'utf8')`. Over-limit events have their `data` replaced with `{ truncated: true, byteLength }` and `truncated: true` set on the envelope. Truncation is logged at most once per 24h per event-type (in-process Map keyed on event-type name, reset at UTC midnight) to prevent log storms on burst traffic. The 24h suppression key is `(eventType, host)` — same pattern as the cache-invalidation log suppression (plan Rev 3 tightening #3).

### [2026-05-09] Pattern — Immutability GUC bypass for retention prune

`agentObservationsPruneJob.ts` bypasses the `agent_observations` DB immutability trigger via `set_config('app.allow_observation_mutation', 'retention_prune', true)` issued as the first statement inside the DELETE transaction. The GUC is transaction-scoped only. Every prune cycle calls `recordSecurityEvent` with action `agent.observations.retention_prune` — this is the ONLY authorised mutation path for non-pinned rows. GUC + audit-log pairing is the canonical pattern for any table that uses a trigger-based immutability guard but needs a maintenance prune path. Delete batches: 1000 rows ordered `(created_at ASC, id ASC)` with `FOR UPDATE SKIP LOCKED`.

### [2026-05-09] Pattern — withOrgTx external side-effect boundary

`ieeSessionService.tearDown()` uses `withOrgTx` for the DB update. The external container release (IEE infra teardown) MUST be placed AFTER the `await withOrgTx(...)` call returns — never inside the transaction callback. Pattern: commit first, then side-effect. Placing the release inside the callback violates atomicity: if the release throws before the implicit commit, the transaction may roll back leaving the DB row in a stale state while the container is already gone. `markFailed()` and `recordSummary()` use `getOrgScopedDb` because a single UPDATE needs no full transaction wrapper. File: `server/services/ieeSessionService.ts`.

### [2026-05-09] Correction — chatgpt-pr-review is iterative until operator says done; never auto-close after a single APPROVED round

**Date:** 2026-05-09
**Source:** Operator correction during PR #275 (slug: trust-verification-layer) Phase 3 finalisation. Round 1 was auto-closed by finalisation-coordinator with disposition `APPROVED — round-2 not requested` after a single round, without pausing for operator input. Operator pointed out that the agent contract is iterative.

The `chatgpt-pr-review` agent is **operator-driven on cadence** — there is no auto-finalise on a single APPROVED round, even when the round produces no findings. Per `.claude/agents/chatgpt-pr-review.md` line 230 ("Empty findings array AND verdict APPROVED → log and ask the user whether to finalise or run another round") and `.claude/agents/finalisation-coordinator.md` line 237 ("Coordinator pauses inside this sub-agent for the operators full ChatGPT loop. No time cap. Operator drives cadence."), the coordinator MUST pause after every round and wait for the operator to either:

- paste the next ChatGPT response (round N+1), or
- say `done` (close the loop and proceed to step 6 doc-sync sweep).

**Why:** even when ChatGPT returns APPROVED with no findings, the operator may want to run a second round at a different prompting angle (strategic risks, security framing, ergonomics). Auto-closing after a single round denies that option and silently truncates the review.

**Detection heuristic.** When running finalisation Step 5, the coordinator must surface BOTH options at the end of every round, regardless of disposition: "say `done` to close the loop, or paste another ChatGPT response to run another round." Never write `APPROVED — round-N+1 not requested` as a self-decided verdict — that field is set only when the operator explicitly says done.

**Applies to:** `.claude/agents/finalisation-coordinator.md` Step 5; `.claude/agents/chatgpt-pr-review.md` per-round loop step 9 (round summary). Both files are correct in their text — this entry exists to lock in the discipline against future drift.

### [2026-05-09] Correction — finalisation-coordinator must auto-monitor CI, auto-fix CI red (with guardrails), and auto-merge

**Date:** 2026-05-09
**Source:** Operator correction during PR #275 (slug: trust-verification-layer) Phase 3 finalisation. The prior contract for finalisation-coordinator stopped at Step 11 with "operator drives the merge sequence" — the operator pointed out that this has failed to fire automatically multiple times across recent finalisations. They want the full lifecycle (label → CI watch → CI fix → merge) automated, since they do not review CI logs themselves.

The `finalisation-coordinator` agent now owns the entire post-Step-10 lifecycle:

- **Step 11 (NEW):** CI monitoring + iterative fix loop. Polls `gh pr view {N}` every 90s via `ScheduleWakeup`. State machine: `green` → Step 12; `running` → schedule another poll; `red` → enter fix sub-loop. Bounded at 5 iterations per session.
- **Step 12 (NEW):** Auto-merge. Update current-focus → NONE, commit + push, run `gh pr merge {N} --squash --delete-branch`, capture squash sha, patch main with the actual sha.
- **Step 13 (was 11):** End-of-phase prompt — confirms merged.

**Guardrails (mandatory) on the fix sub-loop.** Without these, auto-fix is unsafe — the agent can silently game tests, scope-creep, or mask real bugs. With them, the auto-fix path is bounded to genuinely mechanical CI red:

1. **G1 — Test files off-limits.** Never modify `*.test.ts` / `*.spec.ts` / `tests/` / `__tests__/` / `e2e/` / `fixtures/` / vitest+jest config. Failing tests usually mean the implementation is wrong; the fix belongs in the implementation, never in the assertion. If the test really is outdated, escalate — the operator owns the spec-amendment decision.
2. **G2 — Diff size cap: 50 lines per iteration.** Bigger fixes almost always indicate the agent is solving the wrong problem. The migration-0300 IMMUTABLE fix (1 line) and the corrections-route service-helper fix (30 lines) both fit comfortably. If a genuine fix needs more than 50 lines, that is a feature-scoped change — spawn `builder`, get pr-reviewer, do not roll it through the auto-fix path.
3. **G3 — Category allowlist.** Auto-fix is allowed for: SQL/migration syntax, lint, typecheck, missing imports, gate-script bugs, RLS-contract violations, idempotency-index issues. Auto-fix is **escalate-immediately** for: failing unit / integration tests, security-scanner findings, "Workspace Actor Coverage" or similar policy gates, anything whose name does not match the allowlist.
4. **G4 — Mandatory post-merge audit log.** Every iteration appends to `tasks/review-logs/auto-fix-log-{slug}-{timestamp}.md` with failed check, root cause, category, guardrail status, fix summary, commit sha, and CI re-fire result. The squash-commit preserves the log so post-hoc review of "what did the bot do under my nose" takes 30 seconds.

**Why the guardrails matter.** The operator stated they do not review CI output themselves. That changes the risk profile of auto-fix from "minor inconvenience if the bot is wrong" to "real bug ships with no human gate". The four guardrails preserve the automation while bounding the blast radius — auto-fix handles "obvious mechanical CI red", escalation handles "behaviour might actually be broken".

**Detection heuristic for future drift.** If a future agent edit removes any guardrail (G1–G4), the iteration cap (5), the stuck-detection rule, or the no-`--no-verify` rule, treat it as a contract violation and surface to operator before merging the change. These four guardrails are the difference between automated maintenance and unbounded agentic merge.

**Applies to:** `.claude/agents/finalisation-coordinator.md` Steps 11, 12, 13. Locked in by operator 2026-05-09.


### [2026-05-09] Pattern — Paired-event accumulators need explicit stable identity, never "latest prior in same scope"

**Date:** 2026-05-09
**Source:** finalisation-coordinator finalisation pass on PR #276 (slug: agent-workspace); chatgpt-pr-review Round 1 B3 + Round 2 R2-S2 (agentWorkingTimeService.ts step pairing).

Whenever a service pairs `*_started` / `*_completed` (or `*_open` / `*_closed`) events into intervals, the pairing key MUST be a stable identity carried by both ends — `payload.stepId`, `(taskId, taskSequence)`, span_id, observation_correlation_id, etc. The "latest prior `*_started` in the same scope" pattern silently mispairs under three real-world conditions: concurrent intervals in the same scope, retries (a started event re-fires before the previous completed), and nested intervals.

**Pattern (mandatory shape).** Pair end-to-start by exact identity. If the end carries identity but no matching start exists, **drop the pair and warn** (`<service>.identity_missing`) — never cross-fall through to a fallback path that could match a different open. The cross-fallthrough is what destroys correctness: a stepId-bearing end that falls through to an unidentified slot pairs with whichever step happens to be open, not with its actual sibling.

**Strict fallback rule.** A run-level / scope-level fallback (no identity on either side) is allowed ONLY when both ends lack identity AND no identified open exists in that scope. The "no identified open" check is what prevents an unidentified end from cross-pairing to an identified start. Pure-helper invariant: the fallback opens at most ONE slot per scope and never pairs an end to an unrelated start; the worst case is an under-count, never mis-attribution.

**Detection heuristic.** Any service that uses `WHERE event_type = '<X>_started' AND sequenceNumber < <ours> ORDER BY sequenceNumber DESC LIMIT 1` to find a pair is using the broken pattern. Replace with identity-keyed lookup; keep the legacy fallback only if you also count identified opens and refuse to pair when one is in flight. Tests must include: (a) interleaved concurrent intervals in same scope with explicit identity, (b) retry where the same identity re-fires, (c) asymmetric identity (one end carries it, the other does not — must drop), (d) ambiguous unidentified end while an identified open is in flight (must drop). Files: `server/services/agentWorkingTimeService.ts` + `server/services/agentWorkingTimeServicePure.ts` + `server/services/agentWorkingTimeServicePure.test.ts`.

### [2026-05-09] Pattern — Permission-gated UI surfaces must fail closed during async permission load

**Date:** 2026-05-09
**Source:** finalisation-coordinator finalisation pass on PR #276 (slug: agent-workspace); chatgpt-pr-review Round 2 R2-S1 (AgentEditPage.tsx Overview tab gate).

When a UI surface is permission-gated and the permission set loads asynchronously (e.g. `/api/my-permissions` fetch on mount), the default during the pre-fetch window MUST be "hide everything that has a gate", not "show everything". The opposite default — render the gated affordance, redirect once perms arrive — has two failure modes: (a) UI contract violation (the "tab does not appear" guarantee is broken for the brief flicker window even when the backend rejects the data), and (b) the gated component can mount and fire a protected backend request before the redirect, producing 403s that look like real failures in observability.

**Pattern (mandatory shape).** Treat `permissions === null` as "permission denied" for the purpose of visibility computation, not as "permission unknown, show everything". Hold the page-level loading state until both the resource fetch AND the permission fetch resolve — never render a tab strip / sidebar / button row that includes a gated affordance while permissions are loading. Admin / system_admin paths can short-circuit (always-visible, never gated) if the role flag is locally cached.

**Detection heuristic.** Any `useMemo` / filter that returns the full unfiltered list when the permission state is `null` is using the broken pattern. The correct shape is: `if (perms === null) return false` (per-tab) inside the filter. Pair this with a top-level `if (permsAreLoading) return <Loading/>` so content rendering also waits.

File: `client/src/pages/build/AgentEditPage.tsx`.


### [2026-05-09] Correction — finalisation-coordinator must commit Phase 3 BEFORE applying ready-to-merge label

**Date:** 2026-05-09
**Source:** Operator correction during PR #276 (slug: agent-workspace) Phase 3 finalisation. The original `finalisation-coordinator` Step 10 ordered: apply label → write handoff → write current-focus → commit → push. Applying the label fired CI on the pre-Phase-3 HEAD; the Phase 3 commit then landed and re-fired CI from scratch. Operator caught it and pointed out the wasted compute / wasted minutes.

**Rule:** the ready-to-merge label is what triggers CI on this repo. CI must therefore fire against the final post-Phase-3 commit, never against a pre-Phase-3 HEAD that the next push will immediately invalidate. Apply the label LAST in the Phase 3 sequence, AFTER all Phase 3 artefacts (`handoff.md`, `current-focus.md`, `KNOWLEDGE.md`, `tasks/todo.md`) are committed and pushed.

**Required Step 10 order (locked):**

1. Capture `LABEL_TIMESTAMP_PLACEHOLDER` via `date -u`.
2. Write `tasks/builds/{slug}/handoff.md` Phase 3 section (recording the placeholder timestamp).
3. Write `tasks/current-focus.md` mission-control + prose for MERGE_READY.
4. Commit all four files in a single `chore(finalisation-coordinator): Phase 3 complete` commit.
5. Push to remote. **Wait for push to complete.**
6. THEN run `gh pr edit {N} --add-label "ready-to-merge"`.

The pre-captured placeholder timestamp is the operator-visible "labelling moment" recorded in the handoff. Drift between the placeholder and the actual `gh` call is at most a few seconds and is acceptable; the alternative (capture timestamp after `gh`, then amend the handoff) requires either an `--amend` (forbidden in this flow) or a second commit (which itself triggers a third CI run).

**Detection heuristic.** If a future `finalisation-coordinator` edit reorders Step 10 such that `gh pr edit ... --add-label "ready-to-merge"` runs before the Phase 3 commit, treat it as a contract violation and surface to the operator before merging the change. The label-after-commit ordering is what makes the auto-CI-watch loop affordable; reverting it doubles every Phase 3's CI cost.

**Applies to:** `.claude/agents/finalisation-coordinator.md` Step 10. Locked in by operator 2026-05-09.


### [2026-05-09] Correction — four CI-only gates that G1 (lint + typecheck) misses; comply WHILE writing, not after

**Date:** 2026-05-09
**Source:** Operator correction during PR #276 (slug: agent-workspace) Phase 3 finalisation. CI red after `ready-to-merge` label fired surfaced four blocking-gate failures that G1 did not catch. Operator asked: "anything you can add into knowledge or doco to prevent this in the future instead of having to fix it from failing tests".

The G1 gate run inside `builder` only exercises lint + typecheck + targeted vitest. Four static gates run CI-only and routinely catch chunks that G1 cleared. Every one of them is mechanical to satisfy WHILE writing the chunk and 10–30× more expensive to fix retroactively.

**The four gates and their pre-flight rules:**

1. **`verify-test-quality.sh`** — `*.test.ts` MUST live under `__tests__/`. Inline siblings (`server/services/foo.test.ts`) are silently invisible to Vitest's discovery glob. Correct shape: `server/services/__tests__/foo.test.ts` (and the import is `../foo`, not `./foo`). Same rule for `client/src/**/*.test.ts`. PR #276 had 7 violations from chunks that landed tests inline. Reference: `docs/testing-conventions.md § Test discovery`.

2. **`verify-rls-coverage.sh`** — `CREATE POLICY <name> ON <table>` must be on a single line. The gate uses line-oriented grep. Splitting across two lines (`CREATE POLICY <name>\n  ON <table>`) makes the gate fail to match. The body (`USING (...) / WITH CHECK (...)`) can wrap normally. PR #274 + PR #276 both hit this. KNOWLEDGE.md `[2026-05-08]` recorded the PR #274 instance and the rule still got missed in PR #276 — promote it from history to a checklist item every migration writer reads.

3. **`verify-rls-contract-compliance.sh`** — no raw `db` import from `server/db/index.js` outside `server/services/**`. New helpers in `server/lib/*.ts` that need a query either: (a) use `getOrgScopedDb('caller-tag')` from `server/lib/orgScopedDb.ts` (allowed everywhere); (b) move into a `server/services/` file; or (c) deliberately add the path to `ALLOWLIST_DIRS` in `scripts/verify-rls-contract-compliance.sh` (reserved for short bootstrap helpers — `resolveSubaccount.ts`, `resolveAgent.ts` are the precedents).

4. **FK references to `agent_execution_events(id)` need `ON DELETE` clause.** Default `NO ACTION` blocks integration-test cleanup that deletes events for the run. Pointer columns (nullable: "last seen", "current focus") → `ON DELETE SET NULL`. Dependent rows (NOT NULL: "this row was generated from this event") → think about retention before choosing CASCADE vs the default. PR #276's `agent_presence_projections.last_event_id_fkey` was the first integration-test failure; both pointer columns now `SET NULL`.

**Why the rule lives here AND in `builder.md`.** The `builder` agent definition has a "CI-gate pre-flight" subsection in Step 3 — that's the workflow-level reminder. KNOWLEDGE.md is the durable cross-session record so the lesson survives builder agent revisions and so any agent reading project knowledge sees it as a known-tripwire pattern.

**Detection heuristic.** When writing or reviewing a chunk that touches: any new `*.test.ts` (gate 1), any new `migrations/*.sql` (gate 2 + gate 4), any new `server/lib/*.ts` that queries the DB (gate 3) — run the corresponding compliance check by hand before claiming SUCCESS:

- `find <chunk dir> -name '*.test.ts' -not -path '*/__tests__/*' -print` should return zero.
- `grep -E '^CREATE POLICY[^O]*$' migrations/<new>.sql` should return zero (any line that starts with CREATE POLICY but has no ON before EOL).
- `grep -l "from '../db/index" server/lib/<new-files>.ts` plus check it's in the gate allowlist.
- `grep "REFERENCES agent_execution_events" migrations/<new>.sql` should not return entries without an `ON DELETE` clause unless the column is intentionally `NO ACTION`.

**Applies to:** `.claude/agents/builder.md` Step 3 ("CI-gate pre-flight"); `docs/testing-conventions.md § Test discovery` (already names the rule but builder agents missed it). Locked in by operator 2026-05-09.


### [2026-05-09] Sub-pattern — `verify-pure-helper-convention.sh` requires `.js` extension on relative imports

**Date:** 2026-05-09
**Source:** Phase 3 finalisation auto-fix iteration 2 on PR #276 (slug: agent-workspace). Iteration 1 fixed test-file location (`./X` → `../X`); iteration 2 caught a follow-on gate failure because the gate's regex requires `.js` on the relative import.

The gate (`scripts/verify-pure-helper-convention.sh`) checks that every test file under `__tests__/` imports something from its parent directory. The grep pattern is `from\s+'(\.\./|\./)[^']+\.js'` — the `.js` extension is required. Without it, a TypeScript-only relative import like `from '../somethingPure'` is invisible to the gate even though TypeScript resolves it correctly.

**Pattern (mandatory shape).** Every relative import in a test file MUST end in `.js` — both the sibling-module import and any deeper relative path (`../../../shared/types/X.js`). This matches the project's TypeScript-ESM `nodenext` resolution mode and the gate's regex.

**Detection heuristic.** Pair this check with the test-file-location check in builder.md Step 3:

- `find <new-test-files> -name '*.test.ts' | xargs grep -E "from '(\.\./|\./)[^']+'$"` should return zero (every relative import should have an extension).
- If zero, also check `from '(\.\./|\./)[^']+\.ts'` is zero (never `.ts` — always `.js` for ESM resolution).

**Applies to:** `.claude/agents/builder.md` Step 3 "CI-gate pre-flight"; `KNOWLEDGE.md [2026-05-09] Correction — four CI-only gates that G1 misses` (this is sub-rule 1.b — the `.js` extension requirement on relative imports inside `__tests__/`).


### [2026-05-09] Correction — finalisation-coordinator merge command must use `--admin --squash --delete-branch`

**Date:** 2026-05-09
**Source:** Operator correction during PR #276 (slug: agent-workspace) Phase 3 finalisation merge step. The original `finalisation-coordinator` Step 12.3 used `gh pr merge {N} --squash --delete-branch`. The post-merge-prep commit in 12.2 (a docs-only `tasks/current-focus.md` edit setting status to NONE + capturing the squash-sha placeholder) triggers a fresh CI run on push. The merge then has to wait for required status checks to pass on a commit that changes nothing CI cares about — pure compute / wall-clock waste.

**Rule.** `gh pr merge` in 12.3 is invoked with `--admin --squash --delete-branch`. The `--admin` flag bypasses the required-status-checks gate and merges immediately. This is safe because:

- The prep commit in 12.2 is pure metadata: `tasks/current-focus.md` only. It cannot break code, schema, RLS, lint, or types.
- The PREVIOUS commit (the last code-bearing commit on the feature branch) already passed all required checks before Step 12.1 was reached. That's the actual "what shipped" content; the squash-merge bundles the prep commit in but adds no new risk.
- Required-status-checks is the contract for code changes; `--admin` is the documented operator override for exactly this kind of metadata-only trailing commit.

**Apply to:** `.claude/agents/finalisation-coordinator.md` Step 12.3. Locked in by operator 2026-05-09.

**Detection heuristic.** Any future Phase-3 merge that does NOT use `--admin` either: (a) skips the prep commit entirely (also valid — but loses the bundled `current-focus → NONE` state in the squash), OR (b) wastes a full CI run on a docs-only commit. If the playbook ever drops `--admin`, treat as a contract violation and surface to operator before merging.


### [2026-05-09] Pattern — deferred-FK migration when two new tables reference each other (cross-cycle)

**Date:** 2026-05-09
**Source:** chatgpt-spec-review Round 1 finding F1 on `support-desk-canonical` spec. ChatGPT caught that `canonical_ticket_messages.source_draft_id` was declared as an inline FK to `canonical_ticket_drafts(id)`, but the schema chunks had `canonical_ticket_messages` (migration 0310) landing BEFORE `canonical_ticket_drafts` (migration 0311). The migration would have failed at apply time because the referenced table doesn't yet exist.

When two new tables reference each other in either direction, you cannot satisfy both FKs at table-create time — at least one direction must be deferred to a later migration. Three valid strategies, in order of preference:

1. **Order them so the cycle resolves.** If A.fk_b → B and B has no FK back to A, create B first. Always preferred when the cycle is one-way; the spec's chunk ordering should naturally land the producer table first.
2. **Deferred FK via ALTER TABLE.** When the cycle is genuine (A → B and B → A), the second migration adds the FK constraint after the second table lands: `ALTER TABLE first_table ADD CONSTRAINT first_fk_x FOREIGN KEY (x) REFERENCES second_table(id);`. The first migration declares the column without the inline FK reference. The partial index (`WHERE x IS NOT NULL`) lands in the same later migration as the FK — both are only meaningful once the referenced table exists.
3. **Drop the DB FK and enforce in service layer.** Last resort. Use only when the FK semantics are too weak for a real constraint (e.g. cross-tenant pointer where RLS would make the FK check fail anyway).

**Pattern (mandatory shape).** Spec the migration ordering explicitly in the phase plan and again in the schema sections of each affected table. Make the deferred-FK pattern visible — name the migration that creates the column, AND the migration that adds the FK + partial index, in both schema sections. Do not rely on chunk ordering alone to communicate the deferral.

**Detection heuristic.** When reviewing a spec's data-model section, grep for FKs whose target table is created in a later chunk than the source table. If any are found, the spec is broken — either reorder the chunks or document the deferred-FK pattern.

**Applies to:** future spec authoring (`docs/spec-authoring-checklist.md` Section 6 phase sequencing — backward-dependency check should include "FKs to tables created later").


### [2026-05-09] Pattern — polymorphic FK splitting in Postgres (no native support)

**Date:** 2026-05-09
**Source:** chatgpt-spec-review Round 1 finding F2 on `support-desk-canonical` spec. The first draft had `canonical_ticket_messages.author_id` as a single UUID column referencing `canonical_contacts.id` when `author_type='customer'` and `canonical_support_agents.id` when `author_type IN ('agent','bot')`. A single Postgres column cannot have conditional FKs to two different parent tables — the constraint syntax has no `WHEN <discriminator>` clause and there is no native polymorphic-association pattern.

**Pattern (mandatory shape).** Split the polymorphic column into one nullable column per target table, plus a CHECK constraint enforcing exactly-one-non-null tied to the discriminator. Example:

```sql
author_type text NOT NULL CHECK (author_type IN ('customer','agent','bot','system')),
author_contact_id uuid REFERENCES canonical_contacts(id),
author_support_agent_id uuid REFERENCES canonical_support_agents(id),
CONSTRAINT author_id_matches_type CHECK (
  (author_type = 'customer' AND author_support_agent_id IS NULL)
  OR (author_type IN ('agent','bot') AND author_contact_id IS NULL AND author_support_agent_id IS NOT NULL)
  OR (author_type = 'system' AND author_contact_id IS NULL AND author_support_agent_id IS NULL)
);
```

The `author_contact_id` column is allowed to be NULL even when `author_type='customer'` (e.g. customer email did not match a canonical contact at ingestion); the support-agent column is the only column that's NOT NULL for its discriminator.

**Detection heuristic.** When reviewing a spec, grep for prose like "FK to X if Y, FK to Z if not" or column descriptions that reference multiple parent tables. If found, the column is impossible as written — split it.

**Applies to:** future spec authoring. The spec-authoring checklist's "Existing primitives search" (Section 1) should add a sub-rule: "polymorphic FKs are not a primitive — split into typed nullable columns + CHECK constraint per discriminator."


### [2026-05-09] Pattern — polling absence ≠ deletion; tombstoning requires either webhook or strict full-reconciliation

**Date:** 2026-05-09
**Source:** chatgpt-spec-review Round 2 finding F1 on `support-desk-canonical` spec. The first draft of the deletion logic in `canonical_tickets` set `provider_deleted=true` "when a poll cycle proves a previously-known ticket is no longer returned by the provider." With incremental polling, pagination, rate limits, partial page failure, cursor windows, inbox filters, or provider search semantics, "not returned" almost always means "not in this slice", NOT "deleted."

A false tombstone is the worst-case correctness failure for a canonical-ingestion layer: it hides live tickets from the agent queue. The agent stops responding to them; the operator may not notice; the customer waits.

**Pattern (mandatory shape).** Tombstone-by-poll requires ALL of the following preconditions to hold for the pass that issues the tombstone:

1. Explicit **full-reconciliation pass** (a distinct cadence from the day-to-day incremental cycle — e.g. nightly per-inbox or operator-triggered).
2. Every page of the relevant provider endpoint completed successfully (no partial pagination state).
3. No `provider.poll_page_failed` was emitted during the pass for the relevant scope.
4. No rate-limit truncation (`provider.rate_limited` did not interrupt the pass).
5. The provider endpoint used has semantics where absence proves deletion (an unfiltered "all entities in this scope" endpoint, NOT a filtered or windowed search).

**Incremental polls must NEVER tombstone.** A row missing from an incremental window is "not in this slice", not "deleted." Specs that conflate the two are unsafe.

If any precondition fails, deletion is **webhook-only** for the affected scope until the next qualifying full-reconciliation pass succeeds. The webhook path is unconditional — provider deletion events are deterministic.

**Detection heuristic.** When reviewing a spec that introduces tombstone columns (`*_deleted`, `deleted_at`, `tombstoned`), grep for "poll" within the same section. If polling can set the tombstone, the spec must enumerate the full-reconciliation precondition — otherwise it is unsafe. Same rule applies to "out of scope" / "removed from view" boolean columns where the source-of-truth is a polled provider.

**Applies to:** future spec authoring. Any spec that mirrors provider entities and supports deletion must include this precondition in its data-model section. The spec-authoring checklist Section 10 (execution-safety contracts) should add a sub-rule for deletion-by-poll.




### [2026-05-09] Pattern — symmetric ingest paths must both implement the same FK / CHECK contracts

**Date:** 2026-05-09
**Source:** dual-reviewer iter-1 P1 #2 + pr-reviewer round 3 B1 on `support-desk-canonical` Phase 2. Two convergent ingest paths (polling Phase D + webhook delivery) both write to the same canonical table (`canonical_ticket_messages`). Migration 0310 enforces a polymorphic-FK CHECK requiring `author_support_agent_id NOT NULL` for `author_type IN ('agent','bot')`.

The polling path was patched first (dual-reviewer iter-1) by adding the agent lookup. The webhook path was missed — every webhook-delivered agent reply would have failed the CHECK constraint at insert, aborting the transaction silently. A second review round caught it; without that round it would have shipped to prod and broken every agent reply via webhook.

**Pattern (mandatory shape).** When a canonical table has multiple ingest paths (polling + webhook + manual + import), every path must independently:
1. Resolve the same FK lookups (author, contact, agent — whichever the schema requires).
2. Honour the same CHECK constraints (polymorphic discriminators, asymmetric NULL rules, status-invariant CHECKs).
3. Emit the same `INGEST_CONTRACT_VIOLATION` (or equivalent) on lookup failure and skip the insert without crashing the surrounding transaction.

A patch to one ingest path is incomplete unless the symmetric paths are patched in the same commit. Reviewers must verify symmetry explicitly — "I fixed the polling path" is not "I fixed the bug."

**Detection heuristic.** When fixing an ingest-path bug, grep for OTHER call sites that insert into the same canonical table. Specifically search for `insert(canonicalTable)` and `tx.insert(canonicalTable)` patterns. Each call site is a separate ingest path that must satisfy the same contracts. The polling/webhook split is the most common case but not the only one — also check boot-recovery loops, manual-resolve handlers, and import scripts.

**Applies to:** any canonical table with FK / CHECK contracts and >1 ingest path. Generalises beyond support — same rule for canonical_contacts (CRM polling + GHL webhook + Stripe webhook), canonical_revenue (Stripe polling + Stripe webhook + manual entry), etc.


### [2026-05-09] Pattern — cross-tenant boot scans against FORCE-RLS tables silently no-op without admin role

**Date:** 2026-05-09
**Source:** pr-reviewer round 3 B2 on `support-desk-canonical` Phase 2. `supportDispatchBootRecovery.ts` imported raw `db` and ran a `SELECT ... FROM canonical_ticket_drafts WHERE status = 'dispatching'` at server boot. Intended behaviour: scan all orgs for stranded drafts and re-enqueue. Actual behaviour: the FORCE-RLS policy on `canonical_ticket_drafts` requires `current_setting('app.organisation_id', true) IS NOT NULL`. At boot, no session var is set; the policy fails closed; the SELECT returns ZERO rows even when stranded drafts exist. **The R5 mitigation is silently a no-op** — every restart leaks dispatching drafts.

A `// guard-ignore reason="boot-time cross-tenant scan"` comment ACKNOWLEDGES the intent but does NOT authorise the access — RLS is enforced at the DB role layer, not the application layer.

**Pattern (mandatory shape).** Boot-time cross-tenant scans against FORCE-RLS tables MUST:
1. Use `withAdminConnectionGuarded({ allowRlsBypass: true, source, reason })` from `server/lib/rlsBoundaryGuard.ts`.
2. Issue `SET LOCAL ROLE admin_role` as the FIRST `tx.execute(...)` call inside the callback, before any SELECT/UPDATE.
3. Perform per-row UPDATEs through the same boundary-wrapped `tx` handle (the proxy enforces `wrapWithBoundary` checks).
4. Justify `allowRlsBypass: true` inline within +/-1 line of the call (satisfies `verify-rls-protected-tables.sh` check 3).

The `guard-ignore` comment is not a substitute for proper admin-role bypass — it only suppresses the static lint, not the runtime RLS policy.

**Detection heuristic.** Grep boot-time / startup / scheduled-job code for `db.select(`, `db.update(`, `db.insert(` against canonical or RLS-protected tables. If the code runs without a per-call org context (no `withOrgTx`, no `getOrgScopedDb`), it must be inside `withAdminConnectionGuarded` with explicit `SET LOCAL ROLE admin_role`. Otherwise the access silently no-ops in prod and the operator never sees an error.

**Applies to:** boot recovery jobs, maintenance jobs, cross-tenant sweepers, billing aggregators — anywhere a startup or scheduled task needs to scan across organisations. Same rule applies to peer-medians materialised view refresh, baseline rot detectors, and any future cross-tenant background work.

### [2026-05-09] Pattern — Spec-design: drop the backfill that contradicts a conservative default introduced in the same spec

**Date:** 2026-05-09
**Source:** ChatGPT spec review of `tasks/builds/synthetos-foundation-refactor/spec.md` round 1, finding F1. Session log: `tasks/review-logs/chatgpt-spec-review-synthetos-foundation-refactor-2026-05-09T07-43-56Z.md`.

**Rule.** When a spec adds (i) a new column with a conservative DEFAULT, (ii) a new governance column with a conservative DEFAULT that constrains downstream behaviour, AND (iii) a one-shot UPDATE that retroactively rewrites historical rows on the new column — check whether (iii) writes values the new governance default in (ii) would block. If yes, the backfill creates a permanent row-vs-policy mismatch (e.g., `agent_runs.controller_style = 'operator'` for an agent whose `subaccount_agents.controller_style_allowed = 'native_only'`). Drop the backfill rather than constraining it: the constrained version usually no-ops in practice (because the conservative default applies to almost all rows) and the unconstrained version produces inconsistent state. Forward-only on the new column is the right trade.

**Apply to:** every spec that adds a new typed/enum column on a hot table AND introduces a governance column or default that gates downstream values on that column. Specifically: when migration N introduces both columns, ask "does my proposed backfill on column A write values that column B's default would forbid?". If yes, drop the backfill in the spec and document the forward-only trade (existing rows render with the conservative default; historical accuracy is the explicit cost).

**Detection heuristic.** During spec review, grep the spec for `UPDATE.*SET.*WHERE.*default` patterns and cross-check against any new `DEFAULT` introduced in the same migration set. The contradiction is invisible at the SQL level (both statements are valid) but produces a class of "agent allow-list says X but historical run says Y" data states that surface confusingly months later in Run Trace UI.

**Related:** the same review caught a CI-gate script using `node --eval "require('./....ts')"` (won't load TypeScript without a loader). Repo precedent for typed verifier harnesses is `npx tsx scripts/foo.ts` invoked from a thin bash wrapper — see `scripts/verify-visibility-parity.sh`. When sketching a new verify gate in a spec, match the existing repo pattern (bash + awk for source-text scans; bash + `npx tsx` for typed import-then-check). Don't invent a third pattern.

## Pattern: First-resolver-wins UPDATE on per-run JSONB snapshots requires snapshot.organisationId as the predicate source

**Context.** The Policy Envelope `persist` function (`server/services/policyEnvelopeResolver.ts`) writes a one-shot JSONB snapshot to `agent_runs` with `WHERE id = $runId AND policy_envelope_snapshot IS NULL`, and re-reads on zero-rows-affected to distinguish "another resolver won" from "row missing". Round-1 pr-reviewer flagged the missing `organisationId` predicate per DEVELOPMENT_GUIDELINES §1 ("filter by organisationId in app code, even with RLS").

**Resolution.** The snapshot itself encodes the run's `organisationId` because the resolver computes it from `ctx.organisationId` before assembly. Use `snapshot.organisationId` as the predicate source in both the UPDATE and the re-read — same value the resolver was scoped against, no risk of the predicate disagreeing with the data being written.

**Why this matters.** Reading from a separate context object would create a class of bugs where the snapshot's contents differ from the predicate's scope. Sourcing from the snapshot itself makes the invariant load-bearing: if the snapshot's `organisationId` is wrong, the UPDATE matches nothing and the loop fails closed.

## Pattern: `replace_all=true` silently misses identical strings with different leading indentation

**Context.** Round-2 pr-reviewer fix replaced two `console.log('foundation.risk_tier.gate_derived', { … })` blocks in `policyEngineService.ts` with `replace_all=true`. The two call sites had different leading indentation (8 spaces inside a `for-of` loop body vs 4 spaces at function-body top level). `replace_all` operates on exact-match strings — only the first site converted; the second was missed. Round-3 pr-reviewer caught it; required a second surgical Edit.

**Resolution.** When replacing call-site patterns that may appear at different indentation levels, do separate surgical Edits per site OR use a regex tool. `replace_all` is for true rename-style replacements (e.g., a single identifier).

**Why this matters.** Linter/typecheck both passed because half-converted code was still valid. Only the human reviewer caught it. Add to the mental checklist for "identical-content blocks at multiple call sites".

## Pattern: Pagination correctness requires SQL filter pushdown, never in-memory filter after LIMIT

**Context.** Run Trace service (`server/services/runTraceService.ts`) initially fetched `LIMIT N+1` rows from a UNION ALL across 7 ledger tables, then applied cursor / eventType / sinceTimestamp / untilTimestamp / toolSlug filters in JavaScript. Codex (dual-reviewer) caught that any filter that reduces the page size below `limit` makes page 2 unreachable — the cursor stops as soon as one filtered page returns less than `limit`, even though more matching events exist downstream.

**Resolution.** Push every filter predicate into the SQL query: cursor as a tuple comparison `(ts, COALESCE(seq,0), source_table, source_id) > $cursor` matching the canonical ORDER BY; `eventType = ANY($::text[])` against the post-translation column; per-arm `toolSlug` predicates that emit `AND FALSE` for non-tool-scoped UNION arms; `ts >= $since::timestamptz` / `ts <= $until::timestamptz`. The LIMIT then operates on the already-filtered row set.

**Detection heuristic.** Whenever a UNION ALL or paginated query feeds a downstream JavaScript `.filter()` call, the LIMIT is applied against the wrong row set. Treat in-memory filtering after LIMIT as a paging-correctness bug, not just a performance hint.

## Pattern: Subaccount-scoped fallback UPDATE must filter by subaccountId, not just organisationId

**Context.** The CredentialBrokerService `revoke` method initially scoped its fallback UPDATE for subaccount-scoped connections by `(id, organisationId)` only. An actor with `CONNECTIONS_MANAGE` on subaccount-A could call `DELETE /api/subaccounts/<sub-A>/connections/<sub-B-connection>` and revoke a sibling subaccount's credential within the same org. The route resolved subaccount-A but did not pass it to the broker — the broker's fallback UPDATE matched any connection in the org.

**Resolution.** Make `subaccountId` a required param on `revoke` (typed `string | null` so org-level vs subaccount-scoped revokes are explicit), and always include the subaccount predicate in the fallback UPDATE: `eq(connections.subaccountId, params.subaccountId)` for subaccount-scoped, `isNull(connections.subaccountId)` for org-level. Codex (dual-reviewer) further hardened by strict-branching on `subaccountId === null` to choose between the two delegate paths up front. Return type changed from `void` to `boolean` so callers can restore the pre-broker 404 behaviour for missing/cross-scope IDs.

**Why this matters.** This is a class of cross-tenant-within-org isolation hole that adversarial-reviewer's auto-trigger surface (server/db/schema, routes, middleware) catches at the route layer but misses at the service-layer when the route looks correct. The defense-in-depth is to make subaccountId a hard parameter at the service boundary.

## Pattern: Stable structured-log codes must use logger.info, never console.log

**Context.** New foundation log codes (`foundation.risk_tier.gate_derived`, `foundation.policy_envelope.resolution_failed`, etc.) had two `console.log` call sites in `policyEngineService.ts` instead of `logger.info`. Downstream observability and alerting consume these codes via the structured-log pipeline (correlation IDs, level, structured fields). `console.log` writes to stdout outside that pipeline, breaking ingestion of half the events emitted from that service.

**Resolution.** All new stable log codes route through `import { logger } from '../lib/logger.js'`. Sibling new services (`credentialBrokerService.ts`, `runTraceService.ts`) had it correct from chunk 5; `policyEngineService.ts` regressed because it pre-existed and the chunk-4 patch didn't add the import. Lint/typecheck don't catch this — the contract is "downstream consumes the stable code", which is observability, not type-system.

**Detection heuristic.** When introducing a new namespaced log code (`<feature>.<event>`), grep the file for both `console.log('<code>` and `logger.info('<code>` — only the structured form should appear.

## Pattern: Type seam for future variants — declare the wider type now, restrict registration at runtime

**Context.** While locking the ExecutionBackend Adapter Contract spec (`tasks/builds/execution-backend-adapter-contract/spec.md`), ChatGPT-spec-review F1 caught that typing `ExecutionBackend.id` as `ExecutionMode` (a closed five-value union) would force a future cascading rename when OpenClaw lands and introduces internal variants like `openclaw_managed` vs `openclaw_external`. Renaming a contract type after it has propagated through the registry, finaliser, and reconcile signatures is exactly the kind of "expensive to retrofit" cost that's cheap to pre-empt at spec time.

**Resolution.** Introduce the wider type now (`ExecutionBackendId = ExecutionMode | 'openclaw_managed' | 'openclaw_external'`) and key the registry, `resolve()`, finaliser, and reconcile on it. Keep dispatch keyed on the narrower `ExecutionMode` (subtype assignment is automatic). Restrict V1 by a runtime guard at registration time: a register-call carrying an OpenClaw `ExecutionBackendId` value throws `BackendCapabilityViolation('OpenClaw backend ids reserved for Phase 3')`. The guard is removed when the OpenClaw adapter lands.

**Why this matters.** A type seam carries forward without code changes; a type rename touches every call site. The wider type costs nothing at runtime (V1 still only registers ExecutionMode values) but eliminates a future PR that exists solely to rename the parameter type at every dispatch / finalise / reconcile call site. Apply this pattern whenever a contract field will plausibly need to accept additional discriminant values within the next ~2 specs — the cost-to-add-now is one type definition; the cost-to-add-later is a contract-wide rename.

**Detection heuristic.** During spec review, ask: "is this id/discriminant typed as a closed union that the spec itself already mentions might expand?" If yes, expand the type now and restrict at runtime.

## Pattern: Service-layer circular import — extract shared types into a neutral file

**Context.** Same spec session, F3. Adapter types (`executionBackends/types.ts`) needed `TokenBudget` and `LoopResult` from `agentExecutionService.ts`, while `agentExecutionService.ts` imports `executionBackends/registry.ts` (which imports `executionBackends/types.ts`). Result: `types.ts → agentExecutionService.ts → registry.ts → types.ts` cycle. This is the service-layer analogue of the 2026-04-25 schema-as-leaf finding (KNOWLEDGE.md), but the fix shape is different.

**Resolution.** Extract the shared type aliases (`TokenBudget`, `LoopResult`) into a new neutral file (`server/services/agentExecutionTypes.ts`) — type aliases only, zero runtime code. Both consumers import directly from the neutral file. The original service file re-exports the types for backwards compatibility with existing consumers (so call sites do not churn). Acceptance test: `expect(typesModuleSource).not.toMatch(/from .+agentExecutionService/)` in the contract pure test.

**Why this matters.** Schema-leaf and service-leaf cycles have the same root cause (a leaf depending upward) but different fix shapes — schema fix is to drop the import; service fix is to relocate the shared type. Don't try to fix a service-layer cycle by inverting one of the imports; the right move is to lift the shared shape into a neutral module that neither side owns.

**Detection heuristic.** When a new file references a "private" type from a module that will eventually depend on the new file, treat the type as already-shared and lift it before authoring the new module. The cycle is preventable at design time; catching it at typecheck time is rework.
## Pattern: actionRegistry directory-shim split (refactor-action-registry, 2026-05-10)

**Context.** The monolithic `server/config/actionRegistry.ts` (3971 lines) was split into per-domain modules under `server/config/actionRegistry/` as part of the refactor-action-registry build.

**Directory shape:**

```
server/config/actionRegistry/
  types.ts          — ActionDefinition type + factory helper types (unchanged)
  factories.ts      — nine deep-module factory functions (unchanged)
  core.ts           — capability discovery, email/tasks, devops, workflow entries
  intelligence.ts   — cross-subaccount intelligence, universal skills, social media
  agents.ts         — ads, CRM, finance, content/SEO, knowledge management
  methodology.ts    — read_priority_feed, search_agent_history, 31 methodology skills
  configuration.ts  — config-write skills, Phase G digest skills, workflow.run.start
  clientpulse.ts    — crm.* actions, notify_operator, cached_context_budget_breach
  commerce.ts       — spend skills, promote_spending_policy_to_live
  support.ts        — support.* actions
  index.ts          — assembles all domains, runs IIFE, exports all helpers/constants
```

`server/config/actionRegistry.ts` is a 3-line re-export shim (`export * from './actionRegistry/index.js'`). All callers resolve unchanged.

**Key constraints:**

1. **Insertion order.** The spread order in `index.ts` must match the original file's section order: `coreActions, intelligenceActions, agentsActions, methodologyActions, configurationActions, clientpulseActions, commerceActions, supportActions`. V8 preserves insertion order for non-integer string keys.

2. **IIFE runs AFTER all spreads.** `applyRuntimeCheckCoverageDefaults` mutates `ACTION_REGISTRY` post-construction. It must appear in `index.ts` after the final spread, never in a domain module.

3. **IIFE-target factories must not pre-populate IIFE-owned fields; inline-bucket factories must.** `verify`, `verifyNullJustification`, `reversible`, and `blastRadius` are set by the trailing IIFE sweep for entries that don't set them inline. The seven IIFE-target factories (`defineCanonicalRead`, `defineInternalRead`, `defineExternalRead`, `defineInternalStateWrite`, `defineExternalWrite`, `defineConfigWrite`, `defineMethodologySkill`) must leave these fields `undefined` so the IIFE can apply the bucket-correct defaults — pre-populating breaks the IIFE. The two inline-bucket factories (`defineCustomerMessagingWrite`, `defineSpendWrite`) DO pre-populate these because the original source's customer-messaging and spend entries carried inline justification strings that must be preserved byte-for-byte.

4. **Diff-test gate is the correctness oracle.** `scripts/diff-action-registry.ts` compares the built registry against `scripts/snapshots/action-registry.snapshot.json`. A pure file relocation produces zero semantic diff. Never modify the snapshot file — CI maintains it.

5. **Direct-object exceptions.** Roughly 25-30 entries don't fit any factory and stay as direct object literals in the relevant domain module. Common reasons: `actionCategory: 'api'` for internal reads (factories hardcode `'worker'`), entries with no `mcp` field (factories pre-populate it), unique `defaultGateLevel: 'block'`, dotted slugs, non-standard fields like `scopeRequirements`/`onFailure`, and customer-messaging-shaped entries whose IIFE-derived `blastRadius: 'tenant'` would shift to `'external'` under `defineCustomerMessagingWrite`. Each direct-object entry carries an inline comment naming the divergence.

**Why this matters.** The shim pattern is zero-cost for callers: `import { ACTION_REGISTRY } from 'server/config/actionRegistry.js'` still works. Adding a new skill means editing only the relevant domain module (e.g. `core.ts` for a new capability skill). The diff-test gate catches semantic drift without manual inspection of 3000-line diffs.

## Pattern: chatgpt-spec-review automated mode saturates around round 3 — stop on re-raise majority

**Context.** Running automated chatgpt-spec-review on `phase-1-showcase-mvps/spec.md` with `gpt-4.1`: round 1 produced 10 findings (6 real applies + 4 already-deferred/rejected). Round 2 produced 8 findings (6 real applies + 2 re-raises). Round 3 produced 10 findings of which 6 were re-raises of items already addressed in rounds 1-2, 1 was a project-policy rejection (frontend tests forbidden), 2 were already-deferred Open Decisions, 1 was a real low-severity apply.

**Resolution.** The agent contract says "Run automated rounds until APPROVED or 3 rounds elapse without APPROVED, then finalise." That's the saturation cap. Practical stopping rule: if round N produces 50%+ re-raises of already-addressed items, the loop has converged regardless of verdict — stop. Verdicts can stay CHANGES_REQUESTED indefinitely because the model rewords concerns the spec already handled.

**Detection heuristic.** Track findings by `evidence` text and rationale across rounds. A round where most rationales reference sections you edited in prior rounds is saturation. The model is generating noise, not finding new gaps.

## Pattern: Two-ledger artifact designs (worker-internal + customer-facing) need explicit drift-handling subsection

**Context.** Spec described `iee_artifacts` (worker-internal) and `run_artifacts` (customer-delivery) as separate by-design ledgers. ChatGPT spec-review raised "no canonical source of truth" three rounds in a row — once with the original framing, once after the round-1 drift-handling fix, once after the round-2 fix. The reviewer wanted a single source of truth even when the design intentionally has two.

**Resolution.** Document the two-ledger split with: (1) what each ledger covers, (2) what happens when one has a row the other doesn't (each direction's failure mode and self-healing path), (3) the explicit "no reconciliation worker" decision with rationale. Reviewers stop re-raising once the failure modes are enumerated.

**Detection heuristic.** Any spec that describes two ledgers/tables for the "same" data (worker vs main, internal vs external, ledger vs cache) needs an explicit drift-handling subsection up front, not deferred to "see Open Decision."

## Pattern: Prompt-injection prevention in MVP specs — defence-in-depth beats programmatic enforcement

**Context.** Spec exposed `agent_config.promptOverride` as a freeform 500-char textarea per inbox. ChatGPT spec-review flagged "no programmatic prompt-injection prevention" three rounds running. There is no proven programmatic prompt-injection prevention at scale today — the field is an open research problem.

**Resolution.** The MVP posture is dev-discipline (length cap + forbidden-token scan + composition rules + audit trail) plus defence-in-depth via the architecture (fixed agent tool surface + HITL approval still gates customer-facing replies). State explicitly in the spec that the controls "are dev-discipline, not a security boundary" and that the defence-in-depth comes from the agent's locked tool surface plus the approval flow. Even a successful prompt-injection cannot send a customer-facing reply in `assisted` mode without passing the HITL gate.

**Detection heuristic.** When a spec exposes any LLM-input-from-customer-config surface, the security review pass will flag prompt injection. Pre-empt by writing the four-line defence-in-depth posture into the spec itself.

## Pattern: PG advisory_xact_lock + partial unique index for singleton-per-tenant install

**Context.** Spec asserted "singleton-per-subaccount" enforcement at install time but didn't address the race where two concurrent installs both pass the existence check before either commits. Standard SELECT-then-INSERT can interleave under read-committed isolation.

**Resolution.** Two-layer defence: (1) `pg_advisory_xact_lock(hashtextextended(<subaccount_id::text || system_agent_id::text>))` taken at install transaction start — second concurrent transaction blocks until first commits/rolls back; (2) partial unique index on `subaccount_agents (subaccount_id, applied_template_id) WHERE is_active = true` filtered to the system-agent-template — even if both transactions race past the advisory lock, the second insert fails with `23505`. Map `23505` to HTTP 409.

**Detection heuristic.** Any "singleton-per-X" install / enable / activate flow needs both: advisory lock for clean error path AND partial unique index as the safety net. Check for whether the existing schema's unique index actually filters by the right scope (active rows only, correct linkage column) — broader indexes don't enforce singleton.

## Pattern: Eval gate fail-open with Activity-feed signal beats fail-closed for sub-2-row state

**Context.** Spec required Foundry-derived regression set for the support-agent eval gate. If Foundry export is unavailable at gate time (export hiccup, data stale), fail-closed would block all unrelated PRs from merging until the data is restored.

**Resolution.** Two-tier policy: (1) CI gate fails open (exits 0) when fewer than two `support_eval_runs` rows exist, AND emits `phase1.support.eval_drift_detected` to the Activity feed so the operator sees the silence. Sub-2-row state happens whenever the daily eval job has not yet run twice, including legitimate fresh-CI scenarios. (2) Lock-in gate (per production-verification step at §8.5) is fail-closed: lock-in cannot proceed without a fresh regression set within 30 days, and Open Decision escalates if the data is permanently unavailable. Ad-hoc CI doesn't block; lock-in does.

**Detection heuristic.** Any acceptance criterion that depends on eternally-available external data needs a two-tier "ad-hoc fail-open + lock-in fail-closed" split, with the fail-open clearly logged so the operator can see it.

## Pattern: Stable-slug discriminator beats UUID literal in partial unique indexes (refinement of PG advisory + partial index pattern above)

**Context.** Round 2 of the phase-1-showcase-mvps chatgpt-spec-review (2026-05-10) raised that the original "partial unique index on `subaccount_agents (subaccount_id, applied_template_id) WHERE is_active = true AND applied_template_id = <system-agent-template-id>`" wording could not be implemented as written: a partial index cannot reference a runtime UUID placeholder (the system_agent_id is a `gen_random_uuid()` generated at seed time, not a stable literal), and a partial index cannot reference another table to look up the slug.

**Resolution.** Add a stable-slug column to the table the partial index keys on (in this case `subaccount_agents.applied_template_slug text`, INV-5-allowed additive), backfilled from `system_agents.slug` in the same migration. The partial unique index then filters on the slug literal (`WHERE is_active = true AND applied_template_slug = 'support-agent'`). Pin the slug stability invariant explicitly: future system-agent renames must NOT rewrite historical slugs — the slug is identity, not display copy. Successor-identifier migrations are deliberate corrective migrations per `DEVELOPMENT_GUIDELINES.md § 6` rule 5, never casual updates.

**Detection heuristic.** Any partial unique index whose `WHERE` clause needs to scope to a foreign-key target's identity (system-template, system-agent, system-skill) cannot use the FK UUID as the literal — UUIDs are seed-time-generated. Add a denormalised stable-slug column on the indexed table, populate at write time, and filter on the literal. Trips up reviewers when the spec says "filtering on `applied_template_id = <UUID>`" without explaining how the literal becomes stable.

## Pattern: COALESCE optional canonical-layer watermarks in NOT-EXISTS predicates (silent UNKNOWN bug)

**Context.** Round 2 of the phase-1-showcase-mvps chatgpt-spec-review (2026-05-10) caught a real correctness bug: the support-agent run-loop terminal-event predicate compared `e.created_at >= canonical_tickets.last_customer_message_at`. When `last_customer_message_at` is NULL (no inbound customer message ingested yet, or legacy ingestion paths predated the column), the comparison evaluates to UNKNOWN, the inner subquery returns no rows, the outer NOT EXISTS returns TRUE, and old tickets with terminal events get reprocessed forever. Silent failure mode — easy to miss in code review because the predicate looks fine for non-null cases.

**Resolution.** Wrap any optional canonical-layer watermark in `COALESCE(<watermark>, <safe-floor>)` so the predicate degrades to a known-good comparison rather than UNKNOWN. For the support-agent case: `COALESCE(last_customer_message_at, created_at)` pins the lower bound to ticket creation time as a degenerate safe floor. Pair the COALESCE with an explicit ingestion-contract paragraph naming the writers (`connectorPollingService`, `webhookAdapterService`) so future developers know who is responsible for keeping the watermark fresh. Add test fixtures specifically for the null-timestamp degenerate cases — null + earlier-created (excluded) and null + later-created (eligible).

**Detection heuristic.** Any predicate of shape `<event_column> >= <optional_canonical_column>` inside a NOT EXISTS / WHERE NOT IN / aggregate filter is a silent-UNKNOWN landmine when the optional column is nullable. Reviewer prompt: "Is this column ALWAYS populated by every ingestion path that touches the parent row, including legacy paths?" If the answer is "should be" or "the writer is supposed to", COALESCE the comparison. The cost of the COALESCE is one extra column read; the cost of the bug is silently re-processing data forever.

## Pattern: Worker-internal `iee_artifacts` vs customer-delivery `run_artifacts` source-of-truth precedence

**Context.** Phase 1 Showcase MVPs (2026-05-10). The IEE browser worker already has its own artifact table (`iee_artifacts`) used internally for IEE progress UI, transcription cache, and dedup-by-content-hash inside the worker loop. A naive design would reuse that table for customer-facing file delivery.

**Resolution.** Two separate tables, distinct roles: `iee_artifacts` is the worker-internal ledger (write by worker; read by IEE progress UI + worker loop). `run_artifacts` is the customer-delivery ledger (write by `fileDeliveryService.upload` via main-app finalize route; read by customer-facing UI only). Promotion path: worker calls `uploadArtifact` helper → main-app `/api/internal/run-artifacts/finalize` → `fileDeliveryService.upload` inserts `run_artifacts` row. The original `iee_artifacts` row is NEVER moved or deleted by promotion. Customer-facing UI reads `run_artifacts` only; worker reads `iee_artifacts` only. No automatic backfill of pre-MVP `iee_artifacts` rows.

**Detection heuristic.** Whenever an internal-caching table and a customer-delivery table serve the same content, keep them separate. Conflating them couples customer-delivery SLAs to internal caching volatility and creates dual-write complexity. The promotion step (internal → delivery) is the explicit boundary.

## Convention: Detector pattern path is workspaceHealth, not systemMonitoring

**Context.** Phase 1 Showcase spec §4.6.2 referenced `server/services/systemMonitoring/detectors/` for the stale-macro-run detector. That path does not exist.

**Convention.** The workspace health detector pattern lives at `server/services/workspaceHealth/detectors/`. All async detectors that perform their own DB reads are registered in `ASYNC_DETECTORS` in `server/services/workspaceHealth/detectors/index.ts`. Pure helper functions live in a `<name>Pure.ts` sibling file; the async wrapper imports the pure function and converts findings to `WorkspaceHealthFinding[]`. When a spec mentions `systemMonitoring/detectors/`, always use `workspaceHealth/detectors/` instead.

## Pattern: Singleton-agent-per-subaccount — advisory lock + partial unique index on applied_template_slug

**Context.** Phase 1 Showcase MVPs Chunk 7 (2026-05-10). The Support Agent must be installed at most once per subaccount. A naive `SELECT → INSERT` check is vulnerable to TOCTOU races under concurrent requests.

**Resolution.** Two-layer defence: (1) `pg_advisory_xact_lock(hashtext(subaccountId || ':' || systemAgentId)::bigint)` acquired at the start of the install transaction serialises concurrent installs for the same (subaccount, system_agent) pair. (2) Partial unique index `subaccount_agents_support_agent_singleton_idx ON subaccount_agents(subaccount_id) WHERE is_active = true AND applied_template_slug = 'support-agent'` is the safety net — catches any race that bypasses the lock and maps `23505` to `409 already_installed`. The advisory lock produces the clean error path (checked before INSERT); the partial index is the serialisation guarantee. Migration `0314`.

**Pattern location.** `server/services/supportAgentInstallService.ts`. CI gate: `scripts/gates/verify-support-agent-skill-set.sh`.

## Convention: applied_template_slug is a stable install discriminator — never rewrite

**Context.** Phase 1 Showcase MVPs Chunk 7 (2026-05-10). The `applied_template_slug` column on `subaccount_agents` is the value the partial unique index keys on for the singleton guard.

**Convention.** Once a `subaccount_agents` row carries `applied_template_slug = 'support-agent'`, that value MUST NOT be rewritten by future system-agent renames or any other code path. Rewriting would either reopen the singleton race or invalidate the index's coverage. Mutating `applied_template_slug` outside `supportAgentInstallService.ts` is a CI gate failure (`scripts/gates/verify-support-agent-skill-set.sh`). The slug is the install identity, not a display string — it is decoupled from the system agent's `name` field on purpose.

## Pattern: window.open() for authenticated download endpoints — call sync, not after await

**Context.** Phase-1-showcase-mvps Chunk 4 (RunTraceArtifactsPanel). Preview and Download buttons need to open an authenticated platform download URL in a new tab. An early implementation called `issueSignedUrl()` (async) before the `window.open()`, which silently fails popup-blocker checks: browsers only allow `window.open()` called synchronously inside a user gesture handler — any `await` before the call severs the gesture link, the browser blocks the popup, and the user sees nothing.

**Resolution.** Route Preview and Download directly to the authenticated endpoint URL (`/api/run-artifacts/:id/download`) — no async call needed, the URL is computed from the artifact ID already in state. Call `window.open(url, '_blank')` synchronously. Reserve async issueSignedUrl only for Copy-link, where the signed URL is the actual payload rather than a navigation target. Check the return value (`const win = window.open(...); if (!win) { setRowError('Popup blocked...'); }`) to surface the popup-blocker case.

**Detection heuristic.** Any `await X; window.open(...)` pattern in a click handler is a popup-blocker trap. If the URL can be computed synchronously, remove the await. If async is genuinely needed, the only fix is user-education (popup permission prompt, or a fallback link element).

## Pattern: Inline Content-Disposition for browser PDF preview via download proxy

**Context.** Phase-1-showcase-mvps Chunk 4. A single route (`GET /api/run-artifacts/:id/download`) serves both Preview (inline, browser renders PDF) and Download (attachment, browser saves file) by reading a `?disposition=inline` query parameter. The default (no param) is `attachment`; `?disposition=inline` sets `Content-Disposition: inline; filename="..."` which causes Chrome/Firefox to render PDFs in the built-in viewer instead of downloading.

**File:** `server/routes/runArtifacts.ts`

**Detection heuristic.** When a route needs to serve the same binary with different browser behaviour, a single query-param-controlled disposition is simpler than two separate routes and keeps the event-emission logic (the `phase1.file_delivery.downloaded` audit event) in one place.

## Gotcha: Judge score scale is 0–5, not 0–1 — threshold and clamp must match

**Context.** Phase-1-showcase-mvps Chunk 9 (eval harness). The spec §5.5.2 documents the draft judge prompt as scoring on a 0–5 scale (`draftJudgeScoreAvg` column comment: "0..5"). An early implementation used a 0–1 scale throughout (threshold 0.70, clamp `Math.min(1, score)`), which made the gate pass trivially for any non-zero score.

**Resolution.** Three places must all agree: (1) the judge prompt's scoring rubric ("Score from 0.0 to 5.0"), (2) `THRESHOLD_JUDGE_MIN = 4.0`, (3) `Math.min(5, overallScore)` clamp. If any one of these is on a different scale the gate silently becomes meaningless. The DB column `numeric(4,2)` stores 0–5 correctly.

**Detection heuristic.** Whenever a judge or rubric score threshold appears, explicitly state the scale (0–N) in the constant name or comment. "0.70 threshold" is ambiguous; "4.0 threshold (0–5 scale)" is not.
## Pattern: Cycle-prevention regex must anchor on the exact filename, not a substring

**Context.** Execution Backend Adapter Contract build (2026-05-10) added §8.32 cycle-prevention assertion coverage rule, then extended the assertion to 8 files in the dispatch chain. The new tests immediately failed against `_ieeShared.ts` even though it has no runtime cycle. Root cause: the original regex `[^'"]*agentExecutionService[^'"]*` matches `agentExecutionServicePure.js` as a false positive — `_ieeShared.ts:44` legitimately imports `computeRunResultStatus` from there.

**Resolution.** Tighten the regex to `agentExecutionService\.(?:js|ts)` so the file extension anchors the match. Both the original two assertions (on `types.ts` and `options.ts`) and the new chain-coverage assertion need the precise pattern. Pure-helper sibling files (`*Pure.js`, `*Pure.ts`) legitimately re-share the prefix and must not trip the cycle-prevention test.

**Detection heuristic.** Any "MUST NOT import from `<filename>`" assertion regex must anchor on `<filename>\.(?:js|ts)` (not `<filename>[^'"]*`) so adjacent pure-helper modules sharing the prefix don't false-positive. The convention `xxx.ts` + `xxxPure.ts` is widespread in this codebase — every pure-helper extraction creates a regex landmine.

## Pattern: Domain-primitive registration must not be gated on queue-backend choice

**Context.** Execution Backend Adapter Contract build (2026-05-10) — pr-reviewer flagged that `server/index.ts` registered all five `ExecutionBackend` adapters inside `if (env.JOB_QUEUE_BACKEND === 'pg-boss') { ... }`. Three of the five (`api`, `headless`, `claude-code`) have no pg-boss dependency at all; the gating was a copy-paste hangover from when the block was originally just the IEE event handler attachment. With `JOB_QUEUE_BACKEND='bullmq'` (an env enum value the codebase still allows), the registry would be empty at HTTP-handler time and EVERY `executeRun` call would throw `BackendNotRegistered`, including the default `api` mode. Silent regression — no compile-time warning would surface it.

**Resolution.** Split the boot block in two: (1) unconditional adapter registration in its own try/catch, (2) pg-boss-gated event-handler attachment that depends on registration completing first. Document the boot-ordering invariant inline so a future maintainer doesn't re-merge the blocks.

**Detection heuristic.** Any boot-time `register*()` call sitting inside an env-conditional gate is suspicious. Ask: "Does the thing being registered actually depend on the env condition, or just one consumer of it?" If the registration is for a domain primitive (registry entry, dispatch table, capability map), it almost always belongs outside the env gate, with the env-conditional consumer attached separately.

## Pattern: Lifting code into a generic orchestrator drops the leaf side-effects

**Context.** Execution Backend Adapter Contract build (2026-05-10) — Chunk 3 lifted `finaliseAgentRunFromIeeRun`'s body into the new generic `finaliseAgentRunFromBackend` orchestrator. The legacy function had an early-return for the parent-row-missing case that ALSO stamped `iee_runs.event_emitted_at = now()` so the worker's `retryUnemittedEvents()` sweep would not re-fire forever. The lift moved the early-return into the orchestrator but dropped the stamp. The Codex dual-reviewer pass caught it; without the stamp, every orphaned `iee_runs` row would have re-emitted its terminal event indefinitely once deployed.

**Resolution.** When lifting a special-case path (early return / null guard / failure branch) into a generic orchestrator, audit it for non-obvious side-effects baked into the original code path. The fix here was to widen the adapter contract to allow `parentRun: null` and have the adapter own the stamp, so the side-effect followed the lifecycle into the new abstraction. Generic orchestrators should not own concrete-row side-effects; lift them into the adapter that owns the row.

**Detection heuristic.** Whenever a refactor extracts a generic shape from a concrete function with multiple early-return paths, diff the legacy function against the lift line by line. Side-effects in early-return branches (write a stamp, emit a metric, log an audit event, schedule a retry) are the easy ones to drop. The acceptance criterion should explicitly enumerate the side-effects the extraction must preserve, not just the happy-path return value.

## Pattern: Capability-gated optional methods make adapter contract widenings cheap

**Context.** Execution Backend Adapter Contract build (2026-05-10) — dual-reviewer fix needed to widen `BackendFinalisationInput.parentRun` from a non-null shape to nullable so the orchestrator could hand the orphan case to the adapter. Five adapters live behind the contract, but only the two delegated ones (`iee_browser`, `iee_dev`) implement `finalise()`. The api/headless/claude-code adapters declare `'in_process'` / `'subprocess'` capabilities and have no `finalise()` slot — the registry's Rule 2 only requires the delegated lifecycle methods when `capabilities.includes('delegated')`.

**Resolution.** Capability-gated optional methods in the contract mean a widening that touches a delegated method only edits the delegated implementations. The api/headless/claude-code adapters were untouched. Both IEE adapters are thin forwarders to `_ieeShared.ts::ieeFinalise`, so the actual edit was to one shared body. The contract type signature change required no adapter-level edits beyond the shared helper.

**Detection heuristic.** When considering a contract change against a registry-resolved adapter set: list the adapters and their declared capabilities. Methods gated by capability only need re-edits in adapters that declare the gating capability. Contract widenings (T → T | null, narrow union → wider union) flow through cleanly; contract narrowings (the reverse) require all gated implementations to re-validate. The DRY of the IEE pair via `_ieeShared.ts` reduces the per-edit cost from N×M to 1 — worth preserving when adding new delegated adapters.

### [2026-05-10] Pattern — Boot-time registration validation must be FATAL, not log-and-continue

**Context.** ChatGPT PR review (PR #281, Round 1, B1) — `server/index.ts` registered all five `ExecutionBackend` adapters in a try/catch that logged registration errors and continued startup. The spec made registration validation a boot-time safety boundary (adapters that fail validation must never reach dispatch); a partial-registry boot would surface as a 500 on every dispatch, strictly worse than a clean fatal-on-failure crash.

**Rule.** When a spec says "registration validation must prevent dispatch", the implementation must rethrow after logging, matching the fatal-boot-failure pattern of other required boot dependencies. Catching-and-continuing produces a half-booted process where every consumer of the registry fails at runtime, the operator sees no boot-time signal, and "boot succeeded" is technically true but functionally misleading. The fix is two lines: keep the structured warn line for forensics, then `throw err`.

**Detection heuristic.** Any boot-time `register*()` call wrapped in try/catch where the catch logs and proceeds is suspicious. The right shape is: log structured detail (error message, stack, context) FOR forensics, then rethrow. The exception is when the registration is truly optional (e.g., a feature-flagged plugin that's opt-in). For domain-primitive registries (dispatch tables, capability maps, finaliser routing), opt-in is rare and rethrow is the safe default.

### [2026-05-10] Pattern — Adapter-contract field semantics must match the migration intent

**Context.** ChatGPT PR review (PR #281, Round 1, B2) — `claudeCodeBackend.ts` returned `ccResult.sessionId` as `backendTaskId` for observability. The contract spec said `backendTaskId` is for delegated backends only and should be `null` for in-process and subprocess adapters. The migration `0313_execution_backend_columns.sql` introduced `(backend_id, backend_task_id)` as a generic delegated-task reference, with `backend_task_id` null for in-process/subprocess paths. Returning a Claude session ID in that field was hidden contract drift inside what looked like an observability improvement.

**Rule.** When a migration introduces a typed contract field with a stated semantics ("delegated-task reference, null for non-delegated"), the adapter implementations must match the stated semantics — even when the adapter has another value that "fits" the field's shape. Observability identifiers belong in the typed log payload (`toolCallsLog[0].sessionId` already preserved this) or in a deliberately named future field (`backendSessionId`); never in a contract field whose semantics are documented elsewhere.

**Detection heuristic.** Cross-check every adapter implementation against the migration that introduced the contract field. Grep the migration text for the field's column comment, then grep adapter code for the field name in returned objects. If an adapter populates the field with a value that doesn't match the migration's stated semantics, the implementation has drifted from the contract. The most common drift shape: an adapter has a "spare" identifier (session id, request id, trace id) that's tempting to surface through a contract field that happens to be the right type. Resist — add a deliberate observability field.

### [2026-05-10] Pattern — Verify route-error envelope behaviour before documenting HTTP shape in code comments

**Context.** ChatGPT PR review (PR #281, Round 2, P1) — A code comment near a `throw ParentRunNotDispatchable` claimed "the route layer's existing error envelope renders typed errors as a 4xx". Investigation showed: `ParentRunNotDispatchable` extends `Error` with no `statusCode` field; `normaliseRouteError` checks `instanceof AppError`, then duck-typed `statusCode`, then falls through to `kind: 'unknown'` with statusCode 500. The error today actually maps to a 500 envelope, not a 4xx — the comment was verifiably wrong, and would mislead future maintainers reasoning about the route surface.

**Rule.** When a typed error is returned to a route layer, do NOT document its HTTP shape in code comments unless you've grep-verified the route mapping. The safe default is a neutral comment ("the route layer will surface the typed error according to the existing error-envelope behaviour") that doesn't claim a specific status code. A deliberate AgentRunResult shape can be added later if/when the desired client-visible shape is decided — that's a behaviour change, separate scope.

**Detection heuristic.** Any inline comment that claims "renders as 4xx" / "renders as 5xx" / "returns N" near a `throw` site is a verification target. Grep the route layer for the typed error class name and check the envelope normalisation code. If the error class lacks `statusCode` AND doesn't extend the route layer's typed-error base, it falls through to the unknown-error branch — which is almost always a 500. Don't write status-code claims into code comments without that grep.

### [2026-05-10] Pattern — When the plan says "rethrow if no existing race-loser shape exists", verify by searching origin/main first

**Context.** ChatGPT PR review (PR #281, Round 1, T1) — The plan explicitly said: "map ParentRunNotDispatchable to the exact existing race-loser shape, or rethrow and document if no such shape exists". The implementation invented a synthetic zeroed `AgentRunResult` with `summary: null`, zero counters, and a coerced status. Verification against `origin/main` showed the pre-cutover dispatch had no such shape — the synthetic response was invented, not replicated.

**Rule.** When a plan directs "match the existing X shape, or rethrow if X doesn't exist", verification is mandatory: grep `origin/main` for the shape's call sites BEFORE inventing one. The "or rethrow" branch exists precisely so the implementation doesn't invent a new shape during a refactor — synthetic shapes are silent contract additions that are hard to back out later. Rethrow + structured warn line is the spec-compliant path when no existing shape exists.

**Detection heuristic.** Plans that mention "existing X" alongside "or do Y if X doesn't exist" are testing whether the implementer verified. The invented-shape failure mode looks like a normal refactor at first glance — the synthetic values often look reasonable in isolation. The tell is that those values weren't there before the refactor. The verification step is one grep against `origin/main` for the shape's signature; skipping it produces a class of bugs where downstream consumers receive plausible-but-wrong data.

### [2026-05-10] Pattern — Capability mismatches that the registry should make impossible must THROW, not silently return false

**Context.** ChatGPT PR review (PR #281, Round 1, T2) — `finaliseAgentRunFromBackend()` resolved an adapter and, if the adapter wasn't delegated or lacked finalisation methods, logged `agentRunFinalization.non_delegated_adapter` and returned `false`. The registry already validates delegated adapters at registration time (Rule 2 requires delegated lifecycle methods when `capabilities.includes('delegated')`), so reaching this branch indicates caller misuse (stale event payload, wrong reconciliation backendId, registry/config drift) — not a recoverable reconciliation result. Returning `false` made a bad call look like an idempotent no-op.

**Rule.** When a runtime check covers a case the registry's invariants make impossible, the right outcome is a typed throw, not a silent boolean false. False says "this is a recoverable no-op state"; throw says "the system is in an invalid configuration the registry promised wouldn't happen". Calling finalisation on `api`, `headless`, or `claude-code` is a programmer error, not a recoverable case — the typed `FinaliseRequiresDelegatedAdapter` error makes the misuse loud at every layer (logs, sentry, route 500).

**Detection heuristic.** When implementing a runtime guard that "shouldn't" be reachable per the registry's invariants, ask: "if this branch fires, is the system still in a valid state?" If no, throw a typed error so the failure is loud. If yes, return a typed result that distinguishes "recoverable no-op" from "actual success". Don't conflate the two by returning a generic false — the caller can't tell which branch fired and bug-hunting takes longer.

## Pattern: UI pct() helper applied to wrong scale produces 400% — use scale-specific formatters

**Context.** Phase-1-showcase-mvps finalisation (2026-05-11) — `SupportEvalsPage.tsx` had a shared `pct(value)` helper that multiplied by 100 and appended `%`. Classification accuracy (0–1 scale) rendered correctly: `pct(0.87) = "87.0%"`. Draft judge score (0–5 scale) rendered wrong: `pct(4.0) = "400.0%"`. Both the score and its threshold used `pct()`, so the mismatch was consistent (both showed 400%) and made it harder to spot.

**Rule.** When a page displays two metrics with different scales (0–1 vs 0–5, or percentage vs score), each scale needs its own formatting helper. A single generic `pct()` is only safe when every value it formats is truly 0–1. The moment one metric is on a different scale, extract `judgeScoreDisplay()` (or equivalent) rather than overloading the 0–1 helper. The formatter name should encode the scale contract (`judgeScoreDisplay` is explicit; `pct` is ambiguous).

**Detection heuristic.** Whenever a page renders two metrics side by side and one uses `pct()` while the other is documented as a 0–N scale elsewhere (column comment, spec, constant name), grep the UI for every `pct()` call and verify all inputs are genuinely 0–1.

## Pattern: Components built in Phase 2 but never imported = dead UI — wire the registration at definition time

**Context.** Phase-1-showcase-mvps chatgpt-pr-review (2026-05-11) — ChatGPT identified three run-trace UI components (`RunTraceArtifactsPanel`, `SupportEventRenderers` map, `MacroFailureRenderers`) that were fully implemented and exported but never imported in their entry-point files (`RunTracePage.tsx`, `RunTraceEventRenderer.tsx`). They were correct implementations of the spec but produced zero visible UI.

**Rule.** When building a new panel, renderer, or map that must be registered or imported somewhere to take effect, write the registration (import statement + wiring line) in the same commit as the component definition. "The component is done" is not done — it's done when it's visible in the UI. For run-trace renderers specifically: a new `*Renderer` component must be (1) exported from its file and (2) imported + either registered in a lookup map or returned from a lookup function in `RunTraceEventRenderer.tsx`.

**Detection heuristic.** After building any component intended for the run-trace event stream, grep `RunTraceEventRenderer.tsx` and `RunTracePage.tsx` for the component or its module path. If neither file imports it, the component is dead. Same applies to any registry pattern: grep the registry's file for the new handler's symbol.

## Pattern: Pure helper encapsulates a policy — always call it, never hardcode the constant at the call site

**Context.** Phase-1-showcase-mvps chatgpt-pr-review (2026-05-11) — `fileDeliveryServicePure.ts::deriveSignedUrlExpiry(artifactKind)` existed and correctly returned 604800s (7d) for `report` and 86400s (24h) for everything else. The signed-URL route in `runArtifacts.ts` built `expiresAt` with `const sevenDays = 7 * 24 * 60 * 60 * 1000` — always 7d regardless of artifact kind.

**Rule.** When a pure helper encapsulates a policy (expiry, TTL, limit, threshold), callers MUST call the helper — never inline the magic number. The pure helper is the policy; inlining the number at the call site creates a second policy that silently diverges the moment the pure helper is updated. The fix is also a useful template: add the artifact kind to the select query, type it via the shared type, pass it to the pure helper.

**Detection heuristic.** When writing any code that encodes a duration, limit, or threshold as a numeric literal, grep the codebase for a pure helper that returns the same kind of value. If a helper exists — use it. Common offenders: signed URL TTL (use `deriveSignedUrlExpiry`), eval thresholds (use the DB-stored values), score clamps (use `Math.min(MAX_SCALE, ...)`).

## Pattern: Separate `usability_state` (broker gate) from `plan_verification_status` (audit signal) — two concerns, two columns

**Context.** Operator-session-identity chatgpt-spec-review (2026-05-11, Round 1 F1). Initial spec made self-declaration connects land in `connected_unverified` — meaning the broker would never issue credentials until plan was independently verified. This made the feature dead-on-arrival for all early users, since V1 has no independent verification mechanism.

**Rule.** When a credential has two separate concerns — "can the broker decrypt and use this?" and "is this credential's metadata confirmed by a third party?" — model them as distinct columns with distinct semantics. `usability_state` is the broker gate: only `connected_usable` allows decryption and injection. `plan_verification_status` is the audit trail: `self_declared` signals unconfirmed tier without blocking access. Mixing the two into a single "unverified = unusable" state creates an unrecoverable hold state that has no exit until infrastructure that may never exist is built.

**Detection heuristic.** When a spec has a state that means both "not yet confirmed by a third party" AND "blocked from use," ask: does the user's action (accepting a disclosure, self-declaring a tier) provide enough confidence to unblock? If yes, split into two fields. The "unconfirmed" signal belongs in a `*_status` or `*_verification_status` column; the "usable" gate belongs in a dedicated `usability_state` or similar state machine column.

## Pattern: Type union members need defined write paths — orphaned values become implementation traps

**Context.** Operator-session-identity chatgpt-spec-review (2026-05-11, Round 1 IC-3). The `planVerificationStatus` TypeScript union included `'unverified'` as a valid value, but no code path in the spec ever set it. The `'failed'` value already covered "couldn't determine tier."

**Rule.** Every value in a discriminated-union or string-literal type MUST have at least one explicitly named write path in the spec (a service method, migration default, or code branch that produces it). Values with no write path will either never appear in production data, or will be set by ad-hoc code that bypasses the intended semantics — both outcomes are bugs. Before locking a spec, grep the type definition and confirm each member is reachable from the execution model.

**Detection heuristic.** For each string-literal type or discriminated union in the data model section, list its values. For each value, search the execution model and chunk plan for the phrase that sets it (e.g., "`plan_verification_status = 'self_declared'`"). A value with no grep hit is orphaned — remove it or add the write path.

## Pattern: Close open questions explicitly in §18 when the answer lands in §18b — stale open questions create builder contradictions

**Context.** Operator-session-identity chatgpt-spec-review (2026-05-11, Round 2 T1). Open Question §18.3 ("subaccount vs org scope for Plus consent — confirm before implementation") was resolved in §18b during spec-reviewer iteration 5, but §18 still showed the original question verbatim. ChatGPT's Round 2 found the contradiction.

**Rule.** When a resolution lands in §18b, update §18 immediately — replace the open question prose with "(Resolved — see §18b: [title])". Do not leave §18 and §18b as parallel documents. Builders reading §18 will see an unresolved question; builders reading §18b will see a resolution. Both reading paths must be consistent.

**Detection heuristic.** Before locking a spec, grep §18 for any question that also appears (by subject) in §18b. Any §18 item whose topic matches a §18b entry should be replaced with a pointer. Conversely, any §18b entry with no corresponding §18 pointer is an invitation to add one (so the §18 reader is not confused by an apparently-unresolved question).

## Pattern: Stale regression tests survive when the test mocks the consequence rather than the implementation

**Context.** Pre-test-hardening pr-reviewer re-review (2026-05-11, commit `3423a0d5` blocker B1.x) — `taskService.createTask.regression.test.ts` asserted that the legacy 4-arg overload "throws synchronously and writes zero rows" via `expect(...).rejects.toThrow('legacy 4-arg shape')` plus `expect(tx.insert).not.toHaveBeenCalled()`. The implementation later pivoted from "throws" to "opens its own db.transaction + sets the GUC + delegates to the canonical path" (needed for sister-branch callers in `workflowEngineService.ts:2716` + `:2962`). The test's mocks did NOT cover `db.transaction` because the original throw fired before any db call — when the implementation pivoted, only the `rejects.toThrow` assertion failed; the unmocked `db.transaction` call hit production code and produced a misleading connection error, not an assertion failure.

**Rule.** A regression test for a contract-narrowing or contract-pivoting change MUST assert on the path taken (which branch ran, which dependency was called, in what order), not just visible side effects on a pre-mocked surface. If you mock `tx.insert` and assert it was not called, you've pinned ONE consequence — but the SUT can change to a different code path that bypasses `tx.insert` entirely without your test catching the pivot. The mock surface area must cover every dependency the test's contract claims is or isn't called.

**Detection heuristic.** When a regression test mocks one path but asserts negatively against a different path ("X was NOT called"), grep the SUT for OTHER side-effect dependencies it could plausibly use (db.transaction, file I/O, network, logger). If any of those are reachable from the SUT and unmocked, the test will pass-by-accident under a pivot. Either mock them too, or restructure the assertion to be a positive claim about the path actually taken.

## Pattern: Sister-branch reconciliation via transitional overloads needs explicit dual-mode test coverage

**Context.** Pre-test-hardening commit `3423a0d5` — `taskService.createTask` ships a `@deprecated` 4-arg overload that opens its own `db.transaction`, sets the `app.organisation_id` GUC, and delegates to the canonical `(input, tx)` path. The overload exists to keep sister-branch callers in `workflowEngineService.ts:2716` + `:2962` functional during the pre-prod-workflow-and-delegation branch's own migration. Without explicit dual-mode tests, a future refactor could remove the GUC SET, change the delegation order, or silently break the legacy path — invisible until sister-branch ships its withOrgTx wrappers.

**Rule.** Whenever a signature change ships a transitional overload that delegates rather than throws, BOTH paths need pinned tests in the same regression file: (1) canonical path succeeds end-to-end, (2) transitional path opens its own context (transaction / lock / session) AND sets every implicit prerequisite (GUC, env var, header) BEFORE delegating, AND emits the deprecation log so ops can track migration runway. The transitional overload's purpose is invisible silent compatibility — pinning the contract is the only way that purpose survives future refactors.

**Detection heuristic.** When reviewing a PR that adds a `@deprecated` overload, look for tests asserting (a) the deprecation log fires, (b) the transitional context-setup runs (tx open, GUC set, etc.), (c) the canonical path is then reached. If any of the three are missing, the overload is a regression risk; route as a Strong recommendation.

## Pattern: Migration-number collision after S2 sync requires renumbering forward, not backward

**Context.** Pre-test-hardening S2 merge (2026-05-11) — main had advanced to migrations 0313 (run_artifacts + execution_backend_columns, two distinct migrations sharing the number) / 0314 (support_agent_install) / 0315 (support_eval_runs) / 0316 / 0317 via PR #281 + PR #283. Pre-test-hardening reserved 0313-0315 (webhook_replay_nonces / connector_configs_webhook_token / connections_status_check). Resolution: renumber the feature branch's migrations FORWARD (to 0318/0319/0320), not backward. Forward-renumbering is safe because (a) no other branch can claim numbers we just took, (b) the migrations have not run anywhere in production yet, (c) update is mechanical (filenames + a small set of code references). Backward-renumbering would conflict with main's already-deployed sequence.

**Rule.** After S2 sync, if both sides claimed the same migration number, the feature branch renumbers to the next free slot AFTER main's highest. Never renumber main's migrations and never reuse a number main has already deployed. Update: (1) the `.sql` + `.down.sql` filenames, (2) `RLS_PROTECTED_TABLES` `policyMigration` field, (3) any inline RAISE EXCEPTION messages that quote the migration number, (4) test files that name the migration in skip-reasons or assertions, (5) build artefacts (spec.md, plan.md, progress.md). Review-log files (frozen historical record) are left untouched. Confirm with `npx tsc --noEmit -p server/tsconfig.json` clean after the rename.

**Detection heuristic.** Before opening a PR, run `git ls-tree -r origin/main migrations/ | grep -E "${RANGE}"` to confirm the feature branch's migration range is still free on main. Re-run after every `git pull origin main` or S2 sync. The check costs nothing; the alternative is a migration sequence break in CI that requires forced operator intervention.

### [2026-05-10] Correction — apply defence-in-depth patterns consistently across siblings; cross-check Drizzle schema against the migration

Three corrections from `chatgpt-pr-review` Round 3 on PR #284 pre-test-hardening:

1. **Inconsistent ALS-presence checks across sibling services.** When I added the `peekOrgTxContext()` fallback pattern to three services in successive rounds (`deliveryService.deliver`, `scheduledTaskService.fireOccurrence`, `knowledgeService.overrideEntry`), the first two used a truthy check (`peekOrgTxContext() ? ... : ...`) and the third used `peekOrgTxContext() !== undefined`. They behave the same in production (the function returns `OrgTxContext | undefined`), but test mocks return `null` and `null !== undefined` is `true`, which routes mocked tests to `getOrgScopedDb()` and incorrectly throws `missing_org_context`. **Rule:** when applying the same defence-in-depth pattern to multiple call sites in successive commits, choose ONE check style and reuse it verbatim across all sites. Truthy check is more lenient and handles mock variations; `!== undefined` is too strict against `null` returns. Verify after the third site that all three look identical.

2. **Drizzle schema vs migration drift on FK.** Authored `webhookReplayNonces.ts` with `.references(() => organisations.id)` but migration `0318_webhook_replay_nonces.sql` did not include `REFERENCES organisations(id) ON DELETE CASCADE`. The Drizzle schema is a TypeScript-side declaration; the migration is the source of truth for the DB. They must agree. **Rule:** every time a Drizzle schema declares `.references(...)`, the matching migration's column definition MUST include the SQL FK constraint. The reverse check is also required: if the migration has a FK, the schema must declare `.references()` so the introspection layer stays consistent. Verify both sides before merging.

3. **ChatGPT scope-of-view false positive (already-imported claim).** Three rounds in a row, ChatGPT claimed `connectorConfigService.ts` was missing `withAdminConnection` import based on a diff hunk that didn't show line 7's existing import. The import has been in the file since well before this PR. **Rule:** when ChatGPT (or any review agent) flags a missing import based on what's "visible in the diff", verify the full file with `grep -n "^import" <file>` before fixing. Diff-hunk visibility is not file-state. Auto-reject duplicate false positives across rounds — they are noise, not signal.

## Pattern: usability_state vs plan_verification_status implementation — two columns, two writers, two read paths

**Context.** Operator-session-identity Phase 2 implementation (2026-05-11). Spec-review identified the conceptual split (see earlier entry: "Pattern: Separate `usability_state` (broker gate) from `plan_verification_status` (audit signal) — two concerns, two columns"). Implementation surfaced that the split needs two independent writers, two independent read sites, and two independent invariants.

**Rule.** `usability_state` is written ONLY by `operatorSessionLifecycleService.transition` (after initial INSERT). `plan_verification_status` is written by `operatorSessionService.verifyPlan` and by `operatorSessionService.connect` (initial value). Read paths: the broker checks `usability_state === 'connected_usable'` exclusively; the UI pill checks both (state for color, status for "verified" badge). The pure helper `orderResolvedCredentials` in `credentialBrokerServicePure.ts` is the single sort site for failover ordering (default-first, then alphabetical by label).

**Detection heuristic.** If a state machine has two responsibilities (gate + audit), confirm each column has exactly one writer and that read sites consult only the relevant column — never both. Conflating them at read time recreates the original drift. When adding a new writer to either column, verify no existing caller already writes it outside the designated write path.

### [2026-05-11] Gotcha — Permission-helper-tier mismatch: `hasOrgPermission` does NOT accept a `SUBACCOUNT_PERMISSIONS.*` constant

`server/routes/integrationConnections.ts` consolidated route added `hasOrgPermission(req, SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_VIEW)` to gate which connection rows the caller could see. The permission constant lives under `SUBACCOUNT_PERMISSIONS` — a workspace-scoped permission set — but the helper was `hasOrgPermission`, an organisation-scoped permission check. The two helpers operate on different permission tiers and look up different membership tables; passing a workspace permission constant into the org helper silently returns the wrong answer (in this case: either hides workspace-scoped operator-session rows for legitimate users, or applies the wrong permission model for org-scope callers). TypeScript does not catch the mismatch because both helpers accept `string`-typed permission codes.

**Pattern:** the permission helper must match the tier of the permission constant exactly:
- `ORG_PERMISSIONS.*` → `hasOrgPermission(req, code)` — no subaccount required
- `SUBACCOUNT_PERMISSIONS.*` → `hasSubaccountPermission(req, subaccountId, code)` — subaccount required, parsed from the request scope/query

**Rule for code review:** when grepping for permission gates, treat `has<Tier>Permission(req, <TIER>_PERMISSIONS.*)` as a structural unit. If the helper tier and the constant tier disagree, that line is wrong by construction — not a stylistic preference. The fix is to swap to the matching helper AND parse the scope-appropriate context (e.g. for `scope=workspace` callers, validate `parsed.data.subaccountId` and pass it as the second arg).

**Applied to:** PR #286 chatgpt-pr-review Round 1 F2 — `server/routes/integrationConnections.ts` flipped to `hasSubaccountPermission(req, parsed.data.subaccountId, SUBACCOUNT_PERMISSIONS.OPERATOR_SESSION_VIEW)` gated on `scope === 'workspace'`; for `scope=org` / undefined scope the flag is forced false (operator_session rows are already skipped downstream for org scope in `connectionsService.ts`). Session log: `tasks/review-logs/chatgpt-pr-review-operator-session-identity-2026-05-11T22-01-13Z.md`.

**Generalises to:** any route handler in `server/routes/*` that gates row visibility or write access via a permission helper. The same trap exists in reverse (passing an `ORG_PERMISSIONS.*` constant into `hasSubaccountPermission`). A future linting rule could enforce: the `<TIER>_` prefix of the constant must match the tier embedded in the helper name, statically. Until that exists, code review catches it via the pattern above.

### [2026-05-11] Gotcha — DB-time bucket queries must fail closed; never fall back to `Date.now()` for ordering / dedupe keys

`server/jobs/operatorSessionRefreshJob.ts:runOperatorSessionRefreshSweep` (PR #286) computed a 5-minute bucket via `SELECT floor(extract(epoch from transaction_timestamp()) / 300)::bigint AS bucket` to dedupe sweep ticks across pods, and computed `expiryThreshold = Date.now() + REFRESH_WINDOW_MINUTES * 60_000` to filter sessions that needed refreshing. Two regressions snuck in during chunk-level implementation:

1. **App-clock fallback on the bucket query** — if the SQL query returned zero rows, the code substituted `Math.floor(Date.now() / 300_000)` as the bucket. That defeats the purpose of using DB time for dedupe: under clock skew between Node processes, two pods could compute different `Date.now()` buckets and both run the sweep tick, doubling work and producing dedupe-key collisions.
2. **App-clock for the expiry predicate** — `Date.now()` flows into the `WHERE token_expires_at <= $1` clause. Same skew exposure: a session expiring at `T + 30s` could be picked up by one pod's predicate and skipped by another's, depending on the pod's wall clock.

**Fix pattern (PR #286 Round 1 F4):**
- Fail closed on the bucket query — if zero rows, log `bucket_query_empty` and SKIP the sweep tick. Better to drop a tick than to corrupt the dedupe key.
- Compute the expiry threshold inside SQL: `WHERE token_expires_at <= transaction_timestamp() + (${REFRESH_WINDOW_MINUTES} * interval '1 minute')`. The predicate evaluates entirely in the database, so all pods see the same threshold for the same transaction.

**Rule:** when a job uses DB-side time for dedupe or ordering semantics (any `transaction_timestamp()`, `now()`, `clock_timestamp()` derivative used as a bucket key, cursor, or predicate), there is NEVER an app-clock fallback. The fallback is "skip this tick / fail closed", not "compute it from Node". Same principle as `[2026-04-30] Date.now() poisons cursor-based projection delta polling` (KNOWLEDGE 2108) and the rate-limit `Retry-After` correctness rule (KNOWLEDGE 1630) — those are reads from DB-time scalars; this entry covers the predicate / bucket-key flavour of the same family.

**Detection heuristic.** Grep any job file for `Date.now()`. Every hit needs a justification: is it used purely for ephemeral instrumentation (latency timing, telemetry), or does it feed into a dedupe key, ordering cursor, or a predicate compared against a DB-side column? If the latter, the value MUST come from a DB query within the same transaction — no fallback.

**Applied to:** PR #286 chatgpt-pr-review Round 1 F4 — `server/jobs/operatorSessionRefreshJob.ts`. The earlier plan-review pass had already removed this pattern once; this was a regression reintroduced during chunk-level implementation. Confirmed resolved in Round 2 with verdict APPROVED. Session log: `tasks/review-logs/chatgpt-pr-review-operator-session-identity-2026-05-11T22-01-13Z.md`.
### [2026-05-11] Pattern — Registration-seam lets provider resolver compile before concrete providers exist

When introducing a new provider-resolved service (e.g. `SandboxExecutionService`) that depends on three concrete implementations not yet built, the order-of-delivery problem is solved by a "registration seam": the resolver module exports a `registerSandboxProvider(name, ctor)` function, and each concrete provider calls it at module-init time. The resolver compiles and type-checks independently; C4 (resolver) can ship before C9 (e2bSandbox) and C10 (localDockerSandbox) because the concrete modules are never statically imported by the resolver. The resolver only fails at runtime when `SANDBOX_PROVIDER` names a provider that hasn't been registered — a fail-fast boot error, not a compile error. This avoids both a circular-dependency and a "everything must land in one giant chunk" build constraint. Applied in Spec B: `server/services/sandbox/sandboxProviderResolver.ts` + concrete providers C9/C10.

### [2026-05-11] Pattern — String-constant module breaks circular pg-boss registration dependencies

When two service modules want to import each other's queue names for pg-boss `boss.subscribe(queueName, ...)` calls, the straightforward import creates a circular dependency. The fix is a dedicated string-constants module (`server/jobs/sandboxJobNames.ts` in Spec B) that both parties can import without pulling in each other's service logic. The constant module has zero imports itself — pure `export const JOB_NAME_X = '...'` — so it cannot participate in a cycle. This is cheaper than a DI container and avoids the "register everything at a central index" approach that forces all jobs to import each other at boot. Applied in Spec B C8 (`withSandboxProvider.ts`) + C11a (job handlers): the provider wrapper imports only the queue name constant, not the job handler module.

### [2026-05-11] Gotcha — Stale gitignored .js files alongside .ts source intercept Vitest imports

When a TypeScript ESM project has an old `.js` file sitting next to a `.ts` file of the same base name (e.g. a leftover compiled output that was committed and then gitignored), Vitest's module resolver under `nodenext` resolution can import the `.js` file instead of the `.ts` source. Tests pass against the stale compiled version and ignore source changes — the most confusing failure mode is "my change has no effect on the test". Detection: `ls server/services/sandbox/` — if a `.js` appears next to its `.ts` counterpart without being intentional, delete it. The `.js` extension on relative imports (required by `nodenext` + `verify-pure-helper-convention.sh`) is fine in source; the problem is a physical `.js` file that the resolver picks up as a sibling artifact. Preventive: run `git status --ignored` before each chunk and delete any stale `.js` alongside new `.ts` files.

### [2026-05-11] Pattern — Intentional OR-clause chunk cohesion: ≤5 files OR ≤1 logical responsibility

The chunk-size posture rule has an OR clause: a chunk that exceeds 5 files is still within the heuristic if every file represents a single cohesive logical responsibility (the C14 doc-sync + gate sweep in Spec B is the example: 9 files, one "build closeout" responsibility). When applying this exception, document the rationale explicitly in the plan at the chunk level — not just "large chunk justified" but "each file is structurally cohesive because X; splitting would require two simultaneous PRs that land atomically anyway." The OR-clause is not a free pass for large chunks — the "≤1 logical responsibility" test is strict: if two files in the chunk have different reviewers, different CI failure modes, or different rollback strategies, they are different responsibilities and should split.

## DB CHECK constraints require a pure application-level transition classifier
**Date:** 2026-05-11
**Source:** finalisation-coordinator finalisation pass on PR #287 (slug: sandbox-isolation), Round 2 R2-F1.
**Pattern:** When a table has paired CHECK constraints that depend on multiple columns (`sandbox_executions_running_harvesting_needs_provider_id` requires `provider_sandbox_id IS NOT NULL` when `status IN ('running', 'harvesting')`; the paired `provider_sandbox_id_not_pending` requires NULL when `status='pending'`), the application MUST encode the legal-transition matrix in a pure helper rather than relying on the CHECK to catch violations at write time. Two reasons: (1) the CHECK rejects the write as an opaque DB error after the application has already decided to issue it, which surfaces as a generic 500 instead of a deliberate error path; (2) defence-in-depth requires both layers — the application classifier prevents the round-trip, the CHECK guards against bypass via raw SQL or untyped Drizzle escapes.
**Why it matters:** PR #287 originally swept `pending → harvesting` transitions in both `sandboxCeilingMonitorJob.markForHarvest` and `sandboxHarvestReconciliationJob.reconcileExecution` — a pending row would have NULL `provider_sandbox_id` and the harvesting flip would violate the CHECK. The fix is `classifyCeilingTransition(status, providerSandboxId, ceilingType): CeilingTransition` in `sandboxCeilingMonitorPure.ts` with four outcomes (`harvesting`, `start_failed`, `noop:already_harvesting`, `noop:unexpected_state`). Both call sites consult the classifier; the pure-test matrix encodes every (status, providerSandboxId) cell. The race-safe `status=` WHERE predicate on the UPDATE backs it up. This pattern generalises to any table where a CHECK constraint involves a conditional on >1 column.

## DB-anchored elapsed time in correctness-sensitive paths (ceiling monitor)
**Date:** 2026-05-11
**Source:** finalisation-coordinator finalisation pass on PR #287 (slug: sandbox-isolation), Round 2 R2-T1.
**Pattern:** When a path enforces a quantitative invariant (timeout, cost ceiling, rate limit, billing window) by comparing elapsed time against a threshold, BOTH endpoints of the comparison MUST come from the same time source. Compute the elapsed value inside the SQL that loads the row: `(EXTRACT(EPOCH FROM (NOW() - {column})) * 1000)::bigint`. Never compute elapsed in Node code by combining DB-stored `started_at` with `Date.now()` — that mixes DB clock with Node wall-clock, and cross-instance clock skew (NTP drift, container clock drift) silently changes the outcome.
**Why it matters:** PR #287 originally computed `elapsedMs = Date.now() - new Date(startedAt).getTime()` in `sandboxCeilingMonitorJob`, where `startedAt` is the DB-set value of `sandbox_executions.started_at`. Pre-existing patterns in the codebase already enforce DB-anchored time: `inboundRateLimiter.ts` returns `extract(epoch from now()) as now_epoch` from the rate-limit query and propagates `nowEpochMs` to all callers (KNOWLEDGE.md 2026-05-XX entry); `agentWorkingTimeService.ts` uses `process.hrtime.bigint()` for elapsed measurement to avoid `Date.now()` NTP drift. The sandbox ceiling monitor is the same class of code (it drives both timeout enforcement AND billing via the `estimateSandboxCostCents` correlation). Drizzle pattern: extend the existing typed `.select({...})` with a `sql<string | null>` fragment for the elapsed value (bigint returned as string for safety; `null` when the source timestamp is null, which the application's classifier handles).

## CI grep gates authored in code must be wired into a workflow before merge
**Date:** 2026-05-11
**Source:** finalisation-coordinator finalisation pass on PR #287 (slug: sandbox-isolation), Round 2 R2-T2 (scope expansion).
**Pattern:** Authoring a new CI grep gate script (`scripts/gates/verify-*.sh`) is half the work — the other half is adding a step to `.github/workflows/ci.yml` (or the appropriate workflow) that invokes the script. A gate that exists as a script but has no workflow step has zero enforcement value; it is documentation, not a gate. Phase 2 doc-sync did not catch this because doc-sync verifies code/doc coherence, not code/CI coherence. Going forward: any chunk that adds a `scripts/gates/verify-*.sh` MUST also touch `.github/workflows/ci.yml` (or equivalent) in the same commit. The chatgpt-pr-review Round 2 T2 finding caught the symptom (`STRICT_TEMPLATE_TAG_CHECK` env var not wired); the actual gap was that ALL FIVE of the C14 sandbox gates were script-only.
**Why it matters:** Spec B Phase 2 closed with 5 new gates documented in the handoff and architecture.md as "5 new CI grep gates added per spec" — but `git grep -l verify-sandbox-classification .github/` returned empty. The fix wires all 5 into `ci.yml § grep_invariants` with `STRICT_TEMPLATE_TAG_CHECK` enabled via `contains(github.event.pull_request.labels.*.name, 'ready-to-merge')`. The wider lesson is process: doc-sync sweeps must include a "any new `scripts/gates/verify-*.sh` is referenced in `.github/workflows/`" check, or the C14-equivalent chunk in future Specs must explicitly include the workflow file in its plan.

## Strict CI gates require pre-publish version-string convention to avoid blocking ship
**Date:** 2026-05-11
**Source:** finalisation-coordinator finalisation pass on PR #287 (slug: sandbox-isolation), Round 2 R2-T2 follow-on.
**Pattern:** A CI gate whose strict mode hard-fails on "non-`local-dev-*` version with no matching publish tag" creates a chicken-and-egg problem for the FIRST publish: the PR that introduces the template cannot push the tag before merge (no commit hash to tag), and cannot rely on the tag existing after merge (the tag is the operator's post-merge work). The convention that resolves this: pre-first-publish `CURRENT_VERSION.version` MUST use a `local-dev-*` prefix (e.g. `local-dev-v1.0.0`). The operator flips the prefix off at first-publish time as step 0 of the runbook. The gate's `local-dev-*` exemption is the "we know this isn't tagged yet, it's not supposed to be" signal.
**Why it matters:** PR #287's initial `CURRENT_VERSION.version=v1.0.0` would have blocked its own `ready-to-merge` label firing (strict gate fails because no `sandbox-template/synthetos-sandbox/v1.0.0` tag exists). Flipping to `local-dev-v1.0.0` keeps the strict gate green during V1 ship while accurately signalling pre-first-publish state. The operator's SANDBOX-F1 step 0 flips back to `v1.0.0` at first-publish. This pattern applies to any "production release fingerprint" file where a CI gate enforces post-publish coherence: the pre-first-publish state needs an explicit "not yet published" sentinel that the gate exempts.

### 2026-05-12 Correction — Mockups must be grounded in the actual codebase UI before drafting, not invented in parallel

**Recurring failure pattern:** mockup-designer (and the main session when authoring UI prompts) jumps straight to drafting hi-fi prototypes without first reading the existing UI surfaces the new capability extends. The result is a parallel UI universe — new pages, new nav entries, new visual languages — for functionality that the existing app already has the right surface for.

**Concrete recent example (Phase D Operator Backend, round 1 mockups):** the operator-run experience was drafted as a standalone "autonomous runs" world (dedicated session-in-progress page, dedicated completed/failed/cancelled pages, dedicated active-sessions list, dedicated provider-suspended page). The actual codebase already has `OpenTaskView.tsx` with `TaskHeader` + `ChatPane` + `ActivityPane` + `RightPaneTabs (Now / Plan / Files)` — the exact surface where an operator run should appear. Operator review caught it in round 1, forced a complete round-2 rebuild against `client/src/pages/OpenTaskView.tsx` and the components under `client/src/components/openTask/`. One wasted mockup round + half a session of context.

**The fix lives in three places (applied 2026-05-12):**
1. `.claude/agents/mockup-designer.md` — added **Step 0a: Codebase grounding pass**, mandatory every round before drafting. The agent must Read the existing pages/components, quote inherited vocabulary in `mockup-log.md`, and explicitly justify any new dedicated page proposal. Mockup-log entry format extended to include the codebase-grounding section.
2. `docs/frontend-design-principles.md` — added a new pre-design checklist item (now #1): "Where does this surface live in the existing UI?" The five-hard-rules re-check now includes "Did I extend an existing page/component instead of inventing a new one?"
3. This entry — captures the failure pattern itself so future sessions reading KNOWLEDGE.md at session start see it.

**Detection signal in future:** if a mockup round produces top-level new pages or new nav entries for functionality that has an existing analogue (run-tracking, task-management, connections, settings, agent config), assume the mockup is wrong-shape and challenge it before delivery. The default answer is *extend, don't replace*. The legitimate exception is cross-cutting surfaces (a dashboard that aggregates across multiple existing pages) — and even then, the new page must be justified per item.

**Caller-side reinforcement:** when dispatching mockup-designer, the prompt MUST name the existing UI files the new capability extends. Don't trust the agent to find them via a generic "explore the codebase" instruction — point to specific paths. The Step 0a rule now requires the agent to ask the caller if the brief doesn't name them, but caller specificity is the cheaper safeguard.

### 2026-05-12 Correction — Step 0a "codebase grounding pass" must enumerate exact filenames per screen, not just claim grounding was done

**Concrete failure (Phase D Operator Backend, round 2 mockups, 2026-05-12):** mockup-designer round 2 ran with Step 0a in place and claimed grounding was performed, but produced `r10-tasks-list-operator-filter.html` — a fictional tasks-list page that does not exist anywhere in the codebase. The real kanban-style task board is `client/src/pages/WorkspaceBoardPage.tsx` (route `/admin/subaccounts/:subaccountId/workspace`) with `TaskCard` components in drag-and-drop columns. The agent missed it because it searched for the literal word "kanban" rather than enumerating the page files in `client/src/pages/`.

**Root cause:** Step 0a as originally worded asked the agent to "identify the existing pages/components the new capability touches and Read those files BEFORE drafting any HTML" — but did not require the agent to name those files in its mockup-log entry per screen. A claim of "I grounded" passes the rule's bar even when the grounding missed the actual surface.

**The fix:** Step 0a now requires the mockup-log Round entry to include a "Codebase grounding (existing files identified)" subsection that lists, per screen, the exact filenames in `client/src/pages/` or `client/src/components/` the screen grounds against. If a screen claims to extend an existing surface but doesn't name the file, the grounding pass is incomplete and the round is rejected.

**Detection signal in future:** if a mockup-log Round entry lacks an explicit per-screen filename list, the grounding pass was skipped. Reject the round before reviewing the HTML.

### 2026-05-12 Correction — Verify PR state before referencing it as actionable

**Concrete failure:** mid-session I proposed "push this strengthening commit to PR #289 now" assuming the PR was still open. User corrected: PR #289 had already been merged. A `mcp__github__pull_request_read` call would have shown `state: closed, merged: true` in one call.

**The fix:** before referencing an open-PR action ("push commit to PR #N", "add comment to PR #N", "amend PR #N's description"), run `mcp__github__pull_request_read` with method `get` and check `merged` + `state`. If merged, the action is fresh-branch + fresh-PR, not amend.

**Detection signal:** any phrase like "PR #N" that's older than 30 minutes of conversation state is unsafe to act on without re-reading. PR state changes off-session (operator merges, CI auto-closes, conflicts arise) and assumed-open PRs are a common stale-state failure mode.

---

### 2026-05-13 Gotcha — bare db.select/db.update on dual-GUC tables silently returns 0 rows (seen in operator-backend B2/B3)
**Date:** 2026-05-13
**Source:** pr-reviewer fix-loop on operator-backend branch (slugs B2, B3)

`operator_runs`, `operator_task_profiles`, and `subaccount_operator_settings` have FORCE ROW LEVEL SECURITY policies keyed on BOTH `app.organisation_id` AND `app.subaccount_id`. Any `db.select()` or `db.update()` that does NOT run inside a `db.transaction(async tx => { await setOrgAndSubaccountGUC(tx, orgId, subaccountId); ... })` block acquires a fresh pool connection with neither GUC set. RLS fails closed — the query returns 0 rows or affects 0 rows, silently. No error is thrown.

**Concrete failure:** the operator-backend dispatcher read `operator_runs` without a transaction. `currentAttemptNumber` always defaulted to 1 and `chainSeqNext` always defaulted to 1, so every chain link wrote `chain_seq=1`. The `(agent_run_id, attempt_number, chain_seq)` UNIQUE index failed on the second link. The entire chain mechanism was non-functional.

**Rule:** for ANY table with a dual-GUC RLS policy, call `setOrgAndSubaccountGUC(tx, orgId, subaccountId)` as the first statement inside the transaction before reading or writing the table. Never make bare pool calls against these tables. Use `setOrgGUC` only for org-scoped-only tables (agent_runs, iee_runs, etc.). See architecture.md "Dual-GUC pattern" for the canonical list.

---

### 2026-05-13 Gotcha — extend-budget routes must accumulate per-task, not write subaccount-wide settings (seen in operator-backend B1)
**Date:** 2026-05-13
**Source:** pr-reviewer finding B1 on operator-backend branch

When a route provides a per-task budget extension (POST /api/operator-tasks/:id/extend-budget), the correct write target is a per-task accumulator column (e.g. `agent_runs.per_task_budget_extension_minutes`), NOT the subaccount-wide settings row (`subaccount_operator_settings.per_task_budget_cap_minutes`). Writing to the subaccount-wide row makes every task in the subaccount — including future tasks — inherit the elevated cap permanently. The cap drifts upward with every extension and can only be corrected via a manual settings PATCH.

**Rule:** budget caps that are spec-stated as per-task additives must be stored on the task row, not the settings table. The dispatcher composes the effective cap at dispatch time: `effectiveSettings.per_task_budget_cap_minutes + run.perTaskBudgetExtensionMinutes`. The settings table remains the baseline; the task row holds the delta.
### [2026-05-13] Gotcha — EA Draft F2 invariant: approval state lives ONLY on `actions`, never on `ea_drafts`

`ea_drafts.send_state` is a SEND-only lifecycle (`idle → sending → sent | send_failed`). It NEVER reaches `approved`. Approval state lives exclusively on `actions.status = 'approved'`. The approve route (POST /api/ea-drafts/:id/approve) writes to `actions`, then dispatches a fire-and-forget send job that transitions `send_state` from `idle → sending → sent|send_failed`. The stall-reset job (`workflowGateStallNotifyJob.ts`) recovers drafts stuck in `sending`. Consequence: any code that checks `ea_drafts.state === 'approved'` is always wrong — that state is structurally impossible. Always check `actions.status = 'approved'` for the approval predicate; read `ea_drafts.send_state` only for delivery status.

### [2026-05-13] Pattern — Cross-org background job admin pattern for FORCE RLS tables

Background jobs that must scan across all orgs (e.g. `voiceProfileRefreshJob`, `gmailInboxPollJob`, `calendarLookaheadJob`) cannot use the bare `db` handle — FORCE RLS tables (`voice_profiles`, `ea_drafts`, `integration_connections`, etc.) require `app.organisation_id` to be set, and a plain pg-boss handler never has it. Correct pattern:

```typescript
await withAdminConnection({ source: 'job-name', reason: 'cross-org scan' }, async (tx) => {
  await tx.execute(sql`SET LOCAL ROLE admin_role`);
  return tx.query(...);
});
```

`withAdminConnection` acquires a BYPASSRLS connection; `SET LOCAL ROLE admin_role` is required for tables with FORCE RLS (the BYPASSRLS flag alone is not sufficient when the policy uses `FORCE`). Do NOT use raw `db` for cross-org scans against FORCE RLS tables. See `server/lib/adminDbConnection.ts` and `server/jobs/agentRunCleanupJob.ts` as reference implementations.

### [2026-05-13] Pattern — User-owned agent credential isolation: `agents.owner_user_id` gates OAuth token access

User-owned agents (Personal Assistant, executive-assistant slug) introduce `agents.owner_user_id` — which user's OAuth tokens are used for calendar/Slack skill execution. The SKILL_HANDLERS for user-scoped skills (`calendar.*`, `slack.*`) MUST resolve `ownerUserId` from the DB via the agent record (`agents.ownerUserId`), never from LLM-provided input. The canonical resolver is `resolveAgentOwner(agentId, orgId, db)` in `server/services/skillExecutor.ts`. Never trust `context.input.userId` or any caller-supplied user reference for credential resolution — this is a security boundary. An agent cannot execute skills on behalf of a user it is not owned by, regardless of what the LLM puts in the tool input.

### [2026-05-13] Pattern — Approval routes must NOT fire-and-forget dispatch; the proposal/action primitive's commit hook owns it

Source: PR #291 chatgpt-pr-review Round 1 F3. The original EA approval route did `actionService.transitionState(actionId, 'approved')` then immediately dynamic-imported the slack/calendar handler and dispatched fire-and-forget from the HTTP route. Failure modes: (a) `transitionState` succeeds but the process crashes before dispatch — action is approved but the send never happens; (b) if the proposal primitive later gains its own commit hook, the route's dispatch double-sends; (c) fire-and-forget errors only `console.log`, the operator never sees them; (d) exactly-once dispatch is no longer owned by the state transition.

Rule: the HTTP route does ONE thing — call `transitionState('approved')`. The proposal/action primitive's `approved` commit hook (registered at boot via `actionService.registerCommitHook`) owns the dispatch. The hook awaits the dispatch service so any error propagates back into the transition's error path. No HTTP route may directly invoke a send-side service after approving. Detection: grep for `transitionState.*'approved'` in a route handler followed by any direct service call — if you see it, the dispatch needs to move into a commit hook. See `server/services/eaDrafts/eaDraftDispatchService.ts` + `actionService.registerCommitHook` for the canonical wiring.

### [2026-05-13] Pattern — Dispatch hooks must claim BEFORE routing; pre-claim errors otherwise leave drafts in idle

Source: PR #291 chatgpt-pr-review Round 2 F2. The naive dispatch hook was: receive `approved` event → switch on `draft.kind` → invoke handler → handler's first line is `claimSend` (idle → sending). Any error thrown BEFORE the handler's own claim (dynamic import failure, malformed body, missing provider module, routing bug, unexpected kind/body mismatch) leaves the draft at `ea_drafts.send_state = 'idle'` while `actions.status = 'approved'` — a durable approved-but-never-sent state. The stall-reset job (`workflowGateStallNotifyJob`) only recovers drafts stuck in `sending`, not `idle`, so the row stays orphaned forever.

Rule: the dispatch hook itself MUST `claimSend` BEFORE routing. Pattern: call `eaDraftService.claimSend(row.id)` first; if `claimed === false`, return silently (idempotent — already in flight); otherwise wrap `routeDraftSend(row, { ...ctx, _dispatchPreClaimed: true })` in try/catch and call `eaDraftService.markSendFailed(row.id, String(err))` from the catch. Downstream handlers honour the `_dispatchPreClaimed` flag and skip their own claim. Every failure becomes `send_failed`; manual-retry endpoints work. Detection: any time you write `await routeXyz(row)` inside a state-transition hook with no preceding claim, the row can get orphaned on hook-internal errors. The rule generalises to any "approved → send" decoupled handler: the hook that bridges the two states owns the claim, not the leaf handler.

### [2026-05-13] Pattern — List endpoints must not return sensitive sub-objects that the detail endpoint already gates

Source: PR #291 chatgpt-pr-review Round 2 F3. The new `GET /api/agent-runs?agentId=` list route initially returned the full `agent_runs` row, including `triggerContext`. RLS already gated row-level access correctly, but `triggerContext` is a sensitive sub-object on user-owned runs — its visibility was previously owned exclusively by the Run Trace detail endpoint (`GET /api/agent-runs/:id/trace`), which applies owner/admin redaction rules. Adding a new LIST surface that returns the field as-is widens the data-exposure perimeter without inheriting the detail endpoint's content rules.

Rule: when an existing detail endpoint owns the visibility contract for a sensitive sub-object (`triggerContext` on `agent_runs`, draft `body` on `ea_drafts`, decoded `secret` on `integration_connections`, etc.), new list endpoints should NOT return that field — even when row-level access is permitted. List endpoints return metadata + a `<field>Redacted: true` marker; clients follow up with the detail endpoint to get redacted-or-full content per the existing rules. Detection: any new list route on a table where a detail route already exists — diff its SELECT against the detail route's SELECT. If the list route returns fields the detail route redacts in some branches, the list route has widened the contract; reduce it to metadata + redacted marker. The cost of removing a field is one extra round-trip; the cost of leaving it is silently expanding the privacy surface.

### [2026-05-13] Pattern — Admin-write paths to FORCE RLS tables use withAdminConnection + SET LOCAL ROLE admin_role (BYPASSRLS), not inline WITH CHECK carve-outs

Source: PR #291 chatgpt-pr-review Round 2 F1. The `external_trigger_dedup` table is FORCE RLS with a tight owner-only WITH CHECK. Webhook ingestion and trigger dispatch insert rows on behalf of users they don't represent (the webhook handler runs as the system, not the impersonated user). ChatGPT recommended widening the WITH CHECK to also allow `current_setting('app.current_role', true) IN ('org_admin', 'system_admin')` — but this fails for the webhook path because `withAdminConnection` sets the DATABASE role (`admin_role`), not the `app.current_role` GUC. App-tier inserts that set the GUC would pass; admin-connection inserts that don't set the GUC would still be rejected.

Rule: pick ONE convention per table and stick to it.
- Admin-write via `withAdminConnection` + `SET LOCAL ROLE admin_role` (BYPASSRLS) — the established repo convention. WITH CHECK stays owner-only. The admin role bypasses RLS entirely; the predicate never runs against the insert. Used by cleanup jobs, webhook ingestion, and cross-org background scans. See `KNOWLEDGE.md [2026-05-04] Gotcha — Cleanup jobs on FORCE-RLS tables MUST use withAdminConnection` and `KNOWLEDGE.md [2026-05-13] Pattern — Cross-org background job admin pattern for FORCE RLS tables`.
- Inline WITH CHECK carve-out — only viable when admin writes flow through the app tier with `app.current_role` set (rare; needs the route to call `setCurrentRoleGUC` before the insert). The pattern works but creates two write paths on the same table and is easy to drift on.

Detection: any new write path to a FORCE RLS table — if the path is webhook ingestion, scheduled job, or background worker, it MUST be inside `withAdminConnection`. Trying to "open up" the WITH CHECK to `org_admin | system_admin` is a code smell that means the author hasn't picked the right convention. Confirm with `grep -r withAdminConnection` against the table name — if the table already has admin-connection writes, that's the established convention and the new path joins it.

### [2026-05-13] Pattern — Unique partial indexes bind a key for life — adoption helpers MUST adopt terminal rows, not fresh-start

**Source:** chatgpt-pr-review Round 1 F2 on operator-backend branch (PR #288). The `sandbox_start_key` column on `sandbox_executions` has a unique partial index `(sandbox_start_key) WHERE sandbox_start_key IS NOT NULL` (migration 0340). The pure decision `decideAdoptOrStart` originally returned `fresh_start` for terminal rows, intending the caller to re-INSERT a new row. The unique index makes this impossible: any second INSERT with the same key violates the index and crashes the dispatch. The bug was structurally invisible until a chain link's first sandbox completed and the dispatcher re-fired with the same `operator_run_id` as the start_key — at which point every retry crashed.

**Rule:** when a column has a unique partial index, any adoption / idempotency helper keyed on that column MUST treat terminal and live rows identically — adopt when the caller's id matches the existing row, conflict when the caller's id differs, fresh-start only when no row exists at all. Returning `fresh_start` for terminal rows is only safe if the column has no unique constraint. Detection: any pure helper returning a `fresh_start | adopt | conflict` enum keyed on a column — grep `migrations/` for `UNIQUE INDEX` or `unique partial index` on that column; if found, terminal rows must adopt. The fix is in the pure helper, not in the SQL: keep the unique index (it's the integrity contract); adjust the decision to match.

### [2026-05-13] Pattern — orderBy DESC discipline for "latest non-superseded" queries

**Source:** chatgpt-pr-review Round 2 F2 on operator-backend branch (PR #288). The fresh-profile-restart route reads `operator_runs` filtered by `isNull(supersededByAttempt)` (current attempt only) and was supposed to inspect the LATEST chain link's `failure_reason`. The original query used `.orderBy(operatorRuns.chainSeq).limit(1)` — ascending — which returns the EARLIEST chain link. Combined with the predicate checking `failure_reason='OPERATOR_PROFILE_UNRECOVERABLE'`, the predicate could never match because the earliest chain link almost always has a different (or null) failure reason. The route was structurally dead for its intended trigger.

**Rule:** any query whose semantics are "select the most recent X" MUST use `.orderBy(desc(<sortColumn>))`. ASC + LIMIT 1 returns the earliest, not the latest — easy to typo, hard to detect because the query "looks right" until a predicate based on the field returns 0 rows in production. Detection: grep for `orderBy(<table>.chainSeq)` / `orderBy(<table>.createdAt)` / `orderBy(<table>.<timestamp>)` without a `desc(...)` wrapper — if the surrounding code reads it as "latest", it's wrong.

### [2026-05-13] Pattern — Coarse permission middleware can short-circuit handler-level actor rules

**Source:** chatgpt-pr-review Round 4 F1 on operator-backend branch (PR #288). The operator-task routes (retry-chain-failure, extend-budget) intend to allow "assigned user OR manager+". The handler implements this via `evaluateRouteActorRule` against `agent_runs.assigned_user_id` and the actor role. But the routes also mounted `requireOrgPermission(ORG_PERMISSIONS.AGENTS_EDIT)` as middleware — and AGENTS_EDIT is typically a manager-level permission, so rank-and-file assigned users were rejected at the middleware BEFORE the handler ever ran. The handler-level rule was unreachable for the case it most needed to admit.

**Rule:** when a route uses BOTH a coarse permission middleware AND a fine-grained handler actor rule, the middleware permission must be a strict superset of every actor the rule would admit. If the rule needs to admit user-level actors with task-assignee context, the middleware permission must be at user-level or removed entirely (let the handler rule be the gate). Detection: any route with `requireOrgPermission(X)` middleware followed by a handler-level role-or-context check — verify that X is granted to every role the handler rule would admit. If the handler admits "assigned user with no special permission", the middleware can't gate on a permission that user lacks. The clean V1 solution for the operator-backend case was to remove the middleware on the user-or-manager routes (handler rule is sufficient) and keep it on the admin-only routes (where the middleware filters non-admins early).

### [2026-05-13] Pattern — Spec aspirational fields require schema reality check before route wiring

**Source:** chatgpt-pr-review Round 3 F1 on operator-backend branch (PR #288). Spec §6.5b stated: "The route handler reads `agent_runs.assigned_user_id` and `users.role` before authorising." But `agent_runs.assigned_user_id` did not exist in V1 — the spec was authored aspirationally and the Phase 2 build matched the spec by passing `null` everywhere instead of adding the column. The result: a structurally-dead-code branch in the actor-rule helper that no production caller could ever reach.

**Rule:** when a spec references a column or field that doesn't exist yet, the implementation MUST either (a) add the column in the same build, (b) document the absence and route around it with a real V1 fallback, or (c) defer the entire feature. Hardcoding `null` for the missing field "to match the spec" creates dead code that masks the absence and accumulates technical debt invisible at review time. Detection: at spec-time, grep the schema files for every column the spec mentions; flag any absences before the build starts. At build-time, before writing a route that reads `<table>.<field>`, run `grep -n "<field>" server/db/schema/<table>.ts` — if the column isn't there, decide the (a)/(b)/(c) question with the operator before writing the route.

### [2026-05-13] Process — Long-running review windows produce migration-number collisions; the loser branch renumbers + sweeps

**Source:** finalisation-coordinator S2 step on operator-backend branch (PR #288). While the operator-backend branch ran 4 rounds of chatgpt-pr-review, main shipped PR #291 (Personal Assistant V1) with migrations 0327-0332. Operator-backend had reserved 0327-0334. The S2 merge surfaced 6 migration filename collisions on the same numbers.

**Rule:** when a long-running review window collides with main's migrations, the convention is the loser branch (still in review) renumbers all colliding migrations to the next available slot, in their original relative order. This is mechanical but requires a thorough sweep — migration filenames, internal `-- Migration NNNN` header comments, `policyMigration:` entries in `rlsProtectedTables.ts`, schema-file comment pointers (`// Migration: NNNN_<name>.sql`), spec file inventory + body prose, plan file inventory + acceptance criteria, handoff narrative, and any `migration NNNN` inline references in service code or test files. Detection: after S2 merge, `git diff --stat` the migration directory — pairs added on both sides with the same number are collisions. The renumber should preserve relative order (lower → still-lower in new numbering) and a single `chore(sync): merge main into <slug> (S2) — migration renumber NNNN-NNNN → MMMM-MMMM` commit captures the entire sweep so future bisect can trace the rename event cleanly.

Source: PR #291 chatgpt-pr-review Round 2 F1. The `external_trigger_dedup` table is FORCE RLS with a tight owner-only WITH CHECK. Webhook ingestion and trigger dispatch insert rows on behalf of users they don't represent (the webhook handler runs as the system, not the impersonated user). ChatGPT recommended widening the WITH CHECK to also allow `current_setting('app.current_role', true) IN ('org_admin', 'system_admin')` — but this fails for the webhook path because `withAdminConnection` sets the DATABASE role (`admin_role`), not the `app.current_role` GUC. App-tier inserts that set the GUC would pass; admin-connection inserts that don't set the GUC would still be rejected.

Rule: pick ONE convention per table and stick to it.
- Admin-write via `withAdminConnection` + `SET LOCAL ROLE admin_role` (BYPASSRLS) — the established repo convention. WITH CHECK stays owner-only. The admin role bypasses RLS entirely; the predicate never runs against the insert. Used by cleanup jobs, webhook ingestion, and cross-org background scans. See `KNOWLEDGE.md [2026-05-04] Gotcha — Cleanup jobs on FORCE-RLS tables MUST use withAdminConnection` and `KNOWLEDGE.md [2026-05-13] Pattern — Cross-org background job admin pattern for FORCE RLS tables`.
- Inline WITH CHECK carve-out — only viable when admin writes flow through the app tier with `app.current_role` set (rare; needs the route to call `setCurrentRoleGUC` before the insert). The pattern works but creates two write paths on the same table and is easy to drift on.

Detection: any new write path to a FORCE RLS table — if the path is webhook ingestion, scheduled job, or background worker, it MUST be inside `withAdminConnection`. Trying to "open up" the WITH CHECK to `org_admin | system_admin` is a code smell that means the author hasn't picked the right convention. Confirm with `grep -r withAdminConnection` against the table name — if the table already has admin-connection writes, that's the established convention and the new path joins it.

### [2026-05-13] Decision — V1 Executive Assistant: owner-only approval, no admin break-glass content access

Source: PR #291 chatgpt-pr-review Round 1 F2. Spec §18 line 1573 locks V1 EA approval to the draft owner only: `if (draft.ownerUserId !== req.user.id) → 403`. The original route allowed `org_admin | system_admin` to approve another user's draft — this is rejected for V1 because it conflates "admin can see metadata" with "admin can act on content". Admin break-glass for EA drafts (read body, approve on behalf, reject on behalf) requires an explicit V2 spec with an audit gate: every break-glass action writes an audit row with reason, the admin's identity, and the affected draft owner. Until that spec exists, admin paths return 403 on approve/reject/retry.

Generalises beyond EA: any "AI-drafted content awaiting user decision" surface (EA drafts, agent recommendations awaiting user approval, generated reports pending publish) defaults to owner-only action. Admin metadata visibility is fine (list endpoints can show "Bob has 3 pending drafts"). Admin content visibility and admin content action are separate, gated capabilities that require their own audit story. Detection: any new route that gates by `isAdmin || isOwner` for an action on user-generated content — challenge it. The default is `isOwner` only; the `isAdmin` branch requires a documented audit-and-rationale layer.
