import { describe, it, expect } from 'vitest';
import { reportRenderingService } from '../reportRenderingService.js';
import type { MacroReportInput } from '../reportRenderingService.js';

const FIXTURE: MacroReportInput = {
  organisationId: 'org-1',
  agentRunId: 'run-1',
  ieeRunId: 'iee-1',
  date: '2026-05-01',
  source: { videoTitle: 'Q1 Review', publishedDate: '2026-04-30', sourceUrl: 'https://example.com' },
  executiveSummary: ['Revenue up 12%', 'Churn reduced'],
  fullAnalysis: [{ heading: 'Revenue', body: 'Increased due to new pricing.' }],
  transcriptExcerpt: 'Sample transcript...',
  pdfRendererVersion: '4.5.1',
};

describe('reportRenderingService', () => {
  it('renders the same input to identical bytes (determinism contract)', async () => {
    const [buf1, buf2] = await Promise.all([
      reportRenderingService.renderMacroReportPdf(FIXTURE),
      reportRenderingService.renderMacroReportPdf(FIXTURE),
    ]);
    expect(buf1.equals(buf2)).toBe(true);
  });

  it('returns a non-empty Buffer', async () => {
    const buf = await reportRenderingService.renderMacroReportPdf(FIXTURE);
    expect(buf.length).toBeGreaterThan(0);
  });
});
