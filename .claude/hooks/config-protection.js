#!/usr/bin/env node
/**
 * PreToolUse hook: config-protection
 *
 * Blocks Edit, Write, and MultiEdit calls that target tooling configuration
 * files (tsconfig, eslint, biome, prettier, package.json scripts). Prevents
 * the agent from "fixing" a failing check by weakening the check itself.
 *
 * Enforces CLAUDE.md rule: "Never skip a failing check. Never suppress
 * warnings to make a check pass."
 *
 * Fails OPEN on parse or logic errors — a bug in this hook must never
 * block a legitimate edit.
 *
 * Exit codes (per Claude Code hook contract):
 *   0 — allow the tool call
 *   2 — block the tool call; stderr is fed back to Claude as feedback
 */

// ── Protected file patterns ────────────────────────────────────────────────
// Basename patterns for files that should not be modified by the agent.

const PROTECTED_BASENAMES = [
  /^tsconfig.*\.json$/,         // tsconfig.json, tsconfig.server.json, etc.
  /^\.?eslintrc.*$/,            // .eslintrc, .eslintrc.cjs, .eslintrc.json, etc.
  /^eslint\.config\.[cm]?[jt]s$/, // eslint.config.js, eslint.config.mjs, etc.
  /^\.?prettierrc.*$/,          // .prettierrc, .prettierrc.json, etc.
  /^prettier\.config\.[cm]?[jt]s$/,
  /^biome\.json$/,
  /^\.editorconfig$/,
  /^package\.json$/,            // protects scripts section from being weakened
];

// Full path patterns (relative to project root, always forward-slash) for
// additional protection.
const PROTECTED_PATHS = [
  /^worker\/\.eslintrc.*$/,
];

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Normalise a file path to use forward slashes (handles Windows backslashes).
 */
function normalisePath(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Extract file paths from tool_input depending on tool type.
 * - Edit / Write: single file_path
 * - MultiEdit: array of edits, each with file_path
 * Returns a deduplicated array of normalised paths.
 */
function extractFilePaths(toolName, toolInput) {
  const paths = new Set();
  if (toolName === 'MultiEdit') {
    const edits = toolInput.edits || [];
    for (const edit of edits) {
      if (edit && edit.file_path) paths.add(normalisePath(edit.file_path));
    }
  } else {
    if (toolInput.file_path) paths.add(normalisePath(toolInput.file_path));
  }
  return [...paths];
}

/**
 * Check whether a file path is protected. If it is, write an error message
 * to stderr and exit 2 to block the tool call.
 */
function checkProtected(toolName, filePath) {
  // Split on both / and \ to handle Windows and Unix paths.
  const basename = filePath.split(/[/\\]/).pop() || '';
  const relativePath = toRelativePath(filePath);

  const basenameMatch = PROTECTED_BASENAMES.some((re) => re.test(basename));
  const pathMatch = relativePath && PROTECTED_PATHS.some((re) => re.test(relativePath));

  if (!basenameMatch && !pathMatch) {
    return; // not protected — allow
  }

  const message = [
    `BLOCKED by config-protection: ${toolName} to "${basename}" is not allowed.`,
    ``,
    `Tooling configuration files (tsconfig, eslint, biome, prettier,`,
    `package.json) are protected. Modifying them to make a failing check`,
    `pass violates the project rule: "Never skip a failing check. Never`,
    `suppress warnings to make a check pass."`,
    ``,
    `Instead:`,
    `  - Fix the actual code that is causing the check to fail.`,
    `  - If the config genuinely needs updating, ask the user first.`,
  ].join('\n');

  process.stderr.write(message + '\n');
  process.exit(2);
}

/**
 * Convert an absolute path to a project-relative path (forward-slash
 * normalised). Uses CLAUDE_PROJECT_DIR if available, otherwise falls back
 * to heuristics. Returns null if the path can't be resolved.
 */
function toRelativePath(absPath) {
  if (!absPath) return null;

  // Input is already normalised to forward slashes by extractFilePaths.
  const normalised = absPath;

  // Preferred: use CLAUDE_PROJECT_DIR (set by Claude Code for hook commands).
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir) {
    const normDir = normalisePath(projectDir);
    if (normalised.startsWith(normDir)) {
      let rel = normalised.slice(normDir.length);
      if (rel.startsWith('/')) rel = rel.slice(1);
      return rel;
    }
  }

  // Fallback: look for known top-level directories in the path.
  const markers = ['/server/', '/client/', '/worker/', '/scripts/', '/migrations/'];
  for (const marker of markers) {
    const idx = normalised.indexOf(marker);
    if (idx !== -1) {
      return normalised.slice(idx + 1);
    }
  }

  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  try {
    const payload = raw.trim() ? JSON.parse(raw) : {};

    const toolName = payload.tool_name || '';
    if (toolName !== 'Edit' && toolName !== 'Write' && toolName !== 'MultiEdit') {
      process.exit(0);
    }

    // Extract all target file paths from the tool input.
    const filePaths = extractFilePaths(toolName, payload.tool_input || {});
    if (filePaths.length === 0) {
      process.exit(0);
    }

    // Check every file path — block if ANY target is protected.
    for (const fp of filePaths) {
      checkProtected(toolName, fp);
    }

    // None of the targets are protected — allow.
    process.exit(0);
  } catch (err) {
    // Fail open: never block a legitimate edit due to a hook bug.
    process.stderr.write(
      `config-protection: internal error, allowing edit: ${err && err.message}\n`,
    );
    process.exit(0);
  }
});
