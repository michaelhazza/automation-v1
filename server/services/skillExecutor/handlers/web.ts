import { eq, and, count, inArray } from 'drizzle-orm';
import { createHash } from 'crypto';
import { resolve, join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { SkillExecutionContext } from '../context.js';
import { env } from '../../../lib/env.js';
import { db } from '../../../db/index.js';
import { agentRuns, actions, scheduledTasks } from '../../../db/schema/index.js';
import { devContextService, assertPathInRoot } from '../../devContextService.js';
import { scrapingEngine, parseFrequencyToRRule, serializeMonitorBrief, parseMonitorBrief } from '../../scrapingEngine/index.js';
import { loadSelectors, saveSelector, incrementHit, incrementMiss, updateSelector } from '../../scrapingEngine/selectorStore.js';
import { buildFingerprint, resolveSelector } from '../../scrapingEngine/adaptiveSelector.js';
import { canonicalizeFieldKey, computeContentHash } from '../../scrapingEngine/contentExtractor.js';
import { scheduledTaskService } from '../../scheduledTaskService.js';
import { routeCall } from '../../llmRouter.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Web Search (Tavily)
// ---------------------------------------------------------------------------

export async function executeWebSearch(input: Record<string, unknown>, context: SkillExecutionContext): Promise<unknown> {
  const apiKey = env.TAVILY_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'Web search is not configured (TAVILY_API_KEY not set)' };
  }

  const query = String(input.query ?? '');
  const maxResults = Math.min(Number(input.max_results ?? 5), 10);

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_answer: true,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return { success: false, error: `Search API error: ${errorText}` };
    }

    const data = await response.json() as {
      answer?: string;
      results?: Array<{
        title: string;
        url: string;
        content: string;
        score: number;
      }>;
    };

    // Per-subaccount Tavily usage logging for billing
    logSearchUsage(context.subaccountId, context.organisationId, context.runId).catch((err) => console.error('[SkillExecutor] Failed to log search usage:', err));

    return {
      success: true,
      answer: data.answer ?? null,
      results: (data.results ?? []).map(r => ({
        title: r.title,
        url: r.url,
        content: r.content,
        relevance_score: r.score,
      })),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Search failed: ${errMsg}` };
  }
}

function logSearchUsage(subaccountId: string | null, organisationId: string, runId: string): Promise<void> {
  // Structured usage log for per-subaccount Tavily billing tracking.
  // Log aggregation (e.g. Datadog, CloudWatch) captures this for billing.
  console.log(JSON.stringify({
    event: 'platform_usage',
    service: 'tavily_search',
    calls: 1,
    subaccountId,
    organisationId,
    runId,
    timestamp: new Date().toISOString(),
  }));
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Fetch URL — HTTP GET/POST with response truncation
// ---------------------------------------------------------------------------

export async function executeFetchUrl(
  input: Record<string, unknown>,
  _context: SkillExecutionContext
): Promise<unknown> {
  const url = String(input.url ?? '');
  if (!url) return { success: false, error: 'url is required' };

  const method = (String(input.method ?? 'GET')).toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return { success: false, error: 'method must be GET or POST' };
  }

  const headers: Record<string, string> = {};
  if (input.headers && typeof input.headers === 'object') {
    for (const [k, v] of Object.entries(input.headers as Record<string, unknown>)) {
      headers[k] = String(v);
    }
  }

  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(30_000),
    };

    if (method === 'POST' && input.body) {
      fetchOptions.body = String(input.body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);

    const bodyText = await response.text();
    const truncated = bodyText.length > 10000;
    const content = truncated ? bodyText.slice(0, 10000) : bodyText;

    return {
      success: true,
      status_code: response.status,
      content,
      truncated,
      content_type: response.headers.get('content-type') ?? undefined,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Fetch failed: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Scrape URL — tiered web scraping with automatic escalation
// ---------------------------------------------------------------------------

export async function executeScrapeUrl(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const url = String(input.url ?? '');
  if (!url) return { success: false, error: 'url is required' };

  const result = await scrapingEngine.scrape({
    url,
    extract: input.extract ? String(input.extract) : undefined,
    outputFormat: (input.output_format as 'text' | 'markdown' | 'json') ?? 'markdown',
    selectors: input.css_selectors as string[] | undefined,
    adaptive: true,
    orgId: context.organisationId,
    subaccountId: context.subaccountId ?? undefined,
    _mcpCallContext: context._mcpClients ? {
      clients: context._mcpClients,
      lazyRegistry: context._mcpLazyRegistry ?? new Map(),
      runContext: {
        runId: context.runId,
        organisationId: context.organisationId,
        agentId: context.agentId,
        subaccountId: context.subaccountId,
        isTestRun: context.isTestRun ?? false,
        taskId: context.taskId,
        mcpCallCount: context.mcpCallCount,
      },
    } : undefined,
  });

  return {
    success: result.success,
    content: result.content,
    tier_used: result.tierUsed,
    content_hash: result.contentHash,
    extracted_data: result.extractedData,
    url: result.url,
    metadata: result.metadata,
  };
}

// ---------------------------------------------------------------------------
// Scrape Structured — adaptive selector extraction with LLM first-run learning
// ---------------------------------------------------------------------------

const SCRAPE_STRUCTURED_MAX_HTML_CHARS = 40_000; // ~4000 tokens of focused DOM
const SCRAPE_STRUCTURED_RETURN_LIMIT = 50_000;   // max response chars returned to agent

/**
 * Derive a deterministic selectorGroup from the site hostname and field string.
 * Format: "<hostname>:<sha256(fields.trim().lower).slice(0,8)>"
 */
function deriveSelectorGroup(hostname: string, fields: string): string {
  const hash = createHash('sha256')
    .update(fields.trim().toLowerCase())
    .digest('hex')
    .slice(0, 8);
  return `${hostname}:${hash}`;
}

export async function executeScrapeStructured(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const url = String(input.url ?? '');
  const fields = String(input.fields ?? '');
  const remember = input.remember !== false; // default true
  const selectorGroupInput = input.selector_group ? String(input.selector_group) : null;

  if (!url) return { success: false, error: 'url is required' };
  if (!fields) return { success: false, error: 'fields is required' };

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { success: false, error: `Invalid URL: ${url}` };
  }

  const selectorGroup = selectorGroupInput ?? deriveSelectorGroup(hostname, fields);
  const urlPattern = hostname; // Use hostname as URL pattern for Phase 2

  // Canonicalize field names
  const canonicalFields = fields
    .split(',')
    .map(f => canonicalizeFieldKey(f))
    .filter(Boolean);

  // ── 1. Check for existing selectors ──────────────────────────────────────
  const storedSelectors = await loadSelectors({
    orgId: context.organisationId,
    subaccountId: context.subaccountId ?? null,
    urlPattern,
    selectorGroup,
  });

  // ── 2. Fetch the page (max Tier 2 — need raw HTML for DOM extraction) ────
  const scrapeResult = await scrapingEngine.scrape({
    url,
    outputFormat: 'text',
    maxTier: 2,
    orgId: context.organisationId,
    subaccountId: context.subaccountId ?? undefined,
  });

  if (!scrapeResult.success || !scrapeResult.rawHtml) {
    return { success: false, error: `Failed to fetch page: ${url}` };
  }

  const contentHash = computeContentHash(scrapeResult.content);

  // ── 3a. Stored selectors exist — DOM extraction path ─────────────────────
  if (storedSelectors.length > 0) {
    try {
      const { JSDOM } = await import('jsdom');
      const { document } = new JSDOM(scrapeResult.rawHtml!).window;

      const extracted: Record<string, string[]> = {};
      let overallScore = 1.0;
      let adaptiveMatchUsed = false;
      let selectorUncertain = false;
      const selectorUpdates: Array<{ id: string; newSelector: string; newFingerprint: import('../../scrapingEngine/adaptiveSelector.js').ElementFingerprint }> = [];

      for (const stored of storedSelectors) {
        const fieldKey = stored.selectorName;
        const resolution = resolveSelector(document, stored.cssSelector, stored.elementFingerprint);

        if (!resolution.found) {
          await incrementMiss(stored.id);
          extracted[fieldKey] = [];
          overallScore = Math.min(overallScore, 0);
          continue;
        }

        if (resolution.adaptiveMatchUsed) {
          adaptiveMatchUsed = true;
          if (resolution.cssSelector && resolution.fingerprint) {
            selectorUpdates.push({
              id: stored.id,
              newSelector: resolution.cssSelector,
              newFingerprint: resolution.fingerprint,
            });
          }
        }

        overallScore = Math.min(overallScore, resolution.score);
        if (resolution.uncertain) selectorUncertain = true;

        // Extract all matching elements for this selector (per-field try/catch
        // so a broken selector for one field doesn't discard the rest)
        try {
          const matchedEls = document.querySelectorAll(resolution.cssSelector!);
          const values: string[] = [];
          matchedEls.forEach((el: Element) => {
            const text = (el.textContent ?? '').trim();
            if (text) values.push(text);
          });
          extracted[fieldKey] = values;
          await incrementHit(stored.id);
        } catch {
          await incrementMiss(stored.id);
          extracted[fieldKey] = [];
          overallScore = Math.min(overallScore, 0);
        }
      }

      // Apply adaptive updates if any
      for (const upd of selectorUpdates) {
        await updateSelector(upd.id, upd.newSelector, upd.newFingerprint);
      }

      return {
        success: true,
        ...extracted,
        selector_confidence: overallScore,
        adaptive_match_used: adaptiveMatchUsed,
        selector_uncertain: selectorUncertain,
        content_hash: contentHash,
        url,
      };
    } catch (err) {
      // If DOM extraction fails, fall through to LLM path
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[scrape_structured] DOM extraction failed, falling back to LLM: ${errMsg}`);
    }
  }

  // ── 3b. No stored selectors — LLM extraction path ────────────────────────
  // Build a focused DOM excerpt for the LLM
  const htmlForLlm = (scrapeResult.rawHtml ?? '').slice(0, SCRAPE_STRUCTURED_MAX_HTML_CHARS);
  const fieldList = canonicalFields.join(', ');

  const extractionPrompt = `You are a data extraction assistant. Given the HTML below, extract structured data.

Fields to extract: ${fieldList}

Rules:
- Return ONLY valid JSON with exactly these keys: ${fieldList}
- Each key maps to an ARRAY of values (even if there is only one value)
- For multiple records on the page (e.g. pricing tiers), each field array has one entry per record in the same order
- Also return a "css_selectors" key mapping each field to the CSS selector that targets those elements
- If a field cannot be found, use an empty array []

Example response for fields "plan_name, price":
{"plan_name":["Starter","Pro"],"price":["$9","$29"],"css_selectors":{"plan_name":"h3.plan-name","price":"span.price"}}

HTML:
${htmlForLlm}`;

  const llmResponse = await routeCall({
    messages: [{ role: 'user', content: extractionPrompt }],
    maxTokens: 2000,
    context: {
      organisationId: context.organisationId,
      subaccountId: context.subaccountId ?? '',
      runId: context.runId,
      sourceType: 'system',
      agentName: 'scrape_structured',
      taskType: 'general',
      routingMode: 'ceiling',
    },
  });

  // Parse LLM response
  let extracted: Record<string, unknown> = {};
  let cssSelectorsFromLlm: Record<string, string> = {};

  try {
    const responseText = typeof llmResponse.content === 'string' ? llmResponse.content : '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      cssSelectorsFromLlm = (parsed.css_selectors as Record<string, string>) ?? {};
      delete parsed.css_selectors;
      extracted = parsed;
    }
  } catch {
    return { success: false, error: 'LLM extraction failed to return valid JSON' };
  }

  // ── 4. Learn selectors for next time ────────────────────────────────────
  if (remember && Object.keys(cssSelectorsFromLlm).length > 0 && scrapeResult.rawHtml) {
    try {
      const { JSDOM } = await import('jsdom');
      const { document: learnDoc } = new JSDOM(scrapeResult.rawHtml).window;

      for (const [fieldName, selector] of Object.entries(cssSelectorsFromLlm)) {
        if (!selector || typeof selector !== 'string') continue;
        let el: Element | null = null;
        try { el = learnDoc.querySelector(selector); } catch { continue; }
        if (el === null) continue;

        const fingerprint = buildFingerprint(el);

        await saveSelector({
          orgId: context.organisationId,
          subaccountId: context.subaccountId ?? null,
          urlPattern,
          selectorGroup,
          selectorName: fieldName,
          cssSelector: selector,
          fingerprint,
        }).catch(err => {
          console.warn(`[scrape_structured] Failed to save selector for "${fieldName}": ${err}`);
        });
      }
    } catch (err) {
      // Selector learning is best-effort — don't fail the extraction
      console.warn(`[scrape_structured] Selector learning failed: ${err}`);
    }
  }

  const dataWasTruncated = JSON.stringify(extracted).length > SCRAPE_STRUCTURED_RETURN_LIMIT;

  return {
    success: true,
    ...extracted,
    ...(dataWasTruncated ? { data_truncated: true } : {}),
    selector_confidence: 0,        // 0 = LLM extraction (no stored selectors)
    adaptive_match_used: false,
    selector_uncertain: false,
    content_hash: contentHash,
    url,
  };
}

