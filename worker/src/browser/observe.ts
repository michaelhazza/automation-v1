// ---------------------------------------------------------------------------
// Browser observation builder. Spec §5.3, §5.6, §6.4.
// Returns a STRUCTURED Observation, never raw HTML. Caps enforced here.
// ---------------------------------------------------------------------------

import type { Page } from 'playwright';
import { Observation } from '../../../shared/iee/observation.js';
import { truncateMiddle } from '../logger.js';

export async function buildBrowserObservation(
  page: Page,
  lastActionResult?: string,
): Promise<Observation> {
  const url = page.url();

  const pageText: string = await page
    .evaluate(() => (document.body?.innerText ?? ''))
    .catch(() => '');

  const clickable: string[] = await page
    .$$eval(
      'a, button, [role="button"], input[type="submit"], [role="link"]',
      (els) =>
        els
          .map((e) => {
            const txt = (e as HTMLElement).innerText?.trim();
            const aria = (e as HTMLElement).getAttribute('aria-label');
            return (txt || aria || '').slice(0, 200);
          })
          .filter(Boolean)
          .slice(0, 80),
    )
    .catch(() => []);

  const inputs: string[] = await page
    .$$eval('input, textarea, select', (els) =>
      els
        .map((e) => {
          const inp = e as HTMLInputElement;
          return (inp.name || inp.id || inp.placeholder || '').slice(0, 200);
        })
        .filter(Boolean)
        .slice(0, 80),
    )
    .catch(() => []);

  return Observation.parse({
    url,
    pageText: truncateMiddle(pageText, 8000),
    clickableElements: clickable,
    inputs,
    lastActionResult,
  });
}
