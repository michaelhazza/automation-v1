import { AgentPresenceState } from '../../../shared/types/agentPresence';

export interface PresenceRow {
  agentId: string;
  presenceState: AgentPresenceState;
  degradedBaseState: 'idle' | 'running' | 'waiting_on_human' | 'waiting_on_dependency' | 'scheduled' | null;
  nextRunAt: string | null;
  updatedAt: string;
}

export type PresenceSection = 'waiting_on_you' | 'working_now' | 'failing' | 'scheduled_next' | 'idle';

export function getEffectiveSection(row: PresenceRow): PresenceSection {
  // Degraded agents float into their base state's section
  const effectiveState: AgentPresenceState =
    row.presenceState === 'degraded' && row.degradedBaseState
      ? (row.degradedBaseState as AgentPresenceState)
      : row.presenceState;

  switch (effectiveState) {
    case 'waiting_on_human': return 'waiting_on_you';
    case 'running': return 'working_now';
    case 'waiting_on_dependency': return 'working_now'; // rolled into Working now footer
    case 'failed': return 'failing';
    case 'scheduled': return 'scheduled_next';
    case 'idle': return 'idle';
    case 'degraded': return 'working_now'; // degraded without base state defaults to working_now
    default: return 'idle';
  }
}

const SECTION_ORDER: PresenceSection[] = ['waiting_on_you', 'working_now', 'failing', 'scheduled_next', 'idle'];

/**
 * Pure comparator: sorts PresenceRow[] according to the Home widget section order.
 * Section order: Waiting on you → Working now → Failing → Scheduled next → Idle
 * Within Scheduled next: next_run_at ASC
 * Within all others: updated_at DESC
 */
export function orderHomePresenceSections(rows: PresenceRow[]): PresenceRow[] {
  return [...rows].sort((a, b) => {
    const sectionA = getEffectiveSection(a);
    const sectionB = getEffectiveSection(b);

    const sectionDiff = SECTION_ORDER.indexOf(sectionA) - SECTION_ORDER.indexOf(sectionB);
    if (sectionDiff !== 0) return sectionDiff;

    // Within 'scheduled_next': sort by next_run_at ASC (nulls last)
    if (sectionA === 'scheduled_next') {
      if (!a.nextRunAt && !b.nextRunAt) return 0;
      if (!a.nextRunAt) return 1;
      if (!b.nextRunAt) return -1;
      return a.nextRunAt < b.nextRunAt ? -1 : a.nextRunAt > b.nextRunAt ? 1 : 0;
    }

    // Within all other sections: sort by updated_at DESC
    return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
  });
}
