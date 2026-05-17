# Gate Fix Design — wave-6-rls-residue-and-gate-fix

**Chunk:** 0 (design/audit — no code changes)
**Author:** Chunk 0 build session, 2026-05-17
**Status:** APPROVED (spec §3, ChatGPT review F1+F2 applied)

---

## 1. Bug Description

`scripts/verify-with-org-tx-or-scoped-db.sh` (and at least one other gate) was silently reporting 0 violations on Windows while Linux CI reported 1,108 real violations.

**Root cause:** The gate's `find → temp-file → FILE_LIST_PATH → Node` pipeline emits POSIX-style paths. On Windows running git-bash, `find` outputs paths in the form `/c/Files/Projects/...`. Node.js `fs.existsSync`, `fs.readFileSync`, and `ts-morph`'s `project.addSourceFilesAtPaths` all call the Win32 filesystem API, which requires Windows-native paths (`C:\Files\Projects\...` or at minimum `C:/Files/Projects/...`). A POSIX path beginning with `/c/` is not a valid UNC or drive-letter path — the Win32 API rejects it, causing `existsSync` to return `false` and `readFileSync` to throw `ENOENT`. The analyser receives a file list it cannot open, so it reports zero violations.

**Impact:** The gate ran successfully (no error exit) on Windows while the entire file-enumeration step was silently a no-op. Linux CI surfaced the real residue count of 1,108 callsites.

---

## 2. Option A — Wrap `find` with `cygpath -w`

**Proposal:** After calling `find`, pipe each path through `cygpath -w` to convert POSIX → Windows form before writing to the temp file.

**Example:**
```bash
while IFS= read -r f; do
  f_win=$(cygpath -w "$f" 2>/dev/null || echo "$f")
  FILE_LIST="${FILE_LIST}${f_win}\n"
done < <(find "$dir" -name '*.ts' ...)
```

**Rejection rationale:**

1. **Dependency risk.** `cygpath` is part of Cygwin and is bundled in Git for Windows, but it is not guaranteed to be present in every CI image. A Linux CI container running ubuntu-latest does not ship `cygpath`. The shim requires a `command -v cygpath` guard on every gate that uses it — fragile and easy to omit.

2. **Blast radius is per-gate, not per-class.** Every gate that uses a `find | Node` pipeline must independently apply the shim. Adding a new gate that forgets the shim re-introduces the bug class immediately. The fix does not prevent recurrence.

3. **Path-form brittleness.** `cygpath -w` emits `C:\Files\...` (backslash form). Node.js on Windows accepts both forward-slash (`C:/Files/...`) and backslash, but `ts-morph`'s glob matching and `project.addSourceFilesAtPaths` internally use forward-slash normalised forms. The backslash form can cause subtle mismatches in path comparison and deduplication.

4. **Inconsistency with existing approach.** The gates that already handle this correctly (`verify-no-new-cycles.sh`, `verify-duplicate-blocks.sh`, `verify-knip-config.sh`) use `cygpath -m` (mixed form, forward-slash Windows paths). Option A would require `cygpath -w` vs `cygpath -m` consistency rules that are undocumented and easy to get wrong.

---

## 3. Option B — Replace `find → temp-file → Node existsSync` with Node-native `glob.sync`

**Proposal:** Extract a shared Node ESM module (`scripts/lib/gate-file-enumerator.mjs`) that enumerates files using the already-pinned `glob ^13.0.6` dependency. The shell gate calls this module via a short Node heredoc instead of using `find`. No temp file is written; the file list is constructed entirely in Node using OS-native path APIs.

**Why Option B wins:**

1. **OS-portable by construction.** `glob.sync` internally uses `node:path.resolve` and `node:fs.readdirSync`, both of which return OS-native absolute paths on every platform. No POSIX-to-Windows conversion is needed because the paths are never produced by a POSIX shell tool.

2. **Fixes the class, not the instance.** All gates that migrate to `enumerateGateFiles` inherit correct behaviour automatically. Adding a new gate that calls `enumerateGateFiles` is safe by default.

3. **Zero new dependencies.** `glob ^13.0.6` is already declared in `package.json` (pinned during Wave 5). No `npm install` step is needed.

