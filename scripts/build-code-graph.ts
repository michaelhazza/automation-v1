/**
 * build-code-graph.ts
 *
 * Cold-build script for the code-intelligence import graph.
 * Walks server/, client/, shared/ and produces:
 *   references/.code-graph-cache.json       — incremental SHA256 cache
 *   references/import-graph/server.json     — per-shard import graph
 *   references/import-graph/client.json
 *   references/import-graph/shared.json
 *   references/import-graph/.skipped.txt   — parse failures
 *   references/project-map.md              — human-readable digest
 *
 * Usage:
 *   npx tsx scripts/build-code-graph.ts            # cold build (default)
 *   npx tsx scripts/build-code-graph.ts --build    # same
 *   npx tsx scripts/build-code-graph.ts --rebuild  # drop cache first
 *   npx tsx scripts/build-code-graph.ts --watch-only # skip build, go to watcher
 */

import { createHash } from 'node:crypto';
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project } from 'ts-morph';
import lockfile from 'proper-lockfile';
import chokidar, { type FSWatcher } from 'chokidar';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const CACHE_PATH = path.join(ROOT, 'references', '.code-graph-cache.json');
const SHARD_DIR = path.join(ROOT, 'references', 'import-graph');
const SKIPPED_PATH = path.join(SHARD_DIR, '.skipped.txt');
const DIGEST_PATH = path.join(ROOT, 'references', 'project-map.md');
const LOCK_PATH = path.join(ROOT, 'references', '.watcher.lock');
const WATCHER_LOG_PATH = path.join(ROOT, 'references', '.code-graph-watcher.log');
const WATCHER_PID_PATH = path.join(ROOT, 'references', '.watcher.pid');

const CLIENT_TSCONFIG = path.join(ROOT, 'tsconfig.json');
const SERVER_TSCONFIG = path.join(ROOT, 'server', 'tsconfig.json');

// Top-level dirs we walk
const TOP_DIRS = ['server', 'client', 'shared'] as const;
type TopDir = typeof TOP_DIRS[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
  sha256: string;
  imports: string[];
  exports: string[];
  importedBy: string[];
}

type Cache = Record<string, FileEntry>;

/**
 * Bump when the FileEntry shape (or any normalisation rule that affects its
 * fields) changes. loadCache discards a cache file whose version doesn't
 * match — a one-time rebuild is cheaper than silently mixing old and new
 * entries until the user manually runs `npm run code-graph:rebuild`.
 */
const CACHE_VERSION = 1 as const;

interface CacheFile {
  version: number;
  entries: Cache;
}

interface Shard {
  files: Record<string, Omit<FileEntry, 'sha256'>>;
}

// ---------------------------------------------------------------------------
// Path normalisation
// ---------------------------------------------------------------------------

/**
 * Convert an absolute path to a repo-root-relative POSIX path.
 * On Windows, apply toLowerCase() for case normalisation.
 * Never strips extensions; never adds leading "./".
 */
function toRepoRelPosix(absPath: string): string {
  let rel = path.relative(ROOT, absPath).replace(/\\/g, '/');
  if (process.platform === 'win32') {
    rel = rel.toLowerCase();
  }
  // Strip any accidental leading "./"
  if (rel.startsWith('./')) rel = rel.slice(2);
  return rel;
}

/**
 * Test files are discovered by the test runner — they are not "service entry
 * points" or "dead code" even though they typically have zero inbound imports.
 * Excluded from digest sections that would otherwise be flooded with hundreds
 * of test entries; still included in the shards (the import edges of a test
 * file are useful when looking for a feature's tests).
 */
function isTestFile(relPath: string): boolean {
  return /\/__tests__\//.test(relPath) || /\.(test|spec)\.tsx?$/.test(relPath);
}

// ---------------------------------------------------------------------------
// File system helpers
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, filePath);
}

