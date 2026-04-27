/**
 * scripts/seed.ts — MASTER SEED SCRIPT
 *
 * Single source of truth for bootstrapping an Automation OS database (local dev
 * or production). Replaces the prior collection of per-feature seed scripts:
 *
 *   - scripts/seed-system.ts                  → Phases 1, 2
 *   - scripts/seed-local.ts                   → Phase 5 (partial — dev org + user)
 *   - scripts/seed-workflow-author.ts         → Phase 3
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
 *   [1/7] System bootstrap
 *         - system organisation ("System")
 *         - system admin user
 *
 *   [2/7] System agents (Automation OS company — the 16 business agents)
 *         - reads companies/automation-os/COMPANY.md and agents/<slug>/AGENTS.md
 *         - upserts 16 rows into system_agents
 *         - sets up the reportsTo hierarchy
 *
 *   [3/7] Playbook Author system agent (separate — Studio tool runner)
 *         - reads server/agents/workflow-author/master-prompt.md
 *         - upserts a 17th system_agents row
 *         - wires the 5 playbook_* Studio tool skills
 *
 *   [4/7] System Monitor system agent + skills
 *         - upserts the system_monitor system_agent row (master prompt from
 *           server/services/systemMonitor/triage/agentSystemPrompt.ts)
 *         - upserts 11 system_skills rows (9 read + 2 write)
 *         - upserts the system principal user in the system-ops org
 *         - upserts the org-side agents row in the system-ops org
 *
 *   [5/7] Playbook templates
 *         - discovers server/workflows/*.workflow.ts, imports each, and upserts
 *           via WorkflowTemplateService (DAG-validated)
 *         - seeds the portfolio-health-sweep template directly (non-standard
 *           agentRef that bypasses the standard validator — preserved as-is)
 *
 *   [6/7] Dev fixtures (skipped in production)
 *         - Synthetos organisation + org admin user
 *         - Synthetos Workspace subaccount (16 system agents activated here)
 *         - Breakout Solutions subaccount (reporting agent only — for testing)
 *         - Reporting Agent (subaccount agent, wired with reporting skill bundle)
 *         - subaccount_agent link
 *         - integration_connection placeholders (web_login + slack, status=error)
 *
 *   [7/7] Configuration Assistant runtime guidelines memory block
 *         - seeds the guidelines block for every org that has the
 *           Configuration Assistant agent activated
 *
 *
 * Usage:
 *   # Full dev seed (includes Synthetos demo org + reporting agent)
 *   npx tsx scripts/seed.ts
 *
 *   # Production seed — Phases 1-5 + 7 only, no dev fixtures
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
import { and, eq, inArray, isNull, not, sql } from 'drizzle-orm';
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
  systemSkills,
  systemWorkflowTemplates,
  systemWorkflowTemplateVersions,
} from '../server/db/schema/index.js';
import { modules } from '../server/db/schema/modules.js';
import { parseCompanyFolder, toSystemAgentRows, type ParsedCompany } from './lib/companyParser.js';
import { classifySkill } from './lib/skillClassification.js';
import { WorkflowTemplateService } from '../server/services/workflowTemplateService.js';
import type { WorkflowDefinition } from '../server/lib/workflow/types.js';
import { seedConfigAgentGuidelinesAll } from './seedConfigAgentGuidelines.js';
import {
  SYSTEM_MONITOR_SKILL_SEEDS,
  SYSTEM_MONITOR_SKILL_SLUGS,
  SYSTEM_PRINCIPAL_USER,
} from './lib/systemMonitorSeed.js';
import { SYSTEM_MONITOR_PROMPT } from '../server/services/systemMonitor/triage/agentSystemPrompt.js';

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
    if (slug === 'README') continue; // documentation file, not a skill
    const raw = (await readFile(join(skillsDir, file), 'utf-8')).replace(/\r\n/g, '\n');

    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
    if (!fmMatch) {
      // No frontmatter — legacy/documentation file, not a classified skill.
      // Warn but do not block the seed. Run verify-skill-visibility for details.
      log(`  [warn] skills/${slug}.md has no YAML frontmatter — skipping visibility check`);
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
  logPhase(1, 7, 'System bootstrap');

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
// Upsert helpers — used by Phase 1 and Phase 6
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
 * admin (Phase 6) — seed password behaviour must be write-once.
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
  logPhase(2, 7, 'System agents (Automation OS company)');

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
  logPhase(3, 7, 'Playbook Author system agent');

  const SLUG = 'workflow-author';
  const PROMPT_PATH = resolve(process.cwd(), 'server/agents/workflow-author/master-prompt.md');
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
  } else {
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

  // v7.1 — Orphan cleanup: soft-delete any system_agents row whose slug is
  // no longer in (parsed.agents.slug ∪ 'workflow-author'). Cascade soft-delete
  // to the matching `agents` rows and deactivate `subaccount_agents`.
  const companyDir = resolve(process.cwd(), 'companies/automation-os');
  const orphanParsed = await parseCompanyFolder(companyDir);
  const expectedSlugs = new Set([
    ...orphanParsed.agents.map((a) => a.slug),
    'workflow-author',
  ]);

  const orphanRows = await db
    .select({ slug: systemAgents.slug, id: systemAgents.id })
    .from(systemAgents)
    .where(and(
      isNull(systemAgents.deletedAt),
      not(inArray(systemAgents.slug, [...expectedSlugs])),
    ));

  if (orphanRows.length > 0) {
    log(`  [cleanup] soft-deleting ${orphanRows.length} orphan system_agents row(s): ${orphanRows.map((o) => o.slug).join(', ')}`);

    await db
      .update(systemAgents)
      .set({ deletedAt: new Date(), status: 'inactive', updatedAt: new Date() })
      .where(and(
        isNull(systemAgents.deletedAt),
        not(inArray(systemAgents.slug, [...expectedSlugs])),
      ));

    const orphanIds = orphanRows.map((o) => o.id);
    await db
      .update(agents)
      .set({ deletedAt: new Date(), status: 'inactive', updatedAt: new Date() })
      .where(and(
        isNull(agents.deletedAt),
        eq(agents.isSystemManaged, true),
        inArray(agents.systemAgentId, orphanIds),
      ));

    const orphanAgentRows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.isSystemManaged, true), inArray(agents.systemAgentId, orphanIds)));

    if (orphanAgentRows.length > 0) {
      await db
        .update(subaccountAgents)
        .set({ isActive: false, updatedAt: new Date() })
        .where(inArray(subaccountAgents.agentId, orphanAgentRows.map((a) => a.id)));
    }
  }

  // v7.1 — Hierarchy assertions (spec §13.4)
  const all = await db
    .select({
      id: systemAgents.id,
      slug: systemAgents.slug,
      parentId: systemAgents.parentSystemAgentId,
    })
    .from(systemAgents)
    .where(isNull(systemAgents.deletedAt));

  const byId = new Map(all.map((r) => [r.id, r]));

  // Assertion 1: exactly one business-team root (orchestrator)
  const businessRoots = all.filter(
    (r) =>
      r.parentId === null &&
      r.slug !== 'portfolio-health-agent' &&
      r.slug !== 'workflow-author',
  );
  if (businessRoots.length !== 1 || businessRoots[0].slug !== 'orchestrator') {
    throw new Error(
      `[hierarchy] expected exactly one business-team root 'orchestrator'; found ${businessRoots.length}: ${businessRoots.map((r) => r.slug).join(', ')}`,
    );
  }

  // Assertion 2: no cycles, depth ≤ 3 (max 2 hops from any leaf to root:
  //   Worker→Head→Orchestrator). Guard fires when hops ≥ 2 before making the
  //   hop — i.e. before taking a 3rd hop that would reach T4.
  for (const row of all) {
    if (row.slug === 'orchestrator' || row.slug === 'portfolio-health-agent' || row.slug === 'workflow-author') continue;
    let cur = row;
    let hops = 0;
    while (cur.parentId !== null) {
      if (hops >= 2) {
        throw new Error(`[hierarchy] depth > 3 from leaf '${row.slug}' — chain exceeds Orchestrator → Head → Worker`);
      }
      const parent = byId.get(cur.parentId);
      if (!parent) {
        throw new Error(`[hierarchy] '${cur.slug}' references non-existent or soft-deleted parent ${cur.parentId}`);
      }
      cur = parent;
      hops += 1;
    }
  }

  // Assertion 3: every non-root non-special agent has a non-null parent
  for (const row of all) {
    if (row.slug === 'orchestrator' || row.slug === 'portfolio-health-agent' || row.slug === 'workflow-author') continue;
    if (row.parentId === null) {
      throw new Error(`[hierarchy] '${row.slug}' has parent_system_agent_id = NULL but is not a designated root`);
    }
  }

  // Assertion 4: every T3 worker's parent is in the allowed T1/T2 parent set.
  // admin-ops-agent is `role: 'staff'` (per §10.1.5) but sits at T2 as a direct
  // report of Orchestrator — included as a future-proofing allowance for the
  // case where admin-ops grows worker subordinates without a spec amendment.
  const ALLOWED_T1_T2_PARENTS = new Set([
    'orchestrator',                  // T1 (sole)
    'head-of-product-engineering',   // T2 manager
    'head-of-growth',                // T2 manager
    'head-of-client-services',       // T2 manager
    'head-of-commercial',            // T2 manager
    'admin-ops-agent',               // T2 staff direct report (see comment above)
    'strategic-intelligence-agent',  // T2 direct report of Orchestrator
  ]);
  for (const row of all) {
    if (row.slug === 'orchestrator' || row.slug === 'portfolio-health-agent' || row.slug === 'workflow-author') continue;
    const parent = byId.get(row.parentId!);
    if (!parent) continue; // already reported by Assertion 2
    if (!ALLOWED_T1_T2_PARENTS.has(parent.slug)) {
      throw new Error(
        `[hierarchy] worker '${row.slug}' is parented to '${parent.slug}', which is not in the allowed T1/T2 parent set. ` +
        `A worker (T3) must report directly to the Orchestrator or a T2 agent listed in ALLOWED_T1_T2_PARENTS.`,
      );
    }
  }

  log('  [ok]   hierarchy assertions: 1 root, no cycles, depth ≤ 3, all parents present, every worker has exactly one parent in ALLOWED_T1_T2_PARENTS');
}

// ---------------------------------------------------------------------------
// Phase 4 — System Monitor system agent
// ---------------------------------------------------------------------------
// Seeds the system_monitor system agent, its 11 system_skills (9 read + 2
// write), the system principal user, and the org-side agents row in the
// system-ops org. Schema for these rows comes from migration 0233 (tables,
// columns, execution_scope='system' CHECK widening).

async function phase4_systemMonitor(): Promise<void> {
  logPhase(4, 7, 'System Monitor system agent + skills');

  const SLUG = 'system_monitor';

  // ── 1. Upsert the 11 system_monitor skills ────────────────────────────────
  let skillsCreated = 0;
  let skillsUpdated = 0;
  for (const seed of SYSTEM_MONITOR_SKILL_SEEDS) {
    const [existing] = await db
      .select({ id: systemSkills.id })
      .from(systemSkills)
      .where(eq(systemSkills.slug, seed.slug));

    if (existing) {
      await db
        .update(systemSkills)
        .set({
          name: seed.name,
          description: seed.description,
          definition: seed.definition,
          handlerKey: seed.handlerKey,
          sideEffects: seed.sideEffects,
          visibility: 'none',
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(systemSkills.id, existing.id));
      skillsUpdated += 1;
    } else {
      await db.insert(systemSkills).values({
        slug: seed.slug,
        handlerKey: seed.handlerKey,
        name: seed.name,
        description: seed.description,
        definition: seed.definition,
        sideEffects: seed.sideEffects,
        visibility: 'none',
        isActive: true,
      });
      skillsCreated += 1;
    }
  }
  log(`  [ok]   skills: ${skillsCreated} created, ${skillsUpdated} updated`);

  // ── 2. Upsert the system_monitor system_agent row ─────────────────────────
  const description =
    'Autonomous agent that diagnoses system incidents and generates investigation prompts.';

  const [existingAgent] = await db
    .select({ id: systemAgents.id })
    .from(systemAgents)
    .where(and(eq(systemAgents.slug, SLUG), isNull(systemAgents.deletedAt)));

  let systemAgentId: string;
  if (existingAgent) {
    await db
      .update(systemAgents)
      .set({
        name: 'System Monitor',
        description,
        masterPrompt: SYSTEM_MONITOR_PROMPT,
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        temperature: 0.3,
        maxTokens: 8096,
        defaultSystemSkillSlugs: SYSTEM_MONITOR_SKILL_SLUGS,
        executionScope: 'system',
        isPublished: true,
        status: 'active',
        updatedAt: new Date(),
      } as never)
      .where(eq(systemAgents.id, existingAgent.id));
    systemAgentId = existingAgent.id;
    log(`  [ok]   Updated system_monitor system agent: ${systemAgentId}`);
  } else {
    const [created] = await db
      .insert(systemAgents)
      .values({
        name: 'System Monitor',
        slug: SLUG,
        description,
        masterPrompt: SYSTEM_MONITOR_PROMPT,
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
        temperature: 0.3,
        maxTokens: 8096,
        defaultSystemSkillSlugs: SYSTEM_MONITOR_SKILL_SLUGS,
        executionScope: 'system',
        isPublished: true,
        version: 1,
        status: 'active',
      } as never)
      .returning({ id: systemAgents.id });
    systemAgentId = created.id;
    log(`  [ok]   Created system_monitor system agent: ${systemAgentId}`);
  }

  // ── 3. Resolve system-ops org (created by migration 0225) ─────────────────
  const [systemOrg] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.isSystemOrg, true));

  if (!systemOrg) {
    throw new Error(
      'system-ops organisation not found — migration 0225 should have created it. Has the migrate step run?',
    );
  }

  // ── 4. Upsert the system principal user ───────────────────────────────────
  // Owns system-initiated agent runs. Idempotent on the fixed UUID.
  await db
    .insert(users)
    .values({
      id: SYSTEM_PRINCIPAL_USER.id,
      organisationId: systemOrg.id,
      email: SYSTEM_PRINCIPAL_USER.email,
      passwordHash: SYSTEM_PRINCIPAL_USER.passwordHash,
      firstName: SYSTEM_PRINCIPAL_USER.firstName,
      lastName: SYSTEM_PRINCIPAL_USER.lastName,
      role: SYSTEM_PRINCIPAL_USER.role,
      status: SYSTEM_PRINCIPAL_USER.status,
    } as never)
    .onConflictDoNothing({ target: users.id });
  log(`  [ok]   System principal user: ${SYSTEM_PRINCIPAL_USER.email}`);

  // ── 5. Upsert the org-side agents row in system-ops ───────────────────────
  // The org-facing record linked to the system_monitor system agent.
  const [existingOrgAgent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.organisationId, systemOrg.id),
        eq(agents.slug, SLUG),
        isNull(agents.deletedAt),
      ),
    );

  if (existingOrgAgent) {
    await db
      .update(agents)
      .set({
        name: 'System Monitor',
        systemAgentId,
        isSystemManaged: true,
        status: 'active',
        updatedAt: new Date(),
      })
      .where(eq(agents.id, existingOrgAgent.id));
    log(`  [ok]   Updated system_monitor org agent: ${existingOrgAgent.id}`);
  } else {
    const [created] = await db
      .insert(agents)
      .values({
        organisationId: systemOrg.id,
        systemAgentId,
        isSystemManaged: true,
        name: 'System Monitor',
        slug: SLUG,
        masterPrompt: '',
        status: 'active',
      })
      .returning({ id: agents.id });
    log(`  [ok]   Created system_monitor org agent: ${created.id}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 5 — Playbook templates
// ---------------------------------------------------------------------------

async function phase5_playbookTemplates(): Promise<void> {
  logPhase(5, 7, 'Playbook templates');

  await seedPlaybookFiles();
  await seedPortfolioHealthPlaybook();
  await seedOnboardingModuleSlugs();
}

/**
 * Sets `onboarding_playbook_slugs` on the `client_pulse` module (Phase G / §10.6).
 * Idempotent — no-op when the slug is already present.
 */
