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
- If the pg-boss event publish fails: `reconcileStuckDelegatedRuns` sweeps `status IN ('delegated','cancelling')` after 120 s and calls `finaliseAgentRunFromIeeRun`.

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
