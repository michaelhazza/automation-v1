/**
 * Seed: Breakout Solutions — 42 Macro Reporting Agent
 *
 * What this script creates / upserts (idempotent — safe to re-run):
 *   1. organisation:           "Breakout Solutions"            (slug: breakout-solutions)
 *   2. subaccount:             "Breakout Solutions"            (slug: 42macro-tracking)
 *   3. agent:                  "Reporting Agent"               (slug: reporting-agent)
 *      with masterPrompt and defaultSkillSlugs pointing at all required skills
 *   4. subaccount_agent:       links the agent to the subaccount with skillSlugs
 *   5. integration_connection placeholder rows (connectionStatus='error' so the worker
 *      refuses to use them until you fill in real values):
 *        - web_login   "42 Macro paywall login"
 *        - slack       "Breakout Solutions Slack"
 *
 * Skills are file-based (server/skills/*.md) — no DB writes needed.
 * analyse_42macro_transcript lives at server/skills/analyse_42macro_transcript.md.
 *
 * What this script CANNOT create (you must finish setup manually — see
 * docs/setup-42macro-reporting-agent.md for the exact steps):
 *   - The real 42 Macro username + password (encrypted via TOKEN_ENCRYPTION_KEY)
 *   - The real Slack bot token + default channel
 *   - The OPENAI_API_KEY env var (Whisper transcription)
 *
 * Usage:
 *   npx tsx scripts/seed-42macro-reporting-agent.ts
 *
 * Requires .env with a valid DATABASE_URL pointing at your local dev DB.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { and, eq, isNull } from 'drizzle-orm';

import { organisations } from '../server/db/schema/organisations.js';
import { subaccounts } from '../server/db/schema/subaccounts.js';
import { agents } from '../server/db/schema/agents.js';
import { subaccountAgents } from '../server/db/schema/subaccountAgents.js';
import { integrationConnections } from '../server/db/schema/integrationConnections.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const ORG_NAME = 'Breakout Solutions';
const ORG_SLUG = 'breakout-solutions';
const SUBACCOUNT_NAME = 'Breakout Solutions';
const SUBACCOUNT_SLUG = '42macro-tracking';
const AGENT_SLUG = 'reporting-agent';

// All skills are file-based (server/skills/*.md) — no DB writes needed.
// Add or remove slugs here as the agent's reporting surface area expands.
const SKILL_SLUGS = [
  'fetch_paywalled_content',
  'fetch_url',
  'web_search',
  'transcribe_audio',
  'analyse_42macro_transcript',
  'send_to_slack',
  'send_email',
  'add_deliverable',
] as const;


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
  'Generic reporting agent: acquire a source (paywalled or public), convert to text, analyse it (with specialised lenses where available — currently 42 Macro), and publish to Slack / email / deliverable. Idempotent via content-hash fingerprint.';

async function upsertRow<T extends { id: string }>(
  rows: T[],
  fallback: () => Promise<T>,
): Promise<T> {
  if (rows.length > 0) return rows[0];
  return fallback();
}

async function seed() {
  console.log('▸ Seeding 42 Macro Reporting Agent (Breakout Solutions)…\n');

  // ── 1. Organisation ────────────────────────────────────────────────────
  // Look up by slug first, then fall back to name. This handles the case
  // where an org was created via the UI (or an older seed run) with a
  // different slug — we reuse it instead of erroring on a unique-name
  // collision or creating a duplicate.
  let existingOrgs = await db
    .select()
    .from(organisations)
    .where(and(eq(organisations.slug, ORG_SLUG), isNull(organisations.deletedAt)))
    .limit(1);
  if (existingOrgs.length === 0) {
    existingOrgs = await db
      .select()
      .from(organisations)
      .where(and(eq(organisations.name, ORG_NAME), isNull(organisations.deletedAt)))
      .limit(1);
  }
  const org = await upsertRow(existingOrgs, async () => {
    const [row] = await db
      .insert(organisations)
      .values({
        name: ORG_NAME,
        slug: ORG_SLUG,
        plan: 'agency',
        status: 'active',
      })
      .returning();
    return row;
  });
  console.log(`  org              ${org.id} ${org.slug}`);

  // ── 2. Subaccount ──────────────────────────────────────────────────────
  // Same fallback pattern: slug → name within the same org. The UI may have
  // already created this subaccount under a different slug; reuse it rather
  // than erroring or creating a duplicate.
  let existingSubs = await db
    .select()
    .from(subaccounts)
    .where(and(eq(subaccounts.organisationId, org.id), eq(subaccounts.slug, SUBACCOUNT_SLUG), isNull(subaccounts.deletedAt)))
    .limit(1);
  if (existingSubs.length === 0) {
    existingSubs = await db
      .select()
      .from(subaccounts)
      .where(and(eq(subaccounts.organisationId, org.id), eq(subaccounts.name, SUBACCOUNT_NAME), isNull(subaccounts.deletedAt)))
      .limit(1);
  }
  const subaccount = await upsertRow(existingSubs, async () => {
    const [row] = await db
      .insert(subaccounts)
      .values({
        organisationId: org.id,
        name: SUBACCOUNT_NAME,
        slug: SUBACCOUNT_SLUG,
        status: 'active',
      })
      .returning();
    return row;
  });
  console.log(`  subaccount       ${subaccount.id} ${subaccount.slug}`);

  // Skills are file-based (server/skills/*.md) — no DB step needed.

  // ── 3. Agent ───────────────────────────────────────────────────────────
  // Migration: the legacy slug was '42macro-reporting-agent'. If we find a
  // row with that slug AND no row at the new slug, rename it in place so
  // the user's existing local DB gets the new generic identity without
  // losing their manual tweaks (skills attachments, runs history, etc.).
  const LEGACY_AGENT_SLUG = '42macro-reporting-agent';
  let existingAgents = await db
    .select()
    .from(agents)
    .where(and(eq(agents.organisationId, org.id), eq(agents.slug, AGENT_SLUG), isNull(agents.deletedAt)))
    .limit(1);
  if (existingAgents.length === 0) {
    const legacyAgents = await db
      .select()
      .from(agents)
      .where(and(eq(agents.organisationId, org.id), eq(agents.slug, LEGACY_AGENT_SLUG), isNull(agents.deletedAt)))
      .limit(1);
    if (legacyAgents.length > 0) {
      console.log(`  ↻ migrating legacy agent slug ${LEGACY_AGENT_SLUG} → ${AGENT_SLUG}`);
      existingAgents = legacyAgents;
    }
  }
  let agent: typeof agents.$inferSelect;
  if (existingAgents[0]) {
    // Always update existing agents to the latest desired state so the seed
    // is the single source of truth for name / prompt / skill list.
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
        defaultSkillSlugs: [...SKILL_SLUGS],
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
        defaultSkillSlugs: [...SKILL_SLUGS],
        status: 'active',
      })
      .returning();
    agent = row;
  }
  console.log(`  agent            ${agent.id} ${agent.slug} (${agent.name})`);

  // ── 4. Subaccount agent link ───────────────────────────────────────────
  // Always update the per-subaccount instance to match the desired skill
  // list so newly added skills (e.g. fetch_url, web_search, send_email)
  // become available without manual UI work.
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
  let subAgent: typeof subaccountAgents.$inferSelect;
  if (existingSAA[0]) {
    await db
      .update(subaccountAgents)
      .set({
        isActive: true,
        skillSlugs: [...SKILL_SLUGS],
        maxCostPerRunCents: 500,
        tokenBudgetPerRun: 60_000,
        maxToolCallsPerRun: 12,
        timeoutSeconds: 900,
        updatedAt: new Date(),
      })
      .where(eq(subaccountAgents.id, existingSAA[0].id));
    const [refreshed] = await db
      .select()
      .from(subaccountAgents)
      .where(eq(subaccountAgents.id, existingSAA[0].id))
      .limit(1);
    subAgent = refreshed;
  } else {
    const [row] = await db
      .insert(subaccountAgents)
      .values({
        organisationId: org.id,
        subaccountId: subaccount.id,
        agentId: agent.id,
        isActive: true,
        skillSlugs: [...SKILL_SLUGS],
        // Set a real per-run cost ceiling so the T23 breaker is meaningful.
        // $5.00 — well above expected (Whisper is the dominant cost, ~$0.40
        // for a 60-min video).
        maxCostPerRunCents: 500,
        tokenBudgetPerRun: 60_000,
        maxToolCallsPerRun: 12,
        timeoutSeconds: 900,
      })
      .returning();
    subAgent = row;
  }
  console.log(`  subaccount_agent ${subAgent.id}`);

  // ── 5. Integration connection placeholders ─────────────────────────────
  // Status='error' so the worker REFUSES to use them until you replace the
  // placeholder secret with a real one (see docs/setup-42macro-reporting-agent.md).
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
        // contentUrl is not stored on the connection — the agent passes the
        // exact video URL on each fetch_paywalled_content call.
        username: 'PLACEHOLDER@example.com',
        // Selector overrides — leave null on first attempt; only fill in if
        // the smoke test (worker/scripts/smoke-paywall.ts) shows the defaults
        // do not match 42macro.com's actual login form.
        usernameSelector: null,
        passwordSelector: null,
        submitSelector: null,
        successSelector: null,
        timeoutMs: 30_000,
      },
      // Placeholder ciphertext — the worker will refuse to use this row until
      // it is replaced with a real encrypted password and connectionStatus is
      // flipped to 'active'.
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
      configJson: {
        defaultChannel: '#42macro-reports',
      },
      secretsRef: 'PLACEHOLDER_REPLACE_WITH_SLACK_BOT_TOKEN',
    })
    .onConflictDoNothing();

  console.log(`  integration_connections (placeholders)  status='error'`);

  console.log('\n✓ Seed complete.');
  console.log('\nNext steps — see docs/setup-42macro-reporting-agent.md');
  await pool.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  pool.end().catch(() => undefined);
  process.exit(1);
});
