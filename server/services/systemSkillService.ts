import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import type { AnthropicTool } from './llmService.js';

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
  /** Whether this skill is visible to org/subaccount admins. Defaults to false (platform-internal). */
  isVisible: boolean;
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
  // isVisible defaults to false — skills must explicitly opt-in to be visible at org/subaccount level
  const isVisible = fm['isVisible'] === 'true';

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
  const instructionsMatch = body.match(/^## Instructions\n([\s\S]*?)(?=^## |\s*$)/m);
  const instructions = instructionsMatch ? instructionsMatch[1].trim() : null;

  // Extract ## Methodology section
  const methodologyMatch = body.match(/^## Methodology\n([\s\S]*?)(?=^## |\s*$)/m);
  const methodology = methodologyMatch ? methodologyMatch[1].trim() : null;

  return { id: slug, slug, name, description, isActive, isVisible, definition, instructions, methodology };
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

  /** Skills that are both active AND visible to org/subaccount level */
  async listVisibleSkills(): Promise<SystemSkill[]> {
    const skills = await this.listSkills();
    return skills.filter(s => s.isActive && s.isVisible);
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
   * Toggle the isVisible flag on a skill by rewriting its .md frontmatter.
   * The .md files are the source of truth so this is the only durable way to persist the change.
   */
  async updateSkillVisibility(slug: string, isVisible: boolean): Promise<SystemSkill> {
    const map = await loadSkills();
    const skill = map.get(slug);
    if (!skill) throw { statusCode: 404, message: 'System skill not found' };

    const filePath = join(SKILLS_DIR, `${slug}.md`);
    const raw = await readFile(filePath, 'utf-8');

    let updated: string;
    if (/^isVisible:/m.test(raw)) {
      // Replace existing isVisible line
      updated = raw.replace(/^isVisible:.*$/m, `isVisible: ${isVisible}`);
    } else {
      // Inject after the last frontmatter key (before closing ---)
      updated = raw.replace(/^(---\n[\s\S]*?)(^---)/m, `$1isVisible: ${isVisible}\n$2`);
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
