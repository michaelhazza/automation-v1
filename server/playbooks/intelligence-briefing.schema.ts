/**
 * intelligence-briefing — Configuration Schema (§9.2)
 *
 * Declares the question set the onboarding conversation (Step 6) and the
 * async Configuration Document both ask. Maps 1-1 to the runtime input shape
 * of the playbook's `initialInputSchema`.
 *
 * Spec: docs/memory-and-briefings-spec.md §9.2 (S21)
 */

import type { ConfigQuestion } from '../types/configSchema.js';

export const INTELLIGENCE_BRIEFING_SCHEMA: ConfigQuestion[] = [
  {
    id: 'briefing.schedule_day',
    section: 'Intelligence Briefing',
    question: 'Which day of the week should the briefing arrive?',
    helpText: 'Default Monday — the start-of-week forward-looking briefing.',
    type: 'select',
    options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    default: 'Mon',
    required: true,
    derivableFrom: ['business_cadence'],
  },
  {
    id: 'briefing.schedule_time',
    section: 'Intelligence Briefing',
    question: 'What time of day?',
    helpText: 'Format HH:MM in the subaccount timezone. Default 07:00.',
    type: 'text',
    default: '07:00',
    required: true,
    validationHint: '24-hour HH:MM format (e.g. 07:00)',
  },
  {
    id: 'briefing.focus_areas',
    section: 'Intelligence Briefing',
    question: 'Which intelligence areas should we cover?',
    helpText: 'Select one or more signals to track.',
    type: 'multiselect',
    options: ['competitive', 'regulatory', 'campaigns', 'industry_news'],
    default: ['competitive', 'industry_news'],
    required: true,
    derivableFrom: ['industry', 'services'],
  },
  {
    id: 'briefing.delivery_channels',
    section: 'Intelligence Briefing',
    question: 'Where should it be delivered?',
    helpText: 'Inbox is always-on. Select additional channels.',
    type: 'deliveryChannels',
    required: true,
  },
  {
    id: 'briefing.recipients',
    section: 'Intelligence Briefing',
    question: 'Who should receive it?',
    helpText: 'Email addresses (comma-separated). Defaults to the subaccount manager.',
    type: 'email',
    required: false,
    derivableFrom: ['subaccount_manager_email'],
  },
];
