/**
 * Detection site: whoer.net (spec §5.1, chunk 3).
 *
 * Mode: advisory — does not block CI until promoted to blocking.
 *
 * V1: runs against the cached fixture at
 *   server/tests/browser-detection-harness/fixtures/whoer.html
 */

interface MinimalPage {
  goto(url: string): Promise<void>;
  content(): Promise<string>;
}

export default {
  slug: 'whoer' as const,
  mode: 'advisory' as const,

  test: async (page: MinimalPage): Promise<number> => {
    await page.goto('https://whoer.net/');
    const html = await page.content();
    return parseWhoerScore(html);
  },
};

function parseWhoerScore(html: string): number {
  // whoer.net shows an anonymity percentage (e.g. "67%").
  // Higher anonymity = lower detection risk = better score.
  // Normalise the percentage to [0,1].
  // On parse failure return NaN so runHarness emits parse_error (spec §8.1).
  const match = html.match(/(\d+(?:\.\d+)?)\s*%/);
  if (match) {
    return Math.min(1.0, parseFloat(match[1]) / 100);
  }
  return NaN;
}
