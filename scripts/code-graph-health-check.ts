/**
 * code-graph-health-check.ts
 *
 * On-demand CEO-level health check for the Code Intelligence Cache (Phase 0).
 * Runs in <30s end to end. Produces a one-page markdown report:
 *   - to stdout
 *   - to references/.code-graph-health-YYYY-MM-DD.md (so reports accumulate)
 *
 * Design split (deliberate):
 *   - Data collection    : deterministic (no LLM)
 *   - Status banner      : deterministic (rule-based)
 *   - Recommendation     : deterministic (rule-based against trigger conditions
 *                          in tasks/code-intel-revisit.md)
 *   - Narrative prose    : LLM (Anthropic API; section bodies + headline only)
 *
 * Why hybrid: the verdict must be reproducible across runs so trends are
 * comparable week to week. The LLM narrates the *why* once the verdict is
 * fixed, never decides it. If the API call fails, the script still emits a
 * usable report from the deterministic skeleton.
 *
 * Spec context:
 *   - tasks/builds/code-intel-phase-0/plan.md  (cache build surface)
 *   - tasks/code-intel-revisit.md              (trigger thresholds, baseline queries)
 *
 * Usage:
 *   npm run code-graph:health
 *   tsx scripts/code-graph-health-check.ts
 */

import 'dotenv/config';
import { promises as fs, createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const REFERENCES_DIR = path.join(ROOT, 'references');
const SHARD_DIR = path.join(REFERENCES_DIR, 'import-graph');
const CACHE_PATH = path.join(REFERENCES_DIR, '.code-graph-cache.json');
const PROJECT_MAP_PATH = path.join(REFERENCES_DIR, 'project-map.md');
const WATCHER_LOG_PATH = path.join(REFERENCES_DIR, '.code-graph-watcher.log');
const WATCHER_LOCK_PATH = path.join(REFERENCES_DIR, '.watcher.lock');
const WATCHER_PID_PATH = path.join(REFERENCES_DIR, '.watcher.pid');
const SKIPPED_PATH = path.join(SHARD_DIR, '.skipped.txt');

const TOP_DIRS = ['server', 'client', 'shared'] as const;
const SHARDS = TOP_DIRS.map(d => path.join(SHARD_DIR, `${d}.json`));

const WINDOW_DAYS = 14;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 1200;
const ANTHROPIC_TIMEOUT_MS = 25_000;

// Thresholds (locked from spec / revisit doc)
const COVERAGE_GREEN_PCT = 95;
const SKIP_RATE_FAIL_PCT = 5;          // per-directory, from plan.md
const LOG_SIZE_FLAG_BYTES = 5 * 1024 * 1024;
const STALE_CACHE_MIN = 60;            // cache older than newest source by >60min = stale
const ESCALATE_QUERIES_PER_MONTH = 10; // from code-intel-revisit.md

// Adjacency: a "wrong answer" only counts if it follows a cache reference
// within this many turns in the same session.
const ADJACENCY_TURNS = 20;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Status = 'GREEN' | 'YELLOW' | 'RED';
type Recommendation = 'KEEP' | 'TUNE' | 'ESCALATE' | 'KILL';

interface ContextSnippet {
  session: string;            // basename of jsonl
  timestamp: string;
  context: string;            // ~120 chars total (50 before, 50 after, plus the match)
}

interface AdoptionSignals {
  references: number;
  sessions: string[];          // unique session ids that referenced the cache
  byProjectDir: Record<string, number>;
  snippets: ContextSnippet[];  // up to 8 examples
}

interface CorrectnessSignals {
  flags: number;               // total correction-pattern hits
  adjacentToCache: number;     // subset that followed a cache reference within ADJACENCY_TURNS
  adjacentSnippets: ContextSnippet[]; // up to 5 examples (the dangerous ones)
}

interface OperationalSignals {
  watcherLogExists: boolean;
  watcherLogSize: number;
  watcherLogLargeFlag: boolean;
  watcherLogTail: string[];    // last 1000 lines
  errorPatternCounts: Record<string, number>;
  errorExamples: string[];
  watcherRunning: boolean | null; // null = could not determine
  watcherPid: number | null;
  cacheMtime: string | null;
  projectMapMtime: string | null;
  watcherLogMtime: string | null;
  newestSourceMtime: string | null;
  cacheStaleByMin: number | null;  // positive = source newer than cache
  shardSizes: Record<string, number>;
  shardOk: boolean;            // every shard exists, non-zero, parseable JSON
  shardErrors: string[];
}

interface CoverageSignals {
  totalFiles: number;
  filesByDir: Record<string, number>;
  shardFileCounts: Record<string, number>;
  coveragePct: number;
  belowThreshold: boolean;
  skippedCount: number;
  skipRateByDir: Record<string, number>;
  anyDirOverSkipFail: boolean;
}

interface QueryVolumeSignals {
  archQueries: number;          // raw count in window
  proratedPerMonth: number;     // archQueries * (30 / WINDOW_DAYS)
  totalSessionsInWindow: number;
  byProjectDir: Record<string, number>;
}

interface CollectedData {
  generatedAt: string;
  windowDays: number;
  cwd: string;
  projectDirs: string[];        // dirs scanned under ~/.claude/projects
  transcriptsAvailable: boolean;
  transcriptCount: number;      // jsonl files inspected (mtime in window)
  adoption: AdoptionSignals;
  correctness: CorrectnessSignals;
  operational: OperationalSignals;
  coverage: CoverageSignals;
  queryVolume: QueryVolumeSignals;
}

interface Verdict {
  status: Status;
  recommendation: Recommendation;
  reasons: string[];            // human-readable bullets explaining the verdict
}

// ---------------------------------------------------------------------------
// Project-dir resolution
// ---------------------------------------------------------------------------

/**
 * Encode a filesystem path the way Claude Code names its project transcript
 * directories. Strips the drive colon, lowercases the drive letter on
 * Windows, and replaces every path separator with `-`.
 *
 * Example: c:\files\Claude\automation-v1 -> c--files-Claude-automation-v1
 */
function encodeProjectDir(p: string): string {
  const normalised = p.replace(/[\\/]+/g, '-').replace(/:/g, '-');
  // Lowercase only the drive-letter prefix on Windows ("C-" -> "c-").
  return normalised.replace(/^([A-Z])-/, (_, l) => `${l.toLowerCase()}-`);
}

/**
 * List Claude Code project directories that correspond to the current cwd.
 * Includes sibling dirs created by Claude Code's collision-handling
 * (`-2nd`, `-3rd`, …) which represent parallel sessions on the same checkout.
 * Excludes worktree dirs, which contain isolated work that should not be
 * counted toward this checkout's adoption signal.
 *
 * Returns an empty array if the projects root isn't found.
 */
async function resolveProjectDirs(cwd: string): Promise<string[]> {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  if (!existsSync(projectsRoot)) return [];

  const encoded = encodeProjectDir(cwd);
  const exact = path.join(projectsRoot, encoded);
  const matches: string[] = [];
  if (existsSync(exact)) matches.push(exact);

  // Sibling collision dirs: same prefix + numeric / ordinal suffix.
  const allDirs = await fs.readdir(projectsRoot, { withFileTypes: true });
  for (const dirent of allDirs) {
    if (!dirent.isDirectory()) continue;
    if (dirent.name === encoded) continue;          // already added
    if (dirent.name.includes('--claude-worktrees-')) continue;
    if (!dirent.name.startsWith(encoded)) continue;
    // Suffix shape: -2nd, -3rd, -4th, …, or -2, -3 (defensive).
    const tail = dirent.name.slice(encoded.length);
    if (/^-(\d+(?:st|nd|rd|th)?)$/.test(tail)) {
      matches.push(path.join(projectsRoot, dirent.name));
    }
  }

  // Fallback: if no exact or sibling match, take all non-worktree dirs so the
  // health check still produces a signal in unfamiliar checkouts.
  if (matches.length === 0) {
    for (const dirent of allDirs) {
      if (!dirent.isDirectory()) continue;
      if (dirent.name.includes('--claude-worktrees-')) continue;
      matches.push(path.join(projectsRoot, dirent.name));
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Transcript scanning
// ---------------------------------------------------------------------------

/**
 * Patterns we scan transcripts for. Kept as plain regexes (compiled once) so
 * each line is matched in one pass.
 *
 * Detection model — narrow on purpose:
 *   - cacheReferencePath  : matches when an assistant tool_use INPUT contains
 *                           a literal path into the cache. Substring match
 *                           against tool inputs only — never prose. This
 *                           prevents conversations *about* the cache from
 *                           being mis-counted as consultation of the cache.
 *   - archQuery           : applied to USER-role text only. Otherwise the
 *                           assistant's own discussion of routes / imports /
 *                           architecture floods the count.
 *   - correction          : applied to USER-role text only. Real corrections
 *                           are user statements; assistant text rarely
 *                           contains "actually that's wrong" about itself.
 */
const CACHE_PATH_NEEDLES = ['project-map.md', 'import-graph/'] as const;
const PATTERNS = {
  archQuery: /\b(what calls|depends on|where is|how does|architecture|flow|imports|route)\b/i,
  correction: /(actually that's wrong|no,\s*the file is|you said .* but|correction:|that's incorrect|not quite right)/i,
} as const;

function inputMentionsCachePath(input: unknown): string | null {
  // Tool inputs vary by tool: Read/Edit use { file_path }, Grep uses { path }.
  // Stringify and substring-match — both fields collapse cleanly.
  const blob = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  for (const needle of CACHE_PATH_NEEDLES) {
    if (blob.includes(needle)) return needle;
  }
  return null;
}

/** Extract a ~120-char window around a regex match. */
function snippetAround(haystack: string, match: RegExpMatchArray): string {
  const idx = match.index ?? 0;
  const start = Math.max(0, idx - 50);
  const end = Math.min(haystack.length, idx + match[0].length + 50);
  return haystack.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Stream a single jsonl transcript and accumulate signals from it. Files can
 * be tens of MB; we line-stream rather than load whole.
 */
async function scanTranscript(
  filePath: string,
  windowStartMs: number,
  acc: {
    adoption: AdoptionSignals;
    correctness: CorrectnessSignals;
    queryVolume: QueryVolumeSignals;
  },
  projectDirLabel: string,
): Promise<void> {
  // Cheap mtime gate first — skip files whose entire content is too old.
  let stat;
  try { stat = await fs.stat(filePath); } catch { return; }
  if (stat.mtimeMs < windowStartMs) return;

  const sessionId = path.basename(filePath, '.jsonl');
  // Per-session ring buffer of recent text turns, used for adjacency on
  // correction patterns. We keep just an index of cache-reference turn
  // numbers and the running turn count.
  let turnCount = 0;
  const cacheRefTurns: number[] = [];

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let sessionUsedCache = false;

  for await (const rawLine of rl) {
    if (!rawLine) continue;
    let entry: any;
    try { entry = JSON.parse(rawLine); } catch { continue; }

    const ts = entry.timestamp;
    if (typeof ts === 'string') {
      const tMs = Date.parse(ts);
      if (!Number.isFinite(tMs) || tMs < windowStartMs) continue;
    }

    // We only care about user/assistant turns with text or tool_use content.
    const message = entry.message;
    if (!message || (entry.type !== 'user' && entry.type !== 'assistant')) continue;
    const content = message.content;
    let text = '';
    let cacheToolMatchNeedle: string | null = null;
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'text' && typeof block.text === 'string') {
          text += '\n' + block.text;
        } else if (block.type === 'tool_use' && entry.type === 'assistant') {
          // Cache consultation = the assistant actually targeted a cache path
          // via a tool call. Substring-match the tool input.
          const needle = inputMentionsCachePath(block.input);
          if (needle && !cacheToolMatchNeedle) cacheToolMatchNeedle = needle;
        }
      }
    } else {
      continue;
    }
    turnCount++;

    // Adoption: a real consultation is an assistant tool_use that read or
    // grepped one of the cache paths. Prose mentions are explicitly excluded
    // — they conflate "discussing the cache" with "using the cache".
    if (cacheToolMatchNeedle) {
      acc.adoption.references++;
      if (!sessionUsedCache) {
        sessionUsedCache = true;
        acc.adoption.sessions.push(sessionId);
      }
      acc.adoption.byProjectDir[projectDirLabel] = (acc.adoption.byProjectDir[projectDirLabel] || 0) + 1;
      cacheRefTurns.push(turnCount);
      if (acc.adoption.snippets.length < 8) {
        acc.adoption.snippets.push({
          session: sessionId,
          timestamp: ts ?? '',
          context: `tool_use → ${cacheToolMatchNeedle}`,
        });
      }
    }

    // Architecture-shaped query and correction patterns are USER-side
    // signals. The assistant's own prose constantly mentions routes,
    // imports, architecture; counting it would drown the real query rate.
    if (entry.type === 'user' && text) {
      if (PATTERNS.archQuery.test(text)) {
        acc.queryVolume.archQueries++;
        acc.queryVolume.byProjectDir[projectDirLabel] = (acc.queryVolume.byProjectDir[projectDirLabel] || 0) + 1;
      }

      // Correction: only flag if a cache reference appeared in the same
      // session within ADJACENCY_TURNS turns BEFORE this one. Otherwise it
      // is likely unrelated to the cache and would cause a false-positive
      // RED status.
      const corrMatch = text.match(PATTERNS.correction);
      if (corrMatch) {
        acc.correctness.flags++;
        const adjacent = cacheRefTurns.some(t => turnCount - t <= ADJACENCY_TURNS && turnCount - t >= 0);
        if (adjacent) {
          acc.correctness.adjacentToCache++;
          if (acc.correctness.adjacentSnippets.length < 5) {
            acc.correctness.adjacentSnippets.push({
              session: sessionId,
              timestamp: ts ?? '',
              context: snippetAround(text, corrMatch),
            });
          }
        }
      }
    }
  }
}

async function collectTranscriptSignals(
  projectDirs: string[],
): Promise<{
  adoption: AdoptionSignals;
  correctness: CorrectnessSignals;
  queryVolume: QueryVolumeSignals;
  transcriptCount: number;
}> {
  const adoption: AdoptionSignals = { references: 0, sessions: [], byProjectDir: {}, snippets: [] };
  const correctness: CorrectnessSignals = { flags: 0, adjacentToCache: 0, adjacentSnippets: [] };
  const queryVolume: QueryVolumeSignals = { archQueries: 0, proratedPerMonth: 0, totalSessionsInWindow: 0, byProjectDir: {} };
  const acc = { adoption, correctness, queryVolume };

  const windowStartMs = Date.now() - WINDOW_MS;
  const sessionsSeen = new Set<string>();
  let transcriptCount = 0;

  for (const dir of projectDirs) {
    const label = path.basename(dir);
    let dirents;
    try { dirents = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const d of dirents) {
      if (!d.isFile() || !d.name.endsWith('.jsonl')) continue;
      const full = path.join(dir, d.name);
      let stat;
      try { stat = await fs.stat(full); } catch { continue; }
      if (stat.mtimeMs < windowStartMs) continue;
      transcriptCount++;
      sessionsSeen.add(path.basename(d.name, '.jsonl'));
      await scanTranscript(full, windowStartMs, acc, label);
    }
  }

  queryVolume.totalSessionsInWindow = sessionsSeen.size;
  queryVolume.proratedPerMonth = Math.round((queryVolume.archQueries * 30) / WINDOW_DAYS);
  return { adoption, correctness, queryVolume, transcriptCount };
}

// ---------------------------------------------------------------------------
// Operational + coverage collection
// ---------------------------------------------------------------------------

const ERROR_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'error',     re: /\berror\b/i },
  { name: 'failed',    re: /\bfail(ed|ure)?\b/i },
  { name: 'ENOSPC',    re: /ENOSPC/ },
  { name: 'EMFILE',    re: /EMFILE/ },
  { name: 'lock held', re: /lock\s+held/i },
  { name: 'dropped',   re: /\bdropped\b/i },
];

