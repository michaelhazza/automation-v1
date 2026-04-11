/**
 * scripts/seed.ts — MASTER SEED SCRIPT
 *
 * Single source of truth for bootstrapping an Automation OS database (local dev
 * or production). Replaces the prior collection of per-feature seed scripts:
 *
 *   - scripts/seed-system.ts                  → Phases 1, 2
 *   - scripts/seed-local.ts                   → Phase 5 (partial — dev org + user)
 *   - scripts/seed-playbook-author.ts         → Phase 3
 *   - scripts/seed-playbooks.ts               → Phase 4 (discovery + upsert)
 *   - scripts/seed-portfolio-health-playbook.ts → Phase 4 (portfolio-health template)
 *   - scripts/seed-42macro-reporting-agent.ts → Phase 5 (reporting agent + integrations)
 *
 * Every phase is idempotent — safe to re-run. Each phase upserts its rows
 * rather than insert-and-crash-on-conflict, so running against an already-seeded
 * DB applies any drift (new agents, renamed skills, etc.) without manual cleanup.
 *
 *
 * Phases:
 *   [1/5] System bootstrap
 *         - system organisation ("System")
 *         - system admin user
 *
 *   [2/5] System agents (Automation OS company — the 16 business agents)
 *         - reads companies/automation-os/COMPANY.md and agents/<slug>/AGENTS.md
 *         - upserts 16 rows into system_agents
 *         - sets up the reportsTo hierarchy
 *
 *   [3/5] Playbook Author system agent (separate — Studio tool runner)
 *         - reads server/agents/playbook-author/master-prompt.md
 *         - upserts a 17th system_agents row (isSystemManaged: true)
 *         - wires the 5 playbook_* Studio tool skills
 *
 *   [4/5] Playbook templates
 *         - discovers server/playbooks/*.playbook.ts, imports each, and upserts
 *           via playbookTemplateService (DAG-validated)
 *         - seeds the portfolio-health-sweep template directly (non-standard
 *           agentRef that bypasses the standard validator — preserved as-is)
 *
 *   [5/5] Dev fixtures (skipped in production)
 *         - Breakout Solutions organisation + org admin user
 *         - 42macro-tracking subaccount
 *         - Reporting Agent (subaccount agent, wired with reporting skill bundle)
 *         - subaccount_agent link
 *         - integration_connection placeholders (web_login + slack, status=error)
 *
 *
 * Usage:
 *   # Full dev seed (includes Breakout Solutions demo org + reporting agent)
 *   npx tsx scripts/seed.ts
 *
 *   # Production seed — Phases 1-4 only, no dev fixtures
 *   npx tsx scripts/seed.ts --production
 *   NODE_ENV=production npx tsx scripts/seed.ts
 *
 *
 * Environment variables:
 *   DATABASE_URL          (required) — postgres connection string
 *   SYSTEM_ADMIN_EMAIL    (optional, default: admin@automation.os)
 *   SYSTEM_ADMIN_PASSWORD (optional, default: Admin123!, REQUIRED in production)
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { readdir, readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { pathToFileURL } from 'url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { and, eq, isNull } from 'drizzle-orm';
import { glob } from 'glob';
import bcrypt from 'bcryptjs';

import { organisations } from '../server/db/schema/organisations.js';
import { users } from '../server/db/schema/users.js';
import { subaccounts } from '../server/db/schema/subaccounts.js';
import { agents } from '../server/db/schema/agents.js';
import { subaccountAgents } from '../server/db/schema/subaccountAgents.js';
import { integrationConnections } from '../server/db/schema/integrationConnections.js';
import {
  systemAgents,
  systemPlaybookTemplates,
  systemPlaybookTemplateVersions,
} from '../server/db/schema/index.js';
import { parseCompanyFolder, toSystemAgentRows, type ParsedCompany } from './lib/companyParser.js';
import { classifySkill } from './lib/skillClassification.js';
import { playbookTemplateService } from '../server/services/playbookTemplateService.js';
import type { PlaybookDefinition } from '../server/lib/playbook/types.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const IS_PRODUCTION =
  process.argv.includes('--production') || process.env.NODE_ENV === 'production';

function log(msg: string): void {
  console.log(msg);
}

function logPhase(num: number, total: number, label: string): void {
  console.log(`\n[${num}/${total}] ${label}`);
  console.log('  ' + '─'.repeat(label.length + 4));
}

/**
 * Preflight: verify every skill file in server/skills/ has an explicit
 * `visibility:` frontmatter entry that matches the classification in
 * scripts/lib/skillClassification.ts. Fails fast with a clear error if any
 * skill has drifted — the seed refuses to run against a codebase with a
 * broken classification so we never silently ship inconsistent state.
 */
