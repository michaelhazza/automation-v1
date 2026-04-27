#!/usr/bin/env node
/**
 * PostToolUse hook: rls-migration-guard (advisory only, never blocks)
 *
 * Spec: docs/superpowers/specs/2026-04-26-audit-remediation-followups-spec.md §A2 Phase 2
 *
 * Runs after a Write or Edit tool call. If the target file is a top-level
 * `migrations/*.sql` and the change introduces a `CREATE TABLE` body that
 * declares an `organisation_id` column without a matching `CREATE POLICY` in
 * the same file, emit an advisory warning to stderr pointing the author at
 * the registry file and the allowlist.
 *
 * Always exits 0 — this is signal, not enforcement. The blocking enforcement
 * lives in `scripts/verify-rls-protected-tables.sh` (CI gate).
 *
 * Defensive parsing: the Claude Code hook payload format varies between
 * versions (and may be empty / non-JSON). Any parse error or missing field
 * results in a silent no-op exit-0.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// ── Helpers ────────────────────────────────────────────────────────────────

function normalisePath(p) {
  if (!p) return '';
  return p.replace(/\\/g, '/');
}

function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function isMigrationSqlFile(absPath) {
  const norm = normalisePath(absPath);
  // Match `<root>/migrations/<file>.sql` (top-level only — not the _down/
  // subdir, which is auto-generated and uninteresting for this guard).
  return /\/migrations\/[^/]+\.sql$/.test(norm);
}

/**
 * Read the file contents. On any error, returns null. The hook fires AFTER
 * the Write/Edit completes, so the file is on disk by this point.
 */
function readMigrationContents(absPath) {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Walk the SQL text and return the list of table names whose CREATE TABLE
 * body declares an `organisation_id` column. Mirrors the gate-script awk
 * heuristic so the two stay aligned.
 */
function extractTablesWithOrgId(sqlText) {
  const lines = sqlText.split(/\r?\n/);
  const tables = [];
  let inTable = false;
  let current = '';
  let hasOrg = false;

  const tableHeader = /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/;
  const orgIdCol = /^\s*"?organisation_id"?\s+/;
  const closeBody = /^\s*\);/;

  for (const line of lines) {
    const m = line.match(tableHeader);
    if (m && !inTable) {
      inTable = true;
      current = m[1];
      hasOrg = false;
      continue;
    }
    if (inTable) {
      if (orgIdCol.test(line)) {
        hasOrg = true;
      }
      if (closeBody.test(line)) {
        if (hasOrg) tables.push(current);
        inTable = false;
        current = '';
        hasOrg = false;
      }
    }
  }
  return tables;
}

/**
 * Returns the set of tables that have a matching `CREATE POLICY` statement in
 * the same SQL text.
 */
function extractTablesWithPolicy(sqlText) {
  const tables = new Set();
  const policyRe = /CREATE POLICY\s+[a-zA-Z_]+\s+ON\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/g;
  let m;
  while ((m = policyRe.exec(sqlText)) !== null) {
    tables.add(m[1]);
  }
  return tables;
}

function emitAdvisory(filePath, missingTables) {
  const registryPath = join(projectDir(), 'server', 'config', 'rlsProtectedTables.ts');
  const allowlistPath = join(projectDir(), 'scripts', 'rls-not-applicable-allowlist.txt');
  const lines = [
    `[rls-migration-guard] advisory: ${filePath}`,
    `  CREATE TABLE with organisation_id but no matching CREATE POLICY in the same file:`,
    ...missingTables.map((t) => `    - ${t}`),
    `  Action items:`,
    `    1. Add an RLS policy: 'CREATE POLICY <name> ON <table> USING (...) WITH CHECK (...)'`,
    `    2. Register the table in: ${registryPath}`,
    `    3. OR (if RLS is genuinely not applicable) add the table with a one-line rationale to: ${allowlistPath}`,
    `  This is advisory — the blocking check lives in scripts/verify-rls-protected-tables.sh.`,
  ];
  process.stderr.write(lines.join('\n') + '\n');
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

    const toolName = payload.tool_name || payload.toolName || '';
    if (toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'MultiEdit') {
      process.exit(0);
    }

    // Extract candidate file paths from a variety of payload shapes.
    const toolInput = payload.tool_input || payload.toolInput || {};
    const candidates = new Set();
    if (toolInput.file_path) candidates.add(toolInput.file_path);
    if (toolInput.path) candidates.add(toolInput.path);
    if (Array.isArray(toolInput.edits)) {
      for (const e of toolInput.edits) {
        if (e && e.file_path) candidates.add(e.file_path);
      }
    }

    let foundAny = false;
    for (const candidate of candidates) {
      if (!isMigrationSqlFile(candidate)) continue;
      foundAny = true;
      const contents = readMigrationContents(candidate);
      if (!contents) continue;

      const tables = extractTablesWithOrgId(contents);
      if (tables.length === 0) continue;

      const policyTables = extractTablesWithPolicy(contents);
      const missing = tables.filter((t) => !policyTables.has(t));
      if (missing.length === 0) continue;

      emitAdvisory(candidate, missing);
    }

    // Fall through silently when there are no migration writes.
    void foundAny;
    process.exit(0);
  } catch {
    // Defensive no-op on any parse / IO error. Hook is advisory and must
    // never break a developer's flow.
    process.exit(0);
  }
});