async function readLastLines(file: string, maxLines: number): Promise<string[]> {
  // Simple in-memory tail. The watcher log is gitignored and capped by spec
  // operational practice; loading 1000 lines is not a concern for diagnostic.
  const content = await fs.readFile(file, 'utf8');
  const lines = content.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(-maxLines);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH = no such process. EPERM = exists but we can't signal (still alive).
    return err?.code === 'EPERM';
  }
}

async function collectOperational(): Promise<OperationalSignals> {
  const out: OperationalSignals = {
    watcherLogExists: false,
    watcherLogSize: 0,
    watcherLogLargeFlag: false,
    watcherLogTail: [],
    errorPatternCounts: {},
    errorExamples: [],
    watcherRunning: null,
    watcherPid: null,
    cacheMtime: null,
    projectMapMtime: null,
    watcherLogMtime: null,
    newestSourceMtime: null,
    cacheStaleByMin: null,
    shardSizes: {},
    shardOk: true,
    shardErrors: [],
  };

  // Watcher log
  if (existsSync(WATCHER_LOG_PATH)) {
    const st = await fs.stat(WATCHER_LOG_PATH);
    out.watcherLogExists = true;
    out.watcherLogSize = st.size;
    out.watcherLogLargeFlag = st.size > LOG_SIZE_FLAG_BYTES;
    out.watcherLogMtime = st.mtime.toISOString();
    out.watcherLogTail = await readLastLines(WATCHER_LOG_PATH, 1000);
    for (const { name, re } of ERROR_PATTERNS) out.errorPatternCounts[name] = 0;
    for (const line of out.watcherLogTail) {
      for (const { name, re } of ERROR_PATTERNS) {
        if (re.test(line)) {
          out.errorPatternCounts[name]++;
          if (out.errorExamples.length < 5) out.errorExamples.push(line.slice(0, 240));
        }
      }
    }
  }

  // Watcher process
  if (existsSync(WATCHER_PID_PATH)) {
    try {
      const pidRaw = (await fs.readFile(WATCHER_PID_PATH, 'utf8')).trim();
      const pid = Number.parseInt(pidRaw, 10);
      if (Number.isFinite(pid)) {
        out.watcherPid = pid;
        out.watcherRunning = isPidAlive(pid);
      }
    } catch { /* ignore */ }
  } else if (existsSync(WATCHER_LOCK_PATH)) {
    // Fallback: if a lock exists but no PID file, treat as "lock present, running unknown".
    out.watcherRunning = null;
  } else {
    out.watcherRunning = false;
  }

  // Cache + project-map timestamps
  if (existsSync(CACHE_PATH))       out.cacheMtime       = (await fs.stat(CACHE_PATH)).mtime.toISOString();
  if (existsSync(PROJECT_MAP_PATH)) out.projectMapMtime  = (await fs.stat(PROJECT_MAP_PATH)).mtime.toISOString();

  // Newest source mtime under TOP_DIRS
  let newestMs = 0;
  async function walk(dir: string) {
    let dirents;
    try { dirents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of dirents) {
      if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) await walk(full);
      else if (d.isFile() && /\.(ts|tsx)$/.test(d.name)) {
        try {
          const st = statSync(full);
          if (st.mtimeMs > newestMs) newestMs = st.mtimeMs;
        } catch { /* ignore */ }
      }
    }
  }
  for (const top of TOP_DIRS) await walk(path.join(ROOT, top));
  if (newestMs > 0) {
    out.newestSourceMtime = new Date(newestMs).toISOString();
    if (out.cacheMtime) {
      const cacheMs = Date.parse(out.cacheMtime);
      out.cacheStaleByMin = Math.round((newestMs - cacheMs) / 60_000);
    }
  }

  // Shard size / parse sanity
  for (const shard of SHARDS) {
    const name = path.basename(shard);
    if (!existsSync(shard)) {
      out.shardOk = false;
      out.shardErrors.push(`${name}: missing`);
      out.shardSizes[name] = 0;
      continue;
    }
    const st = await fs.stat(shard);
    out.shardSizes[name] = st.size;
    if (st.size === 0) {
      out.shardOk = false;
      out.shardErrors.push(`${name}: zero-byte`);
      continue;
    }
    try {
      JSON.parse(await fs.readFile(shard, 'utf8'));
    } catch (err: any) {
      out.shardOk = false;
      out.shardErrors.push(`${name}: invalid JSON (${err?.message ?? 'unknown'})`);
    }
  }

  return out;
}

