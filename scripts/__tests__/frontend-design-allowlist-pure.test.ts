/**
 * frontend-design-allowlist-pure.test.ts
 *
 * Vitest unit tests for scripts/lib/frontend-design-allowlist-pure.mjs:
 *   isInAllowlist, scanImports
 *
 * Run via: npx vitest run scripts/__tests__/frontend-design-allowlist-pure.test.ts
 *
 * Coverage assertions (from chunk 6 definition-of-done):
 *   (d) file in allow-list → no flag (isInAllowlist returns true)
 */

import { describe, expect, test } from 'vitest';
import { isInAllowlist, scanImports } from '../lib/frontend-design-allowlist-pure.mjs';

const SAMPLE_ALLOWLIST = {
  _doc: 'Test allow-list',
  files: [
    {
      path: 'client/src/pages/UsagePage.tsx',
      components: ['RunActivityChart'],
      reason: 'usage analytics page',
    },
    {
      path: 'client/src/pages/SystemPnlPage.tsx',
      components: ['PnlKpiCard', 'PnlTrendChart'],
      reason: 'P&L page for billing operators',
    },
  ],
};

// ── isInAllowlist ─────────────────────────────────────────────────────────────

describe('isInAllowlist', () => {
  // (d) file in allow-list → no flag (returns true)
  test('(d) file present in allow-list returns true', () => {
    expect(
      isInAllowlist({ file: 'client/src/pages/UsagePage.tsx', allowlist: SAMPLE_ALLOWLIST })
    ).toBe(true);
  });

  test('file NOT in allow-list returns false', () => {
    expect(
      isInAllowlist({ file: 'client/src/pages/SomeOtherPage.tsx', allowlist: SAMPLE_ALLOWLIST })
    ).toBe(false);
  });

  test('empty files array returns false', () => {
    expect(
      isInAllowlist({ file: 'client/src/pages/UsagePage.tsx', allowlist: { files: [] } })
    ).toBe(false);
  });

  test('allowlist with no files key returns false', () => {
    expect(
      isInAllowlist({ file: 'client/src/pages/UsagePage.tsx', allowlist: {} as never })
    ).toBe(false);
  });

  test('path must match exactly (case-sensitive)', () => {
    expect(
      isInAllowlist({ file: 'client/src/pages/usagepage.tsx', allowlist: SAMPLE_ALLOWLIST })
    ).toBe(false);
  });
});

// ── scanImports ───────────────────────────────────────────────────────────────

describe('scanImports', () => {
  const COMPONENTS = ['MetricCard', 'RunActivityChart', 'PnlKpiCard', 'SparklineChart'];

  test('detects default import', () => {
    const content = `import MetricCard from '../../components/MetricCard';`;
    expect(scanImports({ content, components: COMPONENTS })).toContain('MetricCard');
  });

  test('detects named import', () => {
    const content = `import { RunActivityChart } from '../../components/ActivityCharts';`;
    expect(scanImports({ content, components: COMPONENTS })).toContain('RunActivityChart');
  });

  test('detects mixed import', () => {
    const content = `import MetricCard, { RunActivityChart } from '../../components/ActivityCharts';`;
    const found = scanImports({ content, components: COMPONENTS });
    expect(found).toContain('MetricCard');
    expect(found).toContain('RunActivityChart');
  });

  test('returns empty array when no monitored imports present', () => {
    const content = `import { useState } from 'react';\nimport { Button } from './Button';`;
    expect(scanImports({ content, components: COMPONENTS })).toHaveLength(0);
  });

  test('does not flag partial name match (MetricCardXL is not MetricCard)', () => {
    // MetricCardXL contains MetricCard but is not the same token
    const content = `import MetricCardXL from '../../components/MetricCardXL';`;
    // The pattern uses word boundaries so MetricCard in MetricCardXL should NOT match
    // unless MetricCard appears as a separate token
    const found = scanImports({ content, components: ['MetricCard'] });
    expect(found).not.toContain('MetricCard');
  });

  test('detects import with aliased name (import X as Y)', () => {
    // The component name still appears in the import statement
    const content = `import { SparklineChart as Chart } from '../clientpulse/SparklineChart';`;
    expect(scanImports({ content, components: COMPONENTS })).toContain('SparklineChart');
  });

  test('returns multiple components when multiple are imported', () => {
    const content = [
      `import MetricCard from '../../components/MetricCard';`,
      `import { RunActivityChart } from '../../components/ActivityCharts';`,
      `import PnlKpiCard from '../system-pnl/PnlKpiCard';`,
    ].join('\n');
    const found = scanImports({ content, components: COMPONENTS });
    expect(found).toContain('MetricCard');
    expect(found).toContain('RunActivityChart');
    expect(found).toContain('PnlKpiCard');
    expect(found).toHaveLength(3);
  });
});
