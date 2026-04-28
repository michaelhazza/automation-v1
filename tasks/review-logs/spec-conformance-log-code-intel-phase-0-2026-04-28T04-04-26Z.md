# Spec Conformance Log

**Spec:** `tasks/builds/code-intel-phase-0/plan.md`
**Spec commit at check:** `a02b2cc0` (latest spec edit on the branch)
**Branch:** `code-cache-upgrade`
**Base (merge-base with main):** `c04e66f1`
**HEAD:** `3483a66e`
**Scope:** All-of-spec — Phase 0 is a single-phase plan (the spec explicitly says *"single file. No phasing."*) and the branch is the completed implementation. Caller listed the changed-code set explicitly; no chunking ambiguity.
**Changed-code set (8 files):**
- `scripts/build-code-graph.ts` (new — generator + watcher)
- `package.json` (3 new scripts: `predev`, `code-graph:rebuild`, `code-graph:watch` + 4 new deps: `chokidar`, `proper-lockfile`, `ts-morph`, `@types/proper-lockfile`)
- `package-lock.json` (lockfile sync)
- `.gitignore` (build-output entries)
- `.claude/agents/architect.md` (verbatim safety sentence)
- `CLAUDE.md` (verbatim safety sentence under § Local Dev Agent Fleet)
- `KNOWLEDGE.md` (correction entry for masking-condition validation lesson)
- `tasks/builds/code-intel-phase-0/plan.md` (spec edits — not part of conformance check)

**Run at:** 2026-04-28T04:04:26Z
**Commit at finish:** `2cb7d9d5`

---

## Summary

- Requirements extracted:     41
- PASS:                       39
- MECHANICAL_GAP → fixed:     0
- DIRECTIONAL_GAP → deferred: 2
- AMBIGUOUS → deferred:       0
- OUT_OF_SCOPE → skipped:     0

**Verdict:** NON_CONFORMANT (2 directional gaps — both small, behavioural drift from spec wording rather than feature gaps; see deferred items)

Both directional gaps trace to the npm-pipe-hang fix (commit `eff3cd2f`) which routed watcher stdio away from the parent's pipes. The fix was correct (the pipe-hang would have made every cold start unusable), but the spec wording in two paragraphs was not updated to match the new stdio routing. Neither gap blocks Phase 0 functionality; both should be addressed before promoting Phase 0 — either by adjusting the spec to match the implementation, or by adding a small parent-side surface for the watcher-failure signal.

---

## Requirements extracted (full checklist)

### Generator — extraction & path handling

| # | Spec section | Requirement | Verdict |
|---|--------------|-------------|---------|
| 1 | "Path normalisation (locked)" (line 47) | Repo-root-relative POSIX, no leading `./`, no extension stripping, lowercase on Windows | PASS |
| 2 | "Import resolution (locked)" (line 49) | Resolve through tsconfig (path aliases, index files, omitted extensions); always emit resolved path; unresolvable imports silently dropped | PASS |

### Generator — output artifacts

| # | Spec section | Requirement | Verdict |
|---|--------------|-------------|---------|
| 3 | Generator artifacts §1 | Per-directory shards `references/import-graph/{server,client,shared}.json` | PASS |
| 4 | Generator artifacts §1 | Shard structure `{ files: { [path]: { imports, exports, importedBy } } }` | PASS |
| 5 | Generator artifacts §2 + Done criteria | `references/project-map.md` ≤100 lines, sections in order | PASS (94 lines) |
| 6 | Digest §1 | Top 20 files by inbound count, tie-break ASC path, deterministic | PASS |
| 7 | Digest §2 | Service entry points by directory | PASS |
| 8 | Digest §3 | Files with zero inbound imports (dead-code candidates) | PASS |
| 9 | Digest §4 | Per-directory file count + line count totals | PASS |
| 10 | "What this is NOT" + commit `c28bb649` | Digest non-goals header at top | PASS |
| 11 | Done criteria | Re-runs produce byte-identical digest (no timestamps; deterministic ordering) | PASS |

### Generator — caching

| # | Spec section | Requirement | Verdict |
|---|--------------|-------------|---------|
| 12 | "Caching" | SHA256 cache at `references/.code-graph-cache.json`, skip on hash match | PASS |
| 13 | Atomic shard writes paragraph (line 110) | Cache file written via temp + rename | PASS |
| 14 | "Dead-file pruning" | Prune cache entries for paths not on disk | PASS |
| 15 | Done criteria | Skipped files written to `.skipped.txt` with one-line reason | PASS |
| 16 | Done criteria | 5%-per-directory skip rate fails the cold build with non-zero exit | PASS |

