/**
 * build-code-graph-watcher.test.ts
 *
 * Process-level guard for two load-bearing watcher invariants surfaced by
 * pr-reviewer S4 and the ChatGPT final-review round 1:
 *
 *   1. Singleton-lock contention. With one watcher already holding
 *      `references/.watcher.lock`, a second `--watcher-subprocess` invocation
 *      must exit code 0 with the "lock held by another process" log,
 *      WITHOUT spawning a second chokidar instance. Without this, two
 *      watchers race-write the same shards and the cache silently diverges
 *      from source.
 *
 *   2. No feedback loop. The watcher writes its own shard JSONs and the
 *      digest under `references/`. chokidar's `ignored` list MUST exclude
 *      the entire `references/` tree; otherwise the watcher's own writes
 *      retrigger processEvents on every flush — pegged CPU, runaway disk.
 *
 * Both tests share one watcherA subprocess so the slow ts-morph project
 * init is paid once. The singleton check gates on PID-file existence
 * (lock acquired BEFORE ts-morph init at script line ~617). The feedback
 * check gates on the "watcher ready" log line (chokidar live).
 *
 * Skips cleanly if a dev-mode watcher is already running on the host —
 * this test is destructive of any in-flight watcher state.
 *
 * Run via: npx tsx scripts/__tests__/build-code-graph-watcher.test.ts
 *   (also picked up automatically by scripts/run-all-unit-tests.sh)
 */

// @vitest-isolate
// reason: spawns tsx subprocesses, holds references/.watcher.lock singleton,
//         destructive of in-flight watcher state, runtime up to 120s
// date: 2026-04-29
// owner: unowned
// follow-up: tasks/todo.md TI-001
// review_after: 2026-05-29

import { expect, test, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build-code-graph.ts');
const LOCK_PATH = path.join(ROOT, 'references', '.watcher.lock');
const LOCK_DIR = LOCK_PATH + '.lock';
const PID_PATH = path.join(ROOT, 'references', '.watcher.pid');
const SHARD_DIR = path.join(ROOT, 'references', 'import-graph');
const FEEDBACK_PROBE = path.join(SHARD_DIR, '__watcher-test-noop.ts');

// ts-morph cold init can be slow on a cold cache. Singleton check finishes
// long before; only the feedback-loop check waits this long.
const READY_TIMEOUT_MS = 120_000;
const SINGLETON_TIMEOUT_MS = 15_000;
const FEEDBACK_QUIET_MS = 1_500;

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

async function isAnotherWatcherAlive(): Promise<boolean> {
  let pid: number | null = null;
  try {
    const raw = await fs.readFile(PID_PATH, 'utf8');
    const parsed = parseInt(raw.trim(), 10);
    if (!Number.isNaN(parsed)) pid = parsed;
  } catch {
    return false;
  }
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function clearLockArtifacts(): Promise<void> {
  try { await fs.unlink(PID_PATH); } catch {}
  try { await fs.unlink(LOCK_PATH); } catch {}
  try { await fs.rm(LOCK_DIR, { recursive: true, force: true }); } catch {}
}

interface SpawnedWatcher {
  child: ChildProcess;
  output: () => string;
  exited: () => boolean;
}

function spawnWatcher(): SpawnedWatcher {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx/esm', SCRIPT, '--watcher-subprocess'],
    { stdio: ['ignore', 'pipe', 'pipe'], cwd: ROOT },
  );
  let buf = '';
  child.stdout?.on('data', (c: Buffer) => { buf += c.toString(); });
  child.stderr?.on('data', (c: Buffer) => { buf += c.toString(); });
  return {
    child,
    output: () => buf,
    exited: () => child.exitCode !== null || child.signalCode !== null,
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function killAndWait(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill('SIGTERM'); } catch {}
  const exited = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
  if (!exited) {
    try { child.kill('SIGKILL'); } catch {}
  }
}

let watcherA: SpawnedWatcher | null = null;
let skipAll = false;

const cleanup = async (): Promise<void> => {
  if (watcherA && !watcherA.exited()) await killAndWait(watcherA.child);
  try { await fs.unlink(FEEDBACK_PROBE); } catch {}
  await clearLockArtifacts();
};

beforeAll(async () => {
  if (await isAnotherWatcherAlive()) {
    skipAll = true;
    return;
  }

  // Start from a known-clean lock state.
  await clearLockArtifacts();

  // Ensure SHARD_DIR exists so the feedback-loop probe write does not fail.
  try { await fs.mkdir(SHARD_DIR, { recursive: true }); } catch {}

  watcherA = spawnWatcher();

  // Wait for watcher A to acquire the lock (signaled by PID-file write).
  const aLocked = await waitFor(async () => {
    if (watcherA!.exited()) {
      throw new Error(`Watcher A exited unexpectedly during startup. Output:\n${watcherA!.output()}`);
    }
    const exists = await fileExists(PID_PATH);
    if (!exists) return false;
    try {
      const raw = await fs.readFile(PID_PATH, 'utf8');
      return raw.trim() === String(watcherA!.child.pid);
    } catch {
      return false;
    }
  }, 30_000);

  if (!aLocked) {
    await cleanup();
    throw new Error(`Watcher A did not write its PID file within 30s. Output:\n${watcherA.output()}`);
  }
}, READY_TIMEOUT_MS);

afterAll(async () => {
  await cleanup();
});

test('singleton-lock: second watcher exits cleanly without holding the lock', async () => {
  if (skipAll) {
    console.log('  SKIP  another watcher is already running on this host');
    return;
  }

  const watcherB = spawnWatcher();
  try {
    const exitInfo = await new Promise<{ code: number | null; signal: NodeJS.Signals | null } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), SINGLETON_TIMEOUT_MS);
      watcherB.child.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
    if (exitInfo === null) {
      throw new Error(`Watcher B did not exit within ${SINGLETON_TIMEOUT_MS}ms — singleton lock not enforced. Output:\n${watcherB.output()}`);
    }
    expect(exitInfo.code === 0, `Watcher B exit code = ${exitInfo.code} (signal=${exitInfo.signal}); expected 0. Output:\n${watcherB.output()}`).toBeTruthy();
    expect(watcherB.output().includes('lock held by another process'), `Watcher B should log "lock held by another process". Output:\n${watcherB.output()}`).toBeTruthy();
    // Confirm watcherA was not displaced — its PID file must still match.
    const pidStr = await fs.readFile(PID_PATH, 'utf8').catch(() => '');
    expect(pidStr.trim() === String(watcherA!.child.pid), `PID file no longer points to watcher A — got "${pidStr.trim()}", expected "${watcherA!.child.pid}"`).toBeTruthy();
    expect(!watcherA!.exited(), 'Watcher A should still be alive after watcher B exits').toBeTruthy();
  } finally {
    if (!watcherB.exited()) await killAndWait(watcherB.child);
  }
}, SINGLETON_TIMEOUT_MS + 5_000);

