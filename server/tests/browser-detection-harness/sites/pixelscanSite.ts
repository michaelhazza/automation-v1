/**
 * Detection site: pixelscan.io (spec §5.1, chunk 3).
 *
 * Mode: advisory — does not block CI until promoted to blocking.
 *
 * V1: runs against the cached fixture at
 *   server/tests/browser-detection-harness/fixtures/pixelscan.html
 */

interface MinimalPage {
  goto(url: string): Promise<void>;
  content(): Promise<string>;
}

export default {
  slug: 'pixelscan' as const,
  mode: 'advisory' as const,

  test: async (page: MinimalPage): Promise<number> => {
    await page.goto('https://pixelscan.io/');
    const html = await page.content();
    return parsePixelscanScore(html);
  },
};

function parsePixelscanScore(html: string): number {
  // pixelscan.io shows a consistency score or consistent/inconsistent labels.
  // "Consistent" signals a genuine browser → high score.
  // "Inconsistent" signals fingerprint mismatches → low score.
  // Also accept a percentage value if present.
  // On parse failure return NaN so runHarness emits parse_error (spec §8.1).
  const lower = html.toLowerCase();
  const percentMatch = html.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) {
    return Math.min(1.0, parseFloat(percentMatch[1]) / 100);
  }
  if (lower.includes('consistent') && !lower.includes('inconsistent')) {
    return 0.80;
  }
  if (lower.includes('inconsistent')) {
    return 0.20;
  }
  return NaN;
}
