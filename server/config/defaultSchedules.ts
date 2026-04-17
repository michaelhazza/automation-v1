/**
 * defaultSchedules — canonical RRULE + time defaults for system playbooks.
 *
 * Consumed by:
 *   - the onboarding conversation (Steps 6 and 7) to pre-fill the schedule picker
 *   - playbook autostart paths that need a deterministic first schedule
 *   - seed scripts provisioning fresh subaccounts
 *
 * Agencies can override per-subaccount via the Configuration Assistant.
 *
 * Spec: docs/memory-and-briefings-spec.md §7.3 (S20)
 */

export interface DefaultScheduleConfig {
  /** iCal RRULE string. */
  rrule: string;
  /** Time of day in HH:MM (24h). */
  scheduleTime: string;
  /** Human-readable summary used in the onboarding prompt. */
  humanDefault: string;
}

/**
 * Default schedules keyed by playbook slug. Timezone is always the subaccount's
 * configured TZ — the RRULE itself is TZ-agnostic.
 */
export const DEFAULT_SCHEDULES: Readonly<Record<string, DefaultScheduleConfig>> = Object.freeze({
  'intelligence-briefing': {
    rrule: 'FREQ=WEEKLY;BYDAY=MO',
    scheduleTime: '07:00',
    humanDefault: 'Monday at 07:00',
  },
  'weekly-digest': {
    rrule: 'FREQ=WEEKLY;BYDAY=FR',
    scheduleTime: '17:00',
    humanDefault: 'Friday at 17:00',
  },
});

/**
 * Returns the default schedule for a playbook slug, or undefined when the
 * playbook has no declared default. Callers fall back to asking the user.
 */
export function getDefaultSchedule(playbookSlug: string): DefaultScheduleConfig | undefined {
  return DEFAULT_SCHEDULES[playbookSlug];
}

/**
 * The default set of playbooks autostarted on subaccount onboarding, in
 * display order. The bundle manifest in `onboarding_bundle_configs` (Phase 3
 * migration 0142) supersedes this per-org; this is the platform baseline.
 */
export const DEFAULT_ONBOARDING_BUNDLE: ReadonlyArray<string> = Object.freeze([
  'intelligence-briefing',
  'weekly-digest',
]);
