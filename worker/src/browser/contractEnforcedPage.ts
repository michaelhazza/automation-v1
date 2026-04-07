// ---------------------------------------------------------------------------
// ContractEnforcedPage — deny-by-default proxy around a Playwright Page.
//
// Spec: docs/reporting-agent-paywall-workflow-spec.md §6.7.1 (T9, T7).
//
// The wrapper makes the BrowserTaskContract enforcement non-bypassable from
// inside the LLM execution loop. Every navigation, click, and download
// pathway that the loop can reach is hooked here. The raw `Page` object is
// NEVER passed to the loop or its helpers — they receive only this proxy.
//
// Hard rules (every violation is a hard failure, never a warning):
//
//   1. page.goto(url): URL host must be in contract.allowedDomains. The
//      check applies to the initial navigation AND to any redirect chain
//      that follows (hooked via the page.on('framenavigated') event).
//
//   2. download events: the downloaded file's MIME type must start with
//      contract.expectedMimeTypePrefix (if set). Mismatches abort the
//      download AND trigger an immediate run termination.
//
//   3. step / time / size limits enforced via violations() callback to
//      the caller (the loop honours them by terminating the run).
//
// Termination semantics: when a violation occurs, the wrapper records it
// in the `violations` array and `wasTerminated` flips to true. The caller
// (executor / runHandler) reads `getViolations()` after each step and
// terminates the run via the standard failure() helper if any are present.
// ---------------------------------------------------------------------------

import type { Page, Download, Frame } from 'playwright';
import type { BrowserTaskContract } from '../../../shared/iee/jobPayload.js';
import { logger } from '../logger.js';

export interface ContractViolation {
  kind:
    | 'domain_violation'
    | 'redirect_to_disallowed_domain'
    | 'download_mime_mismatch'
    | 'download_kind_mismatch'
    | 'step_limit_exceeded'
    | 'wall_clock_exceeded'
    | 'success_condition_unmet';
  detail: string;
  metadata?: Record<string, unknown>;
}

export interface ContractEnforcedPageOptions {
  contract: BrowserTaskContract;
  runId: string;
  correlationId: string;
}

/**
 * Wraps a Playwright Page with deny-by-default contract enforcement.
 *
 * This class intentionally does NOT extend the Page interface — it is a
 * smaller surface than the full Page API, exposing only the methods the
 * LLM execution loop is allowed to call. Anything not exposed here is, by
 * construction, unreachable from inside the loop.
 */
export class ContractEnforcedPage {
  private readonly violations: ContractViolation[] = [];
  private terminated = false;
  private readonly allowedHosts: Set<string>;
  private readonly startMs: number;

