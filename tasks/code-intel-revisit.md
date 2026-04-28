# Code Intelligence — Revisit Trigger & Parked Phase 1 Design

**Status:** Phase 0 in flight on branch `code-cache-upgrade`. Phase 1 parked behind measurable trigger conditions.
**Date parked:** 2026-04-28
**Source synthesis:** Graphify trial (`/tmp/graphify-trial-report.md` — Apr 2026) + three rounds of Claude/ChatGPT review.

---

## Why this document exists

The full Phase 1 design (PreToolUse hook + helper layer + telemetry + correctness gate + 30% kill criterion) was synthesised across three review rounds and rejected — *for now* — on the basis of an audit that showed real architecture-query volume is too low to justify the build cost or to clear the measurement gate cleanly. The synthesis is too valuable to lose, but committing to the build prematurely would over-engineer for a use case the data does not yet support.

This file captures (a) the audit findings, (b) the parked Phase 1 design, and (c) explicit trigger conditions for revisiting. When any trigger fires, this document is the entry point — synthesis is preserved, no rebuild needed.

## Audit findings (2026-04-28)

Source: `~/.claude/projects/c--files-Claude-automation-v1/*.jsonl` — 28 session transcripts spanning 2026-04-02 to 2026-04-28.

- **18** `Explore` subagent invocations across **9** sessions.
- Of those 18, classified by whether a deterministic AST cache would meaningfully help:

| Type | Count | Cache helps? |
|---|---|---|
| Read specific named files ("read these three files and report") | 5 | No |
| UI / page structure exploration (mixed) | 4 | Partial |
| Architecture-mapping (route resolution, "how do A and B relate") | 5 | **Yes** |
| Diagnostic / log-driven investigation | 2 | No |
| Git history / DB-state inventory | 2 | No |
| External (URL fetch via Explore) | 1 | No |
| Synthetic (Graphify trial, today) | 1 (4 questions) | Excluded — synthetic |

- **Real architecture-query rate:** ~5 in 26 days, or ~5–6/month.
- **Per-query token cost:** typically 20–30 K (file reads + greps + reasoning).
- **Best-case savings if Phase 1 cleared its 30% gate:** ~75–150 K tokens/month. Real, but small, and post prompt-caching the marginal saving is smaller still.

Conclusion: Phase 1 is sized for a problem we do not yet have at the volume the design assumes. Phase 0 captures the durable wins (project-map digest + import graph cache) at ~half a day of build cost, with no measurement infrastructure to defend.

## Trigger conditions for revisiting Phase 1

Revisit when **any** of the following is true. Either trigger a one-day re-audit before commissioning, or commission directly if the signal is unambiguous.

1. **Quantitative threshold.** Architecture-query volume crosses **≥10/month for two consecutive months**. Re-run the audit by grepping `~/.claude/projects/<project>/*.jsonl` for `subagent_type":"Explore"` and classifying.
2. **Qualitative pattern.** Repeated "what calls X" / "how does Y connect to Z" questions surfacing in three or more sessions in a single fortnight.
3. **Multi-agent demand.** A second agent type (beyond `Explore`) starts dispatching subagents for structural questions — e.g. the `architect` agent burning tokens on dependency-tracing during spec authoring, or the `pr-reviewer` re-deriving import graphs to assess change blast radius.
4. **Time-based fallback.** **2026-06-23** (8 weeks). If none of the above have fired by then, run the audit anyway. Either the volume signal has emerged organically or it hasn't — don't let the question drift.

## Parked Phase 1 design (do not implement until a trigger fires)

The full design after three review rounds. Recorded here so the architect doesn't reconstruct it from chat history when the trigger fires.

### What Phase 1 adds on top of Phase 0

1. **PreToolUse hook (pattern-gated).** Fires before `Grep`/`Glob`. Pattern set to start: `what calls`, `depends on`, `where is`, `imports`, `exports`, `architecture`, `flow`. Injects a one-line hint pointing at `references/import-graph/<dir>.json`. **Telemetry:** every Grep that did *not* fire the hook is logged to `references/.hook-telemetry.jsonl` with `{timestamp, query, fired: false}`. Weekly review ritual (written into the spec, not optional): every Friday glance at the unfired-but-relevant rate, expand patterns from real data.
2. **Query helper layer.** A clean importable module (interface = service-shaped, exposure = narrow). Functions: `getCallers(symbol)`, `getDependencies(file)`, `getDefinition(symbol)`. **Phase 1 scope:** Explore subagent only. Promotion to global skill registry (callable by any agent) is Phase 2 pending usage data.
3. **Correctness gate.** Five baseline queries (see *Baseline queries* below). After Phase 1 ships, re-run them with the cache enabled. **Any** baseline-query regression in answer quality → fail the build. Not "on average". Not "most of them". Any.
4. **Token-reduction gate.** Across the same five baseline queries, cached version must show ≥30% token reduction vs uncached. Below 30% → kill the cache rather than let it bit-rot.
5. **Hook coverage gate (4-week post-launch check).** ≥15% of architecture-shaped Greps must trigger the hook. Below 15% → either the patterns are too narrow (expand from telemetry) or architecture queries are still too rare to justify the hook (kill it).
6. **Guarantees / non-guarantees doc.** A short `references/import-graph/README.md` stating exactly what the AST graph covers (static imports, direct calls, extends/implements) and what it does *not* cover (dynamic imports, runtime dispatch via `string` keys, framework magic — React hooks, Drizzle proxy methods, decorators that rewrite at compile time, etc.). Without this, agents over-trust the graph.

### Phase 1 non-goals (locked)

- No clustering / community detection
- No "INFERRED" or "AMBIGUOUS" edge labels
- No semantic similarity edges
- No graph-traversal "query" interface that returns BFS dumps
- No promotion of helpers to global skill registry in Phase 1 (that's Phase 2)
- No commitment to the cache as source of truth — it remains an advisory hint layer; agents always retain raw-source fallback

### Baseline queries (pick before commissioning Phase 1)

The five candidates from the 2026-04-28 audit, attached as data so the measurement gate is enforceable rather than retroactive:

1. **2026-04-02** — "How are agents displayed in subaccount view? What does the Manage button link to? Is there a subaccount-specific agent edit page or does it go to `/admin/agents/:id`?" (route + import resolution)
2. **2026-04-02** — "Read the orchestrator system agent's master prompt... what skills are configured for the Reporting Agent" (config + import discovery)
3. **2026-04-08** — "Old `connections` system vs newer `connector_configs` and `web_login_connections` system. What each supports and how they relate." (service relationship mapping)
4. **2026-04-08** — "Subaccount agent route registration — is there a route for `/subaccounts/:id/agents/:agentId/edit`" (route + page resolution)
5. **2026-04-08** — "Current state of Integrations (MCP servers) and Connections pages... what API calls each makes" (page + API trace)

When Phase 1 commissions, baseline these against the *current* working tree before the cache lands, then compare post-launch.

## Pointer to Phase 0

Phase 0 is the version actually being built now. It captures the durable wins (project-map digest + sharded import graph cache + dead-file pruning + manual usage hint in agent prompts) at low cost and no measurement burden. Spec: [`tasks/builds/code-intel-phase-0/plan.md`](./builds/code-intel-phase-0/plan.md).

## Owner / next review

- **Trigger watcher:** the dev (manual). Re-run the `~/.claude/projects/*.jsonl` audit on the time-based trigger date or when a qualitative pattern is noticed.
- **Next mandatory check date:** **2026-06-23**.