async function collectCoverage(): Promise<CoverageSignals> {
  const filesByDir: Record<string, number> = {};
  let total = 0;
  async function walk(dir: string, top: string) {
    let dirents;
    try { dirents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of dirents) {
      if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
      if (d.name === 'dist' || d.name === 'build') continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) await walk(full, top);
      else if (d.isFile() && /\.(ts|tsx)$/.test(d.name) && !/\.d\.ts$/.test(d.name) && !/\.generated\.ts$/.test(d.name)) {
        filesByDir[top] = (filesByDir[top] || 0) + 1;
        total++;
      }
    }
  }
  for (const top of TOP_DIRS) await walk(path.join(ROOT, top), top);

  const shardFileCounts: Record<string, number> = {};
  let inShards = 0;
  for (const top of TOP_DIRS) {
    const shard = path.join(SHARD_DIR, `${top}.json`);
    if (!existsSync(shard)) { shardFileCounts[top] = 0; continue; }
    try {
      const j = JSON.parse(await fs.readFile(shard, 'utf8'));
      const n = j?.files ? Object.keys(j.files).length : 0;
      shardFileCounts[top] = n;
      inShards += n;
    } catch {
      shardFileCounts[top] = 0;
    }
  }

  // Skipped count + per-dir skip rate
  let skippedCount = 0;
  const skipsByDir: Record<string, number> = {};
  if (existsSync(SKIPPED_PATH)) {
    const raw = await fs.readFile(SKIPPED_PATH, 'utf8');
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    skippedCount = lines.length;
    for (const line of lines) {
      // Each line is `path/to/file.ts: reason`. Bucket by top-level dir.
      const filePart = line.split(':')[0]?.trim() ?? '';
      const top = filePart.split(/[\/\\]/)[0];
      if (top && (TOP_DIRS as readonly string[]).includes(top)) {
        skipsByDir[top] = (skipsByDir[top] || 0) + 1;
      }
    }
  }
  const skipRateByDir: Record<string, number> = {};
  let anyOver = false;
  for (const top of TOP_DIRS) {
    const denom = filesByDir[top] || 0;
    const skips = skipsByDir[top] || 0;
    const pct = denom === 0 ? 0 : Math.round((skips / denom) * 1000) / 10; // one decimal
    skipRateByDir[top] = pct;
    if (pct > SKIP_RATE_FAIL_PCT) anyOver = true;
  }

  // Clamp at 100. Local file walker and the build script's walker have a
  // small one-file divergence on edge cases (extension/exclusion ordering),
  // which can produce 100.1% on full-coverage runs. Cosmetic clamp avoids
  // chasing the walker discrepancy down a rabbit hole.
  const rawCoverage = total === 0 ? 0 : Math.round((inShards / total) * 1000) / 10;
  const coveragePct = Math.min(rawCoverage, 100);
  return {
    totalFiles: total,
    filesByDir,
    shardFileCounts,
    coveragePct,
    belowThreshold: coveragePct < COVERAGE_GREEN_PCT,
    skippedCount,
    skipRateByDir,
    anyDirOverSkipFail: anyOver,
  };
}