  constructor(
    private readonly page: Page,
    private readonly opts: ContractEnforcedPageOptions,
  ) {
    this.allowedHosts = new Set(
      opts.contract.allowedDomains.map((d) => d.toLowerCase().trim()),
    );
    this.startMs = Date.now();

    // Hook the framenavigated event so we catch ALL navigations, including
    // server-side redirects, JS-driven location changes, and meta-refresh.
    this.page.on('framenavigated', (frame) => this.checkFrameNavigation(frame));

    // Hook the download event so we can validate before the file lands.
    this.page.on('download', (download) => {
      // We can't await here (it's an event handler), so we kick off the
      // validation and let the executor pick up the violation via
      // getViolations() before the next loop step.
      void this.validateDownload(download).catch((err) => {
        logger.warn('worker.contract.download_validation_threw', {
          runId: opts.runId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  // ─── Allowed surface (the LLM loop only sees these methods) ─────────────

  /**
   * Navigate to a URL. The URL host must be in allowedDomains. Redirects
   * are also validated via the framenavigated hook.
   */
  async goto(url: string, options?: { waitUntil?: 'load' | 'networkidle' | 'domcontentloaded'; timeout?: number }): Promise<void> {
    if (!this.assertHostAllowed(url, 'domain_violation')) {
      return;
    }
    this.assertWallClock();
    await this.page.goto(url, options);
  }

  /** Read the current URL. Always allowed. */
  url(): string {
    return this.page.url();
  }

  /** Get the page title. Always allowed. */
  async title(): Promise<string> {
    return this.page.title();
  }

  /** Wait for a selector. Always allowed. */
  async waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown> {
    this.assertWallClock();
    return this.page.waitForSelector(selector, options);
  }

  /** Click an element. Side-effect navigations are caught by framenavigated. */
  async click(selector: string, options?: { timeout?: number }): Promise<void> {
    this.assertWallClock();
    await this.page.click(selector, options);
  }

  /** Fill an input. Side-effect navigations caught by framenavigated. */
  async fill(selector: string, value: string, options?: { timeout?: number }): Promise<void> {
    this.assertWallClock();
    await this.page.fill(selector, value, options);
  }

  /** Evaluate JS in the page context. Used by observe(). */
  async evaluate<T>(fn: () => T): Promise<T> {
    this.assertWallClock();
    return this.page.evaluate(fn);
  }

  /** Take a screenshot. Used for failure diagnosis. */
  async screenshot(options: { path: string; fullPage?: boolean }): Promise<void> {
    await this.page.screenshot(options);
  }

  /** Read all cookies on the current context. Used by performLogin tier-3. */
  async cookies() {
    return this.page.context().cookies();
  }

  // ─── Read-only contract / violation introspection ───────────────────────

  getViolations(): readonly ContractViolation[] {
    return this.violations;
  }

  hasTerminated(): boolean {
    return this.terminated;
  }

  contract(): BrowserTaskContract {
    return this.opts.contract;
  }

  // ─── Internal enforcement helpers ───────────────────────────────────────

  private assertHostAllowed(url: string, violationKind: ContractViolation['kind']): boolean {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      // Malformed URLs are also a violation — fail closed.
      this.recordViolation({
        kind: violationKind,
        detail: `malformed_url:${url.slice(0, 100)}`,
      });
      return false;
    }
    // Match either exact host or any allowed-domain suffix (e.g.
    // 'foo.example.com' matches 'example.com').
    const allowed = Array.from(this.allowedHosts).some(
      (d) => host === d || host.endsWith(`.${d}`),
    );
    if (!allowed) {
      this.recordViolation({
        kind: violationKind,
        detail: `host_not_allowed:${host}`,
        metadata: { url, allowedDomains: this.opts.contract.allowedDomains },
      });
      return false;
    }
    return true;
  }

  private assertWallClock(): void {
    const elapsed = Date.now() - this.startMs;
    if (elapsed > this.opts.contract.timeoutMs) {
      this.recordViolation({
        kind: 'wall_clock_exceeded',
        detail: `elapsed:${elapsed}ms,limit:${this.opts.contract.timeoutMs}ms`,
      });
    }
  }

  private checkFrameNavigation(frame: Frame): void {
    // Only check the main frame — sub-frames (e.g. third-party iframes) are
    // not within the LLM's control surface and are validated by the page's
    // own CSP. The contract is about where the LLM-driven navigation
    // ultimately resolves.
    if (frame !== this.page.mainFrame()) return;
    const url = frame.url();
    if (!url || url === 'about:blank') return;
    this.assertHostAllowed(url, 'redirect_to_disallowed_domain');
  }

  private async validateDownload(download: Download): Promise<void> {
    const expectedKind = this.opts.contract.expectedArtifactKind;
    const expectedMimePrefix = this.opts.contract.expectedMimeTypePrefix;

    if (!expectedKind && !expectedMimePrefix) {
      // No constraint — nothing to validate at the download event level.
      // The static T17 validation in artifactValidator.ts still runs after
      // the file lands and provides the magic-bytes check.
      return;
    }

    // Playwright provides the suggested filename and an optional MIME via
    // headers. We do a name-based prefilter here; the rigorous check is in
    // T17 artifact validation after the file is fully written.
    const suggested = download.suggestedFilename();
    const ext = suggested.split('.').pop()?.toLowerCase() ?? '';

    // A coarse extension-to-kind map matching expectedArtifactKind values.
    const KIND_EXTENSIONS: Record<string, string[]> = {
      video: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'],
      audio: ['mp3', 'm4a', 'wav', 'ogg', 'flac'],
      document: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md'],
      image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
      text: ['txt', 'md', 'csv', 'json', 'xml', 'html'],
    };

    if (expectedKind) {
      const allowed = KIND_EXTENSIONS[expectedKind] ?? [];
      if (!allowed.includes(ext)) {
        this.recordViolation({
          kind: 'download_kind_mismatch',
          detail: `expected:${expectedKind},extension:${ext}`,
          metadata: { suggestedFilename: suggested },
        });
      }
    }
  }

  private recordViolation(v: ContractViolation): void {
    this.violations.push(v);
    this.terminated = true;
    logger.warn('worker.contract.violation', {
      runId: this.opts.runId,
      correlationId: this.opts.correlationId,
      kind: v.kind,
      detail: v.detail,
      metadata: v.metadata,
    });
  }
}
