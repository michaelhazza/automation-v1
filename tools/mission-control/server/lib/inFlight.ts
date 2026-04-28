/**
 * inFlight.ts
 *
 * Composer that stitches local files (current-focus.md, builds/<slug>/progress.md,
 * review-logs/) and the GitHub API into the InFlightItem[] shape per spec § C4.
 *
 * Read-only — never writes to disk or remote.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseCurrentFocusBlock,
  parseProgressMd,
  parseVerdictFromLog,
  pickLatestLogForSlug,
  type Phase,
  type ReviewKind,
} from './logParsers.js';
import { fetchPRForBranch, type CiStatus } from './github.js';
import type { Config } from './config.js';

export interface InFlightItem {
  build_slug: string;
  branch: string | null;
  phase: Phase;
  pr: {
    number: number;
    url: string;
    state: 'open' | 'closed' | 'merged';
    ci_status: CiStatus;
  } | null;
  latest_review: {
    kind: ReviewKind;
    verdict: string | null;
    log_path: string;
    timestamp: string;
  } | null;
  progress: {
    last_updated: string | null;
    completed_chunks: number | null;
    total_chunks: number | null;
  } | null;
}

/**
 * Derive a phase from the latest review log's verdict — used when the build is
 * not the active focus and therefore has no machine-block status of its own.
 * Maps the green-family verdicts to MERGE_READY and the change-requested family
 * to REVIEWING; falls back to BUILDING when there's no verdict.
 */
export function derivePhaseFromVerdict(verdict: string | null): Phase {
  if (!verdict) return 'BUILDING';
  switch (verdict) {
    case 'APPROVED':
    case 'READY_FOR_BUILD':
    case 'CONFORMANT':
    case 'CONFORMANT_AFTER_FIXES':
    case 'PASS':
    case 'PASS_WITH_DEFERRED':
      return 'MERGE_READY';
    case 'CHANGES_REQUESTED':
    case 'NEEDS_REVISION':
    case 'NEEDS_DISCUSSION':
    case 'NON_CONFORMANT':
    case 'FAIL':
      return 'REVIEWING';
    default:
      return 'BUILDING';
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * List build slugs as the names of subdirectories under `tasks/builds/`.
 */
export async function listBuildSlugs(config: Config): Promise<string[]> {
  if (!(await exists(config.buildsDir))) return [];
  const entries = await readdir(config.buildsDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function listReviewLogFilenames(config: Config): Promise<string[]> {
  if (!(await exists(config.reviewLogsDir))) return [];
  const entries = await readdir(config.reviewLogsDir);
  return entries.filter((name) => name.endsWith('.md'));
}

/**
 * Read the active build slug from `current-focus.md` (machine block first,
 * fall back to a prose-tolerant search if the block is missing).
 */
export async function readActiveBuildSlug(config: Config): Promise<{
  slug: string | null;
  branch: string | null;
  status: Phase | null;
}> {
  const content = await readIfExists(config.currentFocusPath);
  if (!content) return { slug: null, branch: null, status: null };
  const block = parseCurrentFocusBlock(content);
  if (block) {
    return {
      slug: block.build_slug,
      branch: block.branch,
      status: block.status,
    };
  }
  // Fallback: scrape `**Active build slug:** <slug> (...)`
  const m = content.match(/\*\*Active build slug:\*\*\s+([A-Za-z0-9_-]+)/);
  return { slug: m ? m[1] : null, branch: null, status: null };
}

/**
 * Compose the dashboard's primary feed.
 *
 * For each build slug found under `tasks/builds/`:
 * - Resolve branch (from current-focus machine block when slug matches, else from progress.md, else from convention)
 * - Resolve phase (machine block status when slug matches, else default BUILDING)
 * - Read the most recent review log for that slug + extract verdict
 * - Read progress.md if present
 * - Fetch GitHub PR + CI status for the branch (if a branch is known)
 */
export async function composeInFlight(config: Config): Promise<InFlightItem[]> {
  const [buildSlugs, reviewLogFilenames, activeFocus] = await Promise.all([
    listBuildSlugs(config),
    listReviewLogFilenames(config),
    readActiveBuildSlug(config),
  ]);

  const items: InFlightItem[] = [];
  for (const slug of buildSlugs) {
    const buildDir = join(config.buildsDir, slug);
    const progressContent = await readIfExists(join(buildDir, 'progress.md'));
    const progress = progressContent ? parseProgressMd(progressContent, slug) : null;

    const meta = pickLatestLogForSlug(reviewLogFilenames, slug);
    let latest_review: InFlightItem['latest_review'] = null;
    if (meta) {
      const logContent = await readIfExists(join(config.reviewLogsDir, meta.filename));
      const verdict = logContent ? parseVerdictFromLog(logContent) : null;
      latest_review = {
        kind: meta.kind,
        verdict,
        log_path: `tasks/review-logs/${meta.filename}`,
        timestamp: meta.timestampIso,
      };
    }

    const isActive = activeFocus.slug === slug;
    const branch = isActive ? activeFocus.branch : null;
    // S2: phase resolution per spec § C4 — machine block status when the build
    // is the active focus, else derived from the latest review verdict, else
    // BUILDING default.
    const phase: Phase =
      isActive && activeFocus.status
        ? activeFocus.status
        : derivePhaseFromVerdict(latest_review?.verdict ?? null);

    let pr: InFlightItem['pr'] = null;
    if (branch && config.githubRepo) {
      pr = await fetchPRForBranch(config.githubRepo, branch, config.githubToken);
    }

    items.push({
      build_slug: slug,
      branch,
      phase,
      pr,
      latest_review,
      progress: progress
        ? {
            last_updated: progress.last_updated,
            completed_chunks: progress.completed_chunks,
            total_chunks: progress.total_chunks,
          }
        : null,
    });
  }

  // Sort: active build first, then by latest_review.timestamp desc, then alpha.
  items.sort((a, b) => {
    if (a.build_slug === activeFocus.slug && b.build_slug !== activeFocus.slug) return -1;
    if (b.build_slug === activeFocus.slug && a.build_slug !== activeFocus.slug) return 1;
    const at = a.latest_review?.timestamp ?? '';
    const bt = b.latest_review?.timestamp ?? '';
    if (at !== bt) return at > bt ? -1 : 1;
    return a.build_slug.localeCompare(b.build_slug);
  });

  return items;
}