// ---------------------------------------------------------------------------
// Monitor Webpage — set up recurring monitoring with change detection
// ---------------------------------------------------------------------------

const MONITOR_SCHEDULE_TIME_DEFAULT = '00:00';

export async function executeMonitorWebpage(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  const url = String(input.url ?? '');
  const watchFor = String(input.watch_for ?? '');
  const frequency = String(input.frequency ?? '');
  const fields = input.fields ? String(input.fields) : null;

  if (!url) return { success: false, error: 'url is required' };
  if (!watchFor) return { success: false, error: 'watch_for is required' };
  if (!frequency) return { success: false, error: 'frequency is required' };

  // requireSubaccountContext check — monitor_webpage needs a subaccount to attach the scheduled task
  if (!context.subaccountId) {
    return { success: false, error: 'monitor_webpage requires a subaccount context' };
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { success: false, error: `Invalid URL: ${url}` };
  }

  // ── 0. Deduplication — return existing task if one already monitors this URL ──
  const existingTasks = await db
    .select({ id: scheduledTasks.id, brief: scheduledTasks.brief })
    .from(scheduledTasks)
    .where(
      and(
        eq(scheduledTasks.organisationId, context.organisationId),
        eq(scheduledTasks.subaccountId, context.subaccountId),
        eq(scheduledTasks.assignedAgentId, context.agentId),
        eq(scheduledTasks.isActive, true),
      ),
    );

  const duplicate = existingTasks.find(t => {
    try {
      return parseMonitorBrief(t.brief ?? '').monitorUrl === url;
    } catch {
      return false;
    }
  });

  if (duplicate) {
    return {
      success: true,
      scheduled_task_id: duplicate.id,
      already_existed: true,
      message: `Monitor for ${url} already exists (task ${duplicate.id})`,
    };
  }

  // ── 1. Parse frequency to rrule ──────────────────────────────────────────
  let rrule: string;
  try {
    rrule = parseFrequencyToRRule(frequency);
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? `Unsupported frequency: "${frequency}"`;
    return { success: false, error: msg };
  }

  // Derive scheduleTime from rrule (default 00:00 for simple frequencies)
  const scheduleTime = MONITOR_SCHEDULE_TIME_DEFAULT;

  // ── 2. Derive selectorGroup ──────────────────────────────────────────────
  let selectorGroup: string | null = null;
  if (fields) {
    selectorGroup = deriveSelectorGroup(hostname, fields);
  }

  // ── 3. Establish initial baseline ────────────────────────────────────────
  let baselineContentHash: string;
  let baselineExtractedData: Record<string, unknown> | null = null;

  if (fields) {
    // Structured monitoring — use LLM extraction for first run
    const structuredResult = await executeScrapeStructured(
      { url, fields, remember: true, selector_group: selectorGroup },
      context
    ) as Record<string, unknown>;

    if (structuredResult.success === false) {
      return {
        success: false,
        error: `Failed to establish structured baseline: ${structuredResult.error}`,
      };
    }

    baselineContentHash = String(structuredResult.content_hash ?? '');
    const {
      success: _s,
      content_hash: _ch,
      url: _u,
      selector_confidence: _sc,
      adaptive_match_used: _am,
      selector_uncertain: _su,
      data_truncated: _dt,
      ...dataFields
    } = structuredResult;
    baselineExtractedData = dataFields as Record<string, unknown>;
  } else {
    // Hash-based monitoring
    const scrapeResult = await scrapingEngine.scrape({
      url,
      outputFormat: 'markdown',
      orgId: context.organisationId,
      subaccountId: context.subaccountId ?? undefined,
    });

    if (!scrapeResult.success) {
      return { success: false, error: `Failed to establish baseline — page could not be fetched: ${url}` };
    }

    baselineContentHash = scrapeResult.contentHash;
  }

  // ── 4. Create scheduled task ─────────────────────────────────────────────
  // The brief carries all config needed by subsequent runs.
  // A temporary ID placeholder — replaced after insert with actual ID.
  const briefPlaceholder = serializeMonitorBrief({
    type: 'monitor_webpage_run',
    monitorUrl: url,
    watchFor,
    fields,
    selectorGroup,
    scheduledTaskId: '__PLACEHOLDER__',
  });

  const title = `Monitor: ${hostname} — ${watchFor.slice(0, 50)}`;

  const scheduledTask = await scheduledTaskService.create(
    context.organisationId,
    context.subaccountId,
    {
      title,
      brief: briefPlaceholder, // updated below
      assignedAgentId: context.agentId, // Strategic Intelligence Agent
      rrule,
      timezone: 'UTC',
      scheduleTime,
    },
  );

  // ── 5. Update brief with actual scheduledTaskId ──────────────────────────
  const finalBrief = serializeMonitorBrief({
    type: 'monitor_webpage_run',
    monitorUrl: url,
    watchFor,
    fields,
    selectorGroup,
    scheduledTaskId: scheduledTask.id,
    baseline: {
      contentHash: baselineContentHash,
      extractedData: baselineExtractedData,
    },
  });

  await scheduledTaskService.update(scheduledTask.id, context.organisationId, { brief: finalBrief });

  return {
    success: true,
    scheduled_task_id: scheduledTask.id,
    title,
    rrule,
    frequency,
    url,
    watch_for: watchFor,
    fields: fields ?? null,
    baseline_content_hash: baselineContentHash,
    message: `Monitoring scheduled. The "${title}" task will run ${frequency} and alert you when ${watchFor} changes.`,
  };
}