async function preflightVerifySkillVisibility(): Promise<void> {
  const skillsDir = resolve(process.cwd(), 'server/skills');
  let files: string[];
  try {
    files = await readdir(skillsDir);
  } catch {
    throw new Error(`skills directory not found: ${skillsDir}`);
  }

  const violations: string[] = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    const slug = file.slice(0, -3);
    const raw = (await readFile(join(skillsDir, file), 'utf-8')).replace(/\r\n/g, '\n');

    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) {
      violations.push(`${slug}: no YAML frontmatter`);
      continue;
    }
    const visMatch = fmMatch[1].match(/^visibility:\s*(\S+)\s*$/m);
    if (!visMatch) {
      violations.push(`${slug}: missing 'visibility:' key`);
      continue;
    }

    const actual = visMatch[1];
    const { desired } = classifySkill(slug);
    if (actual !== desired) {
      violations.push(`${slug}: visibility is '${actual}', expected '${desired}'`);
    }
  }

  if (violations.length > 0) {
    console.error(
      `\n✗ preflight: ${violations.length} skill visibility violation(s):`,
    );
    for (const v of violations) console.error(`  - ${v}`);
    console.error('\nRun `npx tsx scripts/apply-skill-visibility.ts` to fix.');
    throw new Error('skill visibility classification drift — aborting seed');
  }
}

// ---------------------------------------------------------------------------
// Phase 1 — System bootstrap
// ---------------------------------------------------------------------------

async function phase1_systemBootstrap(): Promise<string> {
  logPhase(1, 5, 'System bootstrap');

  // 1a. System organisation — upsert
  const systemOrgId = await upsertOrganisation({
    name: 'System',
    slug: 'system',
    plan: 'agency',
    status: 'active',
  });

  // 1b. System admin user — upsert (password reset on re-run is intentional)
  const adminEmail = process.env.SYSTEM_ADMIN_EMAIL || 'admin@automation.os';
  const adminPassword = process.env.SYSTEM_ADMIN_PASSWORD || 'Admin123!';

  if (IS_PRODUCTION && !process.env.SYSTEM_ADMIN_PASSWORD) {
    throw new Error(
      'SYSTEM_ADMIN_PASSWORD must be set when running with --production or NODE_ENV=production',
    );
  }

  await upsertUser({
    organisationId: systemOrgId,
    email: adminEmail,
    password: adminPassword,
    firstName: 'System',
    lastName: 'Admin',
    role: 'system_admin',
  });

  return systemOrgId;
}

// ---------------------------------------------------------------------------
// Upsert helpers — used by Phase 1 and Phase 5
// ---------------------------------------------------------------------------

type OrgPlan = 'starter' | 'pro' | 'agency';
type OrgStatus = 'active' | 'suspended';
type UserRole = 'system_admin' | 'org_admin' | 'manager' | 'user' | 'client_user';
type SubaccountStatus = 'active' | 'suspended' | 'inactive';

/**
 * Upsert an organisation by slug. If a row with the given slug exists, update
 * the mutable fields (name, plan, status) to match the desired state. Otherwise
 * insert. Returns the organisation id.
 *
 * Soft-deleted orgs (deletedAt not null) are treated as not-existing and a
 * fresh row is created — the caller is bootstrapping a known state.
 */
async function upsertOrganisation(values: {
  name: string;
  slug: string;
  plan: OrgPlan;
  status: OrgStatus;
}): Promise<string> {
  const [existing] = await db
    .select()
    .from(organisations)
    .where(and(eq(organisations.slug, values.slug), isNull(organisations.deletedAt)))
    .limit(1);

  if (existing) {
    await db
      .update(organisations)
      .set({
        name: values.name,
        plan: values.plan,
        status: values.status,
        updatedAt: new Date(),
      })
      .where(eq(organisations.id, existing.id));
    log(`  [update] organisation '${values.slug}': ${existing.id}`);
    return existing.id;
  }

  const [inserted] = await db.insert(organisations).values(values).returning();
  log(`  [create] organisation '${values.slug}': ${inserted.id}`);
  return inserted.id;
}

/**
 * Upsert a user by email.
 *
 * On INSERT: uses the provided password to set `passwordHash`.
 *
 * On UPDATE: **deliberately does NOT overwrite** `passwordHash`. Re-running
 * the seed against a database where a user has changed their password via
 * the UI would otherwise silently revert it to the seed default. This
 * protection applies to both the system admin (Phase 1) and the dev org
 * admin (Phase 5) — seed password behaviour must be write-once.
 *
 * Other mutable fields (organisationId, firstName, lastName, role, status)
 * are always updated on re-run, so renaming or re-scoping a user still
 * takes effect.
 */
async function upsertUser(values: {
  organisationId: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}): Promise<void> {
  const [existing] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, values.email), isNull(users.deletedAt)))
    .limit(1);

  if (existing) {
    await db
      .update(users)
      .set({
        organisationId: values.organisationId,
        // passwordHash intentionally omitted — preserve any UI-changed password
        firstName: values.firstName,
        lastName: values.lastName,
        role: values.role,
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));
    log(`  [update] user '${values.email}': ${existing.id} (password preserved)`);
    return;
  }

  // New user — hash the provided password and insert.
  const passwordHash = await bcrypt.hash(values.password, 12);
  const [inserted] = await db
    .insert(users)
    .values({
      organisationId: values.organisationId,
      email: values.email,
      passwordHash,
      firstName: values.firstName,
      lastName: values.lastName,
      role: values.role,
      status: 'active',
    })
    .returning();
  log(`  [create] user '${values.email}': ${inserted.id}`);
}

