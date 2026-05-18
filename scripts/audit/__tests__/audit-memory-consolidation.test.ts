import { describe, it, expect } from 'vitest';
import {
  combinedVerdict,
  formatTodoEntry,
  check7ConfigVersionVerdict,
  check3FlagStateVerdict,
} from '../audit-memory-consolidation.js';
import type { AuditCheckResult } from '../../../shared/types/memoryConsolidation.js';

// ---------------------------------------------------------------------------
// combinedVerdict
// ---------------------------------------------------------------------------

describe('combinedVerdict', () => {
  it('returns pass when all checks are pass', () => {
    const checks: AuditCheckResult[] = [
      { checkName: 'a', status: 'pass', findings: [], evidence: null },
      { checkName: 'b', status: 'pass', findings: [], evidence: null },
    ];
    expect(combinedVerdict(checks)).toBe('pass');
  });

  it('returns pass when all checks are n/a', () => {
    const checks: AuditCheckResult[] = [
      { checkName: 'a', status: 'n/a', findings: [], evidence: null },
      { checkName: 'b', status: 'n/a', findings: [], evidence: null },
    ];
    expect(combinedVerdict(checks)).toBe('pass');
  });

  it('returns pass when mix of pass and n/a', () => {
    const checks: AuditCheckResult[] = [
      { checkName: 'a', status: 'pass', findings: [], evidence: null },
      { checkName: 'b', status: 'n/a', findings: [], evidence: null },
    ];
    expect(combinedVerdict(checks)).toBe('pass');
  });

  it('returns warn when one check is warn and none fail', () => {
    const checks: AuditCheckResult[] = [
      { checkName: 'a', status: 'pass', findings: [], evidence: null },
      { checkName: 'b', status: 'warn', findings: [], evidence: null },
    ];
    expect(combinedVerdict(checks)).toBe('warn');
  });

  it('returns fail when one check is fail', () => {
    const checks: AuditCheckResult[] = [
      { checkName: 'a', status: 'pass', findings: [], evidence: null },
      { checkName: 'b', status: 'fail', findings: [], evidence: null },
    ];
    expect(combinedVerdict(checks)).toBe('fail');
  });

  it('returns fail when mix of warn and fail', () => {
    const checks: AuditCheckResult[] = [
      { checkName: 'a', status: 'warn', findings: [], evidence: null },
      { checkName: 'b', status: 'fail', findings: [], evidence: null },
    ];
    expect(combinedVerdict(checks)).toBe('fail');
  });

  it('returns warn for a single warn check', () => {
    const checks: AuditCheckResult[] = [
      { checkName: 'a', status: 'warn', findings: [], evidence: null },
    ];
    expect(combinedVerdict(checks)).toBe('warn');
  });

  it('returns pass for an empty check array', () => {
    expect(combinedVerdict([])).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// formatTodoEntry
// ---------------------------------------------------------------------------

describe('formatTodoEntry', () => {
  it('produces the expected markdown entry format', () => {
    const result = formatTodoEntry(
      'check1_tier_distribution',
      'Empty tiers detected for tenant X.',
      'staging',
      '2026-05-18',
      'scripts/audit/_logs/memory-consolidation-audit-staging-2026-05-18.json',
    );
    expect(result).toBe(
      '- **[2026-05-18] [staging] [check1_tier_distribution]** Empty tiers detected for tenant X.. Evidence: `scripts/audit/_logs/memory-consolidation-audit-staging-2026-05-18.json`.',
    );
  });

  it('includes the env, runDate, and checkName in the output', () => {
    const result = formatTodoEntry('check7_config_version', 'Version mismatch.', 'prod', '2026-06-01', 'path/to/file.json');
    expect(result).toContain('[2026-06-01]');
    expect(result).toContain('[prod]');
    expect(result).toContain('[check7_config_version]');
    expect(result).toContain('Version mismatch.');
    expect(result).toContain('`path/to/file.json`');
  });
});

// ---------------------------------------------------------------------------
// check7ConfigVersionVerdict
// ---------------------------------------------------------------------------

describe('check7ConfigVersionVerdict', () => {
  it('returns pass when active version exists in history', () => {
    const result = check7ConfigVersionVerdict(1, [1, 2, 3]);
    expect(result.status).toBe('pass');
    expect(result.checkName).toBe('check7_config_version');
    expect(result.evidence).toMatchObject({ consistent: true });
  });

  it('returns fail when active version is not in history', () => {
    const result = check7ConfigVersionVerdict(99, [1, 2, 3]);
    expect(result.status).toBe('fail');
    expect(result.findings[0]).toContain('99');
    expect(result.evidence).toMatchObject({ consistent: false });
  });

  it('returns fail for empty history', () => {
    const result = check7ConfigVersionVerdict(1, []);
    expect(result.status).toBe('fail');
  });

  it('returns pass when version 1 is the sole history entry', () => {
    const result = check7ConfigVersionVerdict(1, [1]);
    expect(result.status).toBe('pass');
  });

  it('includes historyVersions in evidence', () => {
    const result = check7ConfigVersionVerdict(2, [1, 2]);
    expect((result.evidence as { historyVersions: number[] }).historyVersions).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// check3FlagStateVerdict
// ---------------------------------------------------------------------------

describe('check3FlagStateVerdict', () => {
  it('returns pass when flag is ON', () => {
    const result = check3FlagStateVerdict(true);
    expect(result.status).toBe('pass');
    expect(result.findings[0]).toContain('true');
    expect((result.evidence as { flagEnabled: boolean }).flagEnabled).toBe(true);
  });

  it('returns pass when flag is OFF', () => {
    const result = check3FlagStateVerdict(false);
    expect(result.status).toBe('pass');
    expect(result.findings[0]).toContain('false');
    expect((result.evidence as { flagEnabled: boolean }).flagEnabled).toBe(false);
  });

  it('always returns checkName check3_flag_state', () => {
    expect(check3FlagStateVerdict(true).checkName).toBe('check3_flag_state');
    expect(check3FlagStateVerdict(false).checkName).toBe('check3_flag_state');
  });
});
