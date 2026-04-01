/**
 * Company folder parser — reads a Paperclip-compatible company folder format
 * and produces normalized in-memory representations.
 *
 * Expected folder layout:
 *   COMPANY.md
 *   agents/<slug>/AGENTS.md
 *   teams/<slug>/TEAM.md
 *   skills/<slug>/SKILL.md
 *
 * Two output targets:
 *   1. Paperclip JSON manifest — feeds into existing importPaperclip methods
 *   2. System agents array — feeds into system_agents table seeding
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { parse as parseYaml } from 'yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompanyManifest {
  name: string;
  description: string;
  slug: string;
  schema: string;
  version: string;
  license: string;
  authors: Array<{ name: string }>;
  goals: string[];
}

export interface AgentDefinition {
  slug: string;
  name: string;
  title?: string;
  description?: string;
  reportsTo: string | null;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  schedule?: string;
  gate?: string;
  tokenBudget?: number;
  maxToolCalls?: number;
  skills: string[];
  systemPrompt: string;
  icon?: string;
}

export interface TeamDefinition {
  slug: string;
  name: string;
  description: string;
  manager: string;
  includes: string[];
  tags: string[];
}

export interface SkillReference {
  slug: string;
  name: string;
  description: string;
  runtimeSkillRef?: string;
}

export interface ParsedCompany {
  manifest: CompanyManifest;
  agents: AgentDefinition[];
  teams: TeamDefinition[];
  skills: SkillReference[];
}

// ---------------------------------------------------------------------------
// YAML frontmatter parser
// ---------------------------------------------------------------------------

function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, body: raw };
  }
  try {
    const frontmatter = parseYaml(fmMatch[1]) as Record<string, unknown>;
    return { frontmatter, body: fmMatch[2].trim() };
  } catch {
    return { frontmatter: {}, body: raw };
  }
}

// ---------------------------------------------------------------------------
// Directory scanner helpers
// ---------------------------------------------------------------------------

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function readMarkdownFile(filePath: string): Promise<{ frontmatter: Record<string, unknown>; body: string } | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    return parseFrontmatter(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export async function parseCompanyFolder(companyDir: string): Promise<ParsedCompany> {
  // 1. Parse COMPANY.md
  const companyFile = await readMarkdownFile(join(companyDir, 'COMPANY.md'));
  if (!companyFile) {
    throw new Error(`COMPANY.md not found in ${companyDir}`);
  }

  const manifest: CompanyManifest = {
    name: String(companyFile.frontmatter.name ?? 'Unknown'),
    description: String(companyFile.frontmatter.description ?? ''),
    slug: String(companyFile.frontmatter.slug ?? basename(companyDir)),
    schema: String(companyFile.frontmatter.schema ?? 'agentcompanies/v1'),
    version: String(companyFile.frontmatter.version ?? '1.0.0'),
    license: String(companyFile.frontmatter.license ?? 'proprietary'),
    authors: (companyFile.frontmatter.authors as Array<{ name: string }>) ?? [],
    goals: (companyFile.frontmatter.goals as string[]) ?? [],
  };

  // 2. Parse agents
  const agents: AgentDefinition[] = [];
  const agentsDir = join(companyDir, 'agents');
  if (await dirExists(agentsDir)) {
    const agentFolders = await readdir(agentsDir);
    for (const folder of agentFolders.sort()) {
      const agentPath = join(agentsDir, folder, 'AGENTS.md');
      const parsed = await readMarkdownFile(agentPath);
      if (!parsed) continue;

      const fm = parsed.frontmatter;
      const skills = Array.isArray(fm.skills) ? fm.skills.map(String) : [];

      agents.push({
        slug: String(fm.slug ?? folder),
        name: String(fm.name ?? folder),
        title: fm.title as string | undefined,
        description: fm.description as string | undefined,
        reportsTo: fm.reportsTo === null || fm.reportsTo === 'null' ? null : String(fm.reportsTo ?? ''),
        model: fm.model as string | undefined,
        temperature: fm.temperature as number | undefined,
        maxTokens: fm.maxTokens as number | undefined,
        schedule: fm.schedule as string | undefined,
        gate: fm.gate as string | undefined,
        tokenBudget: fm.tokenBudget as number | undefined,
        maxToolCalls: fm.maxToolCalls as number | undefined,
        skills,
        systemPrompt: parsed.body,
        icon: fm.icon as string | undefined,
      });
    }
  }

  // 3. Parse teams
  const teams: TeamDefinition[] = [];
  const teamsDir = join(companyDir, 'teams');
  if (await dirExists(teamsDir)) {
    const teamFolders = await readdir(teamsDir);
    for (const folder of teamFolders.sort()) {
      const teamPath = join(teamsDir, folder, 'TEAM.md');
      const parsed = await readMarkdownFile(teamPath);
      if (!parsed) continue;

      const fm = parsed.frontmatter;
      teams.push({
        slug: String(fm.slug ?? folder),
        name: String(fm.name ?? folder),
        description: String(fm.description ?? ''),
        manager: String(fm.manager ?? ''),
        includes: Array.isArray(fm.includes) ? fm.includes.map(String) : [],
        tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
      });
    }
  }

  // 4. Parse skills
  const skills: SkillReference[] = [];
  const skillsDir = join(companyDir, 'skills');
  if (await dirExists(skillsDir)) {
    const skillFolders = await readdir(skillsDir);
    for (const folder of skillFolders.sort()) {
      const skillPath = join(skillsDir, folder, 'SKILL.md');
      const parsed = await readMarkdownFile(skillPath);
      if (!parsed) continue;

      const fm = parsed.frontmatter;
      skills.push({
        slug: String(fm.slug ?? folder),
        name: String(fm.name ?? folder),
        description: String(fm.description ?? ''),
        runtimeSkillRef: fm.runtimeSkillRef as string | undefined,
      });
    }
  }

  return { manifest, agents, teams, skills };
}

// ---------------------------------------------------------------------------
// Conversion: company → Paperclip JSON manifest
// (feeds into existing importPaperclip methods on template services)
// ---------------------------------------------------------------------------

export function toPaperclipManifest(parsed: ParsedCompany): Record<string, unknown> {
  return {
    company: {
      name: parsed.manifest.name,
      description: parsed.manifest.description,
      slug: parsed.manifest.slug,
      schema: parsed.manifest.schema,
      version: parsed.manifest.version,
      agents: parsed.agents.map(a => ({
        slug: a.slug,
        name: a.name,
        title: a.title,
        description: a.description,
        reportsTo: a.reportsTo,
        systemPrompt: a.systemPrompt,
        modelProvider: 'anthropic',
        modelId: a.model ?? 'claude-sonnet-4-6',
        icon: a.icon,
        capabilities: a.skills.join(', '),
        role: a.title,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Conversion: company → system agents seed data
// (feeds into system_agents table upsert)
// ---------------------------------------------------------------------------

export interface SystemAgentSeedRow {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  masterPrompt: string;
  modelProvider: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  defaultSystemSkillSlugs: string[];
  defaultOrgSkillSlugs: string[];
  defaultTokenBudget: number;
  defaultMaxToolCalls: number;
  executionMode: 'api' | 'headless';
  isPublished: boolean;
  status: 'draft' | 'active' | 'inactive';
  defaultScheduleCron: string | null;
}

export function toSystemAgentRows(parsed: ParsedCompany): SystemAgentSeedRow[] {
  return parsed.agents.map(a => ({
    slug: a.slug,
    name: a.name,
    description: a.description ?? a.title ?? null,
    icon: a.icon ?? null,
    masterPrompt: a.systemPrompt,
    modelProvider: 'anthropic',
    modelId: a.model ?? 'claude-sonnet-4-6',
    temperature: a.temperature ?? 0.7,
    maxTokens: a.maxTokens ?? 4096,
    defaultSystemSkillSlugs: a.skills,
    defaultOrgSkillSlugs: [],
    defaultTokenBudget: a.tokenBudget ?? 30000,
    defaultMaxToolCalls: a.maxToolCalls ?? 20,
    executionMode: 'api' as const,
    isPublished: true,
    status: 'active' as const,
    defaultScheduleCron: a.schedule === 'on-demand' ? null : (a.schedule ?? null),
  }));
}