/**
 * Upsert a subaccount by (organisationId, slug). Updates name and status on
 * existing rows. Returns the subaccount row.
 */
async function upsertSubaccount(values: {
  organisationId: string;
  name: string;
  slug: string;
  status: SubaccountStatus;
}): Promise<typeof subaccounts.$inferSelect> {
  const [existing] = await db
    .select()
    .from(subaccounts)
    .where(
      and(
        eq(subaccounts.organisationId, values.organisationId),
        eq(subaccounts.slug, values.slug),
        isNull(subaccounts.deletedAt),
      ),
    )
    .limit(1);

  if (existing) {
    const [refreshed] = await db
      .update(subaccounts)
      .set({ name: values.name, status: values.status, updatedAt: new Date() })
      .where(eq(subaccounts.id, existing.id))
      .returning();
    log(`  [update] subaccount '${values.slug}': ${existing.id}`);
    return refreshed;
  }

  const [inserted] = await db.insert(subaccounts).values(values).returning();
  log(`  [create] subaccount '${values.slug}': ${inserted.id}`);
  return inserted;
}

// ---------------------------------------------------------------------------
// Phase 2 — System agents from companies/automation-os/
// ---------------------------------------------------------------------------

async function phase2_systemAgents(): Promise<void> {
  logPhase(2, 5, 'System agents (Automation OS company)');

  const companyDir = resolve('companies/automation-os');
  let parsed: ParsedCompany;
  try {
    parsed = await parseCompanyFolder(companyDir);
  } catch (err) {
    throw new Error(`Failed to parse company folder at ${companyDir}: ${(err as Error).message}`);
  }

  log(`  Company: ${parsed.manifest.name} (v${parsed.manifest.version})`);
  log(`  Agents:  ${parsed.agents.length}`);

  const rows = toSystemAgentRows(parsed);
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const values = { ...row, updatedAt: new Date() };

    // Scope the lookup to non-deleted rows so a soft-deleted agent with the
    // same slug never gets silently resurrected by the subsequent UPDATE.
    const [existing] = await db
      .select({ id: systemAgents.id })
      .from(systemAgents)
      .where(and(eq(systemAgents.slug, row.slug), isNull(systemAgents.deletedAt)));

    if (existing) {
      await db
        .update(systemAgents)
        .set(values)
        .where(eq(systemAgents.id, existing.id));
      updated += 1;
    } else {
      await db.insert(systemAgents).values({ ...values, createdAt: new Date() });
      created += 1;
    }
  }

  log(`  [ok]   ${created} created, ${updated} updated`);

  // Hierarchy — set parentSystemAgentId based on reportsTo. Scope to non-deleted
  // rows so a soft-deleted row's id can never be used as a parent link.
  const allAgents = await db
    .select({ id: systemAgents.id, slug: systemAgents.slug })
    .from(systemAgents)
    .where(isNull(systemAgents.deletedAt));
  const slugToId = new Map(allAgents.map((a) => [a.slug, a.id]));

  let hierarchyUpdates = 0;
  let hierarchyClears = 0;
  let hierarchyWarnings = 0;

  for (const agent of parsed.agents) {
    // Always write parentSystemAgentId — either to the resolved parent id or
    // explicitly to null when reportsTo is absent. This ensures a stale parent
    // link is cleared when an agent's reportsTo is removed or set to null in
    // its AGENTS.md file (without this, the old link lingers forever).
    if (!agent.reportsTo || agent.reportsTo === 'null') {
      await db
        .update(systemAgents)
        .set({ parentSystemAgentId: null })
        .where(eq(systemAgents.slug, agent.slug));
      hierarchyClears += 1;
      continue;
    }

    const parentId = slugToId.get(agent.reportsTo);
    if (!parentId) {
      log(`  [warn] reportsTo slug not found: ${agent.reportsTo} (for ${agent.slug})`);
      hierarchyWarnings += 1;
      continue;
    }

    await db
      .update(systemAgents)
      .set({ parentSystemAgentId: parentId })
      .where(eq(systemAgents.slug, agent.slug));
    hierarchyUpdates += 1;
  }

  log(
    `  [ok]   hierarchy: ${hierarchyUpdates} set, ${hierarchyClears} cleared${hierarchyWarnings ? `, ${hierarchyWarnings} warnings` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// Phase 3 — Playbook Author system agent
// ---------------------------------------------------------------------------

async function phase3_playbookAuthor(): Promise<void> {
  logPhase(3, 5, 'Playbook Author system agent');

  const SLUG = 'playbook-author';
  const PROMPT_PATH = resolve(process.cwd(), 'server/agents/playbook-author/master-prompt.md');
  const TOOL_SKILLS = [
    'playbook_read_existing',
    'playbook_validate',
    'playbook_simulate',
    'playbook_estimate_cost',
    'playbook_propose_save',
  ];

  if (!existsSync(PROMPT_PATH)) {
    log(`  [warn] master prompt missing at ${PROMPT_PATH} — skipping`);
    return;
  }
  const masterPrompt = readFileSync(PROMPT_PATH, 'utf8');

  const description =
    'System agent that helps platform admins create new Playbook templates via chat. ' +
    'Uses the 5 Playbook Studio tools (read_existing, validate, simulate, estimate_cost, ' +
    'propose_save) and never writes files itself.';

  // Scope the lookup so a soft-deleted Playbook Author row never gets
  // silently resurrected.
  const [existing] = await db
    .select()
    .from(systemAgents)
    .where(and(eq(systemAgents.slug, SLUG), isNull(systemAgents.deletedAt)));

  if (!existing) {
    const [created] = await db
      .insert(systemAgents)
      .values({
        name: 'Playbook Author',
        slug: SLUG,
        description,
        masterPrompt,
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        temperature: 0.3,
        maxTokens: 8192,
        defaultSystemSkillSlugs: TOOL_SKILLS,
        defaultOrgSkillSlugs: [],
        allowModelOverride: false,
        defaultTokenBudget: 50000,
        defaultMaxToolCalls: 30,
        executionMode: 'api',
        isSystemManaged: true,
        isPublished: true,
      } as never)
      .returning();
    log(`  [ok]   Created Playbook Author system agent: ${created.id}`);
    return;
  }

  await db
    .update(systemAgents)
    .set({
      name: 'Playbook Author',
      masterPrompt,
      defaultSystemSkillSlugs: TOOL_SKILLS,
      updatedAt: new Date(),
    } as never)
    .where(eq(systemAgents.id, existing.id));
  log(`  [ok]   Updated existing Playbook Author system agent: ${existing.id}`);
}

// ---------------------------------------------------------------------------
// Phase 4 — Playbook templates
// ---------------------------------------------------------------------------

async function phase4_playbookTemplates(): Promise<void> {
  logPhase(4, 5, 'Playbook templates');

  await seedPlaybookFiles();
  await seedPortfolioHealthPlaybook();
}

async function seedPlaybookFiles(): Promise<void> {
  const PLAYBOOKS_GLOB = 'server/playbooks/*.playbook.ts';
  const cwd = process.cwd();
  const files = (await glob(PLAYBOOKS_GLOB, { cwd, absolute: true })).sort();

  if (files.length === 0) {
    log(`  [skip] no playbook files at ${PLAYBOOKS_GLOB}`);
    return;
  }

  log(`  Discovered ${files.length} playbook file(s)`);

  const summary = { created: 0, updated: 0, skipped: 0, failed: 0 };
  const failures: { file: string; error: string }[] = [];

  for (const file of files) {
    const relPath = file.replace(cwd + '/', '').replace(/\\/g, '/');
    try {
      const mod = await import(pathToFileURL(file).href);
      const def: PlaybookDefinition | undefined = mod.default;
      if (!def) throw new Error('file has no default export');
      const outcome = await playbookTemplateService.upsertSystemTemplate(def);
      summary[outcome] += 1;
    } catch (err) {
      summary.failed += 1;
      const e = err as { message?: string };
      failures.push({ file: relPath, error: e.message ?? String(err) });
    }
  }

  log(
    `  [ok]   templates: ${summary.created} created, ${summary.updated} updated, ${summary.skipped} skipped${summary.failed ? `, ${summary.failed} failed` : ''}`,
  );

  if (failures.length > 0) {
    for (const f of failures) {
      log(`  [err]  ${f.file}: ${f.error}`);
    }
    throw new Error(`${failures.length} playbook template(s) failed to seed`);
  }
}

async function seedPortfolioHealthPlaybook(): Promise<void> {
  const TEMPLATE_SLUG = 'portfolio-health-sweep';
  const TEMPLATE_NAME = 'Portfolio Health Sweep';

  // NOTE: This template uses a non-standard agentRef that does not resolve
  // through the normal playbook validator (agentRef.slug 'reporting-agent'
  // is a subaccount agent, not a system agent). Preserved from the original
  // seed-portfolio-health-playbook.ts to avoid regressing existing behaviour.
  // Fixing the agentRef is tracked as a separate concern.
  const definition = {
    name: TEMPLATE_NAME,
    description:
      'Enumerate active subaccounts and run health checks in parallel via bulk mode. ' +
      'A synthesis step waits for all per-subaccount results before generating the portfolio report.',
    initialInputSchema: { type: 'object', properties: {}, required: [] },
    maxParallelSteps: 8,
    steps: [
      {
        id: 'enumerate_subaccounts',
        name: 'List active subaccounts',
        type: 'agent_call',
        dependsOn: [],
        sideEffectType: 'none',
        agentRef: { kind: 'system', slug: 'reporting-agent' },
        agentInputs: { skill: 'list_active_subaccounts' },
        outputSchema: {
          type: 'object',
          properties: { subaccountIds: { type: 'array', items: { type: 'string' } } },
        },
      },
      {
        id: 'synthesise',
        name: 'Generate portfolio report',
        type: 'agent_call',
        dependsOn: ['enumerate_subaccounts'],
        sideEffectType: 'none',
        agentRef: { kind: 'system', slug: 'reporting-agent' },
        agentInputs: {
          skill: 'generate_portfolio_report',
          context: '{{ steps.enumerate_subaccounts.output }}',
        },
      },
    ],
  };

  // Upsert template row
  const [existing] = await db
    .select()
    .from(systemPlaybookTemplates)
    .where(eq(systemPlaybookTemplates.slug, TEMPLATE_SLUG));

  let templateId: string;
  if (existing) {
    templateId = existing.id;
    await db
      .update(systemPlaybookTemplates)
      .set({
        name: TEMPLATE_NAME,
        description: definition.description,
        updatedAt: new Date(),
      })
      .where(eq(systemPlaybookTemplates.id, existing.id));
    log(`  [update] portfolio-health-sweep template: ${templateId}`);
  } else {
    const [row] = await db
      .insert(systemPlaybookTemplates)
      .values({
        slug: TEMPLATE_SLUG,
        name: TEMPLATE_NAME,
        description: definition.description,
      })
      .returning();
    templateId = row.id;
    log(`  [create] portfolio-health-sweep template: ${templateId}`);
  }

  // Upsert v1 of the definition. Note: the schema uses systemTemplateId
  // (not templateId) and has no updatedAt / status columns on the version row.
  const [existingVersion] = await db
    .select()
    .from(systemPlaybookTemplateVersions)
    .where(eq(systemPlaybookTemplateVersions.systemTemplateId, templateId));

  if (existingVersion) {
    await db
      .update(systemPlaybookTemplateVersions)
      .set({
        definitionJson: definition as unknown as Record<string, unknown>,
      })
      .where(eq(systemPlaybookTemplateVersions.id, existingVersion.id));
    log(`  [update] portfolio-health-sweep v${existingVersion.version}`);
  } else {
    await db.insert(systemPlaybookTemplateVersions).values({
      systemTemplateId: templateId,
      version: 1,
      definitionJson: definition as unknown as Record<string, unknown>,
    });
    // Bump latestVersion on parent template to match.
    await db
      .update(systemPlaybookTemplates)
      .set({ latestVersion: 1, updatedAt: new Date() })
      .where(eq(systemPlaybookTemplates.id, templateId));
    log(`  [create] portfolio-health-sweep v1`);
  }
}

// ---------------------------------------------------------------------------
// Phase 5 — Dev fixtures (Breakout Solutions demo org)
// ---------------------------------------------------------------------------

async function phase5_devFixtures(): Promise<void> {
  logPhase(5, 5, 'Dev fixtures (Breakout Solutions demo org)');

  const ORG_NAME = 'Breakout Solutions';
  const ORG_SLUG = 'breakout-solutions';
  const ORG_ADMIN_EMAIL = 'michael@breakoutsolutions.com';
  const ORG_ADMIN_PASSWORD = 'Zu5QzB5vG8!2';
  const SUBACCOUNT_NAME = 'Breakout Solutions';
  const SUBACCOUNT_SLUG = '42macro-tracking';
  const AGENT_SLUG = 'reporting-agent';
  const LEGACY_AGENT_SLUG = '42macro-reporting-agent';

  // 5a. Organisation — upsert
  const orgId = await upsertOrganisation({
    name: ORG_NAME,
    slug: ORG_SLUG,
    plan: 'agency',
    status: 'active',
  });
  const [org] = await db
    .select()
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .limit(1);

  // 5b. Org admin — upsert
  await upsertUser({
    organisationId: org.id,
    email: ORG_ADMIN_EMAIL,
    password: ORG_ADMIN_PASSWORD,
    firstName: 'Michael',
    lastName: 'Admin',
    role: 'org_admin',
  });

  // 5c. Subaccount — upsert
  const subaccount = await upsertSubaccount({
    organisationId: org.id,
    name: SUBACCOUNT_NAME,
    slug: SUBACCOUNT_SLUG,
    status: 'active',
  });

  // 5d. Reporting Agent (subaccount-level agent, not a system agent)
  const SKILL_SLUGS = [
    'fetch_paywalled_content',
    'fetch_url',
    'web_search',
    'transcribe_audio',
    'analyse_42macro_transcript',
    'send_to_slack',
    'send_email',
    'add_deliverable',
  ];

  const AGENT_MASTER_PROMPT = `You are the Reporting Agent.

Your job: turn an external source (a paywalled video, a public webpage, a research
note, a transcript, etc.) into a clear written report and publish it to the right
channel (Slack, email, deliverable, task). You are domain-agnostic. Specialised
analysis lenses live in your skill list — when a lens matches the source, follow
the recipe in that skill's description.

GENERAL FLOW

You are usually given a source and a destination. Pick the right skills for each step:

  1. ACQUIRE the source
       - fetch_paywalled_content   → sources behind a login (uses a stored
                                     web_login connection; supports download
                                     buttons and snoop-the-network video capture)
       - fetch_url                 → public webpages and direct file URLs
       - web_search                → when you need to discover the source

  2. CONVERT to text
       - transcribe_audio          → audio or video artifacts (Whisper)
       - the result of fetch_url   → already text for HTML pages

  3. ANALYSE
       - If a specialised analysis skill (a "lens") matches the source's topic,
         use it. The lens skill's description tells you exactly which upstream
         fetch params to use, what to pass in, and what it returns.
       - Otherwise produce a plain-language summary in your own words: a one-line
         dashboard, a three-paragraph executive summary, and a sectioned full
         analysis.

  4. PUBLISH
       - send_to_slack             → channel post (most common)
       - send_email                → email recipients
       - add_deliverable           → attach to a task as a deliverable

Hard rules:
  - Run the steps in order. Do not analyse before you have text. Do not publish
    before you have an analysis.
  - If any step returns a failure, stop and report the failure with the structured
    failureReason. Do not retry by hand.
  - If a fetch returns { noNewContent: true } the dedup fingerprint matched — emit
    \`done\` immediately. Do not re-process.
  - Plain language is the highest priority for written output. Explain every
    technical term in everyday English.
  - You explain and translate; you do not give personalised financial advice.

When a specialised analysis lens is available for the current source, prefer it
over a generic summary — the lens carries domain expertise and a structured output
format. Read the skill description before invoking it; the description includes
the upstream fetch recipe needed to produce the right input.

Emit \`done\` once the publish step returns a permalink / message id / deliverable id.`;

  const AGENT_DESCRIPTION =
    'Generic reporting agent: acquire a source (paywalled or public), convert to text, ' +
    'analyse it (with specialised lenses where available — currently 42 Macro), and ' +
    'publish to Slack / email / deliverable. Idempotent via content-hash fingerprint.';

  // Prefer new slug; fall back to legacy slug for migration; else create.
  let existingAgents = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.organisationId, org.id),
        eq(agents.slug, AGENT_SLUG),
        isNull(agents.deletedAt),
      ),
    )
    .limit(1);

  if (existingAgents.length === 0) {
    const legacyAgents = await db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.organisationId, org.id),
          eq(agents.slug, LEGACY_AGENT_SLUG),
          isNull(agents.deletedAt),
        ),
      )
      .limit(1);
    if (legacyAgents.length > 0) {
      log(`  [migrate] legacy agent slug ${LEGACY_AGENT_SLUG} → ${AGENT_SLUG}`);
      existingAgents = legacyAgents;
    }
  }

  let agent: typeof agents.$inferSelect;
  if (existingAgents.length > 0) {
    await db
      .update(agents)
      .set({
        name: 'Reporting Agent',
        slug: AGENT_SLUG,
        description: AGENT_DESCRIPTION,
        icon: '📊',
        masterPrompt: AGENT_MASTER_PROMPT,
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        defaultSkillSlugs: SKILL_SLUGS,
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(agents.id, existingAgents[0].id));
    const [refreshed] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, existingAgents[0].id))
      .limit(1);
    agent = refreshed;
    log(`  [ok]   Updated Reporting Agent: ${agent.id}`);
  } else {
    const [row] = await db
      .insert(agents)
      .values({
        organisationId: org.id,
        name: 'Reporting Agent',
        slug: AGENT_SLUG,
        description: AGENT_DESCRIPTION,
        icon: '📊',
        masterPrompt: AGENT_MASTER_PROMPT,
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        temperature: 0.3,
        maxTokens: 8192,
        responseMode: 'precise',
        outputSize: 'extended',
        defaultSkillSlugs: SKILL_SLUGS,
        status: 'active',
      })
      .returning();
    agent = row;
    log(`  [ok]   Created Reporting Agent: ${agent.id}`);
  }

  // 5e. Subaccount agent link
  const existingSAA = await db
    .select()
    .from(subaccountAgents)
    .where(
      and(
        eq(subaccountAgents.subaccountId, subaccount.id),
        eq(subaccountAgents.agentId, agent.id),
      ),
    )
    .limit(1);

  if (existingSAA.length > 0) {
    await db
      .update(subaccountAgents)
      .set({
        isActive: true,
        skillSlugs: SKILL_SLUGS,
        maxCostPerRunCents: 500,
        tokenBudgetPerRun: 60_000,
        maxToolCallsPerRun: 12,
        timeoutSeconds: 900,
        updatedAt: new Date(),
      })
      .where(eq(subaccountAgents.id, existingSAA[0].id));
    log(`  [ok]   Updated subaccount_agent link: ${existingSAA[0].id}`);
  } else {
    const [row] = await db
      .insert(subaccountAgents)
      .values({
        organisationId: org.id,
        subaccountId: subaccount.id,
        agentId: agent.id,
        isActive: true,
        skillSlugs: SKILL_SLUGS,
        maxCostPerRunCents: 500,
        tokenBudgetPerRun: 60_000,
        maxToolCallsPerRun: 12,
        timeoutSeconds: 900,
      })
      .returning();
    log(`  [ok]   Created subaccount_agent link: ${row.id}`);
  }

  // 5f. Integration connection placeholders.
  //
  //     DELIBERATELY uses onConflictDoNothing, NOT upsert.
  //
  //     These rows start with secretsRef='PLACEHOLDER_...' and connectionStatus='error'.
  //     Once you fill in real credentials via the UI (or manually in the DB), the
  //     placeholder is replaced with real encrypted secrets. Re-running the seed
  //     must NOT overwrite those real secrets — doing so would silently destroy
  //     working integrations. If you need to reset a connection to placeholder,
  //     delete the row manually and re-run the seed.
  await db
    .insert(integrationConnections)
    .values({
      organisationId: org.id,
      subaccountId: subaccount.id,
      providerType: 'web_login',
      authType: 'service_account',
      label: '42 Macro paywall login',
      connectionStatus: 'error',
      configJson: {
        loginUrl: 'https://42macro.com/login',
        username: 'PLACEHOLDER@example.com',
        usernameSelector: null,
        passwordSelector: null,
        submitSelector: null,
        successSelector: null,
        timeoutMs: 30_000,
      },
      secretsRef: 'PLACEHOLDER_REPLACE_WITH_ENCRYPTED_PASSWORD',
    })
    .onConflictDoNothing();

  await db
    .insert(integrationConnections)
    .values({
      organisationId: org.id,
      subaccountId: subaccount.id,
      providerType: 'slack',
      authType: 'oauth2',
      label: 'Breakout Solutions Slack',
      connectionStatus: 'error',
      configJson: { defaultChannel: '#42macro-reports' },
      secretsRef: 'PLACEHOLDER_REPLACE_WITH_SLACK_BOT_TOKEN',
    })
    .onConflictDoNothing();

  log(`  [ok]   integration_connections (placeholders, status='error')`);

  // 5g. Activate baseline system agents in the dev org — one `agents` row
  //     per system agent with `systemAgentId` linking back to the authoritative
  //     `system_agents` definition. Org admins inherit masterPrompt and skills
  //     via isSystemManaged=true and can only layer an additionalPrompt on top.
  await activateBaselineSystemAgents(org.id, subaccount.id);
}