test('no-feedback-loop: writing inside references/ does not retrigger processEvents', async () => {
  if (skipAll) {
    console.log('  SKIP  another watcher is already running on this host');
    return;
  }

  // Wait for chokidar to be live (gated on the explicit "watcher ready" log).
  const ready = await waitFor(() => {
    if (watcherA!.exited()) {
      throw new Error(`Watcher A exited before reaching ready state. Output:\n${watcherA!.output()}`);
    }
    return watcherA!.output().includes('watcher ready');
  }, READY_TIMEOUT_MS);
  if (!ready) {
    throw new Error(`Watcher A did not reach "watcher ready" within ${READY_TIMEOUT_MS}ms. Output:\n${watcherA!.output()}`);
  }

  const baselineLength = watcherA!.output().length;

  // Write a .ts file under references/import-graph/ — chokidar's
  // `ignored` list must exclude `references/**`, so no event fires.
  await fs.writeFile(FEEDBACK_PROBE, '// watcher self-write probe\n', 'utf8');

  // Allow time for the chokidar event + 150ms debounce + processing.
  await new Promise((r) => setTimeout(r, FEEDBACK_QUIET_MS));

  const newOutput = watcherA!.output().slice(baselineLength);
  const probeRel = path.relative(ROOT, FEEDBACK_PROBE).replace(/\\/g, '/');
  const offending = newOutput
    .split('\n')
    .filter((line) => /\[code-graph\] (add|change|unlink):/.test(line))
    .filter((line) => line.includes('references/') || line.includes(probeRel));
  expect(offending.length === 0, `Watcher reacted to a write inside references/. Offending log lines:\n${offending.join('\n')}`).toBeTruthy();

  try { await fs.unlink(FEEDBACK_PROBE); } catch {}
}, READY_TIMEOUT_MS);
