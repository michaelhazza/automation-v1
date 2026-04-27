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

**Rule for testing-posture framing in long specs:** if the spec inherits a framing default from a higher-level doc (e.g. `runtime_tests: pure_function_only` from `docs/spec-context.md`), and the spec defines tests that deviate from that default, declare the deviation explicitly in the spec's own framing-deviations section. Silence creates a cross-layer contradiction that reviewers will catch late. Caught in round 5 of this spec; worth doing proactively next time.

Applies to any implementation-readiness spec review: API contracts, primitive rollouts, cross-cutting concerns.

### 2026-04-23 Pattern — ChatGPT PR-review re-raises previously-adjudicated items under variant framing in follow-up rounds

During PR #183 (cached-context-infrastructure) the ChatGPT review loop went two rounds. Round 1 produced 6 findings: 1 implemented, 4 rejected, 1 deferred (with a documented spec-doc follow-up task). Round 2 produced 4 findings — and 3 of the 4 were the Round 1 rejections re-raised under slightly different framing (subaccount-isolation variant, concurrency-guarantee variant, retention-lifecycle variant). The fourth was a low-severity scope-creep suggestion outside the PR's stated phase. Net new signal in Round 2: zero. The user's correct posture was to reject all four. 

The failure mode: ChatGPT appears to pattern-match on the Round 1 discussion surface (the areas where it previously engaged) rather than re-reading the PR diff / spec state *post*-Round-1 fixes. The model re-opens discussions that were already closed with a recorded architectural rationale, hoping the variant phrasing will change the outcome. 

**Rules for future `chatgpt-pr-review` sessions:**

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

**Prior entries on this pattern:** 2026-04-17 Gotcha (rebase with merge conflicts), 2026-04-17 Correction (verify against PR diff perspective), 2026-04-17 Gotcha (GitHub unified diff commonly misread). This is now **4 occurrences across 2 PRs** — it is a structural failure mode of LLM PR review, not a one-off. The right mitigation is in the review-agent contract (always verify with `Read` before acting), not in the codebase.

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

### [2026-04-27] Gotcha — Idempotency `scope` declarations must match what storage actually enforces

`server/config/actionRegistry.ts` had 4 entries (`config_create_agent`, `config_update_agent`, `config_activate_agent`, `config_create_subaccount`) declaring `idempotency.scope: 'org'`, but `skill_idempotency_keys.subaccount_id` is `NOT NULL` and the wrapper at `skillExecutor.ts:2157-2159` throws when `context.subaccountId` is missing. Result: any call site that respected the `'org'` declaration and supplied no subaccount would crash before execution, while every call site that did supply a subaccount used the column anyway — so the declaration was decorative metadata, not enforcement. **Rule:** for any `idempotency.scope` field, grep the storage layer (DDL + insert path) and the wrapper guard. If the column is `NOT NULL` and the wrapper throws on missing context, the only valid scope is the one that matches that context. Org-level idempotency requires either nullable subaccount_id + a partial-unique index covering the null case, or a separate `org_idempotency_keys` table; until either lands, declaring `'org'` is a runtime trap. **Detector:** add a registry consistency check that asserts every `scope: 'org'` declaration has a corresponding org-level keying primitive in storage; lint-fail if not.

### [2026-04-27] Gotcha — Idempotency-hit early returns must terminalise the freshly-proposed action row

`executeWithActionAudit` (server/services/skillExecutor.ts) proposes an `actions` row at line 2061 *before* checking `skill_idempotency_keys` for cross-run idempotency. On every replay early-return path — `idempotency_collision`, cached `completed`, `in_flight` (reclaim disabled / lost / within window), `previous_failure` — the wrapper returned cached payload without ever closing the freshly-proposed row. Replays accumulated dangling `approved` rows that never reached a terminal state, leaving the audit trail silently incomplete. **Rule:** any wrapper that proposes a state-machine row before performing a "do we even run?" gate must close that row to a terminal status on every gate-fail early return — `markCompleted` for cached-success replays (mirroring the cached payload), `markBlocked('concurrent_execute')` for in-flight branches, `markFailed(<code>)` for collisions or previous failures. **Implementation gotcha:** `transitionState()` rejects approved → completed because `LEGAL_TRANSITIONS` assumes the row passed through `executing`; use direct `markCompleted` / `markFailed` / `markBlocked` writes (precedent: handler-exception path in the same wrapper). **Detector:** every early `return` in a wrapper that has a preceding `proposeAction` call should be followed by reasoning about row closure; add a code-review check or `verify-action-row-terminalised.sh` gate that flags `return` statements between `propose` and a terminal write.

### [2026-04-27] Gotcha — Hash-input drift: parse Zod once, hash AND execute the same value

`executeWithActionAudit` parsed user input with `parameterSchema.safeParse` into `parsedInput` (Zod `default()` materialised, transforms applied), hashed `parsedInput`, then called `executor()` with no arguments — handlers used closure-captured raw `input`. For any skill with Zod defaults or transforms (e.g. `config_link_agent.isActive` defaults `true`, `read_campaigns.include_ad_groups` defaults `false`), the value used to compute the cross-run idempotency hash drifted from the value the handler executed against. Replays of the same call hashed under one shape but ran under another, breaking the cross-run guarantee silently — never throws, just stops being idempotent for default-bearing keys. **Rule:** when a wrapper parses input through a schema *and* derives a key/hash from the parsed shape, the executor MUST receive the parsed shape too. Treat this as a single contract: signature `(processedInput: T) => Promise<R>`, never `() => Promise<R>` with the raw input captured in closure. **Detector:** any schema-validating wrapper whose hash function reads `parsed*` and whose executor reads `input`/`raw` is a guaranteed drift bug. Prefer threading the parsed value through every layer (`runWithProcessors(_, parsedInput, _, (processed) => executor(processed))`) over post-hoc patches.
