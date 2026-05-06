/**
 * scrapingEngine — orchestrates multi-tier web scraping.
 *
 * Phase 1 scope:
 *   - Tier 1: plain HTTP fetch (httpFetcher)
 *   - Tier 2: IEE browser fetch (browserFetcher)
 *   - Tier 3: Scrapling / stealth — TODO Phase 3
 *
 * Pre-flight checks run before any tier:
 *   1. Domain blocklist / allowlist (OrgScrapingSettings)
 *   2. Per-domain rate limit (rateLimiter)
 *   3. robots.txt (in-process cache, only when respectRobotsTxt is true)
 *
 * Org settings are loaded from a hardcoded default in Phase 1. Full DB-backed
 * settings load is deferred to Phase 4.
 */

import { randomUUID } from 'crypto';
import type { ScrapeOptions, ScrapeResult, OrgScrapingSettings } from './types.js';
import { httpFetch } from './httpFetcher.js';
import { browserFetch } from './browserFetcher.js';
import { scraplingFetch } from './scraplingFetcher.js';
import { extractContent } from './contentExtractor.js';
import { checkRateLimit } from './rateLimiter.js';
import { logger } from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// robots.txt cache — in-process, module-scope, TTL-aware.
// Keyed by hostname. Entries expire after 24 hours to pick up policy changes.
// ---------------------------------------------------------------------------
interface RobotsCacheEntry {
  disallowed: boolean;
  expiresAt: number;
}
const robotsCache = new Map<string, RobotsCacheEntry>();
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function isAllowedByRobots(url: string): Promise<boolean> {
  const { hostname, protocol } = new URL(url);
  const cached = robotsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return !cached.disallowed;

  try {
    const robotsUrl = `${protocol}//${hostname}/robots.txt`;
    const res = await fetch(robotsUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AutomationOS/1.0)' },
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      // No robots.txt or inaccessible — treat as allowed
      robotsCache.set(hostname, { disallowed: false, expiresAt: Date.now() + ROBOTS_TTL_MS });
      return true;
    }

    const text = await res.text();
    const disallowed = isSiteGloballyDisallowed(text, '/');
    robotsCache.set(hostname, { disallowed, expiresAt: Date.now() + ROBOTS_TTL_MS });
    return !disallowed;
  } catch {
    // Network error fetching robots.txt — fail open (treat as allowed)
    robotsCache.set(hostname, { disallowed: false, expiresAt: Date.now() + ROBOTS_TTL_MS });
    return true;
  }
}

/**
 * Minimal robots.txt parser — checks whether the given path is disallowed
 * for the AutomationOS user-agent or the wildcard agent (*).
 *
 * Phase 1: only checks root path ('/') to determine general crawlability.
 * A full path-level parser is deferred to a future phase.
 */
function isSiteGloballyDisallowed(robotsTxt: string, _path: string): boolean {
  const lines = robotsTxt.split('\n').map(l => l.trim().toLowerCase());
  let activeAgent = false;

  for (const line of lines) {
    if (line.startsWith('user-agent:')) {
      const agent = line.slice('user-agent:'.length).trim();
      activeAgent = agent === '*' || agent.includes('automationos');
    } else if (activeAgent && line.startsWith('disallow:')) {
      const disallowedPath = line.slice('disallow:'.length).trim();
      if (disallowedPath === '/' || disallowedPath === '/*') return true;
      if (disallowedPath === '') return false; // empty = allow all
    }
  }

  return false;
}

// Rate limiter is process-local (in-memory buckets). In a multi-process
// deployment each process enforces its own limits independently — external
// targets see N× the configured rate where N = number of server processes.
// A shared backing store is deferred to a future phase.
logger.warn('scrapingEngine.rate_limiter_single_instance_mode', {
  note: 'Rate limits are per-process only. Multi-process deployments multiply effective request rate.',
});

// ---------------------------------------------------------------------------
// Phase 1 stub: default org settings. Phase 4 will load these from the DB.
// ---------------------------------------------------------------------------
function getOrgSettings(_orgId: string): OrgScrapingSettings {
  return {
    respectRobotsTxt: true,
    maxTier: 3,
  };
}

// ---------------------------------------------------------------------------
// Helpers exported for scheduled monitoring use cases
// ---------------------------------------------------------------------------

