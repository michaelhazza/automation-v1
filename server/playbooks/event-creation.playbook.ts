/**
 * Event Creation Playbook — first system template (spec §3.6).
 *
 * 6 steps that exercise the full Phase 1 feature set:
 *   1. user_input              — gather venue/capacity from the operator
 *   2. agent_call (review)     — draft positioning statement; humanReviewRequired
 *   3. agent_call (parallel)   — landing page hero copy
 *   4. agent_call (parallel)   — announcement email
 *   5. approval                — marketing review gate before publishing
 *   6. agent_call (irreversible) — publish landing page to CMS
 *
 * Steps 3 and 4 both depend only on step 2, so they execute in parallel.
 * Step 6 is irreversible — the engine will block automatic re-execution
 * if anything upstream is later edited (the user must explicitly opt in
 * via skip-and-reuse).
 *
 * To seed locally:
 *   npm run migrate
 *   npm run playbooks:seed
 *
 * To validate without touching the DB:
 *   npm run playbooks:validate
 */

import { z } from 'zod';
import { definePlaybook } from '../lib/playbook/definePlaybook.js';

export default definePlaybook({
  slug: 'event-creation',
  name: 'Create a New Event',
  description:
    'End-to-end content pack for launching a new event: positioning, landing page hero, announcement email, marketing review, and CMS publish.',
  version: 1,

  initialInputSchema: z.object({
    eventName: z.string().min(3),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    audience: z.string().min(3),
  }),

  steps: [
    // ── 1. Gather venue + capacity from the operator (form input) ──────────
    {
      id: 'event_basics',
      name: 'Confirm event basics',
      type: 'user_input',
      dependsOn: [],
      sideEffectType: 'none',
      formSchema: z.object({
        venue: z.string().min(2),
        capacity: z.number().int().positive(),
        ticketPriceCents: z.number().int().nonnegative(),
      }),
      outputSchema: z.object({
        venue: z.string(),
        capacity: z.number(),
        ticketPriceCents: z.number(),
      }),
    },

    // ── 2. Draft positioning statement (with human review) ────────────────
    {
      id: 'positioning',
      name: 'Draft positioning statement',
      type: 'agent_call',
      dependsOn: ['event_basics'],
      sideEffectType: 'none',
      humanReviewRequired: true,
      agentRef: { kind: 'system', slug: 'copywriter' },
      agentInputs: {
        eventName: '{{ run.input.eventName }}',
        venue: '{{ steps.event_basics.output.venue }}',
        audience: '{{ run.input.audience }}',
      },
      prompt:
        'Draft a one-paragraph positioning statement for {{ run.input.eventName }} at {{ steps.event_basics.output.venue }} for {{ run.input.audience }}. Return JSON with `positioning` (the paragraph) and `tagline` (a 5-7 word hook).',
      outputSchema: z.object({
        positioning: z.string(),
        tagline: z.string(),
      }),
    },

    // ── 3. Landing page hero copy (parallel with email) ───────────────────
    {
      id: 'landing_page_hero',
      name: 'Landing page hero copy',
      type: 'agent_call',
      dependsOn: ['positioning'],
      sideEffectType: 'none',
      agentRef: { kind: 'system', slug: 'copywriter' },
      agentInputs: {
        tagline: '{{ steps.positioning.output.tagline }}',
        positioning: '{{ steps.positioning.output.positioning }}',
      },
      prompt:
        'Write a hero section for the landing page using tagline "{{ steps.positioning.output.tagline }}". Return JSON with `headline`, `subheadline`, and `ctaText`.',
      outputSchema: z.object({
        headline: z.string(),
        subheadline: z.string(),
        ctaText: z.string(),
      }),
    },

    // ── 4. Announcement email (parallel with hero) ────────────────────────
    {
      id: 'email_announcement',
      name: 'Announcement email',
      type: 'agent_call',
      dependsOn: ['positioning'],
      sideEffectType: 'none',
      agentRef: { kind: 'system', slug: 'copywriter' },
      agentInputs: {
        positioning: '{{ steps.positioning.output.positioning }}',
        eventName: '{{ run.input.eventName }}',
      },
      prompt:
        'Write an announcement email for {{ run.input.eventName }} using the positioning. Return JSON with `subject` and `body`.',
      outputSchema: z.object({
        subject: z.string(),
        body: z.string(),
      }),
    },

    // ── 5. Marketing review gate ──────────────────────────────────────────
    {
      id: 'content_review',
      name: 'Marketing review',
      type: 'approval',
      dependsOn: ['landing_page_hero', 'email_announcement'],
      sideEffectType: 'none',
      approvalPrompt:
        'Review the landing page hero and announcement email below. Approve to proceed to publishing.',
      outputSchema: z.object({
        approvedAt: z.string(),
      }),
    },

    // ── 6. Publish to CMS (IRREVERSIBLE) ──────────────────────────────────
    // Depends on content_review for the gate AND landing_page_hero for the
    // actual content fields it templates into agentInputs. Validator's
    // transitive-dep rule requires every referenced step to be explicit.
    {
      id: 'publish_landing_page',
      name: 'Publish landing page to CMS',
      type: 'agent_call',
      dependsOn: ['content_review', 'landing_page_hero'],
      sideEffectType: 'irreversible',
      // Irreversible steps cannot have retryPolicy.maxAttempts > 1
      // (validator rule 12 + runtime backstop in §5.5).
      retryPolicy: { maxAttempts: 1 },
      agentRef: { kind: 'org', slug: 'cms_publisher' },
      agentInputs: {
        headline: '{{ steps.landing_page_hero.output.headline }}',
        subheadline: '{{ steps.landing_page_hero.output.subheadline }}',
        ctaText: '{{ steps.landing_page_hero.output.ctaText }}',
      },
      prompt:
        'Publish a new landing page with the supplied content. Return JSON with `pageId` and `url`.',
      outputSchema: z.object({
        pageId: z.string(),
        url: z.string().url(),
      }),
    },
  ],
});
