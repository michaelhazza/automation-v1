import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import { MacroReport } from './reportTemplates/MacroReport.js';
import { logger } from '../lib/logger.js';

export interface MacroReportInput {
  organisationId: string;
  agentRunId: string;
  ieeRunId: string;
  date: string;
  source: { videoTitle: string; publishedDate: string; sourceUrl: string };
  executiveSummary: string[];
  fullAnalysis: { heading: string; body: string }[];
  transcriptExcerpt: string | null;
  pdfRendererVersion: string;
}

export interface ReportRenderingService {
  renderMacroReportPdf(input: MacroReportInput): Promise<Buffer>;
}

// Determinism contract (spec §4.4.3): normalize PDF bytes to eliminate
// timestamp variance before hashing. This must remain even if @react-pdf/renderer
// stops embedding these fields — the function is the stable contract boundary.
function normalizePdfBytes(buf: Buffer): Buffer {
  let str = buf.toString('binary');
  str = str.replace(/\/CreationDate\s*\([^)]*\)/g, '/CreationDate (D:20000101000000Z)');
  str = str.replace(/\/ModDate\s*\([^)]*\)/g, '/ModDate (D:20000101000000Z)');
  str = str.replace(/\/ID\s*\[<[0-9a-fA-F]{32}>\s*<[0-9a-fA-F]{32}>\]/g, '');
  return Buffer.from(str, 'binary');
}

export const reportRenderingService: ReportRenderingService = {
  async renderMacroReportPdf(input: MacroReportInput): Promise<Buffer> {
    logger.info('reportRenderingService.render_start', {
      agentRunId: input.agentRunId,
      ieeRunId: input.ieeRunId,
      pdfRendererVersion: input.pdfRendererVersion,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = React.createElement(MacroReport, input) as React.ReactElement<any>;
    const raw = await renderToBuffer(element);
    return normalizePdfBytes(Buffer.from(raw));
  },
};