4. **Follows existing repo conventions.** The repo already has `scripts/lib/with-org-tx-analyser.mjs`, `scripts/lib/check-knip-config.mjs`, and `scripts/lib/orphan-component-analyser.mjs` — pure ESM Node helpers that gates delegate to. `gate-file-enumerator.mjs` follows the same pattern.

5. **Removes the temp-file step entirely.** The original gate wrote a temp file to avoid shell path-conversion hazards, then read it back from Node. Option B eliminates this two-step indirection by keeping file enumeration entirely in Node.

---

## 4. Design of `scripts/lib/gate-file-enumerator.mjs`

**File:** `scripts/lib/gate-file-enumerator.mjs`

**Responsibility:** Given a root directory, a set of include glob patterns, and optional exclude patterns, return an array of absolute, OS-native, sorted, deduplicated file paths.

### Public interface

```ts
function enumerateGateFiles(opts: {
  root: string;         // absolute path; honours process.env.GATE_ROOT first
  includes: string[];   // glob patterns relative to root
  excludes?: string[];  // glob patterns to filter out
}): string[];           // absolute paths, sorted, deduped, Node-native form
```

### Behavioural contract

- `root` is resolved via `path.resolve(root)` before any glob expansion. If `process.env.GATE_ROOT` is set, it overrides the passed-in `root` (allows CI to pin a specific root without code changes).
- `includes` patterns are expanded relative to `root`. Each matched path is joined with `root` via `path.join` to produce an absolute path.
- `excludes` patterns are applied as a post-filter using the same `minimatch` engine that `glob` uses internally (already a transitive dep of `glob ^13`).
- Output paths are normalised using `path.normalize` + `path.resolve`, ensuring backslash-to-forward-slash unification on Windows is not needed (the OS-native form is always correct for Node APIs).
- The result array is sorted lexicographically and deduplicated (a path appearing in multiple include patterns is emitted once).
- The function is synchronous (`glob.sync` / `readdirSync` based) to match the synchronous execution model of the existing gate analysers.

### Callers (Chunk 1 will implement)

- `verify-with-org-tx-or-scoped-db.sh` — replaces the `find` loop + temp-file + `FILE_LIST_PATH` env pattern.
- `verify-no-direct-boss-work.sh` — replaces the outer `find "$ROOT_DIR/server" -type f -name '*.ts'` call.

### Example caller pattern (shell heredoc)

```bash
FILES_JSON=$(
  GATE_ROOT="$ROOT_DIR" \
  node --input-type=module <<'NODEEOF'
const { enumerateGateFiles } = await import(
  'file://' + process.env.GATE_ROOT + '/scripts/lib/gate-file-enumerator.mjs'
);
const files = enumerateGateFiles({
  root: process.env.GATE_ROOT,
  includes: ['server/services/**/*.ts', 'server/jobs/**/*.ts', 'server/lib/**/*.ts', 'server/adapters/**/*.ts'],
  excludes: ['**/*.test.ts', '**/*.integration.test.ts', '**/node_modules/**'],
});
process.stdout.write(JSON.stringify(files));
NODEEOF
)
```

The analyser then receives `files` directly as a JSON array — no temp file, no POSIX path, no `existsSync` rejection.

---

## 5. Decision Record

| Criterion | Option A | Option B |
|-----------|----------|----------|
| Fixes the instance | YES | YES |
| Fixes the class | NO | YES |
| New dependencies | NO | NO |
| CI image portability | Fragile (`cygpath` may be absent) | Robust (Node built-in) |
| Per-gate maintenance surface | High (every gate needs shim) | Low (one shared module) |
| Consistent with existing conventions | Partial (`cygpath -m` vs `-w` inconsistency) | YES (follows `.mjs` helper pattern) |

**Decision: Option B.**

Option B is adopted for all gates identified as bug-affected in `gate-audit-results.md`. Chunk 1 implements `gate-file-enumerator.mjs` and migrates `verify-with-org-tx-or-scoped-db.sh` and `verify-no-direct-boss-work.sh`. Chunk 2 runs parity verification on both gates.
