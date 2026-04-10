import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import type { AnthropicTool } from './llmService.js';
import { isSkillVisibility, type SkillVisibility } from '../lib/skillVisibility.js';

// ---------------------------------------------------------------------------
// System Skill Service — reads platform-level skills from .md files
// Source of truth: server/skills/*.md — no DB sync required.
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const SKILLS_DIR = join(__filename, '..', '..', 'skills');

export interface SystemSkill {
  id: string;          // slug (filename without .md)
  slug: string;
  name: string;
  description: string;
  isActive: boolean;
  /**
   * Three-state cascade visibility for org/subaccount tiers. Defaults to
   * 'none' so skills must be explicitly opted in.
   *   none   — invisible to lower tiers
   *   basic  — name + description only
   *   full   — everything (instructions, methodology, definition)
   */
  visibility: SkillVisibility;
  definition: AnthropicTool;
  instructions: string | null;
  methodology: string | null;
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

let _cache: Map<string, SystemSkill> | null = null;

async function loadSkills(): Promise<Map<string, SystemSkill>> {
  if (_cache) return _cache;

  const map = new Map<string, SystemSkill>();

  let files: string[];
  try {
    files = await readdir(SKILLS_DIR);
  } catch {
    console.warn('[systemSkillService] skills directory not found:', SKILLS_DIR);
    _cache = map;
    return map;
  }

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const slug = file.slice(0, -3);

    try {
      const raw = await readFile(join(SKILLS_DIR, file), 'utf-8');
      const skill = parseSkillFile(slug, raw);
      if (skill) map.set(slug, skill);
    } catch (err) {
      console.warn(`[systemSkillService] failed to load skill ${file}:`, err);
    }
  }

  _cache = map;
  return map;
}

/** Extract a markdown section by heading. Returns content between `## Heading`
 *  and the next `## ` heading or end of string. Returns null if section missing. */
function extractSection(body: string, heading: string): string | null {
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

/** Parse a skill .md file into a SystemSkill record */
function parseSkillFile(slug: string, raw: string): SystemSkill | null {
  // Normalize Windows CRLF → LF before any regex matching
  const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

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

  // Extract JSON code block for tool definition
  const jsonMatch = body.match(/```json\n([\s\S]*?)\n```/);
  if (!jsonMatch) return null;

  let definition: AnthropicTool;
  try {
    definition = JSON.parse(jsonMatch[1]);
  } catch {
    console.warn(`[systemSkillService] invalid JSON in skill ${slug}`);
    return null;
  }

  // Extract ## Instructions section
  const instructions = extractSection(body, 'Instructions');

  // Extract ## Methodology section
  const methodology = extractSection(body, 'Methodology');

  return { id: slug, slug, name, description, isActive, visibility, definition, instructions, methodology };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const systemSkillService = {
  /** Reload the in-memory cache (useful in tests or hot-reload scenarios) */
  invalidateCache() {
    _cache = null;
  },

  async listSkills(): Promise<SystemSkill[]> {
    const map = await loadSkills();
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  },

  async listActiveSkills(): Promise<SystemSkill[]> {
    const skills = await this.listSkills();
    return skills.filter(s => s.isActive);
  },

  /** Skills that are both active AND visible to org/subaccount level
   *  (visibility !== 'none'). Returns the raw row including the body — the
   *  caller is responsible for stripping the body via stripBodyForBasic()
   *  when visibility === 'basic'.
   */
  async listVisibleSkills(): Promise<SystemSkill[]> {
    const skills = await this.listSkills();
    return skills.filter(s => s.isActive && s.visibility !== 'none');
  },

  /**
   * Strip the body fields from a system skill so a 'basic' viewer only
   * sees name + description + visibility (no instructions, methodology, or
   * tool definition). Mirrors the same operation skillService does for
   * org-level skills via decorateSkillForViewer.
   */
  stripBodyForBasic(skill: SystemSkill): SystemSkill {
    return {
      ...skill,
      instructions: null,
      methodology: null,
      definition: { name: skill.definition.name, description: skill.definition.description, input_schema: { type: 'object', properties: {}, required: [] } } as AnthropicTool,
    };
  },

  async getSkill(id: string): Promise<SystemSkill> {
    const map = await loadSkills();
    const skill = map.get(id);
    if (!skill) throw { statusCode: 404, message: 'System skill not found' };
    return skill;
  },

  async getSkillBySlug(slug: string): Promise<SystemSkill | null> {
    const map = await loadSkills();
    const skill = map.get(slug);
    if (!skill || !skill.isActive) return null;
    return skill;
  },

  /**
   * Set the cascade visibility on a skill by rewriting its .md frontmatter.
   * The .md files are the source of truth so this is the only durable way
   * to persist the change. Replaces both legacy `isVisible:` lines and any
   * existing `visibility:` line in one pass.
   */
  async updateSkillVisibility(slug: string, visibility: SkillVisibility): Promise<SystemSkill> {
    if (!isSkillVisibility(visibility)) {
      throw { statusCode: 400, message: 'visibility must be one of: none, basic, full' };
    }
    const map = await loadSkills();
    const skill = map.get(slug);
    if (!skill) throw { statusCode: 404, message: 'System skill not found' };

    const filePath = join(SKILLS_DIR, `${slug}.md`);
    const raw = await readFile(filePath, 'utf-8');

    // Preserve the file's existing line ending (CRLF on Windows-edited files,
    // LF elsewhere). All regexes below are CRLF-tolerant via \r?\n so the
    // injection does not silently no-op on Windows.
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';

    let updated = raw;
    // Strip any legacy isVisible line so it can never override visibility.
    if (/^isVisible:/m.test(updated)) {
      updated = updated.replace(/^isVisible:.*\r?\n?/m, '');
    }
    if (/^visibility:/m.test(updated)) {
      updated = updated.replace(/^visibility:.*$/m, `visibility: ${visibility}`);
    } else {
      // Inject after the last frontmatter key (before closing ---).
      // Use \r?\n so this works on both LF and CRLF files.
      updated = updated.replace(/^(---\r?\n[\s\S]*?)(^---)/m, `$1visibility: ${visibility}${eol}$2`);
    }

    const { writeFile } = await import('fs/promises');
    await writeFile(filePath, updated, 'utf-8');

    // Invalidate cache so the change is visible immediately
    _cache = null;
    const freshMap = await loadSkills();
    return freshMap.get(slug)!;
  },

  /**
   * Resolve an array of system skill slugs into Anthropic tool definitions + prompt instructions.
   */
  async resolveSystemSkills(
    skillSlugs: string[]
  ): Promise<{ tools: AnthropicTool[]; instructions: string[] }> {
    if (!skillSlugs || skillSlugs.length === 0) return { tools: [], instructions: [] };

    const tools: AnthropicTool[] = [];
    const instructions: string[] = [];

    for (const slug of skillSlugs) {
      const skill = await this.getSkillBySlug(slug);
      if (!skill) continue;

      tools.push({
        name: skill.definition.name,
        description: skill.definition.description,
        input_schema: skill.definition.input_schema,
      });

      const parts: string[] = [];
      if (skill.instructions) parts.push(skill.instructions);
      if (skill.methodology) parts.push(skill.methodology);
      if (parts.length > 0) {
        instructions.push(parts.join('\n\n'));
      }
    }

    return { tools, instructions };
  },
};
