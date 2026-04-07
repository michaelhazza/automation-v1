// ---------------------------------------------------------------------------
// Streaming video capture — equivalent of the "Video Downloader" Chrome
// extension, implemented inside Playwright + ffmpeg.
//
// Used when a paywalled site does NOT expose a download button: the page
// loads the video into an HTML5 player from either:
//
//   1. A direct .mp4 URL (Range-served by the CDN), OR
//   2. An HLS playlist (.m3u8) referencing many .ts segments (Cloudflare
//      Stream, Mux, Vimeo Pro, JW Player, etc.)
//
// We do NOT scrape the page DOM. Instead we attach a network listener
// BEFORE navigation, navigate, optionally trigger play, and wait for the
// browser itself to request the media. The first matching request URL is
// our prize; we then refetch it with the same cookies the browser holds.
//
//   - mp4 →  Playwright APIRequestContext (inherits the BrowserContext's
//            cookies + Referer) → stream to disk
//   - m3u8 → spawn ffmpeg with the captured Cookie / Referer headers →
//            download + remux into a single mp4
//
// The result is a single mp4 file on disk. The caller validates magic
// bytes + size via the existing artifactValidator.
// ---------------------------------------------------------------------------

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import type { BrowserContext, Page } from 'playwright';
import { logger } from '../logger.js';
import { failure, FailureError } from '../../../shared/iee/failure.js';

export interface CaptureStreamingVideoOptions {
  /** Page URL to navigate to (the video page). */
  contentUrl: string;
  /** Where to write the resulting mp4. */
  outputPath: string;
  /** Optional CSS selector for a play button. If null, we try a default list
   *  of common video-element selectors. */
  playSelector?: string | null;
  /** How long to wait for a media URL to appear after triggering play. */
  captureTimeoutMs?: number;
  /** Run id / correlation id for structured logs. */
  runId: string;
  correlationId: string;
}

export interface CaptureStreamingVideoResult {
  outputPath: string;
  /** Which capture path we took — useful for telemetry. */
  source: 'mp4' | 'hls';
  /** The URL we captured (for forensic logging — never the bytes). */
  capturedUrl: string;
  durationMs: number;
}

const DEFAULT_CAPTURE_TIMEOUT_MS = 60_000;
// Coarse pattern: anything that looks like a video URL the player might load.
// We deliberately match BOTH manifest formats (m3u8) and direct mp4 so we
// support both adaptive-bitrate and progressive download players.
const VIDEO_URL_PATTERN =
  /\.(m3u8|mp4)(\?|$)|\/manifest(\?|$)|video\/mp4|application\/vnd\.apple\.mpegurl/i;
// Common play-button selectors used by HTML5 players. Tried in order until
// one is clickable. The page is allowed to expose a custom selector via
// playSelector; we fall through to these only if it is unset.
const DEFAULT_PLAY_SELECTORS = [
  'video',                                  // direct video element — clicking it toggles play
  'button[aria-label*="Play" i]',
  'button[title*="Play" i]',
  '[role="button"][aria-label*="Play" i]',
  '.vjs-big-play-button',                   // Video.js
  '.plyr__control--overlaid',               // Plyr
  '.jw-display-icon-container',             // JW Player
];

/**
 * Capture the streaming video that the page loads into its HTML5 player.
 *
 * Hard rules:
 *  - The function never reads the file via the page DOM. Only network
 *    response URLs are inspected.
 *  - The function never logs cookies or the captured response body. The
 *    URL is logged (truncated) so an operator can debug DNS / CDN issues.
 *  - On any failure, throws a structured FailureError so the caller routes
 *    via the unified failure taxonomy.
 */