/**
 * For each system agent, upsert a corresponding `agents` row in the given
 * organisation (linked via systemAgentId) and, for subaccount-scoped agents,
 * link it into the given subaccount via `subaccount_agents`.
 *
 * Org-scoped system agents (executionScope: 'org' — e.g. portfolio-health-agent)
 * are activated at org level but NOT linked to the subaccount, matching how
 * they run in production.
 */
async function activateBaselineSystemAgents(
  organisationId: string,
  subaccountId: string,
): Promise<void> {
  log('\n  Activating baseline system agents in dev org...');

  const allSystemAgents = await db
    .select()
    .from(systemAgents)
    .where(and(eq(systemAgents.status, 'active'), isNull(systemAgents.deletedAt)));

  if (allSystemAgents.length === 0) {
    log('  [warn] no system agents found — did Phase 2/3 run?');
    return;
  }

  let orgAgentsCreated = 0;
  let orgAgentsUpdated = 0;
  let subaccountLinksCreated = 0;
  let subaccountLinksUpdated = 0;
  let orgScopedSkipped = 0;

  // Pre-fetch every existing non-system-managed agent in this org. Any slug
  // that already belongs to a custom (non-system-managed) agent is off-limits
  // to the baseline activation loop — overwriting it would destroy user
  // customisation. This generalises the Reporting Agent slug-collision case
  // (the Reporting Agent is created in Phase 5d as a non-system-managed
  // custom agent with slug 'reporting-agent') without hardcoding the slug.
  const existingCustomAgents = await db
    .select({ slug: agents.slug })
    .from(agents)
    .where(
      and(
        eq(agents.organisationId, organisationId),
        eq(agents.isSystemManaged, false),
        isNull(agents.deletedAt),
      ),
    );
  const customSlugs = new Set(existingCustomAgents.map((a) => a.slug));

  for (const sysAgent of allSystemAgents) {
    // Skip any slug that collides with a custom (non-system-managed) agent
    // already in this org. Covers the Reporting Agent case and any future
    // situation where a custom agent happens to share a slug with a system
    // agent — the custom agent wins, the system agent is left alone.
    if (customSlugs.has(sysAgent.slug)) continue;

    // Upsert the org-level agent row (agents table)
    const [existingOrgAgent] = await db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.organisationId, organisationId),
          eq(agents.slug, sysAgent.slug),
          isNull(agents.deletedAt),
        ),
      )
      .limit(1);

    let orgAgentId: string;

    if (existingOrgAgent) {
      await db
        .update(agents)
        .set({
          systemAgentId: sysAgent.id,
          isSystemManaged: true,
          name: sysAgent.name,
          description: sysAgent.description ?? null,
          icon: sysAgent.icon ?? null,
          agentRole: sysAgent.agentRole ?? null,
          agentTitle: sysAgent.agentTitle ?? null,
          modelProvider: sysAgent.modelProvider,
          modelId: sysAgent.modelId,
          temperature: sysAgent.temperature,
          maxTokens: sysAgent.maxTokens,
          defaultSkillSlugs: sysAgent.defaultSystemSkillSlugs ?? [],
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(agents.id, existingOrgAgent.id));
      orgAgentId = existingOrgAgent.id;
      orgAgentsUpdated += 1;
    } else {
      const [inserted] = await db
        .insert(agents)
        .values({
          organisationId,
          systemAgentId: sysAgent.id,
          isSystemManaged: true,
          name: sysAgent.name,
          slug: sysAgent.slug,
          description: sysAgent.description ?? null,
          icon: sysAgent.icon ?? null,
          agentRole: sysAgent.agentRole ?? null,
          agentTitle: sysAgent.agentTitle ?? null,
          masterPrompt: '', // system-managed agents inherit masterPrompt at runtime
          additionalPrompt: '',
          modelProvider: sysAgent.modelProvider,
          modelId: sysAgent.modelId,
          temperature: sysAgent.temperature,
          maxTokens: sysAgent.maxTokens,
          defaultSkillSlugs: sysAgent.defaultSystemSkillSlugs ?? [],
          status: 'active',
        })
        .returning({ id: agents.id });
      orgAgentId = inserted.id;
      orgAgentsCreated += 1;
    }

    // Org-scoped agents (e.g. portfolio-health-agent) do not get a subaccount
    // link — they operate against all subaccounts at org level. If an agent
    // has flipped from subaccount to org scope since the last seed run, any
    // existing active subaccount_agents row for it must be deactivated so
    // the link doesn't linger as a false-positive "active at subaccount".
    if (sysAgent.executionScope === 'org') {
      await db
        .update(subaccountAgents)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(subaccountAgents.subaccountId, subaccountId),
            eq(subaccountAgents.agentId, orgAgentId),
            eq(subaccountAgents.isActive, true),
          ),
        );
      orgScopedSkipped += 1;
      continue;
    }

    // Upsert the subaccount_agents link row
    const skillSlugs = sysAgent.defaultSystemSkillSlugs ?? [];
    const [existingLink] = await db
      .select()
      .from(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.subaccountId, subaccountId),
          eq(subaccountAgents.agentId, orgAgentId),
        ),
      )
      .limit(1);

    if (existingLink) {
      // Refresh all mutable fields so upstream changes to the system agent's
      // default budgets propagate to every org. Without this, existing
      // subaccount links drift permanently from the current defaults.
      await db
        .update(subaccountAgents)
        .set({
          isActive: true,
          skillSlugs,
          tokenBudgetPerRun: sysAgent.defaultTokenBudget,
          maxToolCallsPerRun: sysAgent.defaultMaxToolCalls,
          updatedAt: new Date(),
        })
        .where(eq(subaccountAgents.id, existingLink.id));
      subaccountLinksUpdated += 1;
    } else {
      await db.insert(subaccountAgents).values({
        organisationId,
        subaccountId,
        agentId: orgAgentId,
        isActive: true,
        skillSlugs,
        tokenBudgetPerRun: sysAgent.defaultTokenBudget,
        maxToolCallsPerRun: sysAgent.defaultMaxToolCalls,
        timeoutSeconds: 300,
      });
      subaccountLinksCreated += 1;
    }
  }

  log(
    `  [ok]   org agents:         ${orgAgentsCreated} created, ${orgAgentsUpdated} updated`,
  );
  log(
    `  [ok]   subaccount links:   ${subaccountLinksCreated} created, ${subaccountLinksUpdated} updated`,
  );
  if (orgScopedSkipped > 0) {
    log(`  [ok]   org-scoped skipped: ${orgScopedSkipped} (activated at org only)`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startTime = Date.now();
  const mode = IS_PRODUCTION ? 'PRODUCTION' : 'DEV';
  console.log(`\n▸ Automation OS master seed — ${mode} mode`);

  // Pre-flight: fail fast if skill visibility has drifted from the
  // classification rule. Catches dev mistakes before any DB writes happen.
  await preflightVerifySkillVisibility();

  await phase1_systemBootstrap();
  await phase2_systemAgents();
  await phase3_playbookAuthor();
  await phase4_playbookTemplates();

  if (!IS_PRODUCTION) {
    await phase5_devFixtures();
  } else {
    console.log('\n[5/5] Dev fixtures — skipped (production mode)');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Seed complete in ${elapsed}s.`);

  if (!IS_PRODUCTION) {
    console.log('\nLogin:');
    console.log('  System Admin: admin@automation.os           / Admin123!');
    console.log('  Org Admin:    michael@breakoutsolutions.com / Zu5QzB5vG8!2');
    console.log(
      '\nReporting Agent integration placeholders are in place but inactive.',
    );
    console.log('Fill in real credentials before running it — see docs/setup-42macro-reporting-agent.md');
  }
}

main()
  .catch((err) => {
    console.error('\n✗ Seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
