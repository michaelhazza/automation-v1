/**
 * Reference site: browserscan.net (spec §5.1, chunk 2).
 *
 * Mode: blocking — failures here block CI when gating flag is on.
 *
 * V1: runs against the cached fixture at
 *   server/tests/browser-detection-harness/fixtures/browserscan.html
 */

interface MinimalPage {
  goto(url: string): Promise<void>;
  content(): Promise<string>;
}

export default {
  slug: 'browserscan' as const,
  mode: 'blocking' as const,

  test: async (page: MinimalPage): Promise<number> => {
    await page.goto('https://browserscan.net/');
    const html = await page.content();
    return parseBrowserscanScore(html);
  },
};

function parseBrowserscanScore(html: string): number {
  // browserscan shows a percentage score — look for it in the HTML.
  // Matches patterns like "85%" or "85.0%". Returns a [0,1] normalised value.
  // On parse failure return NaN so runHarness emits parse_error (spec §8.1) —
  // a neutral 0.5 would hide parser regressions behind a passable score and
  // weaken the { fail, parse_error } blocking contract for cached fixtures.
  const scoreMatch = html.match(/(\d+(?:\.\d+)?)\s*%/);
  if (scoreMatch) {
    return Math.min(1.0, parseFloat(scoreMatch[1]) / 100);
  }
  return NaN;
}
