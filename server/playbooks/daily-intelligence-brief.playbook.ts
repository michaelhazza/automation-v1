/**
 * Daily Intelligence Brief — Phase G system template (spec §11).
 *
 * Exercises every primitive shipped in this spec:
 *   - action_call (§4)          — setup_schedule, publish_portal, send_email
 *   - SchedulePicker / runNow   — setup_schedule creates the cron task
 *   - HelpHint (§6)             — initial input form fields carry hints
 *   - Unified Knowledge (§7)    — research step reads Memory Blocks as context
 *   - knowledgeBindings (§8)    — baseline facts written back on first run
 *   - Run modal + portal card   — publish_portal marks the run portal-visible
 *   - modules.onboardingPlaybookSlugs (§10) — autoStartOnOnboarding: true
 *
 * Step DAG:
 *   setup_schedule (action_call, idempotent)
 *     └─► research (agent_call, idempotent)
 *           └─► draft (prompt, none)
 *                 ├─► publish_portal (action_call, reversible, humanReviewRequired)
 *                 └─► send_email    (action_call, irreversible)
 *
 * To seed locally (after running npm run migrate):
 *   npm run seed
 *
 * To validate without touching the DB:
 *   npm run playbooks:validate
 */

import { z } from 'zod';
import { definePlaybook } from '../lib/playbook/definePlaybook.js';
/** Schedule input shape consumed by config_create_scheduled_task (spec §5.2). */
const schedulePickerValueSchema = z.object({
  rrule: z.string().describe('iCal RRULE string defining the recurrence pattern'),
  timezone: z.string().describe('IANA timezone identifier'),
  scheduleTime: z.string().describe('Time of day in HH:MM format'),
});

