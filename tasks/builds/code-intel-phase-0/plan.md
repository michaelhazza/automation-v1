# Code Intelligence — Phase 0 Implementation Plan

**Slug:** code-intel-phase-0
**Branch:** `code-cache-upgrade`
**Classification:** Standard (single-file generator + two output artifacts)
**Date:** 2026-04-28
**Plan shape:** single file. No phasing.

---

## Mental model

`Project Structure → (ts-morph) → Per-directory shards + human digest.`

A deterministic codebase intelligence layer extracted once and re-read on every session. Walk the TypeScript compilation graph at `npm run dev` startup, emit a small set of static artifacts under `references/`, and let agents (and humans) read them as session-zero context instead of rediscovering structure from scratch via Grep/Read. No LLM. No clustering. No inferred edges. Just facts the AST can prove.

The artifacts are build outputs, not source — `.gitignore`'d, regenerated on first session in any checkout. The cache is a hint layer, not a source of truth: agents fall through to raw source when the artifact is missing or doesn't cover the question.

## What this is NOT

These are locked from three rounds of synthesis. Out of scope, period:

- LLM-driven semantic extraction
- "Inferred" / "ambiguous" edge labels
- Community detection / Leiden clustering
- Cross-document semantic similarity
- A query language or BFS over the graph
- A `PreToolUse` hook (deferred to Phase 1)
- A query helper layer with `getCallers` / `getDependencies` exports (deferred to Phase 1)
- Telemetry, correctness gate, kill criterion (deferred to Phase 1)

If any of these come up during implementation, that's a signal to stop and revisit — not absorb into Phase 0.

## What this IS (build surface)

One generator script and two output artifacts. That's it.

### Generator: `scripts/build-code-graph.ts`

ts-morph based. Walks `server/`, `client/`, `shared/`. For each `.ts`/`.tsx` file:
- Imports (resolved to project-relative paths; ignore `node_modules`)
- Exports (named symbols + default export presence)
- Inbound import edges (computed by inverting the imports map after the full walk)

Emits two artifacts:

1. **`references/import-graph/{server,client,shared}.json`** — sharded per top-level directory. Each shard is a `{ files: { [path]: { imports: string[]; exports: string[]; importedBy: string[] } } }` map. Per-directory sharding so an Explore subagent can load only the slice it needs (~1–3 MB per shard rather than a 5–10 MB monolith).
2. **`references/project-map.md`** — human-readable digest, ~50–100 lines. Sections (in order): top 20 files by inbound-import count; service entry points by directory; files with zero inbound imports (dead-code candidates); per-directory file count + line count totals. Markdown tables, no prose.

### Caching

`references/.code-graph-cache.json` — per-file SHA256 keyed map of `{ sha256: extractionResult }`. Generator skips files whose hash matches the cache, re-extracts only changed files.

**Dead-file pruning:** every regen, walk the cache and drop entries whose `path` no longer exists on disk. Without this, deleted files accumulate in the import-graph shards and mislead future readers.

### Lifecycle

- `.gitignore` adds: `references/.code-graph-cache.json`, `references/import-graph/`, `references/project-map.md`.
- Regen on `npm run dev` startup. Sub-second incremental in the typical case (small diff).
- Manual: `npm run code-graph:rebuild` for full force-rebuild from cold cache.
- First session in any checkout pays a few seconds of cold-build cost. Acceptable.

## Manual usage pattern

Phase 0 ships no `PreToolUse` hook. Adoption is manual until usage justifies automation:

- **Agents:** when an architecture-shaped question comes up ("what calls X", "how do A and B relate", "where does the route for Y live"), include a one-line hint in the agent's prompt: "before grepping, check `references/project-map.md` and `references/import-graph/<dir>.json`". Specifically applies to the `Explore` subagent and the `architect` agent.
- **Humans:** read `references/project-map.md` at the start of any session that touches a part of the codebase you haven't worked in recently.

This is deliberately friction-bearing: if the manual usage produces qualitative wins, Phase 1 (automation via hook + helper layer) becomes justifiable. If it doesn't, no automation is built and Phase 0 remains the floor.

## Done criteria

- `npm run code-graph:rebuild` produces all three shards + the digest in under 30s on a cold cache, sub-second on a warm cache.
- The three shards together cover ≥98% of `.ts`/`.tsx` files under `server/`, `client/`, `shared/`. The 2% margin allows for parse failures (circular type imports, etc.) — log them, don't fail the build.
- `references/project-map.md` is ≤100 lines and renders cleanly in GitHub markdown preview.
- Dead-file pruning verified by deleting a known file, regenerating, and confirming it's gone from the shards.
- `architecture.md` carries the new "Deterministic vs Interpretive Knowledge" section (separate commit; principle, not implementation).
- Every prompt template that currently dispatches `Explore` for architecture questions includes the manual-usage hint (one-line addition; no new agent definitions).

## Open questions for the architect

These remain for the architect to decide:

1. **ts-morph configuration** — full project compile vs file-by-file walk. Trade: full compile is slower cold but gives correct cross-file type resolution; file-by-file is faster but may miss re-exports. Default lean: file-by-file for v0, escalate only if data shows it matters.
2. **Path normalisation** — relative-from-repo-root vs absolute vs original-as-imported. Consistency across shards matters more than which form.
3. **Generator placement** — `scripts/build-code-graph.ts` (top-level) vs `server/scripts/...` vs a new `tools/` directory. Use existing convention if one applies.
4. **`npm run dev` integration mechanism** — pre-script in `package.json`, separate `concurrently` task, or a generator-on-import hook. Pick the simplest.
5. **Failure handling for un-parseable files** — log + skip vs log + halt. Lean: log + skip, the artifact is advisory.

## Reference: parked Phase 1

If usage data later justifies it, Phase 1 adds: `PreToolUse` hook with pattern-gating, query helper layer (`getCallers`, `getDependencies`, `getDefinition`), telemetry JSONL with weekly review ritual, correctness gate against 5 baseline queries, 30% token-reduction kill criterion. Full design parked in [`tasks/code-intel-revisit.md`](../../code-intel-revisit.md). Do not absorb any of it into Phase 0.
