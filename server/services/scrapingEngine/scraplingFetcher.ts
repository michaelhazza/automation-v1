/**
 * scraplingFetcher — Tier 3 scraping via the Scrapling MCP sidecar.
 *
 * Phase 3 scope: wired into scrapingEngine/index.ts in Phase 3.
 * This file exists so the module is ready when the engine escalates to Tier 3.
 *
 * Scrapling MCP provides best-in-class Cloudflare Turnstile bypass via a
 * Python-based stdio MCP server (`uvx scrapling mcp`). The preset is
 * configured in server/config/mcpPresets.ts.
 *
 * Capability boundary:
 *   - Only supports text/markdown output — Scrapling returns pre-extracted
 *     markdown, not raw HTML. CSS selector queries and structured JSON
 *     extraction against the raw DOM are not possible via Tier 3.
 *   - scrapingEngine/index.ts enforces this: json output_format and
 *     css_selectors cap escalation at Tier 2.
 */

import { mcpClientManager } from '../mcpClientManager.js';
import { logger } from '../../lib/logger.js';
import type { TierResult } from './types.js';
import type { McpClientInstance } from '../mcpClientManager.js';
import type { McpServerConfig } from '../../db/schema/mcpServerConfigs.js';

const MAX_CONTENT_BYTES = 100_000; // 100KB — matches MAX_MCP_RESPONSE_SIZE

export interface ScraplingCallContext {
  clients: Map<string, McpClientInstance>;
  lazyRegistry: Map<string, McpServerConfig>;
  runContext: {
    runId: string;
    organisationId: string;
    agentId: string;
    subaccountId: string | null;
    taskId?: string;
    mcpCallCount?: number;
  };
}

/**
 * Fetch a URL via the Scrapling MCP sidecar (Tier 3).
 *
 * Returns `{ available: false }` (as a failed TierResult) when the Scrapling
 * MCP server is not configured for this org — Tier 3 remains optional.
 */
export async function scraplingFetch(
  url: string,
  context: ScraplingCallContext,
): Promise<TierResult & { available?: boolean }> {
  // Check if Scrapling is available in the lazy registry or already connected
  const isAvailable =
    context.clients.has('scrapling') || context.lazyRegistry.has('scrapling');

  if (!isAvailable) {
    return { success: false, wasBlocked: false, available: false };
  }

  const mcpCtx = {
    ...context.runContext,
    mcpCallCount: context.runContext.mcpCallCount ?? 0,
  };

  // Attempt Tier 3a: stealthy_fetch (Cloudflare bypass)
  try {
    const result = await mcpClientManager.callTool(
      context.clients,
      context.lazyRegistry,
      'mcp.scrapling.stealthy_fetch',
      { url, main_content_only: true },
      mcpCtx,
    );

    const content = extractScraplingContent(result);
    if (content !== null) {
      logger.info('scraplingFetch.stealthy_fetch.success', { url, contentLength: content.length });
      return {
        success: true,
        html: content.length > MAX_CONTENT_BYTES ? content.slice(0, MAX_CONTENT_BYTES) : content,
        wasBlocked: false,
        available: true,
      };
    }
  } catch (err) {
    logger.warn('scraplingFetch.stealthy_fetch.failed', {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Attempt Tier 3b: get (plain HTTP via Scrapling — still has better TLS fingerprinting)
  try {
    const result = await mcpClientManager.callTool(
      context.clients,
      context.lazyRegistry,
      'mcp.scrapling.get',
      { url },
      mcpCtx,
    );

    const content = extractScraplingContent(result);
    if (content !== null) {
      logger.info('scraplingFetch.get.success', { url, contentLength: content.length });
      return {
        success: true,
        html: content.length > MAX_CONTENT_BYTES ? content.slice(0, MAX_CONTENT_BYTES) : content,
        wasBlocked: false,
        available: true,
      };
    }
  } catch (err) {
    logger.warn('scraplingFetch.get.failed', {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    success: false,
    wasBlocked: true,
    available: true,
    error: 'Scrapling exhausted both stealthy_fetch and get — all tiers blocked',
  };
}

/**
 * Extracts the content string from a Scrapling MCP tool result.
 * Returns null if the result does not contain usable content.
 */
function extractScraplingContent(result: unknown): string | null {
  if (typeof result === 'string' && result.length > 0) return result;

  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.content === 'string' && r.content.length > 0) return r.content;
    if (typeof r.text === 'string' && r.text.length > 0) return r.text;
    if (typeof r.markdown === 'string' && r.markdown.length > 0) return r.markdown;
    if (typeof r.html === 'string' && r.html.length > 0) return r.html;
  }

  return null;
}