// ---------------------------------------------------------------------------
// Analyze Endpoint — HTTP request with timing and expected-status validation
// ---------------------------------------------------------------------------

export async function executeAnalyzeEndpoint(
  input: Record<string, unknown>,
  _context: SkillExecutionContext
): Promise<unknown> {
  const url = String(input.url ?? '');
  if (!url) return { success: false, error: 'url is required' };

  const method = String(input.method ?? 'GET').toUpperCase();
  const expectedStatus = input.expected_status ? Number(input.expected_status) : undefined;
  const headers: Record<string, string> = {};
  if (input.headers && typeof input.headers === 'object') {
    for (const [k, v] of Object.entries(input.headers as Record<string, unknown>)) {
      headers[k] = String(v);
    }
  }

  const start = Date.now();

  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(30_000),
    };

    if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && input.body) {
      fetchOptions.body = String(input.body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);
    const durationMs = Date.now() - start;
    const bodyText = await response.text();
    const truncated = bodyText.length > 10000;
    const content = truncated ? bodyText.slice(0, 10000) : bodyText;

    const statusOk = expectedStatus !== undefined
      ? response.status === expectedStatus
      : response.ok;

    return {
      success: true,
      url,
      method,
      status_code: response.status,
      status_ok: statusOk,
      expected_status: expectedStatus,
      content,
      truncated,
      content_type: response.headers.get('content-type') ?? undefined,
      duration_ms: durationMs,
      headers: Object.fromEntries(response.headers.entries()),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Endpoint analysis failed: ${errMsg}`, duration_ms: Date.now() - start };
  }
}

// ---------------------------------------------------------------------------
// Capture Screenshot — launch headless browser, navigate, capture
// ---------------------------------------------------------------------------

export async function executeCaptureScreenshot(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  let devCtxResult;
  try {
    devCtxResult = await devContextService.getContext(context.subaccountId!);
  } catch (err) {
    const msg = (err as { message?: string }).message ?? String(err);
    return { success: false, error: `Cannot load dev execution context: ${msg}` };
  }

  const { context: devCtx } = devCtxResult;

  if (!devCtx.playwright) {
    return {
      success: false,
      error: 'Playwright is not configured for this subaccount. Add a "playwright" section to devContext settings with at minimum a baseUrl.',
    };
  }

  const url = String(input.url ?? '');
  if (!url) return { success: false, error: 'url is required' };

  const reasoning = String(input.reasoning ?? '');
  if (!reasoning) return { success: false, error: 'reasoning is required' };

  const selector = input.selector ? String(input.selector) : null;
  const viewport = input.viewport as { width?: number; height?: number } | undefined;

  // Resolve screenshot output directory (must be inside projectRoot)
  const screenshotDirRelative = devCtx.playwright.screenshotDir;
  const screenshotDir = resolve(devCtx.projectRoot, screenshotDirRelative);
  assertPathInRoot(screenshotDir, devCtx.projectRoot);

  const timestamp = Date.now();
  const filename = `screenshot_${timestamp}.png`;
  const screenshotPath = join(screenshotDir, filename);

  try {
    const { mkdir } = await import('fs/promises');
    await mkdir(screenshotDir, { recursive: true });

    const playwright = await import('playwright');
    const browserType = playwright[devCtx.playwright.browser] ?? playwright.chromium;

    const browser = await browserType.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: {
          width: viewport?.width ?? 1280,
          height: viewport?.height ?? 720,
        },
      });

      page.setDefaultTimeout(devCtx.playwright.timeoutMs);

      await page.goto(url, { waitUntil: 'networkidle', timeout: devCtx.playwright.timeoutMs });

      let screenshotOptions: { path: string; fullPage?: boolean } = { path: screenshotPath };

      if (selector) {
        const element = await page.locator(selector).first();
        const box = await element.boundingBox();
        if (!box) return { success: false, error: `Selector "${selector}" found no visible element` };
        await element.screenshot({ path: screenshotPath });
      } else {
        screenshotOptions = { path: screenshotPath, fullPage: !viewport };
        await page.screenshot(screenshotOptions);
      }

      // Read back as base64 for inline delivery
      const { readFile } = await import('fs/promises');
      const imageBuffer = await readFile(screenshotPath);
      const base64 = imageBuffer.toString('base64');

      return {
        success: true,
        url,
        selector: selector ?? null,
        screenshot_path: screenshotPath.replace(devCtx.projectRoot, '').replace(/\\/g, '/'),
        screenshot_base64: `data:image/png;base64,${base64}`,
        size_bytes: imageBuffer.length,
        reasoning,
      };
    } finally {
      await browser.close();
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // Diagnose common failure: browsers not installed
    if (errMsg.includes('Executable doesn\'t exist') || errMsg.includes('browserType.launch')) {
      return {
        success: false,
        error: `Playwright browser binaries not installed. Run: npx playwright install ${devCtx.playwright.browser}. Original error: ${errMsg}`,
      };
    }
    return { success: false, error: `Screenshot failed: ${errMsg}` };
  }
}

// ---------------------------------------------------------------------------
// Run Playwright Test — execute a specific Playwright test file via CLI
// ---------------------------------------------------------------------------

export async function executeRunPlaywrightTest(
  input: Record<string, unknown>,
  context: SkillExecutionContext
): Promise<unknown> {
  let devCtxResult;
  try {
    devCtxResult = await devContextService.getContext(context.subaccountId!);
  } catch (err) {
    const msg = (err as { message?: string }).message ?? String(err);
    return { success: false, error: `Cannot load dev execution context: ${msg}` };
  }

  const { context: devCtx } = devCtxResult;

  if (!devCtx.playwright) {
    return {
      success: false,
      error: 'Playwright is not configured for this subaccount. Add a "playwright" section to devContext settings with at minimum a baseUrl.',
    };
  }

  // Enforce the same maxTestRunsPerTask limit as run_tests
  if (context.taskId) {
    const taskRunRows = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(eq(agentRuns.taskId, context.taskId));
    const taskRunIds = taskRunRows.map(r => r.id);
    const runCount = taskRunIds.length
      ? await db
          .select({ total: count() })
          .from(actions)
          .where(and(inArray(actions.agentRunId, taskRunIds), eq(actions.actionType, 'run_playwright_test')))
          .then(rows => Number(rows[0]?.total ?? 0))
      : 0;
    if (runCount >= devCtx.costLimits.maxTestRunsPerTask) {
      return {
        success: false,
        error: `Playwright test run limit reached (${runCount}/${devCtx.costLimits.maxTestRunsPerTask} per task).`,
        errorCode: 'permission_failure',
      };
    }
  }

  const testFile = String(input.test_file ?? '');
  if (!testFile) return { success: false, error: 'test_file is required' };

  const baseUrl = String(input.base_url ?? devCtx.playwright.baseUrl);
  const testName = input.test_name ? String(input.test_name) : null;

  // Validate test file is inside projectRoot
  const absoluteTestPath = resolve(devCtx.projectRoot, testFile);
  assertPathInRoot(absoluteTestPath, devCtx.projectRoot);

  // Build the Playwright CLI command
  const args = ['playwright', 'test', testFile, '--reporter=line'];
  if (testName) args.push('--grep', testName);
  // Pass baseUrl via env so playwright.config.ts can pick it up
  const playwrightEnv = { ...process.env, ...devCtx.env, PLAYWRIGHT_BASE_URL: baseUrl, BASE_URL: baseUrl };

  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync('npx', args, {
      cwd: devCtx.projectRoot,
      timeout: devCtx.playwright.timeoutMs * 3, // E2E tests take longer
      maxBuffer: devCtx.resourceLimits.maxOutputBytes,
      env: playwrightEnv,
    }).catch((err: { stdout?: string; stderr?: string; code?: number }) => {
      return { stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    });

    const durationMs = Date.now() - start;
    const output = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')).slice(0, devCtx.resourceLimits.maxOutputBytes);
    const truncated = (stdout + stderr).length > devCtx.resourceLimits.maxOutputBytes;

    const passed = /(\d+) passed/.exec(output)?.[1] ?? null;
    const failed = /(\d+) failed/.exec(output)?.[1] ?? null;
    const skipped = /(\d+) skipped/.exec(output)?.[1] ?? null;

    return {
      success: true,
      test_file: testFile,
      test_name: testName,
      base_url: baseUrl,
      output,
      truncated,
      duration_ms: durationMs,
      passed: passed ? Number(passed) : null,
      failed: failed ? Number(failed) : null,
      skipped: skipped ? Number(skipped) : null,
      all_passed: failed === null && passed !== null,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('Executable doesn\'t exist') || errMsg.includes('browserType.launch')) {
      return {
        success: false,
        error: `Playwright browser binaries not installed. Run: npx playwright install ${devCtx.playwright.browser}. Original error: ${errMsg}`,
      };
    }
    return { success: false, error: `Playwright test execution failed: ${errMsg}` };
  }
}