async function seedOnboardingModuleSlugs(): Promise<void> {
  const REPORTING_MODULE_SLUG = 'client_pulse';
  const PLAYBOOK_SLUG = 'intelligence-briefing';

  const [mod] = await db
    .select({ id: modules.id, onboardingWorkflowSlugs: modules.onboardingWorkflowSlugs })
    .from(modules)
    .where(and(eq(modules.slug, REPORTING_MODULE_SLUG), isNull(modules.deletedAt)))
    .limit(1);

  if (!mod) {
    log(`  [skip] module '${REPORTING_MODULE_SLUG}' not found`);
    return;
  }

  const already = (mod.onboardingWorkflowSlugs ?? []).includes(PLAYBOOK_SLUG);
  if (already) {
    log(`  [skip] '${PLAYBOOK_SLUG}' already in '${REPORTING_MODULE_SLUG}'`);
    return;
  }

  await db
    .update(modules)
    .set({
      onboardingWorkflowSlugs: sql`array_append(${modules.onboardingWorkflowSlugs}, ${PLAYBOOK_SLUG})`,
      updatedAt: new Date(),
    })
    .where(eq(modules.id, mod.id));

  log(`  [ok]   added '${PLAYBOOK_SLUG}' to module '${REPORTING_MODULE_SLUG}'`);
}

