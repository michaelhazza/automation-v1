/**
 * Detection site: deviceandbrowserinfo.com (spec §5.1, chunk 3).
 *
 * Mode: advisory — does not block CI until promoted to blocking.
 *
 * V1: runs against the cached fixture at
 *   server/tests/browser-detection-harness/fixtures/deviceandbrowserinfo.html
 */

interface MinimalPage {
  goto(url: string): Promise<void>;
  content(): Promise<string>;
}

export default {
  slug: 'deviceandbrowserinfo' as const,
  mode: 'advisory' as const,

  test: async (page: MinimalPage): Promise<number> => {
    await page.goto('https://www.deviceandbrowserinfo.com/are_you_a_bot');
    const html = await page.content();
    return parseDeviceAndBrowserInfoScore(html);
  },
};

function parseDeviceAndBrowserInfoScore(html: string): number {
  // The site shows a verdict about whether the browser appears real or headless.
  // Positive indicators (real browser) → high score.
  // Negative indicators (headless / detected) → low score.
  const lower = html.toLowerCase();
  if (lower.includes('real browser') || lower.includes('not detected') || lower.includes('not a bot')) {
    return 0.80;
  }
  if (lower.includes('headless') || lower.includes('detected') || lower.includes('is a bot')) {
    return 0.20;
  }
  return 0.5;
}
