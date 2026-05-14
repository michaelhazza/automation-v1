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
  // Standalone PDF date literals — @react-pdf/renderer emits CreationDate
  // as an INDIRECT object (e.g. `0 0 obj\n(D:20260514003513Z)\nendobj`)
  // and the inline `/CreationDate` key references that object via `0 0 R`.
  // The inline-form regex above never matches the date literal in that
  // case. Normalise any free-standing `(D:YYYYMMDDhhmmss[Z|±HH'mm])` PDF
  // date string regardless of where it appears.
  str = str.replace(/\(D:\d{14}(?:Z|[+-]\d{2}'\d{2})?\)/g, '(D:20000101000000Z)');
  str = str.replace(/\/ID\s*\[<[0-9a-fA-F]{32}>\s*<[0-9a-fA-F]{32}>\]/g, '');
  str = str.replace(/[A-Z]{6}\+/g, 'AAAAAA+');
  // Strip PDF object stream contents — opaque binary that may vary per
  // render. Permissive endstream match (any whitespace, not just \r?\n)
  // because some PDF writers omit the leading newline before `endstream`.
  str = str.replace(/(stream\r?\n)[\s\S]*?(\s*endstream)/g, '$1<STREAM_NORMALISED>$2');
  // Normalise /Length declarations on stream objects.
  str = str.replace(/\/Length\s+\d+/g, '/Length 0');
  // Iteration 5: normalise PDF object IDs and references. Two renders
  // of the same input may produce identical OBJECT CONTENT but emit
  // objects in different orders, getting different generated IDs. The
  // header `N M obj` (start of an indirect object) and the reference
  // `N M R` (pointer to one) both carry these IDs. Replacing them with
  // a fixed sentinel decouples byte-equality from object-emission order.
  str = str.replace(/\b\d+\s+\d+\s+obj\b/g, '0 0 obj');
  str = str.replace(/\b\d+\s+\d+\s+R\b/g, '0 0 R');
  // Strip xref table contents.
  str = str.replace(/(xref\r?\n)[\s\S]*?(trailer\b)/g, '$1<XREF_NORMALISED>\n$2');
  // Normalise the trailer's /Size entry — the count of indirect objects.
  str = str.replace(/\/Size\s+\d+/g, '/Size 0');
  // Normalise the `startxref` offset.
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