export default definePlaybook({
  slug: 'daily-intelligence-brief',
  name: 'Daily Intelligence Brief',
  description:
    'Researches competitive, regulatory, campaign, and industry signals on a configurable schedule, ' +
    'drafts a concise brief, publishes it to the sub-account portal, and optionally emails it to a list of recipients.',
  version: 1,

  autoStartOnOnboarding: true,

  portalPresentation: {
    cardTitle: 'Daily Intelligence Brief',
    headlineStepId: 'draft',
    headlineOutputPath: 'bullets',
    // Deep-link to a future brief archive page; run modal is the fallback.
    detailRoute: undefined,
  },

  knowledgeBindings: [
    {
      stepId: 'research',
      outputPath: 'baselineFacts',
      blockLabel: 'Sub-account intelligence baseline',
      mergeStrategy: 'merge',
      firstRunOnly: true,
    },
  ],

  initialInputSchema: z.object({
    focusAreas: z
      .array(
        z.enum(['competitive', 'regulatory', 'campaigns', 'industry_news']),
      )
      .min(1)
      .describe('Which intelligence areas to include in each brief'),
    schedule: schedulePickerValueSchema.describe(
      'When to run the brief — use the schedule picker to set frequency and time',
    ),
    deliveryEmails: z
      .array(z.string().email())
      .max(5)
      .default([])
      .describe('Email addresses to receive the brief (max 5). Leave empty to skip email delivery.'),
    portalVisible: z
      .boolean()
      .default(true)
      .describe('Show the brief on the sub-account portal after each run'),
  }),

  steps: [
    // ── 1. Create the recurring scheduled task ────────────────────────────────
    // `sideEffectType: idempotent` — the config_create_scheduled_task handler
    // dedupes by taskSlug so replaying this step is safe.
    {
      id: 'setup_schedule',
      name: 'Set up recurring schedule',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'idempotent',
      idempotencyScope: 'entity',
      entityKey: 'task:{{ run.subaccount.id }}:daily-intelligence-brief',
      actionSlug: 'config_create_scheduled_task',
      actionInputs: {
        title: 'Daily Intelligence Brief',
        description:
          'Recurring brief for this sub-account. Created by the Daily Intelligence Brief playbook.',
        subaccountId: '{{ run.subaccount.id }}',
        rrule: '{{ run.input.schedule.rrule }}',
        timezone: '{{ run.input.schedule.timezone }}',
        scheduleTime: '{{ run.input.schedule.scheduleTime }}',
        taskSlug: 'daily-intelligence-brief-{{ run.subaccount.id }}',
        createdByPlaybookSlug: 'daily-intelligence-brief',
        // runNow: true kicks off the first occurrence immediately so the brief
        // exists in the portal before the next scheduled run fires.
        runNow: 'true',
      },
      outputSchema: z.object({
        entityId: z.string().describe('ID of the created or existing scheduled task'),
        title: z.string(),
      }),
    },

    // ── 2. Research — agent_call to the research-assistant system agent ───────
    {
      id: 'research',
      name: 'Research intelligence signals',
      type: 'agent_call',
      dependsOn: ['setup_schedule'],
      sideEffectType: 'idempotent',
      agentRef: { kind: 'system', slug: 'research-assistant' },
      retryPolicy: { maxAttempts: 3 },
      agentInputs: {
        focusAreas: '{{ run.input.focusAreas }}',
        subaccountName: '{{ run.subaccount.name }}',
      },
      prompt:
        'You are researching intelligence signals for sub-account "{{ run.subaccount.name }}". ' +
        'Focus areas: {{ run.input.focusAreas }}. ' +
        'Use the Memory Blocks in context as background. ' +
        'Return JSON with: ' +
        '`findings` (array of { topic, summary, sources[] }) and ' +
        '`baselineFacts` (object with key facts to remember for future runs — only non-empty on first run). ' +
        '`rawNotes` (string with full research notes).',
      outputSchema: z.object({
        findings: z.array(
          z.object({
            topic: z.string(),
            summary: z.string(),
            sources: z.array(z.string()),
          }),
        ),
        baselineFacts: z.record(z.unknown()).optional().describe('Key facts captured on first run only'),
        rawNotes: z.string(),
      }),
    },

    // ── 3. Draft the brief from research findings ─────────────────────────────
    {
      id: 'draft',
      name: 'Draft the brief',
      type: 'prompt',
      dependsOn: ['research'],
      sideEffectType: 'none',
      model: 'claude-haiku-4-5-20251001',
      prompt:
        'You are drafting a concise intelligence brief for "{{ run.subaccount.name }}" based on the following research findings:\n\n' +
        '{{ steps.research.output.findings | json }}\n\n' +
        'Write 3–5 crisp bullet points that an executive can act on. ' +
        'Then write a 200–400 word detailed summary in markdown. ' +
        'Return JSON with: ' +
        '`title` (string, max 80 chars), ' +
        '`bullets` (array of strings, each max 120 chars), ' +
        '`detailMarkdown` (string).',
      outputSchema: z.object({
        title: z.string().max(80),
        bullets: z.array(z.string().max(120)),
        detailMarkdown: z.string(),
      }),
    },

    // ── 4. Publish the brief to the portal ────────────────────────────────────
    // `humanReviewRequired: true` on supervised runs — the admin sees the draft
    // before it goes live. Auto runs skip the review gate (§4.6).
    {
      id: 'publish_portal',
      name: 'Publish to portal',
      type: 'action_call',
      dependsOn: ['draft'],
      sideEffectType: 'reversible',
      humanReviewRequired: true,
      actionSlug: 'config_publish_playbook_output_to_portal',
      actionInputs: {
        playbookSlug: 'daily-intelligence-brief',
        title: '{{ steps.draft.output.title }}',
        bullets: '{{ steps.draft.output.bullets | json }}',
        detailMarkdown: '{{ steps.draft.output.detailMarkdown }}',
      },
      outputSchema: z.object({
        briefId: z.string(),
      }),
    },

    // ── 5. Email the brief to delivery recipients (irreversible) ─────────────
    // Skipped when `deliveryEmails` is empty. The engine handles the empty
    // array case by marking the step completed with `{ skipped: true }`.
    {
      id: 'send_email',
      name: 'Email digest to recipients',
      type: 'action_call',
      dependsOn: ['draft'],
      sideEffectType: 'irreversible',
      retryPolicy: { maxAttempts: 1 },
      actionSlug: 'config_send_playbook_email_digest',
      actionInputs: {
        to: '{{ run.input.deliveryEmails | json }}',
        subject: '{{ steps.draft.output.title }}',
        bodyMarkdown: '{{ steps.draft.output.detailMarkdown }}',
      },
      outputSchema: z.object({
        success: z.boolean(),
        deduplicated: z.boolean().optional(),
      }),
    },
  ],
});
