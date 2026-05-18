import { describe, test, expect, vi, beforeEach } from 'vitest';

// We need to mock the .registry-meta.json and the fs read to control what
// isValidatorEnabled sees without touching the real file on disk.
// The registry is built at module load, so we use dynamic imports with
// vi.doMock to inject controlled behaviour per test scenario.

describe('registry — getValidator', () => {
  test('returns output_non_empty for known slug', async () => {
    const { getValidator } = await import('../registry.js');
    const v = getValidator('output_non_empty');
    expect(v).toBeDefined();
    expect(v?.slug).toBe('output_non_empty');
    expect(v?.version).toBe('1.0.0');
    expect(v?.kind).toBe('deterministic');
  });

  test('returns undefined for unknown slug', async () => {
    const { getValidator } = await import('../registry.js');
    expect(getValidator('does_not_exist')).toBeUndefined();
  });
});

describe('registry — getAllValidatorSummaries', () => {
  test('includes output_non_empty in summaries', async () => {
    const { getAllValidatorSummaries } = await import('../registry.js');
    const summaries = getAllValidatorSummaries();
    const found = summaries.find((s) => s.slug === 'output_non_empty');
    expect(found).toBeDefined();
    expect(found?.kind).toBe('deterministic');
    expect(found?.deprecated).toBe(false);
  });
});

describe('registry — testsGreen: false exclusion', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('excludes a validator whose testsGreen is false (no bypass)', async () => {
    // Mock readFileSync to return controlled meta JSON.
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        readFileSync: (filePath: string, encoding: unknown) => {
          if (typeof filePath === 'string' && filePath.endsWith('.registry-meta.json')) {
            return JSON.stringify({
              validators: {
                output_non_empty: { testsGreen: false },
              },
              generatedAt: '2026-05-18T10:00:00Z',
              ciRunId: 'test',
            });
          }
          return actual.readFileSync(filePath as string, encoding as BufferEncoding);
        },
      };
    });

    const { getValidator } = await import('../registry.js');
    expect(getValidator('output_non_empty')).toBeUndefined();
  });
});

describe('registry — skipEnforcement expiry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('throws at boot when skipEnforcementExpiry is in the past', async () => {
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        readFileSync: (filePath: string, encoding: unknown) => {
          if (typeof filePath === 'string' && filePath.endsWith('.registry-meta.json')) {
            return JSON.stringify({
              validators: {
                output_non_empty: {
                  testsGreen: false,
                  skipEnforcement: true,
                  skipEnforcementExpiry: '2020-01-01',
                  reason: 'expired bypass',
                },
              },
              generatedAt: '2026-05-18T10:00:00Z',
              ciRunId: 'test',
            });
          }
          return actual.readFileSync(filePath as string, encoding as BufferEncoding);
        },
      };
    });

    await expect(import('../registry.js')).rejects.toThrow(/expired skipEnforcementExpiry/);
  });

  test('includes validator when skipEnforcement is valid and not expired', async () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);

    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        readFileSync: (filePath: string, encoding: unknown) => {
          if (typeof filePath === 'string' && filePath.endsWith('.registry-meta.json')) {
            return JSON.stringify({
              validators: {
                output_non_empty: {
                  testsGreen: false,
                  skipEnforcement: true,
                  skipEnforcementExpiry: futureDate.toISOString().slice(0, 10),
                  reason: 'temporary bypass',
                },
              },
              generatedAt: '2026-05-18T10:00:00Z',
              ciRunId: 'test',
            });
          }
          return actual.readFileSync(filePath as string, encoding as BufferEncoding);
        },
      };
    });

    const { getValidator } = await import('../registry.js');
    expect(getValidator('output_non_empty')).toBeDefined();
  });
});
