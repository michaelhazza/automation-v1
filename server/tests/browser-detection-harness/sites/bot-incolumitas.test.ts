/**
 * Detection site: bot.incolumitas.com (spec §5.1, chunk 3).
 *
 * Mode: advisory — does not block CI until promoted to blocking.
 *
 * V1: runs against the cached fixture at
 *   server/tests/browser-detection-harness/fixtures/bot-incolumitas.html
 */

interface MinimalPage {
  goto(url: string): Promise<void>;
  content(): Promise<string>;
}

export default {
  slug: 'bot-incolumitas' as const,
  mode: 'advisory' as const,

  test: async (page: MinimalPage): Promise<number> => {
    await page.goto('https://bot.incolumitas.com/');
    const html = await page.content();
    return parseBotIncolumitasScore(html);
  },
};

function parseBotIncolumitasScore(html: string): number {
  // The site returns a JSON-based result with a "bot" boolean.
  // "bot":false means the browser looks human → high score.
  // "bot":true means detected as a bot → low score.
  if (html.includes('"bot":false')) return 0.80;
  if (html.includes('"bot":true')) return 0.20;
  return 0.5;
}