// ---------------------------------------------------------------------------
// Verdict (deterministic)
// ---------------------------------------------------------------------------

function computeVerdict(d: CollectedData): Verdict {
  const reasons: string[] = [];
  let status: Status = 'GREEN';
  let recommendation: Recommendation = 'KEEP';

  // RED conditions (any one fires) ------------------------------------------
  const hasOperationalFailure =
    !d.operational.shardOk ||
    d.coverage.anyDirOverSkipFail ||
    (d.operational.errorPatternCounts['ENOSPC'] ?? 0) > 0 ||
    (d.operational.errorPatternCounts['EMFILE'] ?? 0) > 0;

  const hasCacheLinkedWrongAnswer = d.correctness.adjacentToCache > 0;

  const zeroAdoptionAfterWindow =
    d.transcriptsAvailable &&
    d.transcriptCount > 0 &&
    d.adoption.references === 0 &&
    d.queryVolume.archQueries > 0; // there WERE arch questions but cache was never consulted

  if (hasCacheLinkedWrongAnswer) {
    status = 'RED';
    reasons.push(`Wrong-answer pattern detected adjacent to ${d.correctness.adjacentToCache} cache reference(s)`);
  }
  if (zeroAdoptionAfterWindow) {
    status = 'RED';
    reasons.push(`Zero cache references in ${WINDOW_DAYS} days despite ${d.queryVolume.archQueries} architecture-shaped queries`);
  }
  if (hasOperationalFailure) {
    status = 'RED';
    if (!d.operational.shardOk) reasons.push(`Shard integrity broken: ${d.operational.shardErrors.join('; ')}`);
    if (d.coverage.anyDirOverSkipFail) reasons.push(`Skip rate exceeds ${SKIP_RATE_FAIL_PCT}% in at least one directory`);
    if ((d.operational.errorPatternCounts['ENOSPC'] ?? 0) > 0) reasons.push('Watcher log shows ENOSPC');
    if ((d.operational.errorPatternCounts['EMFILE'] ?? 0) > 0) reasons.push('Watcher log shows EMFILE');
  }

  // YELLOW conditions (only escalate if not already RED) --------------------
  if (status !== 'RED') {
    const yellowReasons: string[] = [];
    if (!d.transcriptsAvailable) yellowReasons.push('No Claude Code transcripts found for this checkout');
    if (!d.operational.watcherLogExists) yellowReasons.push('Watcher log missing — watcher may never have started');
    if (d.coverage.belowThreshold) yellowReasons.push(`Shard coverage at ${d.coverage.coveragePct}% (target ≥${COVERAGE_GREEN_PCT}%)`);
    if ((d.operational.cacheStaleByMin ?? 0) > STALE_CACHE_MIN) yellowReasons.push(`Cache is ${d.operational.cacheStaleByMin} min behind newest source file`);
    if (d.operational.watcherLogLargeFlag) yellowReasons.push(`Watcher log >${LOG_SIZE_FLAG_BYTES / 1024 / 1024}MB (${(d.operational.watcherLogSize / 1024 / 1024).toFixed(1)}MB)`);
    if (d.operational.watcherRunning === false) yellowReasons.push('Watcher process is not running');
    const totalErrors = Object.values(d.operational.errorPatternCounts).reduce((a, b) => a + b, 0);
    if (totalErrors > 20) yellowReasons.push(`${totalErrors} error/failure lines in last 1000 watcher log entries`);
    if (d.adoption.references > 0 && d.adoption.references < 3 && d.queryVolume.archQueries >= 5) {
      yellowReasons.push(`Marginal adoption: ${d.adoption.references} cache references against ${d.queryVolume.archQueries} architecture queries`);
    }
    if (yellowReasons.length > 0) {
      status = 'YELLOW';
      reasons.push(...yellowReasons);
    }
  }

  if (status === 'GREEN') reasons.push('No concerns detected.');

  // Recommendation ----------------------------------------------------------
  // KILL: cache-linked wrong answers, OR genuine zero-use after the window with arch queries present.
  // ESCALATE: prorated arch-query rate >= ESCALATE_QUERIES_PER_MONTH AND adoption healthy.
  // TUNE: operational issues but cache otherwise functional.
  // KEEP: everything else.
  if (hasCacheLinkedWrongAnswer || zeroAdoptionAfterWindow) {
    recommendation = 'KILL';
  } else if (hasOperationalFailure || (status === 'YELLOW' && (
    d.coverage.belowThreshold ||
    (d.operational.cacheStaleByMin ?? 0) > STALE_CACHE_MIN ||
    d.operational.watcherRunning === false ||
    !d.operational.watcherLogExists
  ))) {
    recommendation = 'TUNE';
  } else if (d.queryVolume.proratedPerMonth >= ESCALATE_QUERIES_PER_MONTH && d.adoption.references > 0) {
    recommendation = 'ESCALATE';
    // Anchor reason for the LLM. Without this, an ESCALATE recommendation on
    // an otherwise-GREEN status leaves the LLM with only "No concerns
    // detected." to narrate, and it produces KEEP-flavoured prose that
    // contradicts the locked recommendation banner.
    reasons.push(
      `Architecture-query volume crossed Phase 1 threshold (${d.queryVolume.proratedPerMonth}/month, target ≥${ESCALATE_QUERIES_PER_MONTH}/month). See tasks/code-intel-revisit.md for trigger conditions.`,
    );
  } else {
    recommendation = 'KEEP';
  }

  return { status, recommendation, reasons };
}

