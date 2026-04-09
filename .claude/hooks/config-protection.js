#!/usr/bin/env node
/**
 * PreToolUse hook: config-protection
 *
 * Blocks Edit and Write calls that target tooling configuration files
 * (tsconfig, eslint, biome, prettier, package.json scripts). Prevents
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
];

// Full path patterns (relative to project root) for additional protection.
const PROTECTED_PATHS = [
  /^worker\/\.eslintrc.*$/,
];

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  raw += chunk;
});
process.stdin.on('end', () => {
  try {
    const payload = raw.trim() ? JSON.parse(raw) : {};

    const toolName = payload.tool_name || '';
    if (toolName !== 'Edit' && toolName !== 'Write') {
      process.exit(0);
    }

    const filePath = (payload.tool_input && payload.tool_input.file_path) || '';
    if (!filePath) {
      process.exit(0);
    }

    const basename = filePath.split('/').pop() || '';
    const relativePath = toRelativePath(filePath);

    // Check basename patterns.
    const basenameMatch = PROTECTED_BASENAMES.some((re) => re.test(basename));

    // Check full path patterns.
    const pathMatch = relativePath && PROTECTED_PATHS.some((re) => re.test(relativePath));

    if (!basenameMatch && !pathMatch) {
      process.exit(0);
    }

    const message = [
      `BLOCKED by config-protection: ${toolName} to "${basename}" is not allowed.`,
      ``,
      `Tooling configuration files (tsconfig, eslint, biome, prettier) are`,
      `protected. Modifying them to make a failing check pass violates the`,
      `project rule: "Never skip a failing check. Never suppress warnings`,
      `to make a check pass."`,
      ``,
      `Instead:`,
      `  - Fix the actual code that is causing the check to fail.`,
      `  - If the config genuinely needs updating, ask the user first.`,
    ].join('\n');

    process.stderr.write(message + '\n');
    process.exit(2);
  } catch (err) {
    // Fail open: never block a legitimate edit due to a hook bug.
    process.stderr.write(
      `config-protection: internal error, allowing edit: ${err && err.message}\n`,
    );
    process.exit(0);
  }
});

/**
 * Attempt to convert an absolute path to a project-relative path.
 * Returns null if the path doesn't appear to be inside the project.
 */
function toRelativePath(absPath) {
  if (!absPath) return null;
  // Look for common project root markers in the path.
  const markers = ['/server/', '/client/', '/worker/', '/scripts/', '/migrations/'];
  for (const marker of markers) {
    const idx = absPath.indexOf(marker);
    if (idx !== -1) {
      return absPath.slice(idx + 1); // e.g. "server/tsconfig.json"
    }
  }
  // Fallback: strip everything up to and including the last known project dir.
  const parts = absPath.split('/');
  // Return just the basename-level match for safety.
  return null;
}
