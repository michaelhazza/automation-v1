/**
 * logParsers.ts
 *
 * Pure parsers for Mission Control's data sources. No I/O. Filesystem and
 * GitHub fetches happen elsewhere; this file is exclusively text → struct.
 *
 * Backed by the contracts at:
 *   docs/superpowers/specs/2026-04-28-dev-mission-control-spec.md § C2, C3, C4
 */

export type ReviewKind =
  | 'pr-review'
  | 'spec-conformance'
  | 'dual-review'
  | 'spec-review'
  | 'spec-review-final'
  | 'codebase-audit'
  | 'adversarial-review'
  | 'chatgpt-pr-review'
  | 'chatgpt-spec-review';

export type Phase =
  | 'PLANNING'
  | 'BUILDING'
  | 'REVIEWING'
  | 'MERGE_READY'
  | 'MERGED'
  | 'NONE';

export interface ReviewLogMeta {
  kind: ReviewKind;
  slug: string;
  chunkSlug: string | null;
  timestampIso: string;
  filename: string;
}

export interface CurrentFocusBlock {
  active_spec: string | null;
  active_plan: string | null;
  build_slug: string | null;
  branch: string | null;
  status: Phase;
  last_updated: string | null;
}

export interface BuildProgress {
  build_slug: string;
  last_updated: string | null;
  completed_chunks: number | null;
  total_chunks: number | null;
}

const VERDICT_LINE = /^\*\*Verdict:\*\*\s+([A-Z_]+)\b/m;

// Three filename shapes are accepted:
//   <agent>-log-<slug>-<timestamp>.md         (README convention — pr-review, spec-conformance, dual-review, spec-review, codebase-audit, adversarial-review)
//   spec-review-final-<slug>-<timestamp>.md   (spec-reviewer's final report — no `-log-` infix)
//   chatgpt-(pr|spec)-review-<slug>-<timestamp>.md (chatgpt agents — no `-log-` infix; predates the convention)
// Slug allows mixed case because real-world session slugs include suffixes like `BgLlY`.
const TS_RE = '(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}Z)';
const SLUG_RE = '([A-Za-z0-9-]+?)';
const FILENAME_REGEX_STD = new RegExp(
  `^(pr-review|spec-conformance|dual-review|spec-review|codebase-audit|adversarial-review)-log-${SLUG_RE}-${TS_RE}\\.md$`,
);
const FILENAME_REGEX_FINAL = new RegExp(
  `^(spec-review-final)-${SLUG_RE}-${TS_RE}\\.md$`,
);
const FILENAME_REGEX_CHATGPT = new RegExp(
  `^(chatgpt-pr-review|chatgpt-spec-review)-${SLUG_RE}-${TS_RE}\\.md$`,
);

const PHASE_VALUES: readonly Phase[] = [
  'PLANNING',
  'BUILDING',
  'REVIEWING',
  'MERGE_READY',
  'MERGED',
  'NONE',
];

/**
 * Parse a review-log filename into kind / slug / chunk-slug / timestamp.
 *
 * The "chunk-slug" sub-segment is optional in the convention. We don't try to
 * disambiguate `<slug>` from `<slug>-<chunk-slug>` from the filename alone —
 * doing so reliably would require knowing the build slug ahead of time. Here
 * we capture the whole "between agent and timestamp" range as `slug` and let
 * the caller (inFlight composer) match it against known build slugs.
 *
 * Returns null if the filename does not match the convention.
 */
export function parseReviewLogFilename(filename: string): ReviewLogMeta | null {
  // Try the no-`-log-` patterns first because their agent prefixes overlap
  // with the standard family (e.g. `spec-review-final-...` would otherwise
  // be ambiguous with `spec-review-log-...`).
  for (const re of [FILENAME_REGEX_FINAL, FILENAME_REGEX_CHATGPT, FILENAME_REGEX_STD]) {
    const m = filename.match(re);
    if (m) {
      const [, kind, slug, ts] = m;
      return {
        kind: kind as ReviewKind,
        slug,
        chunkSlug: null,
        timestampIso: convertFilenameTimestampToIso(ts),
        filename,
      };
    }
  }
  return null;
}

/**
 * Convert a filename timestamp like `2026-04-25T11-00-13Z` to ISO 8601
 * `2026-04-25T11:00:13Z` (replace the time-field hyphens with colons).
 */
export function convertFilenameTimestampToIso(ts: string): string {
  const datePart = ts.slice(0, 10);
  const timePart = ts.slice(11, 19).replace(/-/g, ':');
  return `${datePart}T${timePart}Z`;
}

/**
 * Parse the verdict from a review log's contents. Reads only the first 30
 * lines per spec § C2 — verdicts that drift to the bottom of a log do not
 * count.
 */
