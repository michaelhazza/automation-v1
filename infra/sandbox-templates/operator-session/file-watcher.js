/* eslint-disable @typescript-eslint/no-require-imports */
// file-watcher.js — sandbox-side filesystem watcher
// Watches /workspace/artefacts/ and ~/Downloads/ for new/changed files.
// Forwards path-safe events to the parent process via IPC.
// NOT built by V1 CI — this runs inside the operator-session sandbox container.
//
// Runtime: CommonJS (Node.js inside the Docker sandbox; no ESM transform).
// ESLint disable: require() is correct here — the sandbox runtime is CommonJS-only.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const chokidar = require('chokidar');

// ---------------------------------------------------------------------------
// Watched roots
// ---------------------------------------------------------------------------

const WATCHED_ROOTS = [
  '/workspace/artefacts',
  path.join(os.homedir(), 'Downloads'),
];

// ---------------------------------------------------------------------------
// Path-safety deny list — must match server/services/operatorSandboxFileEventBridgePure.ts:UNSAFE_PATTERNS
// ---------------------------------------------------------------------------

const UNSAFE_PATTERNS = [
  /(?:^|\/)\.env(?:\.|$)/,
  /\.pem$/i,
  /\.key$/i,
  /(?:^|\/)\.ssh\//,
  /(?:^|\/)\.aws\//,
];

function isPathSafe(absPath) {
  if (!absPath) return false;
  for (const pattern of UNSAFE_PATTERNS) {
    if (pattern.test(absPath)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Path redaction — never log raw filenames (e.g. ".env" is itself sensitive)
// ---------------------------------------------------------------------------

function redactPath(absPath, watchedRoots) {
  for (const root of watchedRoots) {
    if (absPath.startsWith(root)) {
      return root + '/<redacted>';
    }
  }
  return 'unknown-root/<redacted>';
}

// ---------------------------------------------------------------------------
// Root-containment check
// ---------------------------------------------------------------------------

function isContainedInRoot(absPath, watchedRoots) {
  for (const root of watchedRoots) {
    // Strict prefix: prevents /workspace/artefacts2 from matching /workspace/artefacts
    if (absPath === root || absPath.startsWith(root + '/')) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// IPC send helper
// ---------------------------------------------------------------------------

const IPC_MAX_ATTEMPTS = 3;
const IPC_RETRY_DELAYS_MS = [0, 100, 500];

function sendIpcWithRetry(payload, attempt) {
  if (attempt >= IPC_MAX_ATTEMPTS) {
    console.warn('[file-watcher] IPC send failed after max attempts — dropped', { maxAttempts: IPC_MAX_ATTEMPTS });
    return;
  }
  try {
    process.send(payload);
  } catch (err) {
    const nextAttempt = attempt + 1;
    if (nextAttempt >= IPC_MAX_ATTEMPTS) {
      console.warn('[file-watcher] IPC send failed after max attempts — dropped', { maxAttempts: IPC_MAX_ATTEMPTS });
      return;
    }
    const delay = IPC_RETRY_DELAYS_MS[nextAttempt] !== undefined ? IPC_RETRY_DELAYS_MS[nextAttempt] : 500;
    console.warn('[file-watcher] IPC send failed, retrying', { attempt, nextAttempt, delay, message: err && err.message });
    setTimeout(() => sendIpcWithRetry(payload, nextAttempt), delay);
  }
}

function sendIpc(payload) {
  if (!process.send) {
    console.warn('[file-watcher] IPC not available (not a child process); skipping send');
    return;
  }
  sendIpcWithRetry(payload, 0);
}

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------

function handleFileEvent(eventPath) {
  // Step (a): resolve symlinks
  let resolvedPath;
  try {
    resolvedPath = fs.realpathSync(eventPath);
  } catch {
    // File may have been deleted between event and read — treat as transient
    console.warn('[file-watcher] realpathSync failed', { redacted: redactPath(eventPath, WATCHED_ROOTS) });
    return;
  }

  // Step (b): confirm realpath is strictly inside a watched root
  if (!isContainedInRoot(resolvedPath, WATCHED_ROOTS)) {
    console.warn('[file-watcher] path escaped watched roots — dropped', { redacted: redactPath(resolvedPath, WATCHED_ROOTS) });
    return;
  }

  // Step (c): reject hidden credential-style paths
  if (!isPathSafe(resolvedPath)) {
    console.warn('[file-watcher] unsafe path pattern — dropped', { redacted: redactPath(resolvedPath, WATCHED_ROOTS) });
    return;
  }

  // Step (d): parent-directory escapes handled by realpathSync + isContainedInRoot above.

  // Step (e): read file content
  let content;
  try {
    content = fs.readFileSync(resolvedPath);
  } catch {
    console.warn('[file-watcher] readFileSync failed — dropped', { redacted: redactPath(resolvedPath, WATCHED_ROOTS) });
    return;
  }

  // Step (f): compute sha256
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');

  // Step (g): send via IPC
  sendIpc({
    type: 'file_event',
    path: resolvedPath,
    existingContentSha256: sha256,
    sizeBytes: content.length,
    emittedBy: 'watcher',
  });
}

// ---------------------------------------------------------------------------
// Watcher setup — chokidar v3.x API
// ---------------------------------------------------------------------------

const watcher = chokidar.watch(WATCHED_ROOTS, {
  persistent: true,
  ignoreInitial: true,
});

watcher
  .on('add', handleFileEvent)
  .on('change', handleFileEvent)
  .on('error', (err) => {
    console.warn('[file-watcher] chokidar error', { message: err && err.message });
  });

console.log('[file-watcher] started; watching', WATCHED_ROOTS);