export async function captureStreamingVideo(
  context: BrowserContext,
  page: Page,
  opts: CaptureStreamingVideoOptions,
): Promise<CaptureStreamingVideoResult> {
  const start = Date.now();
  const captureTimeoutMs = opts.captureTimeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;

  logger.info('worker.capture_video.start', {
    runId: opts.runId,
    correlationId: opts.correlationId,
    contentUrl: opts.contentUrl,
  });

  // ── 1. Attach the network listener BEFORE navigating ───────────────────
  // We resolve a single Promise as soon as the first matching URL is seen.
  // We deliberately prefer m3u8 over mp4 if both appear in the same window
  // (HLS players sometimes pre-warm a thumbnail mp4 — the m3u8 is the real
  // payload).
  const captureState: { url: string | null; kind: 'mp4' | 'hls' | null } = {
    url: null,
    kind: null,
  };
  let resolveCapture: (() => void) | null = null;
  const capturePromise = new Promise<void>((resolve) => {
    resolveCapture = resolve;
  });
  const onResponse = (response: import('playwright').Response): void => {
    if (captureState.url && captureState.kind === 'hls') return;
    const url = response.url();
    if (!VIDEO_URL_PATTERN.test(url)) return;
    const isHls = /\.m3u8/i.test(url);
    if (isHls) {
      captureState.url = url;
      captureState.kind = 'hls';
      resolveCapture?.();
      return;
    }
    // mp4 — only accept 200/206 to avoid 416 probe responses.
    if (response.status() === 200 || response.status() === 206) {
      if (!captureState.url) {
        captureState.url = url;
        captureState.kind = 'mp4';
        resolveCapture?.();
      }
    }
  };
  page.on('response', onResponse);

  try {
    // ── 2. Navigate to the video page ────────────────────────────────────
    await page.goto(opts.contentUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // ── 3. Trigger play ─────────────────────────────────────────────────
    // Some players autoplay; some require a click. We attempt the click but
    // don't fail if no play button is present (autoplay path).
    const playSelectors = opts.playSelector
      ? [opts.playSelector]
      : DEFAULT_PLAY_SELECTORS;
    for (const sel of playSelectors) {
      try {
        const handle = await page.waitForSelector(sel, { timeout: 2_000 });
        if (handle) {
          await handle.click({ timeout: 2_000 }).catch(() => undefined);
          break;
        }
      } catch {
        // Try next selector
      }
    }

    // Some HTML5 players also need an explicit play() call when the user
    // gesture isn't a "real" mouse event — fire it via the DOM as a backup.
    await page
      .evaluate(() => {
        const v = document.querySelector('video');
        if (v && typeof v.play === 'function') {
          void v.play().catch(() => undefined);
        }
      })
      .catch(() => undefined);

    // ── 4. Wait for the network listener to fire ─────────────────────────
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('capture_timeout')), captureTimeoutMs),
    );
    try {
      await Promise.race([capturePromise, timeoutPromise]);
    } catch {
      throw new FailureError(
        failure('data_incomplete', 'video_url_not_captured', {
          contentUrl: opts.contentUrl,
          waitedMs: captureTimeoutMs,
        }),
      );
    }

    const finalUrl = captureState.url;
    const finalKind = captureState.kind;
    if (!finalUrl || !finalKind) {
      throw new FailureError(
        failure('data_incomplete', 'video_url_not_captured_post_race', {
          contentUrl: opts.contentUrl,
        }),
      );
    }

    logger.info('worker.capture_video.url_captured', {
      runId: opts.runId,
      kind: finalKind,
      // Truncate so we never log session-bearing query strings in full.
      capturedUrl: finalUrl.slice(0, 200),
    });

    // ── 5. Pull the bytes ───────────────────────────────────────────────
    await fs.mkdir(path.dirname(opts.outputPath), { recursive: true });
    if (finalKind === 'mp4') {
      await downloadDirectMp4(context, finalUrl, opts.outputPath, opts);
    } else {
      await downloadHlsViaFfmpeg(context, finalUrl, opts.outputPath, opts);
    }

    return {
      outputPath: opts.outputPath,
      source: finalKind,
      capturedUrl: finalUrl,
      durationMs: Date.now() - start,
    };
  } finally {
    page.off('response', onResponse);
  }
}

// ─── Direct mp4 path ──────────────────────────────────────────────────────

async function downloadDirectMp4(
  context: BrowserContext,
  url: string,
  outputPath: string,
  opts: CaptureStreamingVideoOptions,
): Promise<void> {
  // Playwright's APIRequestContext inherits the BrowserContext's cookies
  // and follows redirects. We use it instead of node-fetch so we don't have
  // to manually replay the auth state.
  const apiCtx = context.request;
  const res = await apiCtx.get(url, { timeout: 300_000 });
  if (!res.ok()) {
    throw new FailureError(
      failure('connector_timeout', `mp4_fetch_${res.status()}`, {
        url: url.slice(0, 200),
      }),
    );
  }
  const body = await res.body();
  await fs.writeFile(outputPath, body);
  logger.info('worker.capture_video.mp4_written', {
    runId: opts.runId,
    sizeBytes: body.length,
    outputPath,
  });
}

// ─── HLS path via ffmpeg ──────────────────────────────────────────────────

async function downloadHlsViaFfmpeg(
  context: BrowserContext,
  m3u8Url: string,
  outputPath: string,
  opts: CaptureStreamingVideoOptions,
): Promise<void> {
  // Build a Cookie header from the BrowserContext so ffmpeg has the same
  // session as the page. Same-origin cookies only — we don't want to leak
  // unrelated cookies to the CDN.
  const targetUrl = new URL(m3u8Url);
  const cookies = await context.cookies(m3u8Url);
  const cookieHeader = cookies
    .filter((c) => c.domain && targetUrl.hostname.endsWith(c.domain.replace(/^\./, '')))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  const headers = [
    cookieHeader ? `Cookie: ${cookieHeader}` : '',
    `Referer: ${opts.contentUrl}`,
    'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ]
    .filter(Boolean)
    .join('\r\n');

  // ffmpeg flags:
  //   -y                           overwrite output without asking
  //   -headers                     pass cookie + referer + UA on every request
  //   -loglevel error              quiet
  //   -i <m3u8>                    input
  //   -c copy                      stream copy — no re-encode (fast, lossless)
  //   -bsf:a aac_adtstoasc         common HLS-to-mp4 audio bitstream filter
  //   -movflags +faststart         web-friendly mp4
  const args = [
    '-y',
    '-headers', headers + '\r\n',
    '-loglevel', 'error',
    '-i', m3u8Url,
    '-c', 'copy',
    '-bsf:a', 'aac_adtstoasc',
    '-movflags', '+faststart',
    outputPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4_096) stderr = stderr.slice(-4_096);
    });
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(
        new FailureError(
          failure('connector_timeout', 'ffmpeg_wall_clock', {
            limitMs: 600_000,
          }),
        ),
      );
    }, 600_000);
    timeout.unref();
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(
        new FailureError(
          failure('environment_error', 'ffmpeg_spawn_failed', {
            message: err.message.slice(0, 200),
            hint: 'Is ffmpeg installed in the worker image? See worker/Dockerfile.',
          }),
        ),
      );
    });
    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(
          new FailureError(
            failure('execution_error', `ffmpeg_exit_${code ?? 'null'}`, {
              stderrTail: stderr.slice(-500),
            }),
          ),
        );
      }
    });
  });

  const stat = await fs.stat(outputPath);
  logger.info('worker.capture_video.hls_written', {
    runId: opts.runId,
    sizeBytes: stat.size,
    outputPath,
  });
}
