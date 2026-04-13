import { createHash } from 'crypto';

export function canonicalizeFieldKey(field: string): string {
  return field
    .split(',')
    .map(f => f.trim().toLowerCase().replace(/[\s-]/g, '_').replace(/[^a-z0-9_]/g, ''))
    .filter(Boolean)
    .join(',');
}

export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function extractContent(
  html: string,
  url: string,
  outputFormat: 'text' | 'markdown' | 'json' = 'markdown',
  _cssSelectors?: string[],
): Promise<{ content: string; contentHash: string }> {
  let content: string;

  if (outputFormat === 'text') {
    content = htmlToText(html);
  } else if (outputFormat === 'json') {
    // JSON (LLM-assisted) is Phase 2 — return stripped text as fallback for now
    content = htmlToText(html);
  } else {
    // markdown (default)
    content = await htmlToMarkdown(html, url);
  }

  return { content, contentHash: computeContentHash(content) };
}

function htmlToText(html: string): string {
  // Strip tags, normalize whitespace
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function htmlToMarkdown(html: string, url: string): Promise<string> {
  try {
    // Try Readability for article extraction
    const { Readability } = await import('@mozilla/readability');
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article?.content) {
      // Convert article HTML to markdown
      const TurndownService = (await import('turndown')).default;
      const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
      return td.turndown(article.content);
    }
  } catch {
    // Fall through to full-page markdown
  }

  try {
    const TurndownService = (await import('turndown')).default;
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    return td.turndown(html);
  } catch {
    return htmlToText(html);
  }
}
