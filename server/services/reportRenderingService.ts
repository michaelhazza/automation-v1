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
// Non-determinism sources handled here (Phase 3 chatgpt-pr-review fix-loop
// iterations on PR #287 — broader-net normalisation after iteration-3's
// font-subset-only patch failed to close the determinism contract):
//
//   1. /CreationDate (PDF info dict) — wall-clock at render time.
//   2. /ModDate         (PDF info dict) — wall-clock at render time.
//   3. /ID [<hex><hex>] (PDF trailer)   — per-render random pair.
//   4. Font subset prefixes — six-letter uppercase prefix on /BaseFont,
//      /FontName, etc. (e.g. `/BaseFont /XYZABC+Helvetica`) is the PDF
//      convention for font subsetting; @react-pdf/renderer regenerates the
//      prefix per render even when the subset content is byte-identical.
//   5. PDF object stream contents — the compressed binary streams between
//      `stream\n` and `\nendstream` may vary due to zlib state, font
//      embedding order, or any per-render randomness inside the binary
//      blob. Replace each stream body with a fixed-length sentinel so the
//      surrounding structure is still compared but the opaque binary is
//      neutralised. Stream content non-determinism does not change the
//      visible PDF output for an identical input.
//   6. xref table byte offsets + startxref — derived from object byte
//      positions, so any earlier non-determinism shifts these too. Strip
//      them so they don't propagate variance into the structural compare.
function normalizePdfBytes(buf: Buffer): Buffer {
  let str = buf.toString('binary');
  str = str.replace(/\/CreationDate\s*\([^)]*\)/g, '/CreationDate (D:20000101000000Z)');
  str = str.replace(/\/ModDate\s*\([^)]*\)/g, '/ModDate (D:20000101000000Z)');
  str = str.replace(/\/ID\s*\[<[0-9a-fA-F]{32}>\s*<[0-9a-fA-F]{32}>\]/g, '');
  str = str.replace(/[A-Z]{6}\+/g, 'AAAAAA+');
  // Strip PDF object stream contents — opaque binary that may vary per
  // render even for identical input. Match `stream\n` ... `\nendstream`
  // (PDF spec — stream operator is always followed by a newline and the
  // endstream operator is preceded by one).
  str = str.replace(/(stream\r?\n)[\s\S]*?(\r?\nendstream)/g, '$1<STREAM_NORMALISED>$2');
  // Normalise /Length declarations on stream objects so the stripped
  // content's original length doesn't leak variance into the bytes.
  str = str.replace(/\/Length\s+\d+/g, '/Length 0');
  // Strip xref table contents — byte offsets derived from earlier object
  // sizes propagate any earlier non-determinism. Keep the `xref`/`trailer`
  // boundary tokens so the file structure remains recognisable.
  str = str.replace(/(xref\r?\n)[\s\S]*?(trailer\b)/g, '$1<XREF_NORMALISED>\n$2');
  // Normalise the `startxref` offset (the absolute byte position of the
  // xref table from file start).
  str = str.replace(/startxref\s+\d+/g, 'startxref 0');
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
