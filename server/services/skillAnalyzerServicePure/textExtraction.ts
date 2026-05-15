// ---------------------------------------------------------------------------
// Text extraction utilities — pure, no DB/env/service imports
// ---------------------------------------------------------------------------

/** Richness score for base skill selection. Weights headings and code blocks
 *  heavily over raw word count — structured skills are harder to reconstruct
 *  if used as the non-base. */
export function richnessScore(text: string | null): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const headings = (text.match(/^#{1,4}\s/gm)?.length ?? 0) * 50;
  const codeBlocks = (text.match(/```/g)?.length ?? 0) * 100;
  return words + headings + codeBlocks;
}

export const GENERIC_BIGRAMS = new Set([
  'email marketing', 'content strategy', 'lead generation', 'social media',
  'marketing strategy', 'brand voice', 'target audience', 'content creation',
  'digital marketing', 'conversion rate',
]);

export function isGenericBigram(bigram: string): boolean {
  return GENERIC_BIGRAMS.has(bigram);
}

/** Extract non-trivial word bigrams from a short description text.
 *  Stopwords and single-character tokens are excluded. Returns lowercase bigrams. */
export function extractDescriptionBigrams(text: string): Set<string> {
  const STOPWORDS = new Set(['a','an','the','and','or','for','to','of','in',
    'on','with','that','this','is','are','be','it','as','by','at','from']);
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
  const bigrams = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.add(`${words[i]} ${words[i+1]}`);
  }
  return bigrams;
}

// Leading whitespace is allowed: the block is detected even if the LLM adds
// a blank line before it. Matches from the first invocation keyword through
// the next blank line (or end of string).
export const INVOCATION_TRIGGER_RE = /^\s*(Invoke|Use|Call|Trigger)\s+this\s+skill\b.+?(?:\n\n|$)/is;

/** Extract the opening invocation trigger block from skill instructions, if present.
 *  Returns the trimmed block text, or null if no trigger block is found at the top. */
export function extractInvocationBlock(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(INVOCATION_TRIGGER_RE);
  return match?.[0]?.trim() ?? null;
}

const HITL_PHRASES = [
  /do not send (this|the|it)\b.*?directly/i,
  /do not post without approval/i,
  /review before sending/i,
  /human approval required/i,
  /present to (the )?user for (review|confirmation|approval)/i,
  /requires? (human|manual) (review|approval|sign-?off)/i,
];

/** Returns true if the text contains any known HITL gate phrase. */
export function containsHitlGate(text: string | null): boolean {
  if (!text) return false;
  return HITL_PHRASES.some(re => re.test(text));
}

/** Returns true if the text contains any approval/review intent signal,
 *  regardless of exact phrasing. Used as fallback after containsHitlGate. */
export function containsApprovalIntent(text: string | null): boolean {
  if (!text) return false;
  return /\b(approval|approvals|review|confirm\w*|sign-?off)\b/i.test(text);
}

const OUTPUT_FORMAT_HEADING_RE = /^#{1,4}\s+(output\s+format|response\s+format|format|template)\b/im;

/** Returns true if the text contains an output format heading or a fenced code
 *  block whose surrounding context references output/response/format/template. */
export function hasOutputFormatBlock(text: string | null): boolean {
  if (!text) return false;
  if (OUTPUT_FORMAT_HEADING_RE.test(text)) return true;
  const fenceRe = /```(?:json|yaml|markdown|text|html)?\s*\n[\s\S]{0,200}?\b(output|response|format|template|result)\b/i;
  return fenceRe.test(text) || /\b(output|response|format|template|result)\b[\s\S]{0,100}?```/i.test(text);
}

export interface ExtractedTable {
  headerKey: string;   // pipe-separated header cells, lowercased and trimmed
  rowCount: number;    // data rows only (header + separator excluded)
}

/** Extract markdown tables from text, keyed by their normalized header row.
 *  headerKey is context-qualified: "{nearest-heading}>{columns}" when a
 *  heading is present, otherwise just "{columns}". This prevents platform-
 *  spec tables that share identical column schemas (e.g. "element|limit|notes"
 *  appearing under Meta, LinkedIn, TikTok, and Twitter/X sections) from
 *  collapsing into a single bucket and cross-polluting each other's rows. */
export function extractTables(text: string | null): ExtractedTable[] {
  if (!text) return [];
  const lines = text.split('\n');
  const tables: ExtractedTable[] = [];
  let inTable = false;
  let headerKey: string | null = null;
  let rowCount = 0;
  let lineIndex = 0;
  let contextHeading = '';

  for (const line of lines) {
    const trimmed = line.trim();
    // Track the nearest heading so tables with identical column schemas but
    // under different section headings get distinct keys.
    if (!inTable && /^#{1,4}\s+/.test(trimmed)) {
      contextHeading = trimmed.replace(/^#+\s+/, '').trim().toLowerCase();
    }
    if (trimmed.startsWith('|')) {
      if (!inTable) {
        inTable = true;
        const rawKey = trimmed.replace(/^\||\|$/g, '').split('|')
          .map(c => c.trim().toLowerCase()).join('|');
        headerKey = contextHeading ? `${contextHeading}>${rawKey}` : rawKey;
        rowCount = 0;
        lineIndex = 0;
      } else {
        lineIndex++;
        if (lineIndex === 1 && /^\|[\s\-:|]+\|/.test(trimmed)) continue;
        rowCount++;
      }
    } else if (inTable) {
      if (headerKey !== null) tables.push({ headerKey, rowCount });
      inTable = false;
      headerKey = null;
      rowCount = 0;
      lineIndex = 0;
    }
  }
  if (inTable && headerKey !== null) tables.push({ headerKey, rowCount });
  return tables;
}

/** Full-row table representation used by remediateTables. */
export interface ExtractedTableRows {
  headerLine: string;           // the raw header line (with pipes)
  headerKey: string;            // normalized pipe-joined header
  separatorLine: string;        // the |---|---| row
  columnCount: number;
  rows: string[];               // raw row lines
  startLineIndex: number;       // line index of the header in source text
  endLineIndex: number;         // line index of last row (exclusive)
}

/** Extract tables with full row content, keyed by context-qualified header.
 *  See extractTables for the heading-context rationale. */
export function extractTablesWithRows(text: string | null): ExtractedTableRows[] {
  if (!text) return [];
  const lines = text.split('\n');
  const tables: ExtractedTableRows[] = [];
  let current: ExtractedTableRows | null = null;
  let linePos = 0;
  let contextHeading = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!current && /^#{1,4}\s+/.test(trimmed)) {
      contextHeading = trimmed.replace(/^#+\s+/, '').trim().toLowerCase();
    }
    if (trimmed.startsWith('|')) {
      if (!current) {
        const headerCells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const rawKey = headerCells.map(c => c.toLowerCase()).join('|');
        current = {
          headerLine: line,
          headerKey: contextHeading ? `${contextHeading}>${rawKey}` : rawKey,
          separatorLine: '',
          columnCount: headerCells.length,
          rows: [],
          startLineIndex: i,
          endLineIndex: i + 1,
        };
        linePos = 0;
      } else {
        linePos++;
        if (linePos === 1 && /^\|[\s\-:|]+\|/.test(trimmed)) {
          current.separatorLine = line;
          current.endLineIndex = i + 1;
          continue;
        }
        current.rows.push(line);
        current.endLineIndex = i + 1;
      }
    } else if (current) {
      tables.push(current);
      current = null;
    }
  }
  if (current) tables.push(current);
  return tables;
}

/** First-column key for row deduplication. Strips leading/trailing pipes
 *  and lowercases the first cell. Empty cells return ''. */
export function firstColumnKey(rowLine: string): string {
  const trimmed = rowLine.trim().replace(/^\|/, '');
  const firstPipe = trimmed.indexOf('|');
  const cell = firstPipe >= 0 ? trimmed.slice(0, firstPipe) : trimmed;
  return cell.trim().toLowerCase();
}

/** Whether a row already carries a [SOURCE: ...] marker (skip to prevent
 *  recursive inflation on retries). */
export function hasSourceMarker(rowLine: string): boolean {
  return /\[SOURCE:\s*(library|incoming)/i.test(rowLine);
}

/** Append a `[SOURCE: ...]` marker to the last non-empty cell of a row.
 *  When `sourceKey` is provided (heading-qualified headerKey of the source
 *  table), it is embedded in the annotation so decontaminateSectionRows can
 *  detect cross-section row pollution. */
export function withSourceMarker(
  rowLine: string,
  source: 'library' | 'incoming',
  sourceKey?: string,
): string {
  const trimmed = rowLine.trimEnd();
  if (hasSourceMarker(trimmed)) return trimmed;
  const marker = sourceKey
    ? `[SOURCE: ${source} "${sourceKey}"]`
    : `[SOURCE: ${source}]`;
  if (trimmed.endsWith('|')) {
    return trimmed.slice(0, -1).trimEnd() + ` ${marker} |`;
  }
  return `${trimmed} ${marker}`;
}

// ---------------------------------------------------------------------------
// Post-remediation cleanup — decontamination + annotation strip
// ---------------------------------------------------------------------------

/** Remove table rows that were appended by remediateTables into the wrong
 *  section. Detects misplacement by comparing the source section key
 *  embedded in the annotation against the current section context.
 *
 *  Only rows with an extended annotation `[SOURCE: ... "key"]` are examined;
 *  legacy bare `[SOURCE: library]` rows are left for stripSourceAnnotations.
 *
 *  Domain-agnostic: comparison is pure string match on heading keys; no
 *  hardcoded platform names.
 *
 *  Idempotent: running twice on the same text produces the same result. */
export function decontaminateSectionRows(instructions: string): string {
  const lines = instructions.split('\n');
  let contextKey = '';
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Update current section heading whenever we see a heading-level line.
    // We DON'T require !inTable here because headings inside remediateTables
    // output can follow a table with no blank line separator.
    if (/^#{1,4}\s+/.test(trimmed)) {
      contextKey = trimmed.replace(/^#+\s+/, '').trim().toLowerCase();
    }

    if (trimmed.startsWith('|')) {
      // Check for extended SOURCE annotation with an embedded section key.
      const match = trimmed.match(/\[SOURCE:\s*(?:library|incoming)\s+"([^"]+)"\]/i);
      if (match) {
        const sourceKey = match[1];
        // Source key format: "<heading>><columns>" — extract heading part.
        const sourceHeading = sourceKey.includes('>') ? sourceKey.split('>')[0] : sourceKey;
        // If source heading differs from current section heading, this row
        // was appended into the wrong section — discard it.
        if (contextKey && sourceHeading && sourceHeading !== contextKey) {
          continue;
        }
      }
    }

    result.push(line);
  }
  return result.join('\n');
}

/** Strip all [SOURCE: library] / [SOURCE: incoming] annotations from table
 *  rows. These are internal merge-process artifacts and must not appear in
 *  the user-facing merged output.
 *
 *  Removes both the legacy bare form and the extended keyed form:
 *    [SOURCE: library]
 *    [SOURCE: incoming "meta ads>element|limit|notes"]
 *
 *  Idempotent. */
export function stripSourceAnnotations(instructions: string): string {
  return instructions.replace(
    /\s*\[SOURCE:\s*(?:library|incoming)(?:\s+"[^"]*")?\]/gi,
    '',
  );
}

export interface RemediateTablesInput {
  mergedInstructions: string;
  baseInstructions: string | null;          // library skill instructions
  incomingInstructions: string | null;      // candidate skill instructions
  /** Abort auto-recovery if remediated word count exceeds this multiple of
   *  the pre-remediation word count (§11.11.9). */
  maxGrowthRatio?: number;
}

export interface RemediateTablesOutput {
  instructions: string;
  autoRecoveredRows: number;
  skippedDueToColumnMismatch: number;
  skippedDueToKeyConflict: number;
  growthRatioExceeded: boolean;
}

/**
 * Post-process merged instructions to append missing table rows from the
 * source skills, marking each recovered row with [SOURCE: library|incoming].
 * Refuses to merge when column schemas differ or when first-column keys
 * conflict across sources (§11.11.6). Honors max_table_growth_ratio.
 */
export function remediateTables(input: RemediateTablesInput): RemediateTablesOutput {
  const { mergedInstructions, baseInstructions, incomingInstructions } = input;
  const maxGrowthRatio = input.maxGrowthRatio ?? 1.5;

  const baseTables = extractTablesWithRows(baseInstructions);
  const incomingTables = extractTablesWithRows(incomingInstructions);
  const mergedTables = extractTablesWithRows(mergedInstructions);

  // Source table lookup: header -> { source, rows }
  const sourceByHeader = new Map<string, Array<{ source: 'library' | 'incoming'; table: ExtractedTableRows }>>();
  for (const t of baseTables) {
    const list = sourceByHeader.get(t.headerKey) ?? [];
    list.push({ source: 'library', table: t });
    sourceByHeader.set(t.headerKey, list);
  }
  for (const t of incomingTables) {
    const list = sourceByHeader.get(t.headerKey) ?? [];
    list.push({ source: 'incoming', table: t });
    sourceByHeader.set(t.headerKey, list);
  }

  let autoRecovered = 0;
  let skippedColumn = 0;
  let skippedKeyConflict = 0;

  // Process tables in reverse line order so line-index splices stay valid.
  const lines = mergedInstructions.split('\n');
  const sortedMergedTables = [...mergedTables].sort((a, b) => b.startLineIndex - a.startLineIndex);

  for (const mergedTable of sortedMergedTables) {
    const sources = sourceByHeader.get(mergedTable.headerKey) ?? [];
    if (sources.length === 0) continue;

    // Guard 1: column mismatch (any source with different column count).
    if (sources.some(s => s.table.columnCount !== mergedTable.columnCount)) {
      skippedColumn++;
      continue;
    }

    const existingKeys = new Set(
      mergedTable.rows
        .filter(r => !hasSourceMarker(r))
        .map(firstColumnKey),
    );

    // Collect candidate rows to append, skipping those whose first-column
    // key is already present (or conflicts across sources).
    const seenSourceKey = new Map<string, 'library' | 'incoming'>();
    const toAppend: Array<{ row: string; source: 'library' | 'incoming'; sourceTableKey: string }> = [];
    for (const { source, table } of sources) {
      for (const row of table.rows) {
        if (hasSourceMarker(row)) continue;
        const key = firstColumnKey(row);
        if (!key) continue;
        if (existingKeys.has(key)) continue;
        const prior = seenSourceKey.get(key);
        if (prior && prior !== source) {
          // Cross-source conflict: skip this row entirely.
          skippedKeyConflict++;
          continue;
        }
        seenSourceKey.set(key, source);
        // Include source table's headerKey so decontaminateSectionRows can
        // detect rows appended into the wrong section.
        toAppend.push({ row, source, sourceTableKey: table.headerKey });
      }
    }

    if (toAppend.length === 0) continue;

    // Append the new rows with extended SOURCE annotations that encode the
    // source table's heading context for downstream decontamination.
    const markedRows = toAppend.map(({ row, source, sourceTableKey }) =>
      withSourceMarker(row, source, sourceTableKey),
    );
    // Splice after the last merged-table row (mergedTable.endLineIndex).
    lines.splice(mergedTable.endLineIndex, 0, ...markedRows);
    autoRecovered += markedRows.length;
  }

  let nextText = lines.join('\n');

  // Guard 2: aggregate growth ratio. Only enforced for non-trivial inputs;
  // small tables would otherwise trip the cap on a single auto-recovered row.
  const preWords = countWords(mergedInstructions);
  const postWords = countWords(nextText);
  const GROWTH_CAP_MIN_WORDS = 100;
  const growthRatioExceeded =
    preWords >= GROWTH_CAP_MIN_WORDS &&
    postWords / preWords > maxGrowthRatio;
  if (growthRatioExceeded) {
    // Abort: return original.
    nextText = mergedInstructions;
    autoRecovered = 0;
  }

  return {
    instructions: nextText,
    autoRecoveredRows: autoRecovered,
    skippedDueToColumnMismatch: skippedColumn,
    skippedDueToKeyConflict: skippedKeyConflict,
    growthRatioExceeded,
  };
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Fix 6 — persona opener detection (v4 brief)
// ---------------------------------------------------------------------------

/** Pattern for persona opener lines ("You are an expert…", "Your goal is…").
 *  Distinct from invocation triggers so the merger can order them correctly. */
const PERSONA_OPENER_RE =
  /^\s*(You\s+are\s+(an?\s+)?|Your\s+goal\s+is\s+(to\s+)?|You\s+speciali[sz]e\s+in\b|Act\s+as\s+(an?\s+)?)/i;

/** Returns true if the text opens with a persona statement rather than an
 *  invocation trigger. */
export function startsWithPersonaOpener(text: string | null): boolean {
  if (!text) return false;
  return PERSONA_OPENER_RE.test(text.trimStart());
}

// ---------------------------------------------------------------------------
// Fix 7 — output format block recovery (v4 brief)
// ---------------------------------------------------------------------------

const OUTPUT_FORMAT_SECTION_RE =
  /^#{1,4}\s+(output\s+format|response\s+format|output\s+template|format)\b/im;

/** Extract the output format section from instructions, including everything
 *  from the section heading to the next same-or-higher level heading. */
export function extractOutputFormatSection(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(OUTPUT_FORMAT_SECTION_RE);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  // Find the end: next heading at the same or higher level.
  const headingLevel = match[0].match(/^#+/)![0].length;
  const afterHeading = text.slice(start + match[0].length);
  const nextHeadingRe = new RegExp(`^#{1,${headingLevel}}\\s+`, 'm');
  const nextMatch = afterHeading.match(nextHeadingRe);
  const end = nextMatch?.index !== undefined
    ? start + match[0].length + nextMatch.index
    : text.length;
  return text.slice(start, end).trim();
}

/** When the merged output lacks an output format block but a source has one,
 *  append the source's format section at the end (before Related Skills). */
export function recoverOutputFormat(
  mergedInstructions: string,
  baseInstructions: string | null,
  nonBaseInstructions: string | null,
): string {
  if (hasOutputFormatBlock(mergedInstructions)) return mergedInstructions;
  const sourceBlock =
    extractOutputFormatSection(baseInstructions) ??
    extractOutputFormatSection(nonBaseInstructions);
  if (!sourceBlock) return mergedInstructions;

  const preserved =
    '### Output Format (preserved from source)\n\n' + sourceBlock.replace(/^#{1,4}\s+[^\n]+\n+/, '');

  const relatedIdx = mergedInstructions.search(/^##\s+related\s+skills\b/im);
  if (relatedIdx !== -1) {
    return mergedInstructions.slice(0, relatedIdx).trimEnd() + '\n\n' + preserved + '\n\n' + mergedInstructions.slice(relatedIdx);
  }
  return mergedInstructions.trimEnd() + '\n\n' + preserved + '\n';
}

// ---------------------------------------------------------------------------
// Word overlap ratio
// ---------------------------------------------------------------------------

/** Word-overlap ratio: what fraction of the source's significant words
 *  (length > 3) appear somewhere in the merged text. */
export function wordOverlapRatio(source: string | null, merged: string | null): number {
  if (!source || !merged) return source ? 0 : 1;
  const sourceWords = new Set(
    source.toLowerCase().split(/\s+/).filter(w => w.length > 3),
  );
  if (sourceWords.size === 0) return 1;
  const mergedLower = merged.toLowerCase();
  let matches = 0;
  for (const word of sourceWords) {
    if (mergedLower.includes(word)) matches++;
  }
  return matches / sourceWords.size;
}

// ---------------------------------------------------------------------------
// Fix 2 / Fix 3 — table drop recovery helpers
// ---------------------------------------------------------------------------

/** Clean a table cell for content-verification matching. Strips [SOURCE:] markers,
 *  backticks, surrounding whitespace, and lowercases. Returns '' for cells that
 *  are not useful for matching (empty, pure punctuation, very short). */
export function cleanCellForMatch(cell: string): string {
  const cleaned = cell
    .replace(/\[SOURCE:[^\]]*\]/g, '')
    .replace(/[`*_]/g, '')
    .trim()
    .toLowerCase();
  if (cleaned.length < 2) return '';
  if (/^[-—–\s]+$/.test(cleaned)) return '';
  return cleaned;
}

/** Stopwords that carry no identifying signal when comparing table cells.
 *  Kept short — we want to preserve domain terms like "chars" that the
 *  stemming logic handles separately. */
export const CELL_TOKEN_STOPWORDS = new Set([
  'and', 'but', 'for', 'the', 'with', 'each', 'upto', 'up', 'to', 'max',
  'min', 'per', 'via', 'not', 'any', 'all', 'or', 'of', 'in', 'on', 'at',
  'by', 'as', 'is', 'are', 'if',
]);

/** Strip a common pluralisation / word-form suffix so "headlines" matches
 *  "headline" and "chars" matches "characters". Intentionally conservative —
 *  we want false negatives over false positives. */
export function stemToken(token: string): string {
  let t = token;
  if (t.length > 4 && t.endsWith('s')) t = t.slice(0, -1); // plural
  // Normalise common word-form pairs seen in skill specs: characters↔chars,
  // seconds↔secs, minutes↔mins. The full words and short forms both collapse
  // to the shared prefix.
  if (t.startsWith('character')) t = 'char';
  else if (t.startsWith('second')) t = 'sec';
  else if (t.startsWith('minute')) t = 'min';
  return t;
}

/** Extract distinctive tokens from a string — length-≥3, non-stopword, stemmed.
 *  Used for row-level coverage matching where exact substring fails on LLM
 *  restructurings ("30 chars each, up to 15" vs "30 characters | Up to 15"). */
export function extractInformativeTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[\s,/|\-()[\]:;"]+/)) {
    if (raw.length < 3) continue;
    if (CELL_TOKEN_STOPWORDS.has(raw)) continue;
    tokens.push(stemToken(raw));
  }
  return tokens;
}

/** Return the cleaned, lowercased, non-empty cells of a markdown table row.
 *  Used by both the token-set scorer (via `extractRowKeyTokens`) and the
 *  low-token fallback in `mergedOutputCoversTableData`. */
export function extractRowCells(rowLine: string): string[] {
  const trimmed = rowLine.trim().replace(/^\||\|$/g, '');
  const cells: string[] = [];
  for (const cell of trimmed.split('|')) {
    const cleaned = cleanCellForMatch(cell);
    if (cleaned.length > 0) cells.push(cleaned);
  }
  return cells;
}

/** Extract informative tokens from all non-empty cells of a row (v6 follow-up
 *  to Codex review: widening from first-2-cells catches rows whose leading
 *  cells are intentionally the same across the table — e.g. "Phase 1 | 30d",
 *  "Phase 2 | 60d" — where only later cells differentiate rows). */
export function extractRowKeyTokens(rowLine: string): string[] {
  return extractRowCells(rowLine).flatMap(extractInformativeTokens);
}

/** Returns true if the merged instructions already contain table data that
 *  covers at least `coverageThreshold` of the source table's rows. v6 Fix 1
 *  (follow-up: tightened after Codex review): for each row, extract
 *  informative tokens from all cells (stemmed, stopwords removed), then count
 *  the row "covered" when ≥50% of those tokens appear as whole tokens
 *  anywhere in the merged instructions AND at least 2 distinct tokens match.
 *  The absolute-minimum guard prevents rows that collapse to one token
 *  ("headline", "phase") from being marked covered by a single haystack hit.
 *  For low-token rows (<2 distinct informative tokens, e.g. `| Banner | 1 |`)
 *  the token-set scorer has insufficient signal; fall back to requiring the
 *  row's cell content to appear literally in the lowercased merged text
 *  (terse rows can't be restructured by LLMs, so exact match is appropriate).
 *  The outer 80%-row-coverage guard controls false positives. */
export function mergedOutputCoversTableData(
  sourceTable: ExtractedTableRows,
  mergedInstructions: string,
  coverageThreshold = 0.80,
  rowTokenThreshold = 0.50,
  rowTokenAbsoluteMin = 2,
): { covered: boolean; matchedRows: number; totalRows: number } {
  const haystackTokens = new Set(extractInformativeTokens(mergedInstructions));
  const haystackLower = mergedInstructions.toLowerCase();
  let matched = 0;
  let scoreable = 0;

  for (const row of sourceTable.rows) {
    const cells = extractRowCells(row);
    if (cells.length === 0) continue;
    const rowTokens = cells.flatMap(extractInformativeTokens);
    if (rowTokens.length === 0) continue;
    const distinctTokens = new Set(rowTokens).size;
    scoreable++;

    if (distinctTokens < rowTokenAbsoluteMin) {
      // Low-token fallback: terse row. Require every meaningful cell to
      // appear as a substring of the merged text. Terse rows can't be
      // restructured (nothing to rephrase); exact match is the appropriate
      // signal. Cells shorter than 3 chars (single letters, single digits)
      // are skipped in the presence check — a standalone "1" would match
      // anywhere and produce false positives.
      const substantiveCells = cells.filter(c => c.length >= 3);
      if (substantiveCells.length === 0) {
        // No substantive content — can't score, undo the scoreable bump.
        scoreable--;
        continue;
      }
      const allCellsPresent = substantiveCells.every(c => haystackLower.includes(c));
      if (allCellsPresent) matched++;
      continue;
    }

    // Count distinct present tokens so a token repeated across cells doesn't
    // double-count toward the match threshold.
    const presentSet = new Set<string>();
    for (const t of rowTokens) {
      if (haystackTokens.has(t)) presentSet.add(t);
    }
    const present = presentSet.size;
    if (
      present >= rowTokenAbsoluteMin &&
      present / distinctTokens >= rowTokenThreshold
    ) {
      matched++;
    }
  }

  if (scoreable === 0) return { covered: false, matchedRows: 0, totalRows: 0 };
  return {
    covered: matched / scoreable >= coverageThreshold,
    matchedRows: matched,
    totalRows: scoreable,
  };
}

/** When TABLE_ROWS_DROPPED warnings fire for tables with < 50% rows retained,
 *  append the original source table as a clearly-labelled reference appendix
 *  at the end of the merged instructions (before any Related Skills section).
 *
 *  Domain-agnostic. Only tables with headerKey present in sourceTables and
 *  with mergedRows < sourceRows * 0.5 are recovered. Idempotent: tables
 *  already in the appendix (heading contains "Reference:") are skipped. */
export function recoverDroppedTableRows(
  mergedInstructions: string,
  baseInstructions: string | null,
  nonBaseInstructions: string | null,
): string {
  const baseTables   = extractTablesWithRows(baseInstructions);
  const nonBaseTables = extractTablesWithRows(nonBaseInstructions);
  const mergedTables = extractTablesWithRows(mergedInstructions);

  const mergedByHeader = new Map(mergedTables.map(t => [t.headerKey, t.rows.length]));

  // Collect the best source table per header (most rows wins).
  const sourceBest = new Map<string, ExtractedTableRows>();
  for (const t of [...baseTables, ...nonBaseTables]) {
    const existing = sourceBest.get(t.headerKey);
    if (!existing || t.rows.length > existing.rows.length) {
      sourceBest.set(t.headerKey, t);
    }
  }

  const appendixBlocks: string[] = [];
  for (const [headerKey, sourceTable] of sourceBest) {
    const mergedRows = mergedByHeader.get(headerKey) ?? 0;
    const sourceRows = sourceTable.rows.length;
    if (sourceRows === 0 || mergedRows >= sourceRows * 0.5) continue;
    // Skip tables whose heading already says "Reference:" to prevent recursion.
    if (/reference:/i.test(headerKey)) continue;
    // v6 Fix 1: skip if the merged instructions already contain ≥80% of the
    // source rows (by first-2-cols substring match). Avoids duplicate reference
    // appendices when the LLM restructured the table inline.
    if (mergedOutputCoversTableData(sourceTable, mergedInstructions).covered) continue;

    const headingPart = headerKey.includes('>')
      ? headerKey.split('>')[0].replace(/\b\w/g, c => c.toUpperCase())
      : headerKey.replace(/\b\w/g, c => c.toUpperCase());
    const block = [
      `### Reference: ${headingPart} (preserved from source — ${sourceRows} rows)`,
      sourceTable.headerLine,
      sourceTable.separatorLine,
      // Strip any [SOURCE: ...] annotations from original rows.
      ...sourceTable.rows.map(r => stripSourceAnnotations(r)),
    ].join('\n');
    appendixBlocks.push(block);
  }

  if (appendixBlocks.length === 0) return mergedInstructions;

  // Insert before "## Related Skills" if present, otherwise append.
  const relatedIdx = mergedInstructions.search(/^##\s+related\s+skills\b/im);
  const appendix = '\n\n' + appendixBlocks.join('\n\n');
  if (relatedIdx !== -1) {
    return mergedInstructions.slice(0, relatedIdx).trimEnd() + appendix + '\n\n' + mergedInstructions.slice(relatedIdx);
  }
  return mergedInstructions.trimEnd() + appendix + '\n';
}
