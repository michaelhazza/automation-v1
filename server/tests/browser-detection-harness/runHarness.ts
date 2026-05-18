/**
 * CLI entry point for the browser detection harness (spec §8.1).
 *
 * Usage:
 *   npx tsx server/tests/browser-detection-harness/runHarness.ts --mode=blocking
 *   npx tsx server/tests/browser-detection-harness/runHarness.ts --mode=full
 *
 * V1 note: e2b SDK is not installed (see architect-pick item 7 / BHP-2 follow-up).
 * All sites run against cached fixture HTML in advisory mode only.
 * Live e2b nightly run is deferred to the e2b SDK install build.
 *
 * Exit code per spec §8.1:
 *   1 — mode=blocking AND DETECTION_HARNESS_GATING=true AND ≥1 blocking site
 *       with outcome in { 'fail', 'parse_error' }
 *   0 — all other cases
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as write from './harnessHistoryWriter.js';
import type { HarnessRunResult, HarnessOutcome, HarnessMode } from './harnessHistoryWriterPure.js';
import browserscanSite from './sites/browserscan.test.js';
import botIncolumitasSite from './sites/bot-incolumitas.test.js';
import deviceAndBrowserInfoSite from './sites/deviceandbrowserinfo.test.js';
import whoerSite from './sites/whoer.test.js';
import pixelscanSite from './sites/pixelscan.test.js';

// ---------------------------------------------------------------------------
// Site contract
// ---------------------------------------------------------------------------

interface HarnessSite {
  slug: string;
  mode: HarnessMode;
  test: (page: { goto(url: string): Promise<void>; content(): Promise<string> }) => Promise<number>;
}

// ---------------------------------------------------------------------------
// Site registry (manual array — simpler than dynamic import in V1)
// ---------------------------------------------------------------------------

const SITES: HarnessSite[] = [
  browserscanSite,
  botIncolumitasSite,
  deviceAndBrowserInfoSite,
  whoerSite,
  pixelscanSite,
];

// ---------------------------------------------------------------------------
// Stub page object — reads cached fixture, never launches a real browser
// ---------------------------------------------------------------------------

interface StubPage {
  goto(url: string): Promise<void>;
  content(): Promise<string>;
  // No-op stubs for any other page methods the site tests might call
  [key: string]: unknown;
}

function makeStubPage(fixtureHtml: string): StubPage {
  return {
    async goto(_url: string): Promise<void> {
      // V1: ignore the URL; fixture HTML was already loaded
    },
    async content(): Promise<string> {
      return fixtureHtml;
    },
  };
}

// ---------------------------------------------------------------------------
// Pure exit-code helper (spec §8.1 truth table)
// ---------------------------------------------------------------------------

export function runHarnessExitCodePure(
  results: HarnessRunResult[],
  mode: 'blocking' | 'full',
  gatingEnabled: boolean,
): 0 | 1 {
  if (!gatingEnabled) return 0;
  if (mode !== 'blocking') return 0;

  const BLOCKING_FAILURES: HarnessOutcome[] = ['fail', 'parse_error'];
  const hasBlockingFailure = results.some(
    (r) => r.mode === 'blocking' && BLOCKING_FAILURES.includes(r.outcome),
  );

  return hasBlockingFailure ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Baseline helpers
// ---------------------------------------------------------------------------

const HARNESS_DIR = path.resolve(import.meta.dirname);
const BASELINES_DIR = path.join(HARNESS_DIR, 'baselines');
const FIXTURES_DIR = path.join(HARNESS_DIR, 'fixtures');

interface BaselineFile {
  score: number;
  tolerance: number;
}

function loadBaseline(slug: string): BaselineFile | null {
  const filePath = path.join(BASELINES_DIR, `${slug}.baseline.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as BaselineFile;
}

function writeBaseline(slug: string, score: number): void {
  const filePath = path.join(BASELINES_DIR, `${slug}.baseline.json`);
  const baseline: BaselineFile = { score, tolerance: 0.15 };
  fs.mkdirSync(BASELINES_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(baseline, null, 2) + '\n');
}

function loadFixture(slug: string): string | null {
  const filePath = path.join(FIXTURES_DIR, `${slug}.html`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

// ---------------------------------------------------------------------------
// Determine pass/fail from score vs baseline
// ---------------------------------------------------------------------------

function scoreToOutcome(
  score: number,
  baseline: BaselineFile,
): 'pass' | 'fail' {
  return score >= baseline.score - baseline.tolerance ? 'pass' : 'fail';
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function runHarness(): Promise<void> {
  const args = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith('--mode='));
  const mode: 'blocking' | 'full' = modeArg?.split('=')[1] === 'full' ? 'full' : 'blocking';

  const gatingEnabled = process.env['DETECTION_HARNESS_GATING'] === 'true';

  const V1_BROWSER_VERSION = 'chromium/V1-fixture';
  const V1_PLAYWRIGHT_VERSION = '1.44.0';
  const V1_TEMPLATE_DIGEST = 'sha256:fixture-v1';

  const results: HarnessRunResult[] = [];

  for (const site of SITES) {
    // In 'blocking' mode, only run blocking-mode sites.
    // In 'full' mode, run all sites except 'disabled'.
    if (mode === 'blocking' && site.mode !== 'blocking') continue;
    if (site.mode === 'disabled') continue;

    const fixtureHtml = loadFixture(site.slug);
    if (fixtureHtml === null) {
      console.log(
        JSON.stringify({
          event: 'browser.detection.harness.run.completed',
          siteSlug: site.slug,
          outcome: 'site_unavailable',
          reason: 'fixture_missing',
        }),
      );
      const result: HarnessRunResult = {
        siteSlug: site.slug,
        mode: site.mode,
        score: null,
        baselineScore: null,
        baselineTolerance: null,
        outcome: 'site_unavailable',
        browserVersion: V1_BROWSER_VERSION,
        playwrightVersion: V1_PLAYWRIGHT_VERSION,
        templateDigest: V1_TEMPLATE_DIGEST,
      };
      results.push(result);
      await writeResultSafe(result);
      continue;
    }

    let score: number;
    try {
      const page = makeStubPage(fixtureHtml);
      score = await site.test(page);
    } catch (err) {
      console.log(
        JSON.stringify({
          event: 'browser.detection.harness.run.completed',
          siteSlug: site.slug,
          outcome: 'site_unavailable',
          reason: String(err),
        }),
      );
      const result: HarnessRunResult = {
        siteSlug: site.slug,
        mode: site.mode,
        score: null,
        baselineScore: null,
        baselineTolerance: null,
        outcome: 'site_unavailable',
        browserVersion: V1_BROWSER_VERSION,
        playwrightVersion: V1_PLAYWRIGHT_VERSION,
        templateDigest: V1_TEMPLATE_DIGEST,
      };
      results.push(result);
      await writeResultSafe(result);
      continue;
    }

    if (typeof score !== 'number' || !isFinite(score)) {
      console.log(
        JSON.stringify({
          event: 'browser.detection.harness.run.completed',
          siteSlug: site.slug,
          outcome: 'parse_error',
          score: null,
        }),
      );
      console.log(
        JSON.stringify({
          event: 'browser.detection.harness.run.regression',
          siteSlug: site.slug,
          score: null,
          baselineScore: null,
          baselineTolerance: null,
        }),
      );
      const result: HarnessRunResult = {
        siteSlug: site.slug,
        mode: site.mode,
        score: null,
        baselineScore: null,
        baselineTolerance: null,
        outcome: 'parse_error',
        browserVersion: V1_BROWSER_VERSION,
        playwrightVersion: V1_PLAYWRIGHT_VERSION,
        templateDigest: V1_TEMPLATE_DIGEST,
      };
      results.push(result);
      await writeResultSafe(result);
      continue;
    }

    const baseline = loadBaseline(site.slug);

    if (baseline === null) {
      // First run: establish baseline
      writeBaseline(site.slug, score);
      console.log(
        JSON.stringify({
          event: 'browser.detection.harness.baseline.updated',
          siteSlug: site.slug,
          score,
          action: 'established',
        }),
      );
      const result: HarnessRunResult = {
        siteSlug: site.slug,
        mode: site.mode,
        score,
        baselineScore: null,
        baselineTolerance: null,
        outcome: 'baseline_established',
        browserVersion: V1_BROWSER_VERSION,
        playwrightVersion: V1_PLAYWRIGHT_VERSION,
        templateDigest: V1_TEMPLATE_DIGEST,
      };
      results.push(result);
      await writeResultSafe(result);
      continue;
    }

    const outcome = scoreToOutcome(score, baseline);

    console.log(
      JSON.stringify({
        event: 'browser.detection.harness.run.completed',
        siteSlug: site.slug,
        outcome,
        score,
        baselineScore: baseline.score,
        baselineTolerance: baseline.tolerance,
      }),
    );

    if (outcome === 'fail') {
      console.log(
        JSON.stringify({
          event: 'browser.detection.harness.run.regression',
          siteSlug: site.slug,
          score,
          baselineScore: baseline.score,
          baselineTolerance: baseline.tolerance,
        }),
      );
    }

    const result: HarnessRunResult = {
      siteSlug: site.slug,
      mode: site.mode,
      score,
      baselineScore: baseline.score,
      baselineTolerance: baseline.tolerance,
      outcome,
      browserVersion: V1_BROWSER_VERSION,
      playwrightVersion: V1_PLAYWRIGHT_VERSION,
      templateDigest: V1_TEMPLATE_DIGEST,
    };
    results.push(result);
    await writeResultSafe(result);
  }

  const exitCode = runHarnessExitCodePure(results, mode, gatingEnabled);
  process.exit(exitCode);
}

async function writeResultSafe(result: HarnessRunResult): Promise<void> {
  try {
    await write.write(result);
  } catch {
    console.log(
      JSON.stringify({
        event: 'harness.history.write_skipped',
        siteSlug: result.siteSlug,
      }),
    );
  }
}

// CLI entry guard — only invoke runHarness when this file is the entrypoint.
// Importing it as a module (e.g. from the pure-test) must NOT trigger main.
const isCliEntry =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isCliEntry) {
  runHarness().catch((err) => {
    console.error('runHarness: fatal error', err);
    process.exit(1);
  });
}
