import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Skill Parser Service — Pure Functions
// Zero DB/env/service imports. Fully testable in isolation.
// ---------------------------------------------------------------------------

export interface ParsedSkill {
  name: string;
  slug: string;
  description: string;
  definition: object | null;   // Anthropic tool JSON schema
  instructions: string | null;
  rawSource: string;           // Original text for diff display
}

/** Parse YAML-style frontmatter from a markdown string.
 *  Returns { frontmatter, body } where body is everything after the closing ---. */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {};
  const trimmed = content.trimStart();

  if (!trimmed.startsWith('---')) {
    return { frontmatter, body: content };
  }

  const endIdx = trimmed.indexOf('\n---', 3);
  if (endIdx === -1) {
    return { frontmatter, body: content };
  }

  const fmBlock = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 4).trimStart();

  for (const line of fmBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) frontmatter[key] = val;
  }

  return { frontmatter, body };
}

/** Extract a JSON code block from markdown text.
 *  Looks for ```json ... ``` or a bare top-level JSON object. */
function extractJsonBlock(text: string): object | null {
  // Try ```json ... ``` block first
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch {
      // fall through
    }
  }

  // Try bare JSON object
  const braceIdx = text.indexOf('{');
  if (braceIdx !== -1) {
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace > braceIdx) {
      try {
        return JSON.parse(text.slice(braceIdx, lastBrace + 1));
      } catch {
        // fall through
      }
    }
  }

  return null;
}

/** Generate a slug from a name (kebab-case, lowercase, ASCII-safe). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
}

/** Parse free-text paste into one or more skills.
 *  Splits by finding YAML frontmatter openers (a line that is exactly '---'
 *  followed by a 'key: value' line), so that bare '---' separators between
 *  skills and the '---' that closes a frontmatter block are not confused with
 *  the start of a new skill. */
export function parseFromText(text: string): ParsedSkill[] {
  // Locate every position that begins a YAML frontmatter block.
  // A frontmatter opener: a line that is exactly '---' whose next line starts
  // with a YAML key (e.g. 'name: ...'). This distinguishes it from closing
  // '---' delimiters and bare content-separator '---' lines.
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blockStarts: number[] = [];
  let charOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '---' && i + 1 < lines.length && /^[a-zA-Z_-]+:/.test(lines[i + 1])) {
      blockStarts.push(charOffset);
    }
    charOffset += lines[i].length + 1; // +1 for the '\n'
  }

  if (blockStarts.length === 0) {
    // No frontmatter opener found — attempt to parse whole text as one skill
    const skill = parseMarkdownFile('paste', normalized);
    return skill ? [skill] : [];
  }

  const results: ParsedSkill[] = [];
  for (let i = 0; i < blockStarts.length; i++) {
    const start = blockStarts[i];
    const end = blockStarts[i + 1] ?? normalized.length;
    const block = normalized.slice(start, end).trim();
    if (block.length >= 10) {
      const skill = parseMarkdownFile('paste', block);
      if (skill) results.push(skill);
    }
  }

  return results;
}

/** Parse a single .md file (YAML frontmatter + JSON definition block + markdown body). */
export function parseMarkdownFile(filename: string, content: string): ParsedSkill | null {
  const { frontmatter, body } = parseFrontmatter(content);

  const name = frontmatter['name'] || frontmatter['title'] || '';
  if (!name) return null;

  const slug = frontmatter['slug'] || slugify(name);
  const description = frontmatter['description'] || frontmatter['desc'] || '';

  // Split body into sections by ## heading
  const sections: Record<string, string> = {};
  let currentSection = '__preamble';
  sections[currentSection] = '';

  for (const line of body.split('\n')) {
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      currentSection = headingMatch[1].toLowerCase().trim();
      sections[currentSection] = '';
    } else {
      sections[currentSection] = (sections[currentSection] || '') + line + '\n';
    }
  }

  // Extract JSON definition from preamble or a dedicated section
  const definitionSource =
    sections['tool definition'] ||
    sections['definition'] ||
    sections['__preamble'] ||
    body;
  const definition = extractJsonBlock(definitionSource);

  const instructionsSection = sections['instructions']?.trim() || sections['usage']?.trim() || null;
  const methodologySection =
    sections['methodology']?.trim() ||
    sections['workflow']?.trim() ||
    sections['approach']?.trim() ||
    null;

  // Merge methodology into instructions (single field)
  let instructions: string | null = (instructionsSection && methodologySection)
    ? instructionsSection + '\n\n' + methodologySection
    : (instructionsSection ?? methodologySection ?? null);

  // Fallback: Anthropic-Plugin-style SKILL.md files put the full skill content
  // in the body without a dedicated `## Instructions` section. When we found
  // nothing via section headings, use the whole body (minus a leading `# Title`)
  // so the skill has usable instructions rather than a null field.
  if (!instructions) {
    const trimmed = body.trimStart();
    const afterH1 = trimmed.startsWith('# ')
      ? trimmed.slice(trimmed.indexOf('\n') + 1)
      : trimmed;
    const normalized = afterH1.trim();
    if (normalized.length > 0) {
      instructions = normalized;
    }
  }

  return {
    name,
    slug,
    description,
    definition,
    instructions,
    rawSource: content,
  };
}

/** Parse a .json skill definition file. */
export function parseJsonFile(filename: string, content: string): ParsedSkill | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  const name = (parsed['name'] as string) || '';
  if (!name) return null;

  const slug = (parsed['slug'] as string) || slugify(name);
  const description = (parsed['description'] as string) || '';
  const definition = (parsed['definition'] as object) || null;
  const instrPart = (parsed['instructions'] as string) || null;
  const methPart = (parsed['methodology'] as string) || null;
  const instructions = instrPart && methPart
    ? instrPart + '\n\n' + methPart
    : instrPart ?? methPart ?? null;

  return {
    name,
    slug,
    description,
    definition,
    instructions: instructions || null,
    rawSource: content,
  };
}

/** Normalize skill content for hashing.
 *  Lowercase, strip whitespace, sort JSON keys deterministically. */
export function normalizeForHash(skill: ParsedSkill): string {
  const parts = [
    skill.name.toLowerCase().trim(),
    skill.description.toLowerCase().trim(),
    skill.definition ? JSON.stringify(sortKeys(skill.definition)) : '',
    (skill.instructions || '').toLowerCase().replace(/\s+/g, ' ').trim(),
  ];
  return parts.join('|');
}

/** Recursively sort JSON object keys for deterministic serialization. */
function sortKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

/** SHA-256 hash of normalized skill content. */
export function contentHash(normalizedContent: string): string {
  return crypto.createHash('sha256').update(normalizedContent).digest('hex');
}

export const skillParserServicePure = {
  parseFromText,
  parseMarkdownFile,
  parseJsonFile,
  slugify,
  normalizeForHash,
  contentHash,
};
