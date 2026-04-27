#!/usr/bin/env node
// ---------------------------------------------------------------------------
// verify-help-hint-length.mjs
//
// Introduced by Phase C of docs/onboarding-playbooks-spec.md (§6.4, §6.8, §13.5).
//
// Fails the gate if any `<HelpHint text="…" />` literal in the client tree
// exceeds 280 characters. The cap is a soft authoring constraint — hints
// that exceed it have scrolled into documentation territory and need a
// better surface (dedicated help panel, docs page, or rewritten copy).
//
// Only string LITERALS are checked (single- or double-quoted). Template
// literals, variable references, and `t()` lookups are skipped by design
// (§6.4 "No interpolation" — the rule is author-time, not runtime).
//
// Exit codes:
//   0  — pass (no violations)
//   1  — blocking fail (at least one literal over 280 chars)
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);
const ROOT_DIR = dirname(SCRIPT_DIR);
const CLIENT_SRC = join(ROOT_DIR, 'client', 'src');
const MAX_CHARS = 280;

/** Walk the client/src tree and collect every .tsx file. */
function collectTsxFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      collectTsxFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Match `<HelpHint ...>` opening tags (self-closing or otherwise) and pull
 * the `text=` attribute value when it is a string LITERAL (single- or
 * double-quoted). Multi-line tags are handled by the `s` flag.
 */
const HELP_HINT_TAG_RE = /<HelpHint\b([^>]*?)\/?>/gs;
const TEXT_LITERAL_RE = /\btext\s*=\s*(?:"([^"]*)"|'([^']*)')/;

function findViolations(filePath, source) {
  const violations = [];
  for (const match of source.matchAll(HELP_HINT_TAG_RE)) {
    const attrs = match[1] ?? '';
    const literalMatch = attrs.match(TEXT_LITERAL_RE);
    if (!literalMatch) continue; // non-literal (variable / expression) — skip
    const textValue = literalMatch[1] ?? literalMatch[2] ?? '';
    if (textValue.length > MAX_CHARS) {
      // Compute the 1-based line number of the tag start in the source.
      const idx = match.index ?? 0;
      const line = source.slice(0, idx).split('\n').length;
      violations.push({
        file: relative(ROOT_DIR, filePath),
        line,
        length: textValue.length,
        preview: textValue.slice(0, 80) + (textValue.length > 80 ? '…' : ''),
      });
    }
  }
  return violations;
}

let stats;
try {
  stats = statSync(CLIENT_SRC);
} catch {
  // No client tree — nothing to check. Pass silently.
  console.log('[verify-help-hint-length] No client/src directory; skipping.');
  console.log('[GATE] help-hint-length: violations=0');
  process.exit(0);
}
if (!stats.isDirectory()) {
  console.log('[verify-help-hint-length] client/src is not a directory; skipping.');
  console.log('[GATE] help-hint-length: violations=0');
  process.exit(0);
}

const files = collectTsxFiles(CLIENT_SRC);
const allViolations = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes('<HelpHint')) continue;
  allViolations.push(...findViolations(file, source));
}

console.log(`[verify-help-hint-length] Scanned ${files.length} .tsx files.`);

if (allViolations.length === 0) {
  console.log('[verify-help-hint-length] PASS — all <HelpHint text="…" /> literals ≤ 280 chars.');
  console.log('[GATE] help-hint-length: violations=0');
  process.exit(0);
}

console.error(`[verify-help-hint-length] FAIL — ${allViolations.length} HelpHint literal(s) exceed ${MAX_CHARS} chars:`);
for (const v of allViolations) {
  console.error(`  ${v.file}:${v.line} — ${v.length} chars`);
  console.error(`    text="${v.preview}"`);
}
console.error('');
console.error('Shorten the text, or move the explanation to a dedicated docs surface. See §6.4 of docs/onboarding-playbooks-spec.md.');
console.log(`[GATE] help-hint-length: violations=${allViolations.length}`);
process.exit(1);
