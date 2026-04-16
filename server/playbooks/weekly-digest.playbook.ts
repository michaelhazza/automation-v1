/**
 * Weekly Digest — Memory & Briefings Phase 3 S19
 *
 * Backward-looking summary of the subaccount's past 7 days. Complements the
 * forward-looking Intelligence Briefing. Default cadence: Friday 17:00 in the
 * subaccount's configured timezone.
 *
 * Step DAG:
 *   setup_schedule (action_call, idempotent)
 *     └─► gather (skill_call, idempotent)
 *           └─► draft  (prompt, none)
 *                 └─► deliver (action_call, irreversible) — routes via
 *                                                         deliveryService
 *
 * The Memory Health section (Section 5 of the digest output) renders live
 * data from memoryHealthDataService once S14 lands in Phase 4. Until then it
 * renders a "coverage gaps will be computed from Phase 4" stub so the playbook
 * can ship and run end-to-end without cross-phase blockers.
 *
 * Spec: docs/memory-and-briefings-spec.md §7.2 (S19)
 */

import { z } from 'zod';
import { definePlaybook } from '../lib/playbook/definePlaybook.js';

const schedulePickerValueSchema = z.object({
  rrule: z.string().describe('iCal RRULE string defining the recurrence pattern'),
  timezone: z.string().describe('IANA timezone identifier'),
  scheduleTime: z.string().describe('Time of day in HH:MM format'),
});

const deliveryChannelsSchema = z.object({
  email: z.boolean().default(true),
  portal: z.boolean().default(true),
  slack: z.boolean().default(false),
});

export default definePlaybook({
  slug: 'weekly-digest',
  name: 'Weekly Digest',
  description:
    'Backward-looking weekly summary of work completed, what the system learned, KPI movement, pending items, memory health, and next week preview. Delivered via DeliveryChannels (default: inbox + email).',
  version: 1,

  autoStartOnOnboarding: true,

  portalPresentation: {
    cardTitle: 'Weekly Digest',
    headlineStepId: 'draft',
    headlineOutputPath: 'summaryMarkdown',
    detailRoute: undefined,
  },

  initialInputSchema: z.object({
    schedule: schedulePickerValueSchema.describe(
      'Default FREQ=WEEKLY;BYDAY=FR at 17:00; configurable during onboarding',
    ),
    deliveryChannels: deliveryChannelsSchema
      .default({ email: true, portal: true, slack: false })
      .describe('Per-channel delivery selection — inbox is always-on regardless'),
    recipients: z
      .array(z.string().email())
      .max(5)
      .default([])
      .describe('Email recipients (max 5). Empty → subaccount manager default.'),
  }),

  steps: [
    // ── 1. Ensure the recurring schedule exists ───────────────────────────────
    {
      id: 'setup_schedule',
      name: 'Set up weekly digest schedule',
      type: 'action_call',
      dependsOn: [],
      sideEffectType: 'idempotent',
      idempotencyScope: 'entity',
      entityKey: 'task:{{ run.subaccount.id }}:weekly-digest',
      actionSlug: 'config_create_scheduled_task',
      actionInputs: {
        title: 'Weekly Digest',
        description:
          'Weekly retrospective digest. Created by the Weekly Digest playbook.',
        subaccountId: '{{ run.subaccount.id }}',
        rrule: '{{ run.input.schedule.rrule }}',
        timezone: '{{ run.input.schedule.timezone }}',
        scheduleTime: '{{ run.input.schedule.scheduleTime }}',
        taskSlug: 'weekly-digest-{{ run.subaccount.id }}',
        createdByPlaybookSlug: 'weekly-digest',
        runNow: 'true',
      },
      outputSchema: z.object({
        entityId: z.string(),
        title: z.string(),
      }),
    },

    // ── 2. Gather last 7 days of events + memory health data ─────────────────
    {
      id: 'gather',
      name: 'Gather activity and memory health',
      type: 'action_call',
      dependsOn: ['setup_schedule'],
      sideEffectType: 'idempotent',
      actionSlug: 'config_weekly_digest_gather',
      actionInputs: {
        subaccountId: '{{ run.subaccount.id }}',
        organisationId: '{{ run.subaccount.organisationId }}',
        windowDays: '7',
      },
      outputSchema: z.object({
        workCompleted: z.object({
          tasksRun: z.number(),
          deliverables: z.number(),
          actions: z.number(),
        }),
        learned: z.object({
          newEntries: z.number(),
          beliefsUpdated: z.number(),
          blocksCreated: z.number(),
        }),
        kpiMovement: z.array(
          z.object({
            name: z.string(),
            delta: z.string(),
          }),
        ),
        itemsPending: z.object({
          clarificationsBlocked: z.number(),
          reviewQueueItems: z.number(),
          failedTasks: z.number(),
        }),
        memoryHealth: z.object({
          conflictsResolved: z.number().nullable(),
          entriesPruned: z.number().nullable(),
          coverageGaps: z.array(z.string()).nullable(),
          stub: z.boolean().default(false),
        }),
        nextWeekPreview: z.array(
          z.object({
            taskSlug: z.string(),
            nextRunAt: z.string(),
          }),
        ),
      }),
    },

    // ── 3. Draft the digest (LLM synthesises the gathered data) ──────────────
    {
      id: 'draft',
      name: 'Draft the weekly digest',
      type: 'prompt',
      dependsOn: ['gather'],
      sideEffectType: 'none',
      model: 'claude-haiku-4-5-20251001',
      prompt:
        'You are drafting the Weekly Digest for "{{ run.subaccount.name }}" covering the past 7 days.\n\n' +
        'Data:\n{{ steps.gather.output }}\n\n' +
        'Produce exactly six sections in this order:\n' +
        '  1. Work completed\n' +
        '  2. What the system learned\n' +
        '  3. KPI movement (week-over-week)\n' +
        '  4. Items pending\n' +
        '  5. Memory health summary (if `memoryHealth.stub === true`, render "Coverage gaps will be computed from Phase 4." and skip other metrics; otherwise render the real numbers)\n' +
        '  6. Next week preview\n\n' +
        'Return JSON with:\n' +
        '  title (max 80 chars)\n' +
        '  summaryMarkdown (the full six-section digest in markdown, 400-1200 words)\n' +
        '  structuredJson (object mirroring gather output with LLM-added commentary under each section)\n',
      outputSchema: z.object({
        title: z.string().max(80),
        summaryMarkdown: z.string(),
        structuredJson: z.record(z.unknown()),
      }),
    },

    // ── 4. Deliver via deliveryService (inbox + enabled channels) ────────────
    {
      id: 'deliver',
      name: 'Deliver via DeliveryChannels',
      type: 'action_call',
      dependsOn: ['draft'],
      sideEffectType: 'irreversible',
      actionSlug: 'config_deliver_playbook_output',
      actionInputs: {
        subaccountId: '{{ run.subaccount.id }}',
        organisationId: '{{ run.subaccount.organisationId }}',
        artefactTitle: '{{ steps.draft.output.title }}',
        artefactContent: '{{ steps.draft.output.summaryMarkdown }}',
        deliveryChannels: '{{ run.input.deliveryChannels }}',
      },
      outputSchema: z.object({
        taskId: z.string(),
        channels: z.array(
          z.object({
            channel: z.string(),
            status: z.string(),
            attempts: z.number(),
          }),
        ),
      }),
    },
  ],
});
