// ScrapeRequest, ScrapeResult, TierResult, OrgScrapingSettings

export interface ScrapeOptions {
  url: string;
  extract?: string;
  outputFormat?: 'text' | 'markdown' | 'json';
  maxTier?: 1 | 2 | 3;
  selectors?: string[];
  adaptive?: boolean;
  selectorGroup?: string;
  timeout?: number;
  orgId: string;
  subaccountId?: string;
}

export interface ScrapeResult {
  success: boolean;
  content: string;
  rawHtml?: string;
  tierUsed: 1 | 2 | 3;
  url: string;
  statusCode?: number;
  contentHash: string;
  extractedData?: Record<string, unknown>;
  selectorConfidence?: number;
  selectorUncertain?: boolean;
  adaptiveMatchUsed?: boolean;
  metadata: {
    fetchDurationMs: number;
    contentLength: number;
    wasEscalated: boolean;
    blockedTiers: number[];
  };
}

export interface TierResult {
  success: boolean;
  html?: string;
  statusCode?: number;
  wasBlocked: boolean;
  error?: string;
}

export interface OrgScrapingSettings {
  allowedDomains?: string[];   // if set, only these domains are permitted
  blockedDomains?: string[];   // domains that are always blocked
  respectRobotsTxt?: boolean;  // default: true
  maxTier?: 1 | 2 | 3;        // org-level tier cap (default: 3)
}
