/**
 * Verifies agent-skill contracts across the full stack:
 *   1. Every skill declared in an AGENTS.md has a corresponding server/skills/<slug>.md with valid frontmatter
 *   2. Every agent skill slug is a key in ACTION_REGISTRY
 *   3. Every agent skill slug is a key in SKILL_HANDLERS
 *   4. Every skill .md in server/skills/ is referenced by at least one agent OR declares reusable: true
 *   5. Every APP_FOUNDATIONAL_SKILLS entry has no external integrations (actionCategory !== 'api',
 *      openWorldHint === false, directExternalSideEffect !== true)
 *   6. Every ACTION_REGISTRY entry with sideEffectClass === 'write' declares idempotency.reclaimEligibility explicitly
 *   7. For every 'eligible' declaration, the actionRegistry.ts source line carries an annotation comment
 *
 * Spec: §13.2
 * Exit 0 = all green. Exit 1 = violations found.
 */

import { readdir, readFile } from 'fs/promises';
import { join, resolve } from 'path';

const AGENTS_DIR = resolve('companies/automation-os/agents');
const SKILLS_DIR = resolve('server/skills');
const ACTION_REGISTRY_PATH = resolve('server/config/actionRegistry.ts');

function parseFrontmatter(raw: string): Record<string, unknown> {
  const match = raw.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split('\n');
  const result: Record<string, unknown> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (val === 'null' || val === '~') result[key] = null;
    else if (val === 'true') result[key] = true;
    else if (val === 'false') result[key] = false;
    else if (/^\d+(\.\d+)?$/.test(val)) result[key] = Number(val);
    else result[key] = val.replace(/^['"]|['"]$/g, '');
  }
  return result;
}

function parseSkillsList(raw: string): string[] {
  // Extract lines under `skills:` that are `  - slug` entries
  const normalized = raw.replace(/\r\n/g, '\n');
  const match = normalized.match(/^skills:\s*\n((?:[ \t]+-[ \t]+\S+\n?)*)/m);
  if (!match) return [];
  return match[1].split('\n')
    .map(l => l.match(/^\s+-\s+(\S+)$/)?.[1] ?? '')
    .filter(Boolean);
}

async function main() {
  // skillExecutor.ts imports server/lib/env.ts which validates required env vars
  // at module load time. Set stubs so the import succeeds without a real .env file —
  // this script only reads SKILL_HANDLERS keys, it never connects to any service.
  process.env['DATABASE_URL'] ??= 'postgresql://stub:stub@localhost/stub';
  process.env['JWT_SECRET'] ??= 'stub-secret-min-32-chars-xxxxxxxxxxxx';
  process.env['EMAIL_FROM'] ??= 'stub@stub.local';

  // Dynamic imports to avoid hoisting env validation before the stubs above
  const { ACTION_REGISTRY } = await import('../server/config/actionRegistry.js');
  const { SKILL_HANDLERS } = await import('../server/services/skillExecutor.js');
  const { APP_FOUNDATIONAL_SKILLS } = await import('./lib/skillClassification.js');

  const violations: string[] = [];

  // --- Collect all agent skill slugs ---
  const agentDirs = (await readdir(AGENTS_DIR, { withFileTypes: true })).filter(e => e.isDirectory());
  const agentSkillSlugs = new Set<string>();

  for (const entry of agentDirs) {
    const agentPath = join(AGENTS_DIR, entry.name, 'AGENTS.md');
    let raw: string;
    try {
      raw = await readFile(agentPath, 'utf8');
    } catch {
      continue;
    }
    const skills = parseSkillsList(raw);
    for (const slug of skills) agentSkillSlugs.add(slug);
  }

  // --- Read all server/skills/*.md files ---
  const skillFiles = (await readdir(SKILLS_DIR)).filter(f => f.endsWith('.md'));
  const skillFileSlugs = new Set(skillFiles.map(f => f.slice(0, -3)));

  // --- Read actionRegistry.ts source for comment checks ---
  const registrySource = await readFile(ACTION_REGISTRY_PATH, 'utf8');

  // --- Assertion 1–3: every agent skill has skill file, registry entry, handler ---
  for (const slug of agentSkillSlugs) {
    if (!skillFileSlugs.has(slug)) {
      violations.push(`[contract] agent declares skill '${slug}' but server/skills/${slug}.md does not exist`);
      continue;
    }

    // Check skill file has valid frontmatter with visibility:
    const skillRaw = await readFile(join(SKILLS_DIR, `${slug}.md`), 'utf8');
    const fm = parseFrontmatter(skillRaw);
    if (fm['visibility'] === undefined) {
      violations.push(`[contract] server/skills/${slug}.md is missing 'visibility:' frontmatter`);
    }

    if (!(slug in ACTION_REGISTRY)) {
      violations.push(`[contract] agent declares skill '${slug}' but it has no entry in ACTION_REGISTRY`);
    }

    if (!(slug in SKILL_HANDLERS)) {
      violations.push(`[contract] agent declares skill '${slug}' but it has no entry in SKILL_HANDLERS`);
    }
  }

  // --- Assertion 4: every skill .md is referenced by an agent OR is reusable: true ---
  for (const slug of skillFileSlugs) {
    if (!agentSkillSlugs.has(slug)) {
      const skillRaw = await readFile(join(SKILLS_DIR, `${slug}.md`), 'utf8');
      const fm = parseFrontmatter(skillRaw);
      if (fm['reusable'] !== true) {
        violations.push(`[contract] server/skills/${slug}.md is not referenced by any agent and does not declare reusable: true`);
      }
    }
  }

  // --- Assertion 5: every APP_FOUNDATIONAL_SKILLS entry is self-contained ---
  for (const slug of APP_FOUNDATIONAL_SKILLS) {
    const entry = ACTION_REGISTRY[slug as keyof typeof ACTION_REGISTRY] as Record<string, unknown> | undefined;
    if (!entry) {
      violations.push(`[foundational] '${slug}' is in APP_FOUNDATIONAL_SKILLS but missing from ACTION_REGISTRY`);
      continue;
    }
    const isApiCategory = (entry as { actionCategory?: string }).actionCategory === 'api';
    const openWorldHint = ((entry as { mcp?: { annotations?: { openWorldHint?: boolean } } }).mcp?.annotations?.openWorldHint) === true;
    const directExternal = (entry as { directExternalSideEffect?: boolean }).directExternalSideEffect === true;
    if (isApiCategory || openWorldHint || directExternal) {
      violations.push(`[foundational] '${slug}' must not have external integrations (actionCategory=${(entry as { actionCategory?: string }).actionCategory}, openWorldHint=${openWorldHint}, directExternalSideEffect=${directExternal})`);
    }
  }

  // --- Assertion 6: every 'write' skill declares reclaimEligibility ---
  for (const [slug, entry] of Object.entries(ACTION_REGISTRY)) {
    const e = entry as Record<string, unknown>;
    if ((e as { sideEffectClass?: string }).sideEffectClass !== 'write') continue;

    const idempotency = (e as { idempotency?: Record<string, unknown> }).idempotency;
    if (!idempotency) {
      violations.push(`[idempotency] '${slug}' has sideEffectClass='write' but no idempotency block`);
      continue;
    }
    if (idempotency['reclaimEligibility'] === undefined) {
      violations.push(`[idempotency] '${slug}' has sideEffectClass='write' but idempotency.reclaimEligibility is not declared (must be 'eligible' | 'disabled')`);
      continue;
    }

    // --- Assertion 7: 'eligible' declarations must have a justification comment ---
    if (idempotency['reclaimEligibility'] === 'eligible') {
      // Find the line(s) referencing this slug and reclaimEligibility in the source
      const lines = registrySource.split('\n');
      const slugBlockStart = lines.findIndex(l => l.includes(`'${slug}'`) || l.includes(`"${slug}"`));
      if (slugBlockStart === -1) continue;
      // Check within 100 lines of the slug entry for a reclaimEligibility line with a comment
      const window = lines.slice(slugBlockStart, slugBlockStart + 100).join('\n');
      const hasComment = /reclaimEligibility.*(?:\/\/|justification:)/.test(window);
      if (!hasComment) {
        violations.push(`[idempotency] '${slug}' declares reclaimEligibility: 'eligible' but the actionRegistry.ts entry has no annotation comment (runtime-budget or justification) on that line`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(`\n✗ verify-agent-skill-contracts: ${violations.length} violation(s):\n`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error('');
    process.exit(1);
  }

  console.log(`✓ verify-agent-skill-contracts: all green (${agentSkillSlugs.size} agent skills, ${skillFileSlugs.size} skill files)`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