// ---------------------------------------------------------------------------
// LLM narration
// ---------------------------------------------------------------------------

function buildPrompt(data: CollectedData, verdict: Verdict): { system: string; user: string } {
  const system = [
    'You are summarising the health of an AI coding assistant cache feature for a non-technical reader.',
    'The cache is an advisory hint layer that helps AI agents answer architecture questions about a codebase without re-reading every file.',
    '',
    'IMPORTANT — the status banner and the recommendation have ALREADY been computed deterministically from the data. They are facts, not your judgements. Do not change them. Reproduce the exact values supplied in your output.',
    '',
    'Your job is the prose only: a one-sentence headline and the body of each numbered section.',
    '',
    'RULES:',
    '- Be direct. No hedging language like "appears to" or "seems to".',
    '- Use plain English. Define any technical term in the same sentence.',
    '- Cite numbers when you have them. "Cache was consulted 4 times" not "occasionally consulted".',
    '- If a section has no data, say so plainly. Do not invent.',
    '- Total report length: under 400 words.',
    '- Output the markdown exactly in the structure given. No preamble, no postscript.',
  ].join('\n');

  const user = [
    `**DETERMINISTIC VERDICT (use these verbatim):**`,
    `- Status: ${verdict.status}`,
    `- Recommendation: ${verdict.recommendation}`,
    `- Verdict reasons (incorporate naturally into the prose, especially in section 5): ${JSON.stringify(verdict.reasons)}`,
    '',
    'Produce a one-page markdown report following EXACTLY this structure:',
    '',
    '```markdown',
    '# Code Intelligence Cache Health Check',
    '',
    `**Status: ${verdict.status}**`,
    '[ONE sentence headline. Plain English. Reflects the deterministic verdict.]',
    '',
    '---',
    '',
    '## 1. Is anyone using it?',
    '[2-3 sentences. Cite the actual numbers. Always include the architecture-query denominator (the cache only matters for those). State whether adoption is healthy, marginal, or zero.]',
    '',
    '## 2. Is it giving correct answers?',
    '[2-3 sentences. Distinguish raw correction-pattern hits from those *adjacent* to a cache reference (the dangerous ones). If the dangerous count is zero, say so plainly.]',
    '',
    '## 3. Is the watcher healthy?',
    '[2-3 sentences. Watcher running? Log clean? Cache up to date? Coverage percentage? Any operational alarms?]',
    '',
    '## 4. Token impact (qualitative)',
    '[2-3 sentences. With low usage volume, do not invent a savings number. Use these guidance buckets: 0–2 references = "signal too weak to estimate"; 3–9 references = "modest savings, roughly N × 20–30K tokens per query"; ≥10 references = "material savings".]',
    '',
    `## 5. Recommendation`,
    `**${verdict.recommendation}** — [1-2 sentences justifying. Use the deterministic verdict reasons; do not propose a different recommendation.]`,
    '```',
    '',
    'DATA:',
    '',
    'Note on ratios: cache_reads_per_query (adoption.references / queryVolume.archQueries) can exceed 100%. A single architecture query may trigger multiple cache reads (project-map digest + one or more import-graph shards). A ratio of 144% means agents read the cache 1.44 times per architecture query on average — that is healthy, not a math error.',
    '',
    '```json',
    JSON.stringify(data, null, 2),
    '```',
  ].join('\n');

  return { system, user };
}

