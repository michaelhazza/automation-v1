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
2. **`references/project-map.md`** — human-readable digest, ~50–100 lines. Sections (in order): top 20 files by inbound-import count (tie-break: ascending lexicographic path — output must be deterministic so re-runs don't churn the diff); service entry points by directory; files with zero inbound imports (dead-code candidates); per-directory file count + line count totals. Markdown tables, no prose.

### Caching

`references/.code-graph-cache.json` — per-file SHA256 keyed map of `{ sha256: extractionResult }`. Generator skips files whose hash matches the cache, re-extracts only changed files.

**Dead-file pruning:** every regen, walk the cache and drop entries whose `path` no longer exists on disk. Without this, deleted files accumulate in the import-graph shards and mislead future readers.

### Lifecycle

- `.gitignore` already covers `references/.code-graph-cache.json`, `references/import-graph/`, `references/project-map.md` (landed with this PR).
- **Regen mechanism: `predev` script in `package.json`.** `"predev": "tsx scripts/build-code-graph.ts"`. The dev server is blocked until generation completes — sub-second on the warm SHA256 cache, a few seconds cold. Deterministic: agents and humans never see a `references/project-map.md not found` race because the file is guaranteed to exist by the time the dev server is up. Picked over fire-and-forget (race) and parallel (race) — both leave the agent-side logic responsible for "is the file there yet?", which the advisory-hint framing was supposed to remove.
- Manual: `npm run code-graph:rebuild` for full force-rebuild from cold cache (drops `references/.code-graph-cache.json` and re-walks).
- First session in any checkout pays a few seconds of cold-build cost on `npm run dev`. Acceptable.

## Manual usage pattern

Phase 0 ships no `PreToolUse` hook. Adoption is manual until usage justifies automation:

- **Agents:** when an architecture-shaped question comes up ("what calls X", "how do A and B relate", "where does the route for Y live"), include a one-line hint in the agent's prompt: "before grepping, check `references/project-map.md` and `references/import-graph/<dir>.json`". Specifically applies to the `Explore` subagent and the `architect` agent.
- **Humans:** read `references/project-map.md` at the start of any session that touches a part of the codebase you haven't worked in recently.

This is deliberately friction-bearing: if the manual usage produces qualitative wins, Phase 1 (automation via hook + helper layer) becomes justifiable. If it doesn't, no automation is built and Phase 0 remains the floor.

## Done criteria

- `npm run code-graph:rebuild` produces all three shards + the digest in under 30s on a cold cache, sub-second on a warm cache.
- The three shards together cover ≥98% of `.ts`/`.tsx` files under `server/`, `client/`, `shared/`. **Skipped files are written to `references/import-graph/.skipped.txt` with a one-line reason per file** (parse error, syntax error, etc.). The build fails if any single directory's skip rate exceeds 5% — that's a signal the parser config is wrong, not "advisory artifact territory."
- `references/project-map.md` is ≤100 lines and renders cleanly in GitHub markdown preview. Re-running the generator on an unchanged tree produces a byte-identical file (deterministic ordering verified).
- Dead-file pruning verified by deleting a known file, regenerating, and confirming it's gone from the shards.
- `architecture.md` carries the new "Deterministic vs Interpretive Knowledge" section (already landed with this PR).
- Manual-usage hint added in two specific places — both verifiable via `grep -l "references/project-map.md"`:
  - `.claude/agents/architect.md` — one line in the workflow: "before grepping for structural questions, consult `references/project-map.md` and the relevant `references/import-graph/<dir>.json` shard."
  - `CLAUDE.md` § "Local Dev Agent Fleet" — one line directing main sessions to the same artifacts before dispatching `Explore` for architecture questions.

## Decisions locked in this spec

The following were live questions during synthesis but are now decided — the architect should not re-open them:

- **ts-morph configuration:** file-by-file walk for Phase 0. Faster, simpler, captures imports/exports correctly. Cross-file type resolution is not needed for the artifact shape Phase 0 ships. Re-evaluate only if Phase 1 lands and needs richer data.
- **Regen mechanism:** `predev` script in `package.json` (see Lifecycle section).
- **Failure handling for un-parseable files:** log + skip + write to `.skipped.txt`. Build fails only if per-directory skip rate >5% (see Done criteria).

## Open questions for the architect

Three genuinely-open decisions remain:

1. **Path normalisation** — relative-from-repo-root vs absolute vs original-as-imported. Consistency across shards matters more than which form. Pick one and document it in the generator's header comment.
2. **Generator placement** — `scripts/build-code-graph.ts` (top-level) vs `server/scripts/...` vs a new `tools/` directory. Use existing convention if one applies — check whether `scripts/` is the established home for cross-cutting build tooling.
3. **`predev` invocation form** — direct `tsx scripts/build-code-graph.ts` vs a wrapper `npm run code-graph` that `predev` then calls. Trade: wrapper gives one canonical entry point for both `predev` and manual `npm run code-graph:rebuild`; direct call is one less indirection. Lean: wrapper, for symmetry with the other `npm run *` entries in `package.json`.

## Reference: parked Phase 1

If usage data later justifies it, Phase 1 adds: `PreToolUse` hook with pattern-gating, query helper layer (`getCallers`, `getDependencies`, `getDefinition`), telemetry JSONL with weekly review ritual, correctness gate against 5 baseline queries, 30% token-reduction kill criterion. Full design parked in [`tasks/code-intel-revisit.md`](../../code-intel-revisit.md). Do not absorb any of it into Phase 0.