async function seedPlaybookFiles(): Promise<void> {
  const WORKFLOWS_GLOB = 'server/workflows/*.workflow.ts';
  const cwd = process.cwd();
  const files = (await glob(WORKFLOWS_GLOB, { cwd, absolute: true })).sort();

  if (files.length === 0) {
    log(`  [skip] no workflow files at ${WORKFLOWS_GLOB}`);
    return;
  }

  log(`  Discovered ${files.length} workflow file(s)`);

  const summary = { created: 0, updated: 0, skipped: 0, failed: 0 };
  const failures: { file: string; error: string }[] = [];

  for (const file of files) {
    const relPath = file.replace(cwd + '/', '').replace(/\\/g, '/');
    try {
      const mod = await import(pathToFileURL(file).href);
      const def: WorkflowDefinition | undefined = mod.default;
      if (!def) throw new Error('file has no default export');
      const outcome = await WorkflowTemplateService.upsertSystemTemplate(def);
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

  // Two-step playbook against the portfolio-health-agent system agent:
  //   1. query_subaccount_cohort — returns health/activity summaries across
  //      every active subaccount in the org (empty tag_filters = all). This
  //      replaces the previous reference to a never-built 'list_active_subaccounts'
  //      skill and the previous (broken) 'reporting-agent' system slug.
  //   2. generate_portfolio_report — produces the briefing, consuming the
  //      cohort output as context.
  //
  // portfolio-health-agent is one of the 16 system agents seeded in Phase 2
  // and is org-scoped (executionScope: 'org'), which is the correct scope for
  // a cross-subaccount sweep.
  const definition = {
    name: TEMPLATE_NAME,
    description:
      'Query health, activity and pipeline metrics across every active subaccount in the org, ' +
      'then synthesise a portfolio-level intelligence briefing from the results. ' +
      'Runs at org scope via the portfolio-health-agent system agent.',
    initialInputSchema: { type: 'object', properties: {}, required: [] },
    maxParallelSteps: 8,
    steps: [
      {
        id: 'enumerate_subaccounts',
        name: 'Query active subaccount cohort',
        type: 'agent_call',
        dependsOn: [],
        sideEffectType: 'none',
        agentRef: { kind: 'system', slug: 'portfolio-health-agent' },
        agentInputs: {
          skill: 'query_subaccount_cohort',
          parameters: {
            // Empty filters → all active subaccounts in the org
            tag_filters: '[]',
            subaccount_ids: '[]',
            metric_focus: 'all',
          },
        },
      },
      {
        id: 'synthesise',
        name: 'Generate portfolio report',
        type: 'agent_call',
        dependsOn: ['enumerate_subaccounts'],
        sideEffectType: 'none',
        agentRef: { kind: 'system', slug: 'portfolio-health-agent' },
        agentInputs: {
          skill: 'generate_portfolio_report',
          parameters: {
            reporting_period_days: 7,
            format: 'structured',
            verbosity: 'standard',
          },
          context: '{{ steps.enumerate_subaccounts.output }}',
        },
      },
    ],
  };

  // Upsert template row
  const [existing] = await db
    .select()
    .from(systemWorkflowTemplates)
    .where(eq(systemWorkflowTemplates.slug, TEMPLATE_SLUG));

  let templateId: string;
  if (existing) {
    templateId = existing.id;
    await db
      .update(systemWorkflowTemplates)
      .set({
        name: TEMPLATE_NAME,
        description: definition.description,
        updatedAt: new Date(),
      })
      .where(eq(systemWorkflowTemplates.id, existing.id));
    log(`  [update] portfolio-health-sweep template: ${templateId}`);
  } else {
    const [row] = await db
      .insert(systemWorkflowTemplates)
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
    .from(systemWorkflowTemplateVersions)
    .where(eq(systemWorkflowTemplateVersions.systemTemplateId, templateId));

  if (existingVersion) {
    await db
      .update(systemWorkflowTemplateVersions)
      .set({
        definitionJson: definition as unknown as Record<string, unknown>,
      })
      .where(eq(systemWorkflowTemplateVersions.id, existingVersion.id));
    log(`  [update] portfolio-health-sweep v${existingVersion.version}`);
  } else {
    await db.insert(systemWorkflowTemplateVersions).values({
      systemTemplateId: templateId,
      version: 1,
      definitionJson: definition as unknown as Record<string, unknown>,
    });
    // Bump latestVersion on parent template to match.
    await db
      .update(systemWorkflowTemplates)
      .set({ latestVersion: 1, updatedAt: new Date() })
      .where(eq(systemWorkflowTemplates.id, templateId));
    log(`  [create] portfolio-health-sweep v1`);
  }
}

// ---------------------------------------------------------------------------
// Phase 6 — Dev fixtures (Breakout Solutions demo org)
// ---------------------------------------------------------------------------

async function phase6_devFixtures(): Promise<void> {
  logPhase(6, 7, 'Dev fixtures (Synthetos demo org)');

  const ORG_NAME = 'Synthetos';
  const ORG_SLUG = 'synthetos';
  const ORG_ADMIN_EMAIL = 'michael@breakoutsolutions.com';
  const ORG_ADMIN_PASSWORD = 'Zu5QzB5vG8!2';
  // Main workspace — system agents are activated here
  const MAIN_SUBACCOUNT_NAME = 'Synthetos Workspace';
  const MAIN_SUBACCOUNT_SLUG = 'synthetos-workspace';
  // Reporting-agent subaccount — kept separate for testing
  const REPORTING_SUBACCOUNT_NAME = 'Breakout Solutions';
  const REPORTING_SUBACCOUNT_SLUG = 'breakout-solutions';
  const AGENT_SLUG = 'reporting-agent';
  const LEGACY_AGENT_SLUG = '42macro-reporting-agent';

  // 5a-migrate. Rename legacy 'breakout-solutions' org slug → 'synthetos' so
  //             the upsert below finds the existing row rather than creating a
  //             duplicate. Safe to re-run: no-op when already renamed.
  const [legacyOrg] = await db
    .select()
    .from(organisations)
    .where(and(eq(organisations.slug, 'breakout-solutions'), isNull(organisations.deletedAt)))
    .limit(1);
  if (legacyOrg) {
    await db
      .update(organisations)
      .set({ slug: ORG_SLUG, name: ORG_NAME, updatedAt: new Date() })
      .where(eq(organisations.id, legacyOrg.id));
    log(`  [migrate] org 'breakout-solutions' → '${ORG_SLUG}'`);
  }

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

  // 5c-migrate. Rename legacy '42macro-tracking' subaccount → 'synthetos-workspace'
  //             so the upsert below updates the existing row in place (preserving
  //             all subaccount_agents / integration_connections linked by UUID).
  const [legacyMainSubaccount] = await db
    .select()
    .from(subaccounts)
    .where(and(
      eq(subaccounts.organisationId, org.id),
      eq(subaccounts.slug, '42macro-tracking'),
      isNull(subaccounts.deletedAt),
    ))
    .limit(1);
  if (legacyMainSubaccount) {
    await db
      .update(subaccounts)
      .set({ slug: MAIN_SUBACCOUNT_SLUG, name: MAIN_SUBACCOUNT_NAME, updatedAt: new Date() })
      .where(eq(subaccounts.id, legacyMainSubaccount.id));
    log(`  [migrate] subaccount '42macro-tracking' → '${MAIN_SUBACCOUNT_SLUG}'`);
  }

  // 5c. Main subaccount (Synthetos Workspace) — upsert
  const mainSubaccount = await upsertSubaccount({
    organisationId: org.id,
    name: MAIN_SUBACCOUNT_NAME,
    slug: MAIN_SUBACCOUNT_SLUG,
    status: 'active',
  });

  // 5c2. Reporting subaccount (Breakout Solutions) — upsert
  const reportingSubaccount = await upsertSubaccount({
    organisationId: org.id,
    name: REPORTING_SUBACCOUNT_NAME,
    slug: REPORTING_SUBACCOUNT_SLUG,
    status: 'active',
  });

  // 5d. Reporting Agent — lives in the Breakout Solutions subaccount
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

  // 5e. Subaccount agent link — reporting agent lives in the Breakout Solutions subaccount
  const existingSAA = await db
    .select()
    .from(subaccountAgents)
    .where(
      and(
        eq(subaccountAgents.subaccountId, reportingSubaccount.id),
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
        subaccountId: reportingSubaccount.id,
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

  // 5f. Integration connection placeholders — linked to Breakout Solutions subaccount.
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
      subaccountId: reportingSubaccount.id,
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
      subaccountId: reportingSubaccount.id,
      providerType: 'slack',
      authType: 'oauth2',
      label: 'Breakout Solutions Slack',
      connectionStatus: 'error',
      configJson: { defaultChannel: '#42macro-reports' },
      secretsRef: 'PLACEHOLDER_REPLACE_WITH_SLACK_BOT_TOKEN',
    })
    .onConflictDoNothing();

  log(`  [ok]   integration_connections (placeholders, status='error')`);

  // 5g. Activate baseline system agents in the Synthetos Workspace subaccount —
  //     one `agents` row per system agent with `systemAgentId` linking back to
  //     the authoritative `system_agents` definition. Org admins inherit
  //     masterPrompt and skills via isSystemManaged=true and can only layer an
  //     additionalPrompt on top.
  await activateBaselineSystemAgents(org.id, mainSubaccount.id);
}

/**
 * For each system agent, upsert a corresponding `agents` row in the given
 * organisation (linked via systemAgentId) and, for subaccount-scoped agents,
 * link it into the given subaccount via `subaccount_agents`.
 *
 * Org-scoped system agents (executionScope: 'org') are activated at org level
 * (via ensureOrgSubaccount) but NOT linked to the regular subaccount.
 *
 * Two-pass design for fresh databases:
 *   Pass 1 — upsert all `agents` rows; build sysAgentId → orgAgentId map.
 *   Pass 2 — upsert `subaccount_agents` rows in topological order (root first),
 *            wiring parentSubaccountAgentId from the already-inserted parent row.
 *   This avoids the subaccount_agents_one_root_per_subaccount constraint violation
 *   that would occur if all rows were inserted with parentSubaccountAgentId = null.
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

  // Pre-fetch every existing non-system-managed agent in this org.
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

  let orgAgentsCreated = 0;
  let orgAgentsUpdated = 0;
  let subaccountLinksCreated = 0;
  let subaccountLinksUpdated = 0;
  let orgScopedSkipped = 0;

  // ── Pass 1: upsert all `agents` rows ──────────────────────────────────────
  // Skip system-scoped agents (e.g. system_monitor) — those run exclusively
  // under the system-ops org and are seeded in Phase 4, not here.
  // sysAgentId → orgAgentId
  const sysToOrgId = new Map<string, string>();

  for (const sysAgent of allSystemAgents) {
    if (sysAgent.executionScope === 'system') continue;
    if (customSlugs.has(sysAgent.slug)) continue;

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
          masterPrompt: '',
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

    sysToOrgId.set(sysAgent.id, orgAgentId);
  }

  // ── Pass 2a: org-scoped agents (link to org subaccount) ───────────────────
  const { ensureOrgSubaccount } = await import('../server/services/orgSubaccountService.js');
  const orgSa = await ensureOrgSubaccount(organisationId, '');

  for (const sysAgent of allSystemAgents) {
    if (sysAgent.executionScope !== 'org') continue;
    if (customSlugs.has(sysAgent.slug)) continue;
    const orgAgentId = sysToOrgId.get(sysAgent.id);
    if (!orgAgentId) continue;

    // Deactivate any existing link to the regular subaccount
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

    if (orgSa) {
      const skillSlugs = sysAgent.defaultSystemSkillSlugs ?? [];
      const [existingOrgLink] = await db
        .select()
        .from(subaccountAgents)
        .where(
          and(
            eq(subaccountAgents.subaccountId, orgSa.id),
            eq(subaccountAgents.agentId, orgAgentId),
          ),
        )
        .limit(1);

      if (existingOrgLink) {
        await db
          .update(subaccountAgents)
          .set({
            isActive: true,
            skillSlugs,
            tokenBudgetPerRun: sysAgent.defaultTokenBudget,
            maxToolCallsPerRun: sysAgent.defaultMaxToolCalls,
            updatedAt: new Date(),
          })
          .where(eq(subaccountAgents.id, existingOrgLink.id));
        subaccountLinksUpdated += 1;
      } else {
        await db.insert(subaccountAgents).values({
          organisationId,
          subaccountId: orgSa.id,
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
    orgScopedSkipped += 1;
  }

  // ── Pass 2b: subaccount-scoped agents — topological order ─────────────────
  // Sort by depth so each parent SA row exists before its children are inserted.
  // This ensures parentSubaccountAgentId is always set correctly on first insert,
  // avoiding the subaccount_agents_one_root_per_subaccount unique-index violation.
  const sysAgentById = new Map(allSystemAgents.map((a) => [a.id, a]));
  function sysDepth(id: string): number {
    const a = sysAgentById.get(id);
    if (!a || !a.parentSystemAgentId) return 0;
    return 1 + sysDepth(a.parentSystemAgentId);
  }
  const subaccountScopedAgents = allSystemAgents
    .filter((a) => a.executionScope !== 'org' && a.executionScope !== 'system' && !customSlugs.has(a.slug))
    .sort((a, b) => sysDepth(a.id) - sysDepth(b.id));

  // Clear existing system-managed SA rows for this subaccount before re-seeding.
  // This handles corrupted partial state from previously failed seed runs (e.g.
  // a non-root agent ended up as the lone root, blocking the real root insert).
  // Safe for dev: the seed owns these rows. Custom (non-system-managed) SA rows
  // are untouched because we filter by the sysToOrgId agent set.
  const systemOrgAgentIds = [...sysToOrgId.values()];
  if (systemOrgAgentIds.length > 0) {
    await db
      .delete(subaccountAgents)
      .where(
        and(
          eq(subaccountAgents.subaccountId, subaccountId),
          inArray(subaccountAgents.agentId, systemOrgAgentIds),
        ),
      );
  }

  // orgAgentId → subaccountAgentId (starts empty; populated as rows are inserted)
  const orgToSaId = new Map<string, string>();

  for (const sysAgent of subaccountScopedAgents) {
    const orgAgentId = sysToOrgId.get(sysAgent.id);
    if (!orgAgentId) continue;

    const skillSlugs = sysAgent.defaultSystemSkillSlugs ?? [];

    // Resolve parent SA ID (topological order guarantees the parent's SA row
    // is already in orgToSaId when this child is processed).
    let parentSaId: string | null = null;
    if (sysAgent.parentSystemAgentId) {
      const parentOrgId = sysToOrgId.get(sysAgent.parentSystemAgentId);
      if (parentOrgId) parentSaId = orgToSaId.get(parentOrgId) ?? null;
    }

    const [inserted] = await db
      .insert(subaccountAgents)
      .values({
        organisationId,
        subaccountId,
        agentId: orgAgentId,
        parentSubaccountAgentId: parentSaId,
        isActive: true,
        skillSlugs,
        tokenBudgetPerRun: sysAgent.defaultTokenBudget,
        maxToolCallsPerRun: sysAgent.defaultMaxToolCalls,
        timeoutSeconds: 300,
      })
      .returning({ id: subaccountAgents.id });
    orgToSaId.set(orgAgentId, inserted.id);
    subaccountLinksCreated += 1;
  }

  log(`  [ok]   org agents:         ${orgAgentsCreated} created, ${orgAgentsUpdated} updated`);
  log(`  [ok]   subaccount links:   ${subaccountLinksCreated} created, ${subaccountLinksUpdated} updated`);
  if (orgScopedSkipped > 0) {
    log(`  [ok]   org-scoped skipped: ${orgScopedSkipped} (activated at org only)`);
  }
}

async function preflightVerifyAgentSkillContracts(): Promise<void> {
  const { execSync } = await import('child_process');
  try {
    execSync('npx tsx scripts/verify-agent-skill-contracts.ts', { stdio: 'inherit' });
  } catch {
    throw new Error('preflight: agent-skill contract violations found — aborting seed');
  }
}

async function preflightVerifyManifestDrift(): Promise<void> {
  const { execSync } = await import('child_process');
  try {
    execSync('npx tsx scripts/regenerate-company-manifest.ts --check', { stdio: 'inherit' });
  } catch {
    throw new Error('preflight: manifest drift detected — run `npx tsx scripts/regenerate-company-manifest.ts` to fix — aborting seed');
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
  await preflightVerifyAgentSkillContracts();
  await preflightVerifyManifestDrift();

  await phase1_systemBootstrap();
  await phase2_systemAgents();
  await phase3_playbookAuthor();
  await phase4_systemMonitor();
  await phase5_playbookTemplates();

  if (!IS_PRODUCTION) {
    await phase6_devFixtures();
  } else {
    console.log('\n[6/7] Dev fixtures — skipped (production mode)\n');
  }

  // Phase 7 — Configuration Assistant runtime guidelines memory block.
  // Runs in both production and dev. Seeds the guidelines block for every
  // org that has the Configuration Assistant agent activated. Idempotent.
  logPhase(7, 7, 'Configuration Assistant guidelines block');
  await seedConfigAgentGuidelinesAll(db, log);

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
    if (err?.cause) console.error('Caused by:', err.cause);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