### Watcher — core

| # | Spec section | Requirement | Verdict |
|---|--------------|-------------|---------|
| 17 | "Mechanism" | chokidar watcher launched detached by predev, monitors server/client/shared | PASS |
| 18 | "Watch scope — explicit ignore list (non-negotiable)" | Ignore list contains node_modules, dist, .git, references, *.d.ts, *.generated.ts | PASS (references entry uses absolute-path glob form rather than `'references/**'`; functionally equivalent because watch roots are server/client/shared, not repo root) |
| 19 | "On each event: add/change" | SHA256 dedupe — skip mtime-only touches | PASS |
| 20 | "Bidirectional edge update (mandatory)" on change | Remove from old imports' importedBy; add to new imports' importedBy | PASS |
| 21 | "On each event: unlink" | Remove from cache + own shard + reverse-clean importedBy of files X previously imported | PASS |
| 22 | "Rename" paragraph | Treated as unlink+add, no special-casing | PASS |
| 23 | "Topology change" — three triggers | top-20 set change OR zero-vs-nonzero crossing OR add/unlink | PASS |
| 24 | "Event coalescing" | 150ms debounce + bulk batch (≥10 events / 500ms window) | PASS |
| 25 | Atomic shard writes paragraph (line 110) | Shards written via temp + rename | PASS |

### Watcher — failure & lifecycle

| # | Spec section | Requirement | Verdict |
|---|--------------|-------------|---------|
| 26 | "Failure logging" (line 102) | Watcher logs to `references/.code-graph-watcher.log` (append mode) | PASS |
| 27 | Done criteria — skipped-file logging | `.skipped.txt` entry clears on next successful save (prune-on-success) | PASS |
| 28 | "Concurrency: lockfile-based singleton" | proper-lockfile, 10s stale, `references/.watcher.lock` | PASS |
| 29 | "Lifecycle" paragraph | SIGTERM / SIGINT handlers registered | PASS |
| 30 | "Watcher start failure — degrade, don't block" (line 112) | On chokidar init failure: log + continue + don't block dev server. Spec wording: *"the launcher logs the error to dev-server stdout"* | DIRECTIONAL_GAP — failure logs to watcher log file, not parent stdout. See deferred item D1. |
| 31 | "Failure logging" (line 102) — *"watcher's stdio is deliberately routed to a log file rather than inherited from `predev`'s pipes"* | Watcher subprocess stdio routed to log file (NOT inherit) | PASS |

### Lifecycle — package.json scripts

| # | Spec section | Requirement | Verdict |
|---|--------------|-------------|---------|
| 32 | "Cold build" (line 117) | `predev` → `tsx scripts/build-code-graph.ts` (verbatim) | PASS |
| 33 | "Manual rebuild" (line 119) | `code-graph:rebuild` — drops cache, releases any held lock, re-walks | DIRECTIONAL_GAP — drops cache and re-walks correctly, but does NOT release a held lock. Live watchers retain stale in-memory state after rebuild. See deferred item D2. |
| 34 | "Watch-only mode" (line 120) | `code-graph:watch` — singleton, coexists with parallel dev | PASS |

### .gitignore

| # | Spec section | Requirement | Verdict |
|---|--------------|-------------|---------|
| 35 | "Lifecycle" (line 116) | `references/.code-graph-cache.json` ignored | PASS |
| 36 | "Lifecycle" (line 116) | `references/import-graph/` ignored | PASS |
| 37 | "Lifecycle" (line 116) | `references/project-map.md` ignored | PASS |
| 38 | "Lifecycle" (line 116) | `references/.watcher.lock` ignored | PASS (also covers auxiliary `.watcher.lock.lock` and `.code-graph-watcher.log`) |

### Integration — manual usage hints

| # | Spec section | Requirement | Verdict |
|---|--------------|-------------|---------|
| 39 | Done criteria — Integration surface | `.claude/agents/architect.md` carries the verbatim safety sentence (`grep -l "trust source"`) | PASS — line 57 |
| 40 | Done criteria — Integration surface | `CLAUDE.md` § Local Dev Agent Fleet carries the verbatim safety sentence | PASS — line 207 |

### Knowledge capture (correction entry)

| # | Spec section | Requirement | Verdict |
|---|--------------|-------------|---------|
| 41 | Caller-listed scope (KNOWLEDGE.md correction) | Correction entry for the masking-condition validation lesson with rule + detector + applicability beyond watchers | PASS — KNOWLEDGE.md lines 957-960 (commit `06f3c63a`) |