async function walkTs(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function recurse(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and dist
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
        await recurse(full);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  await recurse(dir);
  return results;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

async function countLines(filePath: string): Promise<number> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Cache I/O
// ---------------------------------------------------------------------------

async function loadCache(): Promise<Cache> {
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CacheFile>;
    if (parsed.version !== CACHE_VERSION) {
      console.warn(`[code-graph] cache version mismatch (got ${parsed.version}, expected ${CACHE_VERSION}) — discarding and rebuilding`);
      return {};
    }
    return parsed.entries ?? {};
  } catch {
    return {};
  }
}

async function saveCache(cache: Cache): Promise<void> {
  const out: CacheFile = { version: CACHE_VERSION, entries: cache };
  await writeAtomic(CACHE_PATH, JSON.stringify(out, null, 2));
}

// ---------------------------------------------------------------------------
// ts-morph extraction
// ---------------------------------------------------------------------------

function extractFromProject(
  project: Project,
  absFiles: string[],
  cache: Cache,
  skipped: Map<string, string>,
): Map<string, { imports: string[]; exports: string[]; hash: string }> {
  const results = new Map<string, { imports: string[]; exports: string[]; hash: string }>();

  for (const absPath of absFiles) {
    const relPath = toRepoRelPosix(absPath);
    let content: string;
    try {
      // ts-morph has the file in memory; get source file
      const sf = project.getSourceFile(absPath) ?? project.addSourceFileAtPath(absPath);
      content = sf.getFullText();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      skipped.set(relPath, reason);
      console.warn(`[code-graph] skipped ${relPath}: ${reason}`);
      continue;
    }

    const hash = sha256(content);

    // Check cache hit
    const cached = cache[relPath];
    if (cached && cached.sha256 === hash) {
      results.set(relPath, {
        imports: cached.imports,
        exports: cached.exports,
        hash,
      });
      continue;
    }

    // Extract imports
    const imports: string[] = [];
    try {
      const sf = project.getSourceFile(absPath)!;

      // Get all import declarations and dynamic imports
      const importDecls = sf.getImportDeclarations();
      for (const decl of importDecls) {
        const moduleSpecifier = decl.getModuleSpecifierValue();
        // Only resolve non-external (relative / alias) imports
        const resolvedSf = decl.getModuleSpecifierSourceFile();
        if (resolvedSf) {
          const resolvedAbs = resolvedSf.getFilePath();
          imports.push(toRepoRelPosix(resolvedAbs));
        }
        // External packages (no resolvedSf) are silently dropped per spec
        void moduleSpecifier; // suppress unused warning
      }

      // Also handle export-from declarations (re-exports)
      const exportDecls = sf.getExportDeclarations();
      for (const decl of exportDecls) {
        const resolvedSf = decl.getModuleSpecifierSourceFile?.();
        if (resolvedSf) {
          const resolvedAbs = resolvedSf.getFilePath();
          const rel = toRepoRelPosix(resolvedAbs);
          if (!imports.includes(rel)) {
            imports.push(rel);
          }
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      skipped.set(relPath, reason);
      console.warn(`[code-graph] skipped ${relPath}: ${reason}`);
      continue;
    }

    // Extract exports
    const exports: string[] = [];
    try {
      const sf = project.getSourceFile(absPath)!;
      const exportedDecls = sf.getExportedDeclarations();
      for (const [name] of exportedDecls) {
        exports.push(name);
      }
    } catch {
      // Non-fatal — exports are best-effort
    }

    results.set(relPath, { imports, exports, hash });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Build reverse index (importedBy)
// ---------------------------------------------------------------------------

function buildImportedBy(
  allEntries: Map<string, { imports: string[]; exports: string[] }>,
): Map<string, string[]> {
  const importedBy = new Map<string, string[]>();

  // Initialise all known files with empty arrays
  for (const relPath of allEntries.keys()) {
    importedBy.set(relPath, []);
  }

  // Forward pass: for each file X importing [A, B, C], add X to A/B/C's importedBy
  for (const [relPath, entry] of allEntries) {
    for (const imp of entry.imports) {
      if (!importedBy.has(imp)) {
        importedBy.set(imp, []);
      }
      importedBy.get(imp)!.push(relPath);
    }
  }

  return importedBy;
}

// ---------------------------------------------------------------------------
// Shard writing
// ---------------------------------------------------------------------------

async function writeShard(dir: TopDir, files: Record<string, Omit<FileEntry, 'sha256'>>): Promise<void> {
  const shard: Shard = { files };
  await writeAtomic(path.join(SHARD_DIR, `${dir}.json`), JSON.stringify(shard, null, 2));
}

// ---------------------------------------------------------------------------
// Digest (project-map.md)
// ---------------------------------------------------------------------------

async function writeDigest(
  allEntries: Map<string, FileEntry>,
  dirFileCounts: Map<string, number>,
  dirLineCounts: Map<string, number>,
): Promise<void> {
  const lines: string[] = [];

  lines.push('# Project Map');
  lines.push('');
  lines.push(
    'This map covers static imports, named exports, and inverted import edges. ' +
      'It does NOT cover: dynamic imports, runtime dispatch via string keys ' +
      '(skill registry, action registry, agent capability resolution), ' +
      'framework-mediated calls (Drizzle proxy methods, React hooks, decorators), ' +
      'or config-driven behaviour (organisation configuration templates, skill enablement). ' +
      'For questions about runtime behaviour or config-driven dispatch, fall through to source.',
  );
  lines.push('');

  // ---- Section 1: Top 20 files by inbound-import count ----
  // Test files are kept in the inbound ranking — they almost never appear here
  // (zero inbound by definition for runner-discovered tests), but excluding the
  // filter keeps the ranking comprehensive.
  lines.push('## Top 20 Files by Inbound-Import Count');
  lines.push('');
  lines.push('| File | Inbound imports |');
  lines.push('|------|-----------------|');

  // Snapshot counts before sorting
  const byInbound = Array.from(allEntries.entries()).map(([p, e]) => ({
    path: p,
    count: e.importedBy.length,
  }));
  byInbound.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  for (const entry of byInbound.slice(0, 20)) {
    lines.push(`| \`${entry.path}\` | ${entry.count} |`);
  }
  lines.push('');

  // ---- Section 2: Service entry points by directory ----
  // Capped at 10 per directory. Many files appear here not because they're
  // "real" entry points but because they're dispatched dynamically (skill /
  // action / handler registries) — see the non-goals paragraph at the top.
  // Cap keeps the digest within the ≤100-line budget; overflow count surfaces
  // when the long tail is non-trivial.
  const ENTRY_POINTS_PER_DIR_CAP = 10;
  lines.push('## Service Entry Points by Directory');
  lines.push('');
  lines.push(
    `_Files with zero inbound imports that have at least one outbound import. Top ${ENTRY_POINTS_PER_DIR_CAP} per directory shown; test files excluded._`,
  );
  lines.push('');

  const entryPoints = Array.from(allEntries.entries())
    .filter(([p, e]) => e.importedBy.length === 0 && e.imports.length > 0 && !isTestFile(p))
    .map(([p]) => p)
    .sort();

  // Group by top-level dir
  const byDir = new Map<string, string[]>();
  for (const p of entryPoints) {
    const dir = p.split('/')[0];
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(p);
  }
  for (const dir of TOP_DIRS) {
    const files = byDir.get(dir) ?? [];
    if (files.length === 0) continue;
    lines.push(`### ${dir}`);
    lines.push('');
    for (const f of files.slice(0, ENTRY_POINTS_PER_DIR_CAP)) {
      lines.push(`- \`${f}\``);
    }
    if (files.length > ENTRY_POINTS_PER_DIR_CAP) {
      lines.push(`- _…and ${files.length - ENTRY_POINTS_PER_DIR_CAP} more (see shard for full list)._`);
    }
    lines.push('');
  }

  // ---- Section 3: Files with zero inbound imports (dead-code candidates) ----
  // Capped at 20 total. Same caveat as section 2 — many "candidates" are not
  // dead, they're dynamically dispatched and the static AST cannot see the
  // edge.
  const DEAD_CODE_CAP = 20;
  lines.push('## Files with Zero Inbound Imports (Dead-Code Candidates)');
  lines.push('');
  lines.push(
    `_Top ${DEAD_CODE_CAP} alphabetical; test files excluded. Many candidates are not actually dead — they are dispatched dynamically. See non-goals at top._`,
  );
  lines.push('');

  const zeroInbound = Array.from(allEntries.entries())
    .filter(([p, e]) => e.importedBy.length === 0 && !isTestFile(p))
    .map(([p]) => p)
    .sort();

  if (zeroInbound.length === 0) {
    lines.push('_None._');
  } else {
    for (const p of zeroInbound.slice(0, DEAD_CODE_CAP)) {
      lines.push(`- \`${p}\``);
    }
    if (zeroInbound.length > DEAD_CODE_CAP) {
      lines.push(`- _…and ${zeroInbound.length - DEAD_CODE_CAP} more (see shards for full list)._`);
    }
  }
  lines.push('');

  // ---- Section 4: Per-directory file count + line count ----
  lines.push('## Per-Directory Totals');
  lines.push('');
  lines.push('| Directory | Files | Lines |');
  lines.push('|-----------|-------|-------|');
  for (const dir of TOP_DIRS) {
    const files = dirFileCounts.get(dir) ?? 0;
    const linesCount = dirLineCounts.get(dir) ?? 0;
    lines.push(`| \`${dir}\` | ${files} | ${linesCount.toLocaleString()} |`);
  }
  lines.push('');

  await writeAtomic(DIGEST_PATH, lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Main cold build
// ---------------------------------------------------------------------------

async function coldBuild(): Promise<void> {
  console.log('[code-graph] starting cold build…');

  await ensureDir(SHARD_DIR);

  // Load incremental cache
  const cache = await loadCache();

  // Build ts-morph projects
  console.log('[code-graph] initialising ts-morph projects…');
  const clientProject = new Project({
    tsConfigFilePath: CLIENT_TSCONFIG,
    skipAddingFilesFromTsConfig: false,
    skipFileDependencyResolution: false,
  });

  const serverProject = new Project({
    tsConfigFilePath: SERVER_TSCONFIG,
    skipAddingFilesFromTsConfig: false,
    skipFileDependencyResolution: false,
  });

  // Walk directories and assign to projects
  const dirFiles = new Map<TopDir, string[]>();
  for (const dir of TOP_DIRS) {
    const absDir = path.join(ROOT, dir);
    const files = await walkTs(absDir);
    dirFiles.set(dir, files);
  }

  const skipped = new Map<string, string>();

  // Extract using appropriate project per directory
  // client → clientProject; server + shared → serverProject
  const allExtracted = new Map<string, { imports: string[]; exports: string[]; hash: string }>();

  for (const dir of TOP_DIRS) {
    const files = dirFiles.get(dir)!;
    const project = dir === 'client' ? clientProject : serverProject;
    console.log(`[code-graph] extracting ${dir} (${files.length} files)…`);
    const extracted = extractFromProject(project, files, cache, skipped);
    for (const [k, v] of extracted) {
      allExtracted.set(k, v);
    }
  }

  // Build reverse index
  console.log('[code-graph] building importedBy index…');
  const importedBy = buildImportedBy(allExtracted);

  // Assemble final entries (merge hash + importedBy)
  const allEntries = new Map<string, FileEntry>();
  for (const [relPath, { imports, exports, hash }] of allExtracted) {
    allEntries.set(relPath, {
      sha256: hash,
      imports,
      exports,
      importedBy: importedBy.get(relPath) ?? [],
    });
  }

  // Dead-file pruning: remove cache entries for paths no longer on disk
  const currentPaths = new Set(allEntries.keys());
  for (const cachedPath of Object.keys(cache)) {
    if (!currentPaths.has(cachedPath)) {
      delete cache[cachedPath];
    }
  }

  // Update cache with new entries
  for (const [relPath, entry] of allEntries) {
    cache[relPath] = entry;
  }

  // Write shards
  console.log('[code-graph] writing shards…');
  for (const dir of TOP_DIRS) {
    const files = dirFiles.get(dir)!;
    const shardFiles: Record<string, Omit<FileEntry, 'sha256'>> = {};
    for (const absPath of files) {
      const relPath = toRepoRelPosix(absPath);
      if (allEntries.has(relPath)) {
        const { imports, exports, importedBy: ib } = allEntries.get(relPath)!;
        shardFiles[relPath] = { imports, exports, importedBy: ib };
      }
    }
    await writeShard(dir, shardFiles);
    console.log(`[code-graph] wrote references/import-graph/${dir}.json (${Object.keys(shardFiles).length} files)`);
  }

  // Write skipped file log
  if (skipped.size > 0) {
    const skippedLines = Array.from(skipped.entries()).map(([p, r]) => `${p}\t${r}`);
    await writeAtomic(SKIPPED_PATH, skippedLines.join('\n') + '\n');
    console.log(`[code-graph] wrote .skipped.txt (${skipped.size} files)`);
  } else {
    // Write empty file to indicate clean build
    await writeAtomic(SKIPPED_PATH, '');
  }

  // 5% skip rate check (cold build only)
  let skipCheckFailed = false;
  for (const dir of TOP_DIRS) {
    const allDirFiles = dirFiles.get(dir)!;
    const total = allDirFiles.length;
    if (total === 0) continue;
    const dirSkipped = Array.from(skipped.keys()).filter((p) => p.startsWith(dir + '/')).length;
    const rate = dirSkipped / total;
    if (rate > 0.05) {
      console.error(
        `[code-graph] ERROR: skip rate for ${dir} is ${(rate * 100).toFixed(1)}% (${dirSkipped}/${total}), exceeds 5% threshold`,
      );
      skipCheckFailed = true;
    }
  }
  if (skipCheckFailed) {
    process.exit(1);
  }

  // Write cache
  console.log('[code-graph] writing cache…');
  await saveCache(cache);

  // Compute line counts per directory for digest
  const dirFileCounts = new Map<string, number>();
  const dirLineCounts = new Map<string, number>();
  for (const dir of TOP_DIRS) {
    const files = dirFiles.get(dir)!;
    dirFileCounts.set(dir, files.length);
    let totalLines = 0;
    await Promise.all(
      files.map(async (f) => {
        const n = await countLines(f);
        totalLines += n;
      }),
    );
    dirLineCounts.set(dir, totalLines);
  }

  // Write digest
  console.log('[code-graph] writing project-map.md…');
  await writeDigest(allEntries, dirFileCounts, dirLineCounts);
  console.log('[code-graph] wrote references/project-map.md');

  const totalFiles = Array.from(dirFiles.values()).reduce((s, a) => s + a.length, 0);
  console.log(`[code-graph] cold build complete. ${totalFiles} files processed, ${skipped.size} skipped.`);
}

// ---------------------------------------------------------------------------
// Watcher — spawn helper (called from main process)
// ---------------------------------------------------------------------------

async function spawnWatcher(): Promise<void> {
  const { spawn } = await import('node:child_process');
  const { openSync } = await import('node:fs');

  // Route watcher stdio to a log file rather than inheriting the parent's
  // pipes. Inheriting from a process spawned under `npm run …` keeps npm's
  // pipe open across the detached watcher's lifetime — npm waits for the
  // watcher's fds to close (forever) and never exits, hanging predev on
  // every cold start. Routing to a log file fully detaches stdio so the
  // parent can exit cleanly. The log file is searchable across sessions
  // (more useful than terminal scrollback) and tail-able live.
  await ensureDir(path.dirname(WATCHER_LOG_PATH));
  const logFd = openSync(WATCHER_LOG_PATH, 'a');

  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawn(
    process.execPath,
    ['--import', 'tsx/esm', scriptPath, '--watcher-subprocess'],
    { detached: true, stdio: ['ignore', logFd, logFd], cwd: ROOT },
  );
  child.unref();
  const logRel = path.relative(ROOT, WATCHER_LOG_PATH).replace(/\\/g, '/');
  console.log(`[code-graph] watcher started in background (pid ${child.pid}). Tail logs with: tail -f ${logRel}`);
}

// ---------------------------------------------------------------------------
// Watcher — subprocess entry point
// ---------------------------------------------------------------------------

async function runWatcher(): Promise<void> {
  // Ensure the lock resource file exists (proper-lockfile requires the file to exist)
  await ensureDir(path.dirname(LOCK_PATH));
  await fs.writeFile(LOCK_PATH, '', { flag: 'a' });

  // Acquire singleton lock
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await lockfile.lock(LOCK_PATH, { stale: 10000, update: 2000, retries: 0 });
  } catch {
    console.log('[code-graph] watcher: lock held by another process — exiting');
    process.exit(0);
  }

  // Truncate the watcher log if it has grown past 5 MB. The log is opened
  // with O_APPEND in the parent's spawnWatcher; truncate-on-startup keeps it
  // bounded across long-running dev sessions without a full rotation system.
  try {
    const stats = await fs.stat(WATCHER_LOG_PATH);
    if (stats.size > 5 * 1024 * 1024) await fs.truncate(WATCHER_LOG_PATH, 0);
  } catch {}

  // Write our PID so `--rebuild` can find and terminate us before dropping
  // the cache. Without this, a live watcher with stale in-memory state
  // would silently overwrite the freshly-rebuilt shards on its next event.
  try { await fs.writeFile(WATCHER_PID_PATH, String(process.pid), 'utf8'); } catch {}

  // Cleanup on signal
  async function cleanup(): Promise<void> {
    try { await fs.unlink(WATCHER_PID_PATH); } catch {}
    if (releaseLock) {
      try { await releaseLock(); } catch {}
      releaseLock = null;
    }
    process.exit(0);
  }
  process.on('SIGTERM', () => void cleanup());
  process.on('SIGINT', () => void cleanup());

  // ---- In-memory state ----
  // Shard maps: TopDir → path → entry WITHOUT sha256
  type ShardMap = Record<string, { imports: string[]; exports: string[]; importedBy: string[] }>;
  const memShards: Record<TopDir, ShardMap> = { server: {}, client: {}, shared: {} };

  // Load each shard from disk
  for (const dir of TOP_DIRS) {
    try {
      const raw = await fs.readFile(path.join(SHARD_DIR, `${dir}.json`), 'utf8');
      memShards[dir] = (JSON.parse(raw) as Shard).files;
    } catch { /* shard may not exist yet */ }
  }

  // Load cache once into memory
  const watcherCache = await loadCache();

  // ---- ts-morph projects for single-file re-extraction ----
  const watcherClientProject = new Project({ tsConfigFilePath: CLIENT_TSCONFIG, skipAddingFilesFromTsConfig: false });
  const watcherServerProject = new Project({ tsConfigFilePath: SERVER_TSCONFIG, skipAddingFilesFromTsConfig: false });

  function projectFor(relPath: string): Project {
    return relPath.startsWith('client/') ? watcherClientProject : watcherServerProject;
  }

  /**
   * Remove any existing line for `relPath` from .skipped.txt. Symmetric with
   * the append-on-failure path: if a file was previously skipped due to a
   * syntax error and the user fixes it, the next successful extract drops the
   * stale entry. Called from the success branch of extractSingleFile.
   */
  async function pruneFromSkipped(relPath: string): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(SKIPPED_PATH, 'utf8');
    } catch {
      return;
    }
    const lines = content.split('\n');
    const filtered = lines.filter((line) => {
      const tabIdx = line.indexOf('\t');
      if (tabIdx === -1) return true;
      return line.slice(0, tabIdx) !== relPath;
    });
    if (filtered.length === lines.length) return;
    await writeAtomic(SKIPPED_PATH, filtered.join('\n'));
  }

  async function extractSingleFile(absPath: string): Promise<{ imports: string[]; exports: string[] } | null> {
    const relPath = toRepoRelPosix(absPath);
    const project = projectFor(relPath);
    try {
      let sf = project.getSourceFile(absPath);
      if (sf) {
        // refreshFromFileSystem only refreshes THIS source file. If a barrel
        // export elsewhere changed and this file's `@/foo` alias now resolves
        // to a different target, ts-morph's project-level resolution cache
        // won't reflect it until that barrel file is itself reprocessed by
        // the watcher. Bounded eventual-consistency window — same class as
        // the rename gap (plan.md "Known eventual-consistency window"); the
        // raw-source fallback in agent prompts is the mitigation.
        await sf.refreshFromFileSystem();
      } else {
        sf = project.addSourceFileAtPath(absPath);
      }
      // Extract imports (same logic as cold build)
      const imports: string[] = [];
      for (const decl of sf.getImportDeclarations()) {
        const resolved = decl.getModuleSpecifierSourceFile();
        if (resolved) imports.push(toRepoRelPosix(resolved.getFilePath()));
      }
      for (const decl of sf.getExportDeclarations()) {
        const resolved = decl.getModuleSpecifierSourceFile?.();
        if (resolved) {
          const rel = toRepoRelPosix(resolved.getFilePath());
          if (!imports.includes(rel)) imports.push(rel);
        }
      }
      // Extract exports
      const exports: string[] = [];
      try {
        for (const [name] of sf.getExportedDeclarations()) exports.push(name);
      } catch {}
      // Successful extract — drop any stale .skipped.txt entry for this file.
      await pruneFromSkipped(relPath);
      return { imports, exports };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[code-graph] skipped ${relPath}: ${reason}`);
      // Append to .skipped.txt
      try {
        await fs.appendFile(SKIPPED_PATH, `${relPath}\t${reason}\n`, 'utf8');
      } catch {}
      return null;
    }
  }

  // ---- Helpers ----

  function shardFor(relPath: string): TopDir | null {
    for (const dir of TOP_DIRS) {
      if (relPath.startsWith(dir + '/')) return dir;
    }
    return null;
  }

  async function flushShards(dirs: Set<TopDir>): Promise<void> {
    for (const dir of dirs) {
      const shard: Shard = { files: memShards[dir] };
      await writeAtomic(path.join(SHARD_DIR, `${dir}.json`), JSON.stringify(shard, null, 2));
    }
  }

  // ---- Topology change detection ----

  function getTop20Set(mem: Record<TopDir, ShardMap>): Set<string> {
    const entries: Array<{ path: string; count: number }> = [];
    for (const dir of TOP_DIRS) {
      for (const [p, e] of Object.entries(mem[dir])) {
        entries.push({ path: p, count: e.importedBy.length });
      }
    }
    entries.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
    return new Set(entries.slice(0, 20).map(e => e.path));
  }

  function getZeroSet(mem: Record<TopDir, ShardMap>): Set<string> {
    const zeros = new Set<string>();
    for (const dir of TOP_DIRS) {
      for (const [p, e] of Object.entries(mem[dir])) {
        if (e.importedBy.length === 0) zeros.add(p);
      }
    }
    return zeros;
  }

  function isTopologyChange(
    before: { top20: Set<string>; zeroCounts: Set<string> },
    after: { top20: Set<string>; zeroCounts: Set<string> },
    addedOrUnlinked: boolean,
  ): boolean {
    if (addedOrUnlinked) return true;
    for (const p of before.top20) if (!after.top20.has(p)) return true;
    for (const p of after.top20) if (!before.top20.has(p)) return true;
    for (const p of before.zeroCounts) if (!after.zeroCounts.has(p)) return true;
    for (const p of after.zeroCounts) if (!before.zeroCounts.has(p)) return true;
    return false;
  }

  // ---- Core event processor ----

  async function processEvents(
    batch: Map<string, 'add' | 'change' | 'unlink'>,
  ): Promise<void> {
    const affectedShards = new Set<TopDir>();
    let hadAddOrUnlink = false;

    // Snapshot topology BEFORE
    const beforeTop20 = getTop20Set(memShards);
    const beforeZero = getZeroSet(memShards);

    for (const [relPath, event] of batch) {
      const absPath = path.join(ROOT, relPath);
      const dir = shardFor(relPath);
      if (!dir) continue;

      if (event === 'unlink') {
        hadAddOrUnlink = true;
        const oldEntry = watcherCache[relPath];
        const oldImports = oldEntry?.imports ?? [];
        // Remove relPath from importedBy of each file it previously imported
        for (const imp of oldImports) {
          const impDir = shardFor(imp);
          if (impDir && memShards[impDir][imp]) {
            memShards[impDir][imp].importedBy = memShards[impDir][imp].importedBy.filter(p => p !== relPath);
            affectedShards.add(impDir);
          }
        }
        delete memShards[dir][relPath];
        delete watcherCache[relPath];
        // Drop the SourceFile from the ts-morph project too — without this,
        // every deleted .ts file leaks a SourceFile instance for the lifetime
        // of the watcher process, growing memory across long-running sessions.
        const sf = projectFor(relPath).getSourceFile(absPath);
        if (sf) projectFor(relPath).removeSourceFile(sf);
        affectedShards.add(dir);
        console.log(`[code-graph] unlink: removed ${relPath}`);

      } else { // add or change
        if (event === 'add') hadAddOrUnlink = true;

        // SHA256 check
        let content: string;
        try {
          content = await fs.readFile(absPath, 'utf8');
        } catch {
          continue; // file disappeared between event and now
        }
        const hash = sha256(content);
        const oldEntry = watcherCache[relPath];
        if (oldEntry && oldEntry.sha256 === hash) {
          // mtime-only touch — skip
          continue;
        }

        const extracted = await extractSingleFile(absPath);
        if (!extracted) continue;

        const newImports = extracted.imports;
        const newExports = extracted.exports;
        const oldImports = oldEntry?.imports ?? [];

        // Bidirectional edge update
        // 1. Remove relPath from importedBy of old imports no longer imported
        for (const oldImp of oldImports) {
          if (!newImports.includes(oldImp)) {
            const impDir = shardFor(oldImp);
            if (impDir && memShards[impDir][oldImp]) {
              memShards[impDir][oldImp].importedBy = memShards[impDir][oldImp].importedBy.filter(p => p !== relPath);
              affectedShards.add(impDir);
            }
          }
        }
        // 2. Add relPath to importedBy of new imports not previously imported
        for (const newImp of newImports) {
          if (!oldImports.includes(newImp)) {
            const impDir = shardFor(newImp);
            if (impDir && memShards[impDir][newImp] && !memShards[impDir][newImp].importedBy.includes(relPath)) {
              memShards[impDir][newImp].importedBy.push(relPath);
              affectedShards.add(impDir);
            }
          }
        }

        // Update X's own entry
        const existingImportedBy = memShards[dir][relPath]?.importedBy ?? [];
        memShards[dir][relPath] = { imports: newImports, exports: newExports, importedBy: existingImportedBy };
        watcherCache[relPath] = { sha256: hash, imports: newImports, exports: newExports, importedBy: existingImportedBy };
        affectedShards.add(dir);
        console.log(`[code-graph] ${event}: updated ${relPath} (${newImports.length} imports)`);
      }
    }

    // Flush affected shards and cache to disk
    if (affectedShards.size > 0) {
      await flushShards(affectedShards);
      await saveCache(watcherCache);
    }

    // Topology change check → regen project-map.md
    const afterTop20 = getTop20Set(memShards);
    const afterZero = getZeroSet(memShards);
    if (isTopologyChange({ top20: beforeTop20, zeroCounts: beforeZero }, { top20: afterTop20, zeroCounts: afterZero }, hadAddOrUnlink)) {
      // Rebuild allEntries for digest
      const allEntries = new Map<string, FileEntry>();
      const dirFileCounts = new Map<string, number>();
      const dirLineCounts = new Map<string, number>();
      for (const dir of TOP_DIRS) {
        let lineTotal = 0;
        for (const [p, e] of Object.entries(memShards[dir])) {
          const cached = watcherCache[p];
          allEntries.set(p, { sha256: cached?.sha256 ?? '', ...e });
          try {
            const content = await fs.readFile(path.join(ROOT, p), 'utf8');
            lineTotal += content.split('\n').length;
          } catch {}
        }
        dirFileCounts.set(dir, Object.keys(memShards[dir]).length);
        dirLineCounts.set(dir, lineTotal);
      }
      await writeDigest(allEntries, dirFileCounts, dirLineCounts);
      console.log('[code-graph] project-map.md updated (topology change)');
    }
  }

  // ---- Debounce + batch coalescing ----

  const pendingEvents = new Map<string, 'add' | 'change' | 'unlink'>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let windowStart: number | null = null;
  let isProcessing = false;

  async function drain(): Promise<void> {
    if (isProcessing) return;
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    windowStart = null;
    const batch = new Map(pendingEvents);
    pendingEvents.clear();
    if (batch.size === 0) return;
    isProcessing = true;
    try {
      await processEvents(batch);
    } finally {
      isProcessing = false;
      // If new events accumulated during processing, drain again
      if (pendingEvents.size > 0) {
        debounceTimer = setTimeout(() => void drain(), 150);
      }
    }
  }

  function scheduleProcess(relPath: string, event: 'add' | 'change' | 'unlink'): void {
    pendingEvents.set(relPath, event); // last-write-wins per path
    const now = Date.now();
    if (windowStart === null) windowStart = now;

    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }

    const inWindow = (now - windowStart) < 500;
    if (pendingEvents.size >= 10 && inWindow) {
      // Bulk event — fire immediately
      void drain();
    } else {
      debounceTimer = setTimeout(() => void drain(), 150);
    }
  }

  // ---- chokidar startup ----

  const watchPaths = TOP_DIRS.map(d => path.join(ROOT, d));
  let watcher: FSWatcher;
  try {
    // awaitWriteFinish: false — atomic-save editors generate unlink+add (handled
    // correctly), and partial writes from non-atomic editors are absorbed by the
    // 150ms debounce + per-file SHA256 cache: a partial write either fails to
    // parse (logged + skipped), or extracts wrong and is corrected on the next
    // save when content settles. Enabling awaitWriteFinish would add unwanted
    // latency on every save without meaningful correctness gain.
    watcher = chokidar.watch(watchPaths, {
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.git/**',
        path.join(ROOT, 'references').replace(/\\/g, '/') + '/**',
        '**/*.d.ts',
        '**/*.generated.ts',
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: false,
    });
  } catch (err) {
    console.warn(`[code-graph] watcher failed to start: ${err} — falling back to manual rebuild mode`);
    if (releaseLock) { try { await releaseLock(); } catch {} }
    process.exit(0);
  }

  watcher
    .on('add', (absPath) => {
      const relPath = toRepoRelPosix(absPath);
      if (/\.tsx?$/.test(absPath) && !absPath.endsWith('.d.ts') && !absPath.endsWith('.generated.ts')) {
        scheduleProcess(relPath, 'add');
      }
    })
    .on('change', (absPath) => {
      const relPath = toRepoRelPosix(absPath);
      if (/\.tsx?$/.test(absPath)) {
        scheduleProcess(relPath, 'change');
      }
    })
    .on('unlink', (absPath) => {
      const relPath = toRepoRelPosix(absPath);
      // Mirror the add/change extension gate so deletions of .d.ts /
      // .generated.ts files don't flip topology dirty for entries that
      // were never in the shards. (N2 from pr-reviewer.)
      if (/\.tsx?$/.test(absPath) && !absPath.endsWith('.d.ts') && !absPath.endsWith('.generated.ts')) {
        scheduleProcess(relPath, 'unlink');
      }
    })
    .on('error', (err) => {
      console.warn(`[code-graph] watcher error: ${err}`);
      // Fatal fs-event-source errors (inotify exhaustion on Linux, EMFILE)
      // leave a healthy-looking-but-stale watcher. The lockfile heartbeat
      // keeps refreshing while file events stop arriving — exactly the
      // silent staleness the spec calls out as "the most concerning" mode.
      // Self-terminate so the next predev / code-graph:rebuild can recover.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOSPC' || code === 'EMFILE') {
        console.warn(`[code-graph] watcher: fatal fs-event source error (${code}) — releasing lock and exiting`);
        void cleanup();
      }
    });

  console.log('[code-graph] watcher ready — monitoring server/, client/, shared/');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Watcher subprocess mode
  if (args.includes('--watcher-subprocess')) {
    await runWatcher();
    return;
  }

  const mode = args.includes('--rebuild') ? 'rebuild'
    : args.includes('--watch-only') ? 'watch-only'
    : 'build';

  if (mode === 'watch-only') {
    console.log('[code-graph] watch-only mode — spawning watcher');
    await spawnWatcher();
    return;
  }

  if (mode === 'rebuild') {
    console.log('[code-graph] --rebuild: terminating any existing watcher…');
    await terminateExistingWatcher();
    console.log('[code-graph] --rebuild: dropping cache…');
    try { await fs.unlink(CACHE_PATH); } catch {}
  }

  await coldBuild();
  await spawnWatcher(); // spawn watcher after cold build
}

/**
 * Send SIGTERM to the watcher PID recorded at WATCHER_PID_PATH (if any),
 * then force-clear the lockfile artifacts. Required by --rebuild: a live
 * watcher carrying stale in-memory state would otherwise overwrite the
 * freshly-rebuilt shards on its next file event.
 *
 * On Windows, Node's process.kill terminates the target unconditionally,
 * so the watcher's cleanup handler does not run. The explicit unlink of
 * the lock and PID files below covers that case. proper-lockfile would
 * also reclaim a 10s-stale lock on its own, but unlinking is faster and
 * ensures the next predev cold-build does not race.
 */
async function terminateExistingWatcher(): Promise<void> {
  let pid: number | null = null;
  try {
    const pidStr = await fs.readFile(WATCHER_PID_PATH, 'utf8');
    const parsed = parseInt(pidStr.trim(), 10);
    if (!Number.isNaN(parsed)) pid = parsed;
  } catch {
    // No PID file — no live watcher tracked. Still proceed to clear lock
    // artifacts below in case of orphaned files.
  }

  if (pid !== null) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[code-graph] --rebuild: sent SIGTERM to watcher (pid ${pid})`);
    } catch {
      // ESRCH — process already gone.
      pid = null;
    }
  }

  // Poll for actual exit before clearing artifacts. A fixed wait race-conditions
  // with watcher operations that exceed the wait (topology rebuild iterates
  // every watched file to recompute line counts — ~1500+ files at warm cache).
  // process.kill(pid, 0) throws ESRCH when the process is gone; until then it
  // returns true (or throws EPERM on permission issues, which we treat as
  // "still alive" since we can't tell).
  if (pid !== null) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ESRCH') break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  try { await fs.unlink(WATCHER_PID_PATH); } catch {}
  try { await fs.unlink(LOCK_PATH); } catch {}
  try { await fs.rm(LOCK_PATH + '.lock', { recursive: true, force: true }); } catch {}
}

main().catch((err) => {
  console.error('[code-graph] fatal:', err);
  process.exit(1);
});
