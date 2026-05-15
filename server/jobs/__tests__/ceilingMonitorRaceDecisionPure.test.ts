import { describe, it, expect } from 'vitest';
import { decideCeilingVsProviderRaceOutcome } from '../ceilingMonitorRaceDecisionPure.js';

describe('decideCeilingVsProviderRaceOutcome', () => {
  // Test 1: row in pre-terminal state, monitor first → monitor wins.
  it('returns monitor when row is in running state and monitor claims first', () => {
    const result = decideCeilingVsProviderRaceOutcome({
      rowStatusAtMonitorTick: 'running',
      providerOutputAvailable: false,
      monitorClaimedFirst: true,
    });
    expect(result.winner).toBe('monitor');
  });

  it('returns monitor when row is in pending state and monitor claims first', () => {
    const result = decideCeilingVsProviderRaceOutcome({
      rowStatusAtMonitorTick: 'pending',
      providerOutputAvailable: false,
      monitorClaimedFirst: true,
    });
    expect(result.winner).toBe('monitor');
  });

  // Test 2: row in harvesting with provider output available → provider wins.
  it('returns provider when row is harvesting and provider output is available', () => {
    const result = decideCeilingVsProviderRaceOutcome({
      rowStatusAtMonitorTick: 'harvesting',
      providerOutputAvailable: true,
      monitorClaimedFirst: false,
    });
    expect(result.winner).toBe('provider');
  });

  // Test 3: row in any terminal state → provider wins.
  it('returns provider when row is in completed terminal state', () => {
    const result = decideCeilingVsProviderRaceOutcome({
      rowStatusAtMonitorTick: 'completed',
      providerOutputAvailable: false,
      monitorClaimedFirst: true,
    });
    expect(result.winner).toBe('provider');
  });

  it('returns provider for each terminal state', () => {
    const terminalStates = [
      'completed',
      'timed_out',
      'cost_ceiling_hit',
      'crashed',
      'output_validation_failed',
      'harvest_failed',
      'artefact_upload_failed',
      'provider_unavailable',
    ] as const;

    for (const status of terminalStates) {
      const result = decideCeilingVsProviderRaceOutcome({
        rowStatusAtMonitorTick: status,
        providerOutputAvailable: false,
        monitorClaimedFirst: true,
      });
      expect(result.winner).toBe('provider');
    }
  });

  // Test 4: both observe harvesting with no provider output → tied.
  it('returns tied when both observe harvesting with no provider output and monitor did not claim first', () => {
    const result = decideCeilingVsProviderRaceOutcome({
      rowStatusAtMonitorTick: 'harvesting',
      providerOutputAvailable: false,
      monitorClaimedFirst: false,
    });
    expect(result.winner).toBe('tied');
  });

  // Test 5: rationale field is always populated.
  it('always returns a non-empty rationale string', () => {
    const cases = [
      { rowStatusAtMonitorTick: 'running' as const, providerOutputAvailable: false, monitorClaimedFirst: true },
      { rowStatusAtMonitorTick: 'harvesting' as const, providerOutputAvailable: true, monitorClaimedFirst: false },
      { rowStatusAtMonitorTick: 'completed' as const, providerOutputAvailable: false, monitorClaimedFirst: true },
      { rowStatusAtMonitorTick: 'harvesting' as const, providerOutputAvailable: false, monitorClaimedFirst: false },
      { rowStatusAtMonitorTick: 'harvesting' as const, providerOutputAvailable: false, monitorClaimedFirst: true },
    ];

    for (const input of cases) {
      const result = decideCeilingVsProviderRaceOutcome(input);
      expect(result.rationale).toBeTruthy();
      expect(typeof result.rationale).toBe('string');
      expect(result.rationale.length).toBeGreaterThan(0);
    }
  });

  // Additional: harvesting + no provider output + monitor claimed first → monitor wins.
  it('returns monitor when harvesting, no provider output, monitor claimed first', () => {
    const result = decideCeilingVsProviderRaceOutcome({
      rowStatusAtMonitorTick: 'harvesting',
      providerOutputAvailable: false,
      monitorClaimedFirst: true,
    });
    expect(result.winner).toBe('monitor');
  });
});
