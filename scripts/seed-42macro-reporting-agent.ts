/**
 * Seed: Breakout Solutions — 42 Macro Reporting Agent
 *
 * What this script creates / upserts (idempotent — safe to re-run):
 *   1. organisation:           "Breakout Solutions"            (slug: breakout-solutions)
 *   2. subaccount:             "42 Macro Tracking"             (slug: 42macro-tracking)
 *   3. org-level skill:        analyse_42macro_transcript      (custom prompt skill,
 *                                                              full 42 Macro A-Player Brain
 *                                                              instructions in body)
 *   4. agent:                  "42 Macro Reporting Agent"      (slug: 42macro-reporting-agent)
 *      with masterPrompt orchestrating fetch_paywalled_content → transcribe_audio →
 *      analyse_42macro_transcript → send_to_slack
 *      and defaultSkillSlugs: [those four]
 *   5. subaccount_agent:       links the agent to the 42 Macro Tracking subaccount,
 *                              with skillSlugs = the four
 *   6. integration_connection placeholder rows (connectionStatus='error' so the worker
 *      refuses to use them until you fill in real values):
 *        - web_login   "42 Macro paywall login"
 *        - slack       "Breakout Solutions Slack"
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
import { and, eq } from 'drizzle-orm';

import { organisations } from '../server/db/schema/organisations.js';
import { subaccounts } from '../server/db/schema/subaccounts.js';
import { agents } from '../server/db/schema/agents.js';
import { subaccountAgents } from '../server/db/schema/subaccountAgents.js';
import { skills } from '../server/db/schema/skills.js';
import { integrationConnections } from '../server/db/schema/integrationConnections.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const ORG_NAME = 'Breakout Solutions';
const ORG_SLUG = 'breakout-solutions';
const SUBACCOUNT_NAME = 'Breakout Solutions';
const SUBACCOUNT_SLUG = '42macro-tracking';
const AGENT_SLUG = 'reporting-agent';
const ANALYSIS_SKILL_SLUG = 'analyse_42macro_transcript';

// Generic reporting-agent skill set + the one 42-Macro-specific analysis
// skill that satisfies the current use case. Add or remove from this list
// as the agent's reporting surface area expands. The first four are the
// "typical reporting agent" baseline (fetch from a source → turn it into
// text → analyse → publish); analyse_42macro_transcript is the
// domain-specific lens layered on top.
const SKILL_SLUGS = [
  'fetch_paywalled_content',
  'fetch_url',
  'web_search',
  'transcribe_audio',
  ANALYSIS_SKILL_SLUG,
  'send_to_slack',
  'send_email',
  'add_deliverable',
] as const;

// ─── 42 Macro A-Player Brain prompt — pasted verbatim into the skill body ────
// Source: user-provided GPT system prompt (Nov 2025 revision).
const ANALYSIS_SKILL_INSTRUCTIONS = String.raw`# 42 Macro A-Player Brain — full system prompt

You are the 42 Macro A-Player Brain, an expert analyst trained on the complete 42 Macro
methodology built by Darius Dale, founder and CEO of 42Macro. Your purpose is to translate
complex, institutional-grade macro analysis into something any person can understand and
act on.

ALWAYS produce three tiers of output for every input transcript:

  TIER 1: DASHBOARD             (≤30 seconds to read; 5 data points + 1 sentence)
  TIER 2: EXECUTIVE SUMMARY     (250–350 words, plain-English prose, 4 paragraphs)
  TIER 3: FULL ANALYSIS         (sectioned: Macro Snapshot, Bitcoin & Digital Assets,
                                 The Bottom Line)

Plain language is the highest content priority. Explain every technical term immediately
in plain English. Short sentences. One idea at a time. No jargon as a shortcut.

Use the GRID Regime framework (Goldilocks / Reflation / Inflation / Deflation), Dr. Mo
risk overlay, and the Fourth Turning context. Use the KISS Portfolio (60% equities / 30%
gold / 10% Bitcoin) as the positioning anchor.

The full reference prompt (regime definitions, Bitcoin playbook, plain-language glossary,
output format guardrails, and operating rules) is documented in
docs/42macro-analysis-skill.md and is the source of truth for all reasoning. Follow it
verbatim for every analysis.

OUTPUT FORMAT (mandatory):
  - Filename:       YYYYMMDD_Report_Name.md  (date from the source document; underscores
                    instead of spaces in the name)
  - Headers:        TIER 1: DASHBOARD / TIER 2: EXECUTIVE SUMMARY / TIER 3: FULL ANALYSIS
  - Section names:  SECTION 1: MACRO SNAPSHOT / SECTION 2: BITCOIN AND DIGITAL ASSETS /
                    SECTION 3: THE BOTTOM LINE

Return the rendered markdown body so the agent loop can pass it to send_to_slack as the
message body.

Not financial advice — you explain and translate; you do not give personalised financial
advice.`;

// The skill description carries the FULL recipe for using this lens, including
// which fetch skill to call upstream and what params to pass. The agent prompt
// stays generic; each lens skill is self-describing. When a new domain lens
// (analyse_yc_essay, analyse_fed_minutes, etc.) is added, drop its recipe in
// the same way and the agent will pick it up automatically — no edits to the
// agent's masterPrompt required.
const ANALYSIS_SKILL_DESCRIPTION = `Convert a 42 Macro video transcript (or 42 Macro written research note) into a three-tier markdown analysis (Dashboard / Executive Summary / Full Analysis) using the 42 Macro GRID / Dr. Mo / KISS portfolio framework. Plain-language only.

USE THIS LENS WHEN: the source is anything from 42macro.com or app.42macro.com (weekly videos, research notes, members-area uploads). Do not use it for non-42-Macro macro content; produce a generic summary instead.

UPSTREAM RECIPE — how to acquire and convert the source before calling this skill:

  1. fetch_paywalled_content
       webLoginConnectionId:   the "42 Macro paywall login" web_login connection on this subaccount
       contentUrl:             the 42 Macro page for the latest video (e.g. https://app.42macro.com/video/around_the_horn_weekly)
       intent:                 "download_latest"
       allowedDomains:         ["42macro.com", "app.42macro.com"]
       expectedArtifactKind:   "video"
       expectedMimeTypePrefix: "video/"
       captureMode:            "capture_video"   ← 42 Macro has NO download button. The worker snoops the page network for the actual mp4/m3u8 the player loads and refetches it with the session cookies (HLS via ffmpeg).
     If the call returns { noNewContent: true } the dedup fingerprint matched — emit \`done\` immediately, do NOT continue.

  2. transcribe_audio
       executionArtifactId:    the artifactId returned from step 1

  3. analyse_42macro_transcript  ← THIS SKILL
       transcript:             the transcript text from step 2
       sourceTitle:            the video title (best guess from the page)
       sourceDate:             today's date in YYYY-MM-DD

  4. publish via send_to_slack / send_email / add_deliverable as instructed.`;

const ANALYSIS_SKILL_DEFINITION = {
  name: ANALYSIS_SKILL_SLUG,
  description: ANALYSIS_SKILL_DESCRIPTION,
  input_schema: {
    type: 'object',
    properties: {
      transcript: {
        type: 'string',
        description: 'Full transcript or research-note text to analyse.',
      },
      sourceTitle: {
        type: 'string',
        description: "Optional title of the source document, used to derive the filename (YYYYMMDD_Report_Name.md).",
      },
      sourceDate: {
        type: 'string',
        description: 'Optional ISO date (YYYY-MM-DD) of the source document. Used as YYYYMMDD prefix in the filename.',
      },
    },
    required: ['transcript'],
  },
};

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
    .where(eq(organisations.slug, ORG_SLUG))
    .limit(1);
  if (existingOrgs.length === 0) {
    existingOrgs = await db
      .select()
      .from(organisations)
      .where(eq(organisations.name, ORG_NAME))
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
    .where(and(eq(subaccounts.organisationId, org.id), eq(subaccounts.slug, SUBACCOUNT_SLUG)))
    .limit(1);
  if (existingSubs.length === 0) {
    existingSubs = await db
      .select()
      .from(subaccounts)
      .where(and(eq(subaccounts.organisationId, org.id), eq(subaccounts.name, SUBACCOUNT_NAME)))
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

  // ── 3. Custom analysis skill ───────────────────────────────────────────
  // Always upsert the skill body so re-running the seed picks up prompt edits.
  const existingSkills = await db
    .select()
    .from(skills)
    .where(and(eq(skills.organisationId, org.id), eq(skills.slug, ANALYSIS_SKILL_SLUG)))
    .limit(1);
  let analysisSkill = existingSkills[0];
  if (analysisSkill) {
    await db
      .update(skills)
      .set({
        name: '42 Macro A-Player Analysis',
        description:
          'Three-tier 42 Macro framework analysis (Dashboard / Executive Summary / Full Analysis) of any transcript or research note. Plain-language only.',
        definition: ANALYSIS_SKILL_DEFINITION,
        instructions: ANALYSIS_SKILL_INSTRUCTIONS,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(skills.id, analysisSkill.id));
  } else {
    const [row] = await db
      .insert(skills)
      .values({
        organisationId: org.id,
        name: '42 Macro A-Player Analysis',
        slug: ANALYSIS_SKILL_SLUG,
        description:
          'Three-tier 42 Macro framework analysis (Dashboard / Executive Summary / Full Analysis) of any transcript or research note. Plain-language only.',
        skillType: 'custom',
        definition: ANALYSIS_SKILL_DEFINITION,
        instructions: ANALYSIS_SKILL_INSTRUCTIONS,
        isActive: true,
        contentsVisible: false,
      })
      .returning();
    analysisSkill = row;
  }
  console.log(`  skill            ${analysisSkill.id} ${analysisSkill.slug}`);

  // ── 4. Agent ───────────────────────────────────────────────────────────
  // Migration: the legacy slug was '42macro-reporting-agent'. If we find a
  // row with that slug AND no row at the new slug, rename it in place so
  // the user's existing local DB gets the new generic identity without
  // losing their manual tweaks (skills attachments, runs history, etc.).
  const LEGACY_AGENT_SLUG = '42macro-reporting-agent';
  let existingAgents = await db
    .select()
    .from(agents)
    .where(and(eq(agents.organisationId, org.id), eq(agents.slug, AGENT_SLUG)))
    .limit(1);
  if (existingAgents.length === 0) {
    const legacyAgents = await db
      .select()
      .from(agents)
      .where(and(eq(agents.organisationId, org.id), eq(agents.slug, LEGACY_AGENT_SLUG)))
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

  // ── 5. Subaccount agent link ───────────────────────────────────────────
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

  // ── 6. Integration connection placeholders ─────────────────────────────
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
