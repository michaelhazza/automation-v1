// ---------------------------------------------------------------------------
// System Skill Service — pure markdown parser
// ---------------------------------------------------------------------------
// Extracted from the legacy file-based systemSkillService so the parsing
// logic can be unit-tested without fs and reused by the Phase 0 backfill
// script (scripts/backfill-system-skills.ts). The markdown files at
// server/skills/*.md are now a seed source only — runtime reads/writes go
// to the system_skills DB table. This module exists so we can still parse
// those seed files into DB rows on first backfill, and for tests.
// ---------------------------------------------------------------------------

import type { AnthropicTool } from './llmService.js';
import { isSkillVisibility, type SkillVisibility } from '../lib/skillVisibility.js';
import { parseParameterSection, buildToolDefinition } from '../../shared/skillParameters.js';

/** A parsed skill ready to be upserted into the system_skills DB table.
 *  Shape matches the DB row minus id/createdAt/updatedAt/handlerKey (the
 *  backfill script sets handlerKey = slug before writing). */
export interface ParsedSystemSkillSeed {
  slug: string;
  name: string;
  description: string;
  isActive: boolean;
  visibility: SkillVisibility;
  definition: AnthropicTool;
  instructions: string | null;
}

/** Extract a markdown section by heading. Returns content between `## Heading`
 *  and the next `## ` heading or end of string. Returns null if section missing. */
export function extractSection(body: string, heading: string): string | null {
  const marker = `## ${heading}\n`;
  const start = body.indexOf(marker);
  if (start === -1) return null;
  const contentStart = start + marker.length;
  const nextHeading = body.indexOf('\n## ', contentStart);
  const content = nextHeading === -1
    ? body.slice(contentStart)
    : body.slice(contentStart, nextHeading);
  const trimmed = content.trim();
  return trimmed || null;
}

/** Parse a skill .md file into a seed record. Pure — no fs, no caching, no
 *  console output. Returns null on any malformed input (missing frontmatter,
 *  missing tool definition, invalid JSON). Callers decide how to report the
 *  failure (the backfill script logs and exits non-zero; tests assert null). */
export function parseSkillFile(slug: string, raw: string): ParsedSystemSkillSeed | null {
  // Strip UTF-8 BOM and normalize CRLF → LF before any regex matching. Without
  // the BOM strip the leading `^---` anchor in the frontmatter regex misses,
  // and the file silently parses as null (skipped by the backfill).
  const normalised = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split frontmatter
  const fmMatch = normalised.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const body = fmMatch[2];

  // Parse frontmatter (simple key: value — no nested YAML)
  const fm: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fm[key] = value;
  }

  const name = fm['name'] ?? slug;
  const description = fm['description'] ?? '';
  const isActive = fm['isActive'] !== 'false';
  // visibility defaults to 'none'. Legacy isVisible boolean is honoured as
  // a one-time fallback so older .md files keep working until they're
  // migrated: isVisible: true → 'full', isVisible: false → 'none'.
  let visibility: SkillVisibility = 'none';
  if (fm['visibility'] && isSkillVisibility(fm['visibility'])) {
    visibility = fm['visibility'];
  } else if (fm['isVisible'] === 'true') {
    visibility = 'full';
  }

  // ---------------------------------------------------------------------------
  // Parse tool definition: new format (## Parameters) or legacy (JSON block)
  // ---------------------------------------------------------------------------
  let definition: AnthropicTool;

  const parametersSection = extractSection(body, 'Parameters');
  if (parametersSection) {
    // New format: auto-generate definition from slug + description + parameter list
    const params = parseParameterSection(parametersSection);
    definition = buildToolDefinition(slug, description, params) as AnthropicTool;
  } else {
    // Legacy format: parse JSON code block
    const jsonMatch = body.match(/```json\n([\s\S]*?)\n```/);
    if (!jsonMatch) return null;
    try {
      definition = JSON.parse(jsonMatch[1]);
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Parse instructions: merge ## Instructions + ## Methodology (legacy) into one
  // ---------------------------------------------------------------------------
  const instructionsSection = extractSection(body, 'Instructions');
  const methodologySection = extractSection(body, 'Methodology');

  const instructions: string | null = (instructionsSection && methodologySection)
    ? instructionsSection + '\n\n' + methodologySection
    : (instructionsSection ?? methodologySection ?? null);

  return { slug, name, description, isActive, visibility, definition, instructions };
}