---

## Mechanical fixes applied

None. Both gaps were classified DIRECTIONAL because resolving them requires a design decision (where to surface the watcher-failure signal upstream; how to release a watcher-held lock during rebuild without leaving the running watcher in an inconsistent state).

---

## Directional / ambiguous gaps (routed to tasks/todo.md)

### D1 — REQ #30 — Watcher start failure logged to log file rather than dev-server stdout

**Spec quote:** *"the launcher logs the error to dev-server stdout (`[code-graph] watcher failed to start: <reason> — falling back to manual rebuild mode`) and continues"* (plan.md line 112).

**Implementation:** `console.warn` from inside `runWatcher()` (line 962 of `scripts/build-code-graph.ts`). The watcher subprocess's stdio is routed to `references/.code-graph-watcher.log` (correctly, per the npm-pipe-hang fix in commit `eff3cd2f`). Therefore the failure message lands in the log file, not in the parent `npm run dev` terminal.

**Why directional, not mechanical:** routing the failure message back to dev-server stdout is non-trivial because the chokidar.watch failure happens *inside the detached subprocess* — by the time the spawn completes successfully, the parent has already moved on. A correct fix needs either (a) a parent-side fast-fail probe before spawning (test that chokidar can initialise in a sync child) or (b) the spec to be edited to acknowledge that the failure message lives in the log file. Both are valid approaches; the choice affects user-visible UX. Not auto-fixed.

**Suggested approach:** edit the spec paragraph on watcher start failure to reflect the log-file destination AND add a single-line stdout marker from the parent process at spawn time (`[code-graph] watcher started — failures and per-event logs in references/.code-graph-watcher.log`) so users know where to look. The current implementation already prints `[code-graph] watcher started in background (pid X). Tail logs with: tail -f references/.code-graph-watcher.log` (line 601), so most of the UX is already there — the spec just needs to acknowledge it.

### D2 — REQ #33 — `code-graph:rebuild` does not release a held lock

**Spec quote:** *"Manual rebuild: `npm run code-graph:rebuild` for cold-rebuild from scratch (drops `references/.code-graph-cache.json`, releases any held lock, re-walks the tree)."* (plan.md line 119).

**Implementation:** rebuild mode unlinks the cache file (line 1016 of `scripts/build-code-graph.ts`), runs `coldBuild()`, then `spawnWatcher()`. The new watcher subprocess tries to acquire the lock; if a previous watcher is alive, the new one exits silently (line 619). The previous watcher retains stale in-memory `memShards` and `watcherCache` and on its next event will write back state that doesn't match the freshly-rebuilt artifacts.

**Why directional, not mechanical:** the obvious mechanical fix (`fs.unlink(LOCK_PATH)` before spawning) leaves the running watcher orphaned and writing stale data; the better fix needs a design choice between: (a) read PID from lock file and SIGTERM the old watcher, then unlink; (b) make the watcher self-restart when it detects the cache file was unlinked; (c) accept that rebuild requires the user to kill the old watcher first and document this. Each option has different trade-offs.

**Suggested approach:** add a parent-side step in rebuild mode that reads the PID stored in the lock-file metadata (proper-lockfile stores PID), sends SIGTERM, waits for the lock to release (with a short timeout fallback to SIGKILL + force-unlink), then proceeds. This matches the spec wording exactly. The 10s heartbeat timeout makes the SIGKILL path safe — even if SIGTERM is missed, the lock self-releases within 10s and the new spawn picks it up.

---

## Files modified by this run

None. Only the review log itself is created; no source files were edited. `tasks/todo.md` is updated with the deferred-items section (see Next step).

---

## Next step

NON_CONFORMANT — 2 directional gaps must be addressed by the main session before `pr-reviewer`. Both are small and trace to a single correctness fix (npm-pipe-hang) that didn't fully propagate into the spec. The recommended path is:

1. Edit `tasks/builds/code-intel-phase-0/plan.md` to align lines 112 and 119 with the implementation (D1 spec-edit; D2 either spec-edit or implementation-extend).
2. If implementation-extend is chosen for D2, add the lock-release step in rebuild mode.
3. Re-run `spec-conformance` (this agent) once edits are applied to confirm CONFORMANT.
4. Run `bash scripts/run-all-unit-tests.sh` then the full gate set per the gate-cadence rule.
5. Hand off to `pr-reviewer`.

If the user chooses to spec-edit both items (no implementation change), `pr-reviewer` can proceed without re-running `spec-conformance` because the changed-code set has not expanded.
