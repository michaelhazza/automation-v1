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

const ORG_SLUG = 'breakout-solutions';
const SUBACCOUNT_SLUG = '42macro-tracking';
const AGENT_SLUG = '42macro-reporting-agent';
const ANALYSIS_SKILL_SLUG = 'analyse_42macro_transcript';

const SKILL_SLUGS = [
  'fetch_paywalled_content',
  'transcribe_audio',
  ANALYSIS_SKILL_SLUG,
  'send_to_slack',
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

const ANALYSIS_SKILL_DEFINITION = {
  name: ANALYSIS_SKILL_SLUG,
  description:
    'Convert a 42 Macro video transcript (or written research note) into a three-tier markdown analysis (Dashboard, Executive Summary, Full Analysis) using the 42 Macro GRID/KISS/Dr. Mo framework. Plain-language only.',
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

const AGENT_MASTER_PROMPT = `You are the 42 Macro Reporting Agent for Breakout Solutions.

Your job: every time you are triggered (manually or on a schedule), fetch the latest
gated 42 Macro video, transcribe it, analyse it through the 42 Macro A-Player Brain
framework, and post the resulting three-tier report to Slack.

Available skills (use them in this exact order):

  1. fetch_paywalled_content
       - webLoginConnectionId: <ID of the "42 Macro paywall login" connection>
       - contentUrl:           the latest video page on 42macro.com (e.g.
                               https://app.42macro.com/video/around_the_horn_weekly)
       - intent:               "download_latest"
       - allowedDomains:       ["42macro.com", "app.42macro.com"]
       - expectedArtifactKind: "video"
       - expectedMimeTypePrefix: "video/"
       - captureMode:          "capture_video"   ← 42 Macro has NO download
                               button. The worker snoops the page network for
                               the actual mp4/m3u8 the player loads and
                               refetches it with the session cookies
                               (HLS via ffmpeg). Equivalent of the Chrome
                               "Video Downloader" extension.
       - playSelector:         omit (worker tries default HTML5 player
                               selectors); only set if the default click
                               doesn't trigger media load.
     If the result is { noNewContent: true }, immediately emit \`done\` —
     the dedup fingerprint matched and there is nothing new to process.

  2. transcribe_audio
       - executionArtifactId:  the artifactId returned from step 1

  3. analyse_42macro_transcript
       - transcript:           the transcript text from step 2
       - sourceTitle:          the title of the source video (best guess from the page)
       - sourceDate:           today's date in YYYY-MM-DD

  4. send_to_slack
       - message:              the rendered markdown body from step 3
       - filename:             the YYYYMMDD_Report_Name.md filename from step 3

Hard rules:
  - Always run the four skills in order. Do not skip steps. Do not call analyse before
    transcribe.
  - If any step returns a failure, stop and report the failure with the structured
    failureReason. Do not retry by hand.
  - Plain language is the highest priority for the analysis output. Explain every term.
  - Not financial advice — you explain and translate.

Emit \`done\` once send_to_slack returns a permalink.`;

const AGENT_DESCRIPTION =
  'Fetches the latest paywalled 42 Macro video, transcribes it via Whisper, runs it through the 42 Macro A-Player Brain analysis skill, and posts the three-tier report to Slack. Idempotent via the content-hash fingerprint.';

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
  const existingOrgs = await db
    .select()
    .from(organisations)
    .where(eq(organisations.slug, ORG_SLUG))
    .limit(1);
  const org = await upsertRow(existingOrgs, async () => {
    const [row] = await db
      .insert(organisations)
      .values({
        name: 'Breakout Solutions',
        slug: ORG_SLUG,
        plan: 'agency',
        status: 'active',
      })
      .returning();
    return row;
  });
  console.log(`  org              ${org.id} ${org.slug}`);

  // ── 2. Subaccount ──────────────────────────────────────────────────────
  const existingSubs = await db
    .select()
    .from(subaccounts)
    .where(and(eq(subaccounts.organisationId, org.id), eq(subaccounts.slug, SUBACCOUNT_SLUG)))
    .limit(1);
  const subaccount = await upsertRow(existingSubs, async () => {
    const [row] = await db
      .insert(subaccounts)
      .values({
        organisationId: org.id,
        name: '42 Macro Tracking',
        slug: SUBACCOUNT_SLUG,
        status: 'active',
      })
      .returning();
    return row;
  });
  console.log(`  subaccount       ${subaccount.id} ${subaccount.slug}`);

  // ── 3. Custom analysis skill ───────────────────────────────────────────
  const existingSkills = await db
    .select()
    .from(skills)
    .where(and(eq(skills.organisationId, org.id), eq(skills.slug, ANALYSIS_SKILL_SLUG)))
    .limit(1);
  const analysisSkill = await upsertRow(existingSkills, async () => {
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
    return row;
  });
  console.log(`  skill            ${analysisSkill.id} ${analysisSkill.slug}`);

  // ── 4. Agent ───────────────────────────────────────────────────────────
  const existingAgents = await db
    .select()
    .from(agents)
    .where(and(eq(agents.organisationId, org.id), eq(agents.slug, AGENT_SLUG)))
    .limit(1);
  const agent = await upsertRow(existingAgents, async () => {
    const [row] = await db
      .insert(agents)
      .values({
        organisationId: org.id,
        name: '42 Macro Reporting Agent',
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
    return row;
  });
  console.log(`  agent            ${agent.id} ${agent.slug}`);

  // ── 5. Subaccount agent link ───────────────────────────────────────────
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
  const subAgent = await upsertRow(existingSAA, async () => {
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
    return row;
  });
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
