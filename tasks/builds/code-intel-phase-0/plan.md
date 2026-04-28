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

**Note on the watcher vs Phase 1 deferral:** the chokidar watcher described below is in scope for Phase 0 and does NOT pull Phase 1 forward. The PreToolUse hook (deferred) is *agent-side automation* — it intercepts agent tool calls and injects hints. The watcher is *server-side dev infrastructure* — it keeps the cache fresh during a session. Different layers, different concerns. Phase 0 cannot ship a usable cache without the watcher; Phase 1 is what makes the cache *automatically consulted* by agents.

## What this IS (build surface)

One generator script and two output artifacts. That's it.

### Generator: `scripts/build-code-graph.ts`

ts-morph based. Walks `server/`, `client/`, `shared/`. For each `.ts`/`.tsx` file:
- Imports (resolved to project-relative paths; ignore `node_modules`)
- Exports (named symbols + default export presence)
- Inbound import edges (computed by inverting the imports map after the full walk)

**Path normalisation (locked):** all paths emitted into shards and the digest MUST be repo-root-relative POSIX format — forward slashes, no leading `./` or `../`, no extension stripping, case-normalised on Windows via `.toLowerCase()` applied to the full path. Example: `server/services/agentExecutionService.ts`, never `./server/services/agentExecutionService.ts` or an absolute path. Consistency across shards matters more than aesthetics; this is locked so consumers never need to normalise before lookup.

**Import resolution (locked):** ts-morph MUST resolve import strings through `tsconfig.json` — path aliases (`@/`, `~`, etc.), bare-directory index file resolution (`/foo` → `/foo/index.ts`), and omitted extensions. Always emit the final resolved file path, not the raw import string. Unresolvable imports (external packages, missing files) are silently dropped — they are already excluded by the `node_modules` filter or represent dead imports.

Emits two artifacts:

1. **`references/import-graph/{server,client,shared}.json`** — sharded per top-level directory. Each shard is a `{ files: { [path]: { imports: string[]; exports: string[]; importedBy: string[] } } }` map. Per-directory sharding so an Explore subagent can load only the slice it needs (~1–3 MB per shard rather than a 5–10 MB monolith).
2. **`references/project-map.md`** — human-readable digest, ~50–100 lines. Sections (in order): top 20 files by inbound-import count (tie-break: ascending lexicographic path — output must be deterministic so re-runs don't churn the diff); service entry points by directory; files with zero inbound imports (dead-code candidates); per-directory file count + line count totals. Markdown tables, no prose. **Stable sort requirement:** snapshot inbound-import counts from the *current* shard state before beginning any batch pass, sort by count DESC then path ASC as a secondary tiebreaker. A file's count must not change mid-sort from a concurrent watcher event. This guarantees identical output across identical inputs.

### Caching

`references/.code-graph-cache.json` — per-file SHA256 keyed map of `{ sha256: extractionResult }`. Generator skips files whose hash matches the cache, re-extracts only changed files.

**Dead-file pruning:** every regen (cold or watcher-triggered), walk the cache and drop entries whose `path` no longer exists on disk. Without this, deleted files accumulate in the import-graph shards and mislead future readers.

**Manual cache reset.** The cache file is a build artifact — safe to delete `references/.code-graph-cache.json` to force a clean rebuild on the next `npm run dev`. Equivalent to `npm run code-graph:rebuild` but does not require the dev server to be down.

### Watcher: in-session staleness protection

Cold-build at `predev` is necessary but not sufficient. A typical dev session runs for hours; without an in-session refresh, the cache goes stale within minutes of the first file change. **Agents reading a stale cache get confidently wrong answers — the most concerning failure mode**, exactly the one the Graphify trial taught us to engineer away from. The advisory-hint framing (agents fall through to raw source on miss) does not protect against staleness — a stale cache "hits" with wrong data, no fall-through triggers.

**Mechanism:** `predev` launches a `chokidar` file watcher as a detached background process. The watcher monitors `server/`, `client/`, `shared/` for `add` / `change` / `unlink` events on `.ts` / `.tsx` files.

**Watch scope — explicit ignore list (non-negotiable):**

```js
ignored: [
  '**/node_modules/**',  // 10K+ files, never our code
  '**/dist/**',          // build output
  '**/.git/**',
  'references/**',       // CRITICAL: prevents feedback loop — watcher writes shard → fires watch event → re-runs forever
  '**/*.d.ts',           // type declarations only, no runtime relationships
  '**/*.generated.ts',   // generated files (drizzle, etc.)
]
```

The `references/**` ignore is load-bearing — without it the watcher writes its own shard files, observes the write, and self-triggers infinitely. Easy to test for; catastrophic if missed.

**On each event:**

- **`add` / `change`:** SHA256 the file, compare to cache. If unchanged (mtime touched, content identical — happens with some editors), skip. Otherwise re-extract via `ts-morph` (`Project.addSourceFileAtPath` + `getImportDeclarations` + `getExportSymbols`). **Bidirectional edge update (mandatory):** before writing the new imports for file X, remove X from the `importedBy` array of every file it previously imported (read from the prior cache entry). Then write X's new imports and add X to each new import target's `importedBy`. Atomically rewrite all affected shards (write to `.tmp`, `rename` — OS-level atomic on POSIX and NTFS). Update `references/.code-graph-cache.json`. Re-emit `references/project-map.md` only on **topology change** (defined below). Without this reverse-index update, removing an import in file A leaves A's path in B's `importedBy` indefinitely — correct data on the next cold build but silently wrong throughout the session.
- **`unlink`:** remove X from cache and from its own shard entry. **Also remove X from the `importedBy` arrays of every file X previously imported** (read from the cache entry before deleting it — same reverse-index cleanup as `add`/`change`). Same dead-file pruning as cold-build.
- **Rename:** chokidar reports renames as **`unlink` of the old path + `add` of the new path** — two separate events. Treat them that way; do NOT special-case rename detection. Inbound-edge updates (other files importing the renamed path) propagate naturally because those files' next save will re-extract their imports. **Known eventual-consistency window:** after a rename, files that import the old path remain stale until they are themselves reprocessed — they continue to reference the non-existent old path, and the new path starts with zero inbound edges. This is bounded (self-corrects on next edit) and visible (not silent corruption), and is consistent with the cache's positioning as a hint layer with raw-source fallback. Full fix (re-extract all importers on rename) is Phase 1+ territory.

**Topology change** (triggers `project-map.md` regen):
1. A file appears in / disappears from the top-20-by-inbound-imports list, OR
2. A file's inbound-import count crosses the zero-vs-nonzero boundary (became dead-code candidate, or stopped being one), OR
3. A file added or unlinked under any of the watched directories.

Within-list reordering at positions 21+ is *not* a topology change — would churn the digest's diff for no reader value.

**Event coalescing — 150 ms debounce + batch processing.** Per-file events that fire within a 150 ms window are coalesced (last-write-wins per path). Bulk events (≥10 events fired within 500 ms — typical of `git checkout` between branches, find-and-replace refactors, or large pulls) trigger a single batched re-extract pass instead of N serial passes. Without this, a branch switch with 200 changed files takes ~20 seconds of serial CPU; batched it takes ~2 seconds.

**Per-event cost (post-coalescing):** <100 ms typical for single-file saves. Atomic shard rewrite is the dominant cost. Bulk pass: 200 changed files complete in ~2 s on a warm cache.

**Failure logging — visible, not silent.** Unparseable files (syntax error, malformed AST, ts-morph throw) are:
1. Written to `references/import-graph/.skipped.txt` (one line per file, `<path>\t<reason>`).
2. Logged via `console.warn` to the dev server's stdout — visible in the same terminal as the dev output, not buried in a separate log file. Format: `[code-graph] skipped <path>: <reason>`.

If skipped-file count exceeds 5% of files in any one directory, the dev server's `predev` cold-build fails with a non-zero exit code (configuration error, not advisory territory). The watcher itself does not fail the dev server on per-event parse errors — those just log and continue.

**Concurrency: lockfile-based singleton.** Multiple dev sessions on the same repo (a second `npm run dev`, an alternate config, a Claude Code session running its own `dev`) MUST NOT both run watchers — they'd race on shard writes. The watcher's first action is to acquire `references/.watcher.lock` via `proper-lockfile` (handles Windows/POSIX differences) with a 10-second `stale` timeout. If a live process holds the lock, the new launcher exits silently and lets the existing watcher serve all sessions. Stale locks (PID dead, lock file older than 10s without heartbeat refresh) are released and reclaimed automatically — covers both clean exits and unclean crashes (`kill -9`, OOM, dev-server segfault). **One watcher per repo, regardless of session count.**

**Lifecycle binding.** The watcher is launched detached by `predev` but registers `SIGTERM` / `SIGINT` handlers tied to the parent dev server's lifetime. When the dev server dies, the watcher dies and releases the lock. Crashed watchers leave a stale lock; the next session's lock-acquire detects-via-PID-liveness and reclaims it. No manual cleanup required.

**Atomic shard writes — invariant:** consumers (agents, scripts, the human reading the digest) MUST never observe a partial JSON file. The temp-file + rename pattern guarantees this on every supported OS. If a watcher is `kill -9`'d mid-write, the original shard is intact; the new content is in `.tmp` and gets cleaned up on next start. **`references/.code-graph-cache.json` is subject to the same invariant** — written via temp-file + rename so a mid-write kill never leaves a partial/corrupt cache that causes shard/cache mismatch on next start.

**Watcher start failure — degrade, don't block.** If chokidar fails to initialize (`ENOSPC` from exhausted Linux inotify watches, `EPERM` from Windows permission issues, any other startup throw), the launcher logs the error to dev-server stdout (`[code-graph] watcher failed to start: <reason> — falling back to manual rebuild mode`) and continues. The cold-build artifacts from `predev` remain valid; in-session refresh is unavailable until either (a) the next `npm run dev` after the underlying issue is fixed, or (b) the user runs `npm run code-graph:rebuild` manually after edits. **The dev server is never blocked by a watcher start failure** — degrades to "no auto-refresh," not "broken."

### Lifecycle

- `.gitignore` already covers `references/.code-graph-cache.json`, `references/import-graph/`, `references/project-map.md`, `references/.watcher.lock` (landed with this PR — lockfile entry to add alongside this commit).
- **Cold build: `predev` script in `package.json`.** `"predev": "tsx scripts/build-code-graph.ts"`. The dev server is blocked until generation completes — sub-second on the warm SHA256 cache, a few seconds cold. Deterministic: agents and humans never see a `references/project-map.md not found` race because the file is guaranteed to exist by the time the dev server is up.
- **In-session refresh: `chokidar` watcher launched detached by `predev`** (see Watcher section). Sub-100ms per file event, atomic shard writes, single watcher per repo via lockfile, dies with the parent dev server.
- **Manual rebuild:** `npm run code-graph:rebuild` for cold-rebuild from scratch (drops `references/.code-graph-cache.json`, releases any held lock, re-walks the tree). Useful after a `git pull` brings in a large diff or after a branch switch.
- **Watch-only mode:** `npm run code-graph:watch` for sessions where `npm run dev` isn't running (e.g. doing code-review without launching the server). Same singleton lock; coexists cleanly with a parallel `npm run dev` (whichever started first owns the lock).
- First session in any checkout pays a few seconds of cold-build cost. Subsequent in-session edits are sub-100ms via the watcher. Multi-session usage on the same checkout shares one watcher.

## Manual usage pattern

Phase 0 ships no `PreToolUse` hook. Adoption is manual until usage justifies automation:

- **Agents:** when an architecture-shaped question comes up ("what calls X", "how do A and B relate", "where does the route for Y live"), include a one-line hint in the agent's prompt: "before grepping, check `references/project-map.md` and `references/import-graph/<dir>.json`". Specifically applies to the `Explore` subagent and the `architect` agent.
- **Humans:** read `references/project-map.md` at the start of any session that touches a part of the codebase you haven't worked in recently.
- **Both:** if the cache appears inconsistent with observed behaviour (a file you just edited isn't reflected, an import you can see in source isn't in the shard, a known function points at the wrong line), fall back to raw source immediately. The cache is an advisory hint layer, not source of truth — agents and humans always retain raw-source fallback. Inconsistency reports are also a useful signal for the trigger conditions in `tasks/code-intel-revisit.md` (manual usage friction → revisit Phase 1).

This is deliberately friction-bearing: if the manual usage produces qualitative wins, Phase 1 (automation via hook + helper layer) becomes justifiable. If it doesn't, no automation is built and Phase 0 remains the floor.

## Done criteria

**Cold build:**
- `npm run code-graph:rebuild` produces all three shards + the digest in under 30s on a cold cache, sub-second on a warm cache.
- The three shards together cover ≥98% of `.ts`/`.tsx` files under `server/`, `client/`, `shared/`. **Skipped files are written to `references/import-graph/.skipped.txt` with a one-line reason per file** (parse error, syntax error, etc.). The build fails if any single directory's skip rate exceeds 5% — that's a signal the parser config is wrong, not "advisory artifact territory."
- `references/project-map.md` is ≤100 lines and renders cleanly in GitHub markdown preview. Re-running the generator on an unchanged tree produces a byte-identical file (deterministic ordering verified).
- Dead-file pruning verified by deleting a known file, regenerating, and confirming it's gone from the shards.

**Watcher (in-session staleness protection):**
- Editing any `.ts`/`.tsx` file under `server/`, `client/`, `shared/` mid-session results in the corresponding shard being updated within 200ms. Verifiable: tail the shard's mtime + content while editing a known import.
- Adding a new file mid-session: appears in the shard within 200ms. Deleting a file mid-session: gone from the shard within 200ms.
- Renaming a file (file system rename or `git mv`): old path gone, new path present, both within 400ms (two events, coalesced).
- **No feedback loop:** writing a shard file MUST NOT re-trigger the watcher. Verifiable: edit a source file once; confirm exactly one watcher pass runs (one log line per event class), not a continuous loop.
- **Branch-switch performance:** `git checkout` between two branches with ~200 changed files completes the watcher batch pass in <5s. Verifiable: time the first save event after the checkout; should be <5s end-to-end, not 20+ s of serial per-file work.
- **Topology-change discrimination:** editing a file whose change does NOT alter top-20 inbound-import membership produces shard updates but NO `project-map.md` rewrite. Verifiable: digest mtime unchanged after the edit.
- **Skipped-file logging:** introduce a file with a deliberate syntax error; confirm it appears in `references/import-graph/.skipped.txt` AND `console.warn` fires to the dev server's stdout. Removing the syntax error causes both to clear on the next save.
- **Singleton enforcement:** running `npm run dev` a second time on the same checkout while a watcher already runs does NOT spawn a second watcher. Verifiable: `ps` (or `Get-Process` on Windows) shows exactly one `chokidar` process; the second `predev` exits silently after detecting the live lock.
- **Stale-lock recovery:** `kill -9` the watcher process, then `npm run dev` again. The new launcher detects the dead PID via `proper-lockfile`'s 10s stale check, releases the stale lock, and starts a new watcher.
- **Atomic shard writes:** kill the watcher mid-edit cycle (`kill -9` while saving a file). Every shard file remains valid JSON — never partial. Verifiable with `jq . references/import-graph/*.json` after kill+restart.
- **Lifecycle binding:** killing the dev server (`Ctrl+C`) terminates the watcher within 2s and releases the lock.

**Integration surface:**
- `architecture.md` carries the new "Deterministic vs Interpretive Knowledge" section (already landed with this PR).
- Manual-usage hint added in two specific places — both verifiable via `grep -l "references/project-map.md"`:
  - `.claude/agents/architect.md` — one line in the workflow: "before grepping for structural questions, consult `references/project-map.md` and the relevant `references/import-graph/<dir>.json` shard."
  - `CLAUDE.md` § "Local Dev Agent Fleet" — one line directing main sessions to the same artifacts before dispatching `Explore` for architecture questions.

**Build cost expectation:** ~1 to 1.5 days for v1 (cold-build + ts-morph extractor + chokidar watcher + lockfile-singleton + atomic-write helper + tests for the watcher invariants). Was "half a day" pre-watcher; the staleness fix is the bulk of the added work and is non-negotiable — without it, the cache is worse than no cache.

## Decisions locked in this spec

The following were live questions during synthesis but are now decided — the architect should not re-open them:

- **ts-morph configuration:** file-by-file walk for Phase 0. Faster, simpler, captures imports/exports correctly. Cross-file type resolution is not needed for the artifact shape Phase 0 ships. Re-evaluate only if Phase 1 lands and needs richer data.
- **Cold-build trigger:** `predev` script in `package.json` (see Lifecycle section).
- **In-session refresh:** `chokidar` watcher launched detached by `predev`, lifecycle-bound to the dev server, singleton-enforced via `proper-lockfile` PID lock at `references/.watcher.lock`. Atomic shard writes via temp-file + rename. **Picked over the alternatives — startup-only regen (proven stale within minutes), lazy-on-read (read-side latency, complex coordination), git-hook-only (misses uncommitted changes mid-session), editor-save-hook (editor-coupled, leaves CLI workflows uncovered).**
- **Failure handling for un-parseable files:** log + skip + write to `.skipped.txt`. Build fails only if per-directory skip rate >5% (see Done criteria).
- **Path normalisation:** repo-root-relative POSIX (`server/services/foo.ts` form), case-normalised on Windows. See Generator section for full spec.
- **Import resolution:** ts-morph must resolve through `tsconfig.json` path aliases and index files; always emit the resolved file path. See Generator section for full spec.

## Open questions for the architect

Two genuinely-open decisions remain (path normalisation and import resolution are now locked above):

1. **Generator placement** — `scripts/build-code-graph.ts` (top-level) vs `server/scripts/...` vs a new `tools/` directory. Use existing convention if one applies — check whether `scripts/` is the established home for cross-cutting build tooling.
2. **`predev` invocation form** — direct `tsx scripts/build-code-graph.ts` vs a wrapper `npm run code-graph` that `predev` then calls. Trade: wrapper gives one canonical entry point for both `predev` and manual `npm run code-graph:rebuild`; direct call is one less indirection. Lean: wrapper, for symmetry with the other `npm run *` entries in `package.json`.

## Reference: parked Phase 1

If usage data later justifies it, Phase 1 adds: `PreToolUse` hook with pattern-gating, query helper layer (`getCallers`, `getDependencies`, `getDefinition`), telemetry JSONL with weekly review ritual, correctness gate against 5 baseline queries, 30% token-reduction kill criterion. Full design parked in [`tasks/code-intel-revisit.md`](../../code-intel-revisit.md). Do not absorb any of it into Phase 0.
