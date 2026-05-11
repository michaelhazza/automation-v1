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
// timestamp + per-render-random variance before byte comparison. The
// function is the stable contract boundary — keep it even if any one of
// these non-deterministic sources is later removed from @react-pdf/renderer.
//
// Non-determinism sources handled here (CI-observed pattern, not exhaustive):
//   1. /CreationDate (PDF info dict) — wall-clock at render time
//   2. /ModDate         (PDF info dict) — wall-clock at render time
//   3. /ID [<hex><hex>] (PDF trailer)   — per-render random pair
//   4. Font subset prefixes — six-letter uppercase prefix on /BaseFont,
//      /FontName, etc. (e.g. `/BaseFont /XYZABC+Helvetica`) is the PDF
//      convention for font subsetting; @react-pdf/renderer regenerates the
//      prefix per render even when the subset content is byte-identical.
//      Strict-match against the `[A-Z]{6}+` shape narrows the substitution
//      to real subset prefixes and avoids touching content text.
function normalizePdfBytes(buf: Buffer): Buffer {
  let str = buf.toString('binary');
  str = str.replace(/\/CreationDate\s*\([^)]*\)/g, '/CreationDate (D:20000101000000Z)');
  str = str.replace(/\/ModDate\s*\([^)]*\)/g, '/ModDate (D:20000101000000Z)');
  str = str.replace(/\/ID\s*\[<[0-9a-fA-F]{32}>\s*<[0-9a-fA-F]{32}>\]/g, '');
  // Font-subset prefix canonicalisation — Phase 3 chatgpt-pr-review fix-loop
  // iteration 2 (PR #287). Six uppercase letters followed by `+` is the PDF
  // font-subset convention; replace every occurrence with a fixed sentinel
  // so two renders with different prefix randomness compare byte-identical.
  str = str.replace(/[A-Z]{6}\+/g, 'AAAAAA+');
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
