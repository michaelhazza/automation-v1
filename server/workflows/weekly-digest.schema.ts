/**
 * weekly-digest — Configuration Schema (§9.2)
 *
 * Mirrors intelligence-briefing.schema.ts but for the backward-looking
 * Friday-evening retrospective digest.
 *
 * Spec: docs/memory-and-briefings-spec.md §9.2 (S21)
 */

import type { ConfigQuestion } from '../types/configSchema.js';

export const WEEKLY_DIGEST_SCHEMA: ConfigQuestion[] = [
  {
    id: 'digest.schedule_day',
    section: 'Weekly Digest',
    question: 'Which day of the week should the digest arrive?',
    helpText: 'Default Friday — end-of-week retrospective.',
    type: 'select',
    options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    default: 'Fri',
    required: true,
  },
  {
    id: 'digest.schedule_time',
    section: 'Weekly Digest',
    question: 'What time of day?',
    helpText: 'Format HH:MM in the subaccount timezone. Default 17:00.',
    type: 'text',
    default: '17:00',
    required: true,
    validationHint: '24-hour HH:MM format (e.g. 17:00)',
  },
  {
    id: 'digest.delivery_channels',
    section: 'Weekly Digest',
    question: 'Where should it be delivered?',
    helpText: 'Inbox is always-on. Select additional channels.',
    type: 'deliveryChannels',
    required: true,
  },
  {
    id: 'digest.recipients',
    section: 'Weekly Digest',
    question: 'Who should receive it?',
    helpText: 'Email addresses (comma-separated). Defaults to the subaccount manager.',
    type: 'email',
    required: false,
    derivableFrom: ['subaccount_manager_email'],
  },
];
