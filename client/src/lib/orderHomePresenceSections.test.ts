import { describe, it, expect } from 'vitest';
import { orderHomePresenceSections, getEffectiveSection, PresenceRow } from './orderHomePresenceSections';

function row(overrides: Partial<PresenceRow> & Pick<PresenceRow, 'agentId' | 'presenceState'>): PresenceRow {
  return {
    degradedBaseState: null,
    nextRunAt: null,
    updatedAt: '2026-05-08T10:00:00Z',
    ...overrides,
  };
}

describe('getEffectiveSection', () => {
  it('waiting_on_human → waiting_on_you', () => {
    expect(getEffectiveSection(row({ agentId: 'a', presenceState: 'waiting_on_human' }))).toBe('waiting_on_you');
  });
  it('running → working_now', () => {
    expect(getEffectiveSection(row({ agentId: 'a', presenceState: 'running' }))).toBe('working_now');
  });
  it('failed → failing', () => {
    expect(getEffectiveSection(row({ agentId: 'a', presenceState: 'failed' }))).toBe('failing');
  });
  it('scheduled → scheduled_next', () => {
    expect(getEffectiveSection(row({ agentId: 'a', presenceState: 'scheduled' }))).toBe('scheduled_next');
  });
  it('idle → idle', () => {
    expect(getEffectiveSection(row({ agentId: 'a', presenceState: 'idle' }))).toBe('idle');
  });
  it('degraded with degraded_base_state = running → working_now', () => {
    expect(getEffectiveSection(row({ agentId: 'a', presenceState: 'degraded', degradedBaseState: 'running' }))).toBe('working_now');
  });
  it('degraded with degraded_base_state = waiting_on_human → waiting_on_you', () => {
    expect(getEffectiveSection(row({ agentId: 'a', presenceState: 'degraded', degradedBaseState: 'waiting_on_human' }))).toBe('waiting_on_you');
  });
});

describe('orderHomePresenceSections', () => {
  it('section order: waiting_on_you before working_now before failing before scheduled_next', () => {
    const rows = [
      row({ agentId: 'sched', presenceState: 'scheduled' }),
      row({ agentId: 'work', presenceState: 'running' }),
      row({ agentId: 'wait', presenceState: 'waiting_on_human' }),
      row({ agentId: 'fail', presenceState: 'failed' }),
    ];
    const sorted = orderHomePresenceSections(rows);
    expect(sorted.map(r => r.agentId)).toEqual(['wait', 'work', 'fail', 'sched']);
  });

  it('within scheduled_next: next_run_at ASC', () => {
    const rows = [
      row({ agentId: 'b', presenceState: 'scheduled', nextRunAt: '2026-05-08T14:00:00Z' }),
      row({ agentId: 'a', presenceState: 'scheduled', nextRunAt: '2026-05-08T12:00:00Z' }),
      row({ agentId: 'c', presenceState: 'scheduled', nextRunAt: '2026-05-09T08:00:00Z' }),
    ];
    const sorted = orderHomePresenceSections(rows);
    expect(sorted.map(r => r.agentId)).toEqual(['a', 'b', 'c']);
  });

  it('within working_now: updated_at DESC', () => {
    const rows = [
      row({ agentId: 'older', presenceState: 'running', updatedAt: '2026-05-08T09:00:00Z' }),
      row({ agentId: 'newer', presenceState: 'running', updatedAt: '2026-05-08T11:00:00Z' }),
    ];
    const sorted = orderHomePresenceSections(rows);
    expect(sorted[0].agentId).toBe('newer');
    expect(sorted[1].agentId).toBe('older');
  });

  it('degraded agent with degraded_base_state=running floats into working_now section', () => {
    const rows = [
      row({ agentId: 'fail', presenceState: 'failed' }),
      row({ agentId: 'degraded_runner', presenceState: 'degraded', degradedBaseState: 'running', updatedAt: '2026-05-08T11:00:00Z' }),
      row({ agentId: 'normal_runner', presenceState: 'running', updatedAt: '2026-05-08T10:00:00Z' }),
    ];
    const sorted = orderHomePresenceSections(rows);
    // working_now section (2 agents) before failing section (1 agent)
    expect(sorted[0].agentId).toBe('degraded_runner');
    expect(sorted[1].agentId).toBe('normal_runner');
    expect(sorted[2].agentId).toBe('fail');
  });
});