/**
 * Converts a natural language frequency string to an rrule FREQ string.
 *
 * Supported patterns:
 *   "daily"             → "FREQ=DAILY"
 *   "weekly"            → "FREQ=WEEKLY"
 *   "every N hours"     → "FREQ=HOURLY;INTERVAL=N"
 *   "every [weekday]"   → "FREQ=WEEKLY;BYDAY=[day]"  (time is ignored in Phase 1)
 *
 * Throws for unrecognised values.
 */
export function parseFrequencyToRRule(frequency: string): string {
  const normalized = frequency.trim().toLowerCase();

  if (normalized === 'daily') return 'FREQ=DAILY';
  if (normalized === 'weekly') return 'FREQ=WEEKLY';

  const everyNHours = normalized.match(/^every\s+(\d+)\s+hours?$/);
  if (everyNHours) {
    const n = parseInt(everyNHours[1], 10);
    return `FREQ=HOURLY;INTERVAL=${n}`;
  }

  const weekdayMap: Record<string, string> = {
    monday: 'MO',
    tuesday: 'TU',
    wednesday: 'WE',
    thursday: 'TH',
    friday: 'FR',
    saturday: 'SA',
    sunday: 'SU',
  };

  // "every monday [at HH:MM]" — time portion ignored in Phase 1
  const everyWeekday = normalized.match(/^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  if (everyWeekday) {
    const day = weekdayMap[everyWeekday[1]];
    return `FREQ=WEEKLY;BYDAY=${day}`;
  }

  throw { statusCode: 400, message: `Unsupported frequency: "${frequency}". Use: "daily", "weekly", "every N hours", or "every [weekday]"`, errorCode: 'MONITOR_UNSUPPORTED_FREQUENCY' };
}

// ---------------------------------------------------------------------------
// Monitor brief serialisation helpers
// ---------------------------------------------------------------------------

export interface MonitorBriefConfig {
  type: 'monitor_webpage_run';
  monitorUrl: string;
  watchFor: string;
  fields: string | null;
  selectorGroup: string | null;
  scheduledTaskId: string;
  /** Initial baseline stored when the monitor was set up. Available on the first scheduled run. */
  baseline?: {
    contentHash: string;
    extractedData: Record<string, unknown> | null;
  };
}

export function serializeMonitorBrief(config: MonitorBriefConfig): string {
  return JSON.stringify(config);
}

export function parseMonitorBrief(brief: string): MonitorBriefConfig {
  const parsed = JSON.parse(brief) as MonitorBriefConfig;
  if (!parsed.monitorUrl || !parsed.watchFor) {
    throw new Error(`monitor_webpage brief could not be parsed: ${parsed.scheduledTaskId ?? 'unknown'}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const scrapingEngine = {
  // NOTE: scraping_cache table exists (Phase 4 scope) but is not consulted here.
  // Every scrape() call fetches fresh content. Cache read/write logic will be
  // added in Phase 4 — do not assume cache is active.
  async scrape(options: ScrapeOptions): Promise<ScrapeResult> {
    const {
      url,
      outputFormat = 'markdown',
      selectors = [],
      orgId,
      subaccountId,
      _mcpCallContext,
    } = options;

    const fetchStart = Date.now();
    const blockedTiers: number[] = [];

    // ── 1. Org settings ───────────────────────────────────────────────────────
    const settings = getOrgSettings(orgId);

    // ── 2. Domain blocklist / allowlist check ─────────────────────────────────
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      throw { statusCode: 400, message: `Invalid URL: ${url}`, errorCode: 'SCRAPE_INVALID_URL' };
    }

    if (settings.allowedDomains && settings.allowedDomains.length > 0) {
      if (!settings.allowedDomains.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
        throw {
          statusCode: 403,
          message: `Domain ${hostname} is not in the org allowlist`,
          errorCode: 'SCRAPE_DOMAIN_NOT_ALLOWED',
        };
      }
    }

    if (settings.blockedDomains && settings.blockedDomains.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
      throw {
        statusCode: 403,
        message: `Domain ${hostname} is blocked for this org`,
        errorCode: 'SCRAPE_DOMAIN_BLOCKED',
      };
    }

    // ── 3. Rate limit check ───────────────────────────────────────────────────
    const rateCheck = checkRateLimit(hostname, orgId);
    if (!rateCheck.allowed) {
      throw {
        statusCode: 429,
        message: `Rate limit exceeded for ${hostname}. Retry after ${rateCheck.retryAfterMs}ms`,
        errorCode: 'SCRAPE_RATE_LIMITED',
      };
    }

    // ── 4. robots.txt check ───────────────────────────────────────────────────
    if (settings.respectRobotsTxt) {
      const allowed = await isAllowedByRobots(url);
      if (!allowed) {
        throw {
          statusCode: 403,
          message: `Scraping ${hostname} is disallowed by robots.txt`,
          errorCode: 'SCRAPE_ROBOTS_DISALLOWED',
        };
      }
    }

    // ── 5. Determine effective maxTier ────────────────────────────────────────
    // JSON output or CSS selectors require a rendered DOM — cap at Tier 2.
    const requestedMax = options.maxTier ?? settings.maxTier ?? 3;
    const effectiveMax: 1 | 2 | 3 =
      outputFormat === 'json' || selectors.length > 0
        ? (Math.min(requestedMax, 2) as 1 | 2)
        : requestedMax;

    // ── 6. Tier 1 — plain HTTP ────────────────────────────────────────────────
    const tier1Result = await httpFetch(url);

    if (tier1Result.success && tier1Result.html) {
      const { content, contentHash } = await extractContent(
        tier1Result.html,
        url,
        outputFormat,
        selectors,
      );

      return {
        success: true,
        content,
        rawHtml: tier1Result.html,
        tierUsed: 1,
        url,
        statusCode: tier1Result.statusCode,
        contentHash,
        metadata: {
          fetchDurationMs: Date.now() - fetchStart,
          contentLength: content.length,
          wasEscalated: false,
          blockedTiers,
        },
      };
    }

    blockedTiers.push(1);
    logger.info('scrapingEngine.escalation', {
      url,
      fromTier: 1,
      toTier: 2,
      reason: tier1Result.error ?? 'non-2xx or no html',
      wasBlocked: tier1Result.wasBlocked,
      statusCode: tier1Result.statusCode,
    });

    // ── 7. Tier 2 — IEE browser ───────────────────────────────────────────────
    if (effectiveMax >= 2) {
      // Phase 1: placeholder agent context — threaded properly in a later phase
      const agentId = 'scraping-engine';
      const runId = randomUUID();

      const tier2Result = await browserFetch(url, {
        orgId,
        subaccountId: subaccountId ?? null,
        agentId,
        runId,
      });

      if (tier2Result.success && tier2Result.html) {
        const { content, contentHash } = await extractContent(
          tier2Result.html,
          url,
          outputFormat,
          selectors,
        );

        return {
          success: true,
          content,
          rawHtml: tier2Result.html,
          tierUsed: 2,
          url,
          statusCode: tier2Result.statusCode,
          contentHash,
          metadata: {
            fetchDurationMs: Date.now() - fetchStart,
            contentLength: content.length,
            wasEscalated: true,
            blockedTiers,
          },
        };
      }

      blockedTiers.push(2);
      logger.info('scrapingEngine.escalation', {
        url,
        fromTier: 2,
        toTier: 3,
        reason: tier2Result.error ?? 'browser fetch failed',
        wasBlocked: tier2Result.wasBlocked,
      });
    }

    // ── 8. Tier 3 — Scrapling MCP sidecar (anti-bot bypass)
    // Only attempted for text/markdown output without CSS selectors.
    // Scrapling returns pre-extracted markdown — raw DOM queries are not possible.
    if (effectiveMax >= 3 && outputFormat !== 'json' && selectors.length === 0 && _mcpCallContext) {
      const tier3Result = await scraplingFetch(url, _mcpCallContext);

      if (tier3Result.available === false) {
        logger.info('scrapingEngine.tier3_unavailable', { url, reason: 'scrapling_not_configured' });
      } else if (tier3Result.success && tier3Result.html) {
        // Scrapling returns pre-extracted markdown — skip re-extraction for plain text
        const content = tier3Result.html;
        const { contentHash } = await extractContent(content, url, outputFormat, selectors);

        return {
          success: true,
          content,
          tierUsed: 3,
          url,
          statusCode: tier3Result.statusCode,
          contentHash,
          metadata: {
            fetchDurationMs: Date.now() - fetchStart,
            contentLength: content.length,
            wasEscalated: true,
            blockedTiers,
          },
        };
      } else {
        blockedTiers.push(3);
        logger.info('scrapingEngine.tier3_blocked', { url, error: tier3Result.error });
      }
    }

    return {
      success: false,
      content: '',
      tierUsed: (blockedTiers[blockedTiers.length - 1] ?? 1) as 1 | 2 | 3,
      url,
      contentHash: '',
      metadata: {
        fetchDurationMs: Date.now() - fetchStart,
        contentLength: 0,
        wasEscalated: blockedTiers.length > 0,
        blockedTiers,
      },
    };
  },
};