export function parseVerdictFromLog(content: string): string | null {
  const head = content.split('\n').slice(0, 30).join('\n');
  const m = head.match(VERDICT_LINE);
  return m ? m[1] : null;
}

/**
 * Parse the `<!-- mission-control ... -->` machine block from a
 * `current-focus.md` file. Returns null if the block is missing.
 *
 * Block format (per spec § C3):
 *
 *   <!-- mission-control
 *   active_spec: docs/...
 *   active_plan: tasks/builds/.../plan.md
 *   build_slug: <slug>
 *   branch: <branch>
 *   status: BUILDING
 *   last_updated: 2026-04-28
 *   -->
 */
/**
 * Scrape the prose body of `current-focus.md` for `**Active build slug:** <slug>`.
 * Used to detect drift between the machine block (read by the dashboard) and the
 * prose (canonical per spec § C3). Returns null when no such line exists.
 */
export function extractActiveBuildSlugFromProse(content: string): string | null {
  // Strip the leading <!-- mission-control --> block so we don't accidentally
  // match the block's `build_slug:` field.
  const proseOnly = content.replace(/<!--\s*mission-control\s*\n[\s\S]*?\n\s*-->/, '');
  const m = proseOnly.match(/\*\*Active build slug:\*\*\s+([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export function parseCurrentFocusBlock(content: string): CurrentFocusBlock | null {
  const blockMatch = content.match(/<!--\s*mission-control\s*\n([\s\S]*?)\n\s*-->/);
  if (!blockMatch) return null;
  const body = blockMatch[1];

  const get = (key: string): string | null => {
    const re = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm');
    const m = body.match(re);
    return m ? m[1].trim() : null;
  };

  const rawStatus = (get('status') ?? '').toUpperCase();
  const status: Phase = (PHASE_VALUES as readonly string[]).includes(rawStatus)
    ? (rawStatus as Phase)
    : 'NONE';

  return {
    active_spec: get('active_spec'),
    active_plan: get('active_plan'),
    build_slug: get('build_slug'),
    branch: get('branch'),
    status,
    last_updated: get('last_updated'),
  };
}

/**
 * Parse a build's `progress.md` for the dashboard.
 *
 * Looks for:
 * - `**Status:** <text>` — surfaced verbatim by the dashboard
 * - `**Last updated:** <date>` — surfaced verbatim
 * - A markdown table with `Status` checkboxes; counts `[x]` vs total rows
 *
 * Tolerant of missing fields — returns nulls rather than throwing.
 */
export function parseProgressMd(content: string, buildSlug: string): BuildProgress {
  const lastUpdatedMatch = content.match(/^\*\*Last updated:\*\*\s+(.+?)\s*$/m);
  const last_updated = lastUpdatedMatch ? lastUpdatedMatch[1].trim() : null;

  // Count any `[x]` / `[ ]` occurrences in the document. Catches both
  // table-cell-style (`| Chunk 1 | [x] complete |`) and bullet-style
  // (`- [x] Item one`) progress markers. Header rows in tables don't have
  // checkboxes so they're naturally excluded.
  // N3: markdown convention for completed checkboxes is lowercase `[x]`; the
  // matcher is case-sensitive on both branches for symmetry.
  const completed = (content.match(/\[x\]/g) ?? []).length;
  const open = (content.match(/\[ \]/g) ?? []).length;
  const total = completed + open;

  return {
    build_slug: buildSlug,
    last_updated,
    completed_chunks: total > 0 ? completed : null,
    total_chunks: total > 0 ? total : null,
  };
}

/**
 * Pick the most recent log per kind for a given build slug from a list of
 * filenames. The slug match is exact-prefix on `<slug>` OR `<slug>-<chunk-slug>`.
 *
 * Returns one ReviewLogMeta — the most recent across all kinds — or null if
 * none match.
 */
export function pickLatestLogForSlug(
  filenames: string[],
  buildSlug: string,
): ReviewLogMeta | null {
  const matches: ReviewLogMeta[] = [];
  for (const filename of filenames) {
    const meta = parseReviewLogFilename(filename);
    if (!meta) continue;
    if (meta.slug === buildSlug || meta.slug.startsWith(`${buildSlug}-`)) {
      // N4: spread into a new object before mutating so a future caller that
      // caches `parseReviewLogFilename` results isn't affected by this side-effect.
      if (meta.slug !== buildSlug) {
        matches.push({
          ...meta,
          chunkSlug: meta.slug.slice(buildSlug.length + 1),
          slug: buildSlug,
        });
      } else {
        matches.push({ ...meta });
      }
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => (a.timestampIso > b.timestampIso ? -1 : 1));
  return matches[0];
}