interface AnthropicResult {
  ok: true;
  markdown: string;
}
interface AnthropicError {
  ok: false;
  reason: string;
}

async function callAnthropic(system: string, user: string, apiKey: string): Promise<AnthropicResult | AnthropicError> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        temperature: 0.2,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    const json: any = await res.json();
    const block = json?.content?.find?.((b: any) => b?.type === 'text');
    const text = typeof block?.text === 'string' ? block.text : '';
    if (!text) return { ok: false, reason: 'response had no text content' };
    return { ok: true, markdown: text.trim() };
  } catch (err: any) {
    return { ok: false, reason: err?.name === 'AbortError' ? `timeout after ${ANTHROPIC_TIMEOUT_MS}ms` : (err?.message ?? 'unknown error') };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Strip a leading code fence (```markdown / ``` / ~~~) and matching trailing
 * fence the model sometimes emits even after being asked not to.
 */
function unwrapCodeFence(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1].trim() : trimmed;
}

/**
 * Defence-in-depth: even with the system prompt forbidding it, an LLM may
 * mis-state the status banner. Force the deterministic value into the
 * markdown post-hoc so the report cannot lie about its own verdict.
 */
function enforceVerdictInMarkdown(md: string, verdict: Verdict): string {
  let out = md;
  out = out.replace(/\*\*Status:\s*(GREEN|YELLOW|RED)\*\*/i, `**Status: ${verdict.status}**`);
  out = out.replace(/\*\*(KEEP|TUNE|ESCALATE|KILL)\*\*/i, `**${verdict.recommendation}**`);
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic fallback report (used when API is unavailable)
// ---------------------------------------------------------------------------

function fallbackReport(data: CollectedData, verdict: Verdict, synthesisError: string | null): string {
  const a = data.adoption;
  const c = data.correctness;
  const op = data.operational;
  const cov = data.coverage;
  const q = data.queryVolume;

  const headline = ({
    GREEN: 'No concerns detected — the cache is being used and is operationally clean.',
    YELLOW: 'Cache is functional but signals warrant monitoring.',
    RED: 'The cache is failing one of its core criteria — see the recommendation.',
  } satisfies Record<Status, string>)[verdict.status];

  let section4: string;
  if (a.references <= 2) {
    section4 = 'Signal too weak to estimate token savings. Below the threshold where the impact would be measurable above noise.';
  } else if (a.references < 10) {
    section4 = `Modest savings: roughly ${a.references} architecture queries × 20–30K tokens that would otherwise have grep-walked the codebase.`;
  } else {
    section4 = `Material savings: ${a.references} cache references in ${WINDOW_DAYS} days. This also crosses the Phase 1 trigger threshold for token-impact measurement.`;
  }

  const watcherLine = op.watcherLogExists
    ? `Watcher log present (${(op.watcherLogSize / 1024).toFixed(0)} KB), ${Object.values(op.errorPatternCounts).reduce((a, b) => a + b, 0)} error/failure lines in the last 1000 entries.`
    : 'Watcher log missing — the watcher may never have started in this checkout.';

  const lines: string[] = [];
  lines.push('# Code Intelligence Cache Health Check');
  lines.push('');
  lines.push(`**Status: ${verdict.status}**`);
  lines.push(headline);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 1. Is anyone using it?');
  if (!data.transcriptsAvailable) {
    lines.push('No Claude Code transcripts were found for this checkout. Verify Claude Code is actually being used here.');
  } else {
    lines.push(
      `Cache was referenced ${a.references} times across ${a.sessions.length} sessions in the last ${WINDOW_DAYS} days. ` +
      `Architecture-shaped queries in the same window: ${q.archQueries} (${q.proratedPerMonth}/month prorated). ` +
      (a.references === 0 ? 'Adoption is zero.' : a.references < 3 ? 'Adoption is marginal.' : 'Adoption is consistent with current architecture-query volume.'),
    );
  }
  lines.push('');
  lines.push('## 2. Is it giving correct answers?');
  if (c.adjacentToCache === 0) {
    lines.push(`No correction patterns were found adjacent to a cache reference. ${c.flags} unrelated correction patterns elsewhere in transcripts (filtered out as noise).`);
  } else {
    lines.push(`${c.adjacentToCache} correction pattern(s) followed a cache reference within ${ADJACENCY_TURNS} turns. Sample: ${(c.adjacentSnippets[0]?.context ?? '').slice(0, 140)}`);
  }
  lines.push('');
  lines.push('## 3. Is the watcher healthy?');
  lines.push(watcherLine);
  lines.push(`Cache last rebuilt ${op.cacheMtime ?? 'never'}; newest source file ${op.newestSourceMtime ?? 'unknown'}; cache stale by ${op.cacheStaleByMin ?? 'n/a'} minutes.`);
  lines.push(`Coverage: ${cov.coveragePct}% of ${cov.totalFiles} TypeScript files (target ≥${COVERAGE_GREEN_PCT}%).`);
  lines.push('');
  lines.push('## 4. Token impact (qualitative)');
  lines.push(section4);
  lines.push('');
  lines.push('## 5. Recommendation');
  lines.push(`**${verdict.recommendation}** — ${verdict.reasons.slice(0, 2).join('. ')}.`);
  if (synthesisError) {
    lines.push('');
    lines.push('---');
    lines.push(`> Note: LLM synthesis was unavailable (${synthesisError}). This report was generated from the deterministic skeleton.`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

function reportFilename(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return path.join(REFERENCES_DIR, `.code-graph-health-${y}-${m}-${d}.md`);
}

async function writeReport(markdown: string, now: Date): Promise<string> {
  await fs.mkdir(REFERENCES_DIR, { recursive: true });
  const out = reportFilename(now);
  await fs.writeFile(out, markdown, 'utf8');
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const now = new Date();
  const cwd = ROOT;

  const projectDirs = await resolveProjectDirs(cwd);
  const transcriptsAvailable = projectDirs.length > 0;

  // Run independent collectors in parallel — keeps total wall-clock low.
  const [transcriptSignals, operational, coverage] = await Promise.all([
    transcriptsAvailable
      ? collectTranscriptSignals(projectDirs)
      : Promise.resolve({
          adoption: { references: 0, sessions: [], byProjectDir: {}, snippets: [] } as AdoptionSignals,
          correctness: { flags: 0, adjacentToCache: 0, adjacentSnippets: [] } as CorrectnessSignals,
          queryVolume: { archQueries: 0, proratedPerMonth: 0, totalSessionsInWindow: 0, byProjectDir: {} } as QueryVolumeSignals,
          transcriptCount: 0,
        }),
    collectOperational(),
    collectCoverage(),
  ]);

  const data: CollectedData = {
    generatedAt: now.toISOString(),
    windowDays: WINDOW_DAYS,
    cwd,
    projectDirs: projectDirs.map(p => path.basename(p)),
    transcriptsAvailable,
    transcriptCount: transcriptSignals.transcriptCount,
    adoption: transcriptSignals.adoption,
    correctness: transcriptSignals.correctness,
    operational,
    coverage,
    queryVolume: transcriptSignals.queryVolume,
  };

  const verdict = computeVerdict(data);

  // LLM synthesis (with graceful fallback)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  let markdown: string;
  let synthesisError: string | null = null;

  if (!apiKey) {
    synthesisError = 'ANTHROPIC_API_KEY not set';
    markdown = fallbackReport(data, verdict, synthesisError);
  } else {
    const { system, user } = buildPrompt(data, verdict);
    const result = await callAnthropic(system, user, apiKey);
    if (result.ok) {
      markdown = enforceVerdictInMarkdown(unwrapCodeFence(result.markdown), verdict);
    } else {
      synthesisError = result.reason;
      markdown = fallbackReport(data, verdict, synthesisError);
    }
  }

  // Always print to stdout.
  process.stdout.write(markdown.endsWith('\n') ? markdown : markdown + '\n');

  // Always persist to a dated file so reports accumulate over time.
  const outPath = await writeReport(markdown, now);
  process.stderr.write(`\n[code-graph:health] report written to ${path.relative(ROOT, outPath)}\n`);
  if (synthesisError) {
    process.stderr.write(`[code-graph:health] synthesis fallback: ${synthesisError}\n`);
    // Also dump the deterministic data as JSON to stdout per the brief, when
    // synthesis failed — useful for debugging and so the raw signals never
    // get lost behind a failed API call.
    process.stdout.write('\n<!-- deterministic-data -->\n```json\n');
    process.stdout.write(JSON.stringify(data, null, 2));
    process.stdout.write('\n```\n');
  }
}

main().catch(err => {
  process.stderr.write(`[code-graph:health] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
