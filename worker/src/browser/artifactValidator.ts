// ---------------------------------------------------------------------------
// Artifact validation + content hashing for downloaded files.
//
// Spec: docs/reporting-agent-paywall-workflow-spec.md §6.7.2 (T17 — validate
// before hash), §6.7.2 (T24 — download stall guard).
//
// Two responsibilities:
//
//   1. validateDownloadedArtifact(): static check after a download has
//      finished writing. Verifies minimum file size, then re-checks the
//      MIME type from the file's magic bytes (not from the response
//      Content-Type header) to catch sites that serve an HTML error page
//      under a video URL. Only returns the contentHash if validation
//      passes.
//
//   2. createDownloadStallGuard(): wraps an in-flight download and aborts
//      if the byte rate falls below the throughput floor or no progress is
//      made for the stall window. Returns a Promise<void> that rejects
//      with `download_stalled` / `download_too_slow` / `download_wall_clock`
//      so the caller can route via failure().
//
// Default thresholds (mirrored from spec):
//   - minBytes by kind: video 50 KB, audio 10 KB, document 1 KB,
//     image 1 KB, text 16 B
//   - download_stalled: > 10 s with no progress
//   - download_too_slow: < 10 KB/s rolling 10s after the first 5 s
//   - download_wall_clock: min(contract.timeoutMs, 600_000)
// ---------------------------------------------------------------------------

import { createHash } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import type { Readable } from 'stream';

export type ArtifactKind = 'video' | 'audio' | 'document' | 'image' | 'text';

export const MIN_BYTES_BY_KIND: Record<ArtifactKind, number> = {
  video: 51_200,    // 50 KB
  audio: 10_240,    // 10 KB
  document: 1_024,  // 1 KB
  image: 1_024,     // 1 KB
  text: 16,
};

// Magic-byte signatures for the most common formats. Detection is
// deliberately coarse — the spec only requires a prefix match against the
// expectedMimeTypePrefix (e.g. "video/", "audio/"). The map below converts
// magic bytes → coarse mime category.
const MAGIC_SIGNATURES: Array<{ bytes: number[]; mimeStartsWith: string }> = [
  // Video
  { bytes: [0x66, 0x74, 0x79, 0x70], mimeStartsWith: 'video/mp4' }, // ISO BMFF (ftyp), at offset 4
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], mimeStartsWith: 'video/webm' }, // EBML (webm/mkv)
  // Audio
  { bytes: [0x49, 0x44, 0x33], mimeStartsWith: 'audio/mpeg' }, // ID3 (mp3)
  { bytes: [0xff, 0xfb], mimeStartsWith: 'audio/mpeg' }, // mp3 frame
  { bytes: [0x52, 0x49, 0x46, 0x46], mimeStartsWith: 'audio/wav' }, // RIFF (wav)
  { bytes: [0x4f, 0x67, 0x67, 0x53], mimeStartsWith: 'audio/ogg' }, // OggS
  // Document
  { bytes: [0x25, 0x50, 0x44, 0x46], mimeStartsWith: 'application/pdf' }, // %PDF
  { bytes: [0x50, 0x4b, 0x03, 0x04], mimeStartsWith: 'application/zip' }, // ZIP (docx, xlsx)
  // Image
  { bytes: [0x89, 0x50, 0x4e, 0x47], mimeStartsWith: 'image/png' }, // PNG
  { bytes: [0xff, 0xd8, 0xff], mimeStartsWith: 'image/jpeg' }, // JPEG
  { bytes: [0x47, 0x49, 0x46, 0x38], mimeStartsWith: 'image/gif' }, // GIF8
  // HTML — used to detect "site returned an error page as a video" failure
  { bytes: [0x3c, 0x21, 0x44, 0x4f, 0x43], mimeStartsWith: 'text/html' }, // <!DOC
  { bytes: [0x3c, 0x68, 0x74, 0x6d, 0x6c], mimeStartsWith: 'text/html' }, // <html
  { bytes: [0x3c, 0x68, 0x74, 0x6d, 0x6c], mimeStartsWith: 'text/html' },
];

export interface ValidationOk {
  ok: true;
  contentHash: string;
  detectedMime: string | null;
  sizeBytes: number;
}

export interface ValidationFail {
  ok: false;
  reason:
    | 'file_too_small'
    | 'mime_mismatch'
    | 'magic_bytes_unrecognised'
    | 'file_unreadable';
  detail: string;
  metadata?: Record<string, unknown>;
}

export type ValidationResult = ValidationOk | ValidationFail;

export interface ValidationOptions {
  expectedKind?: ArtifactKind;
  /** e.g. "video/", "audio/", "application/pdf". Prefix match. */
  expectedMimeTypePrefix?: string;
  /** Override the kind-default minimum bytes if needed. */
  minBytesOverride?: number;
}

/**
 * Validate a downloaded file BEFORE computing its content hash for the
 * fingerprint. Per T17, hashing is only meaningful if the file passes a
 * minimum size check AND a magic-bytes check that confirms it is what we
 * expected.
 *
 * Returns the contentHash on success. On failure, returns a structured
 * reason — the caller throws via failure('data_incomplete', ...).
 */
export async function validateDownloadedArtifact(
  filePath: string,
  opts: ValidationOptions,
): Promise<ValidationResult> {
  // 1. Stat the file
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    return {
      ok: false,
      reason: 'file_unreadable',
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    };
  }

  // 2. Minimum size check
  const minBytes =
    opts.minBytesOverride ??
    (opts.expectedKind ? MIN_BYTES_BY_KIND[opts.expectedKind] : 0);
  if (stat.size < minBytes) {
    return {
      ok: false,
      reason: 'file_too_small',
      detail: `size:${stat.size},minimum:${minBytes}`,
      metadata: { sizeBytes: stat.size, minBytes },
    };
  }

  // 3. Magic-bytes detection (read first 16 bytes)
  let header: Buffer;
  try {
    const fd = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(16);
      const { bytesRead } = await fd.read(buf, 0, 16, 0);
      header = buf.subarray(0, bytesRead);
    } finally {
      await fd.close();
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'file_unreadable',
      detail: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    };
  }

  let detectedMime: string | null = null;
  for (const sig of MAGIC_SIGNATURES) {
    // Most signatures match at offset 0; the ftyp signature for ISO BMFF is
    // at offset 4. We try both for simplicity.
    if (matchesAt(header, sig.bytes, 0) || matchesAt(header, sig.bytes, 4)) {
      detectedMime = sig.mimeStartsWith;
      break;
    }
  }

  // 4. MIME prefix check
  if (opts.expectedMimeTypePrefix) {
    if (!detectedMime || !detectedMime.startsWith(opts.expectedMimeTypePrefix)) {
      return {
        ok: false,
        reason: 'mime_mismatch',
        detail: `expected:${opts.expectedMimeTypePrefix},detected:${detectedMime ?? 'unknown'}`,
        metadata: { detectedMime, sizeBytes: stat.size },
      };
    }
  }

  // 5. Stream-hash the file bytes for the fingerprint
  const contentHash = await sha256Stream(filePath);

  return {
    ok: true,
    contentHash,
    detectedMime,
    sizeBytes: stat.size,
  };
}

function matchesAt(buf: Buffer, sig: number[], offset: number): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
}

async function sha256Stream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream: Readable = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ─── Download stall guard (T24) ───────────────────────────────────────────────

export class DownloadStallError extends Error {
  readonly _tag = 'DownloadStallError' as const;
  constructor(
    message: string,
    public readonly reason: 'download_stalled' | 'download_too_slow' | 'download_wall_clock',
    public readonly bytesReceived: number,
  ) {
    super(message);
  }
}

export interface DownloadStallGuardOptions {
  /** Maximum total download time in ms. */
  wallClockMs: number;
  /** Abort if no progress for this long (default 10 s). */
  stallMs?: number;
  /** Throughput floor in bytes/sec after warmup (default 10 KB/s). */
  minBytesPerSec?: number;
  /** Warmup window before throughput floor kicks in (default 5 s). */
  warmupMs?: number;
  /** Called periodically with the running byte total (for telemetry). */
  onProgress?: (bytesReceived: number, elapsedMs: number) => void;
}

/**
 * Build a stall guard that monitors a download in progress. The guard
 * exposes:
 *  - record(byteCount): call from the download stream's data handler
 *  - finish(): call after the download completes successfully (clears timers)
 *  - abortPromise: a Promise that rejects with DownloadStallError if
 *    the guard trips. The caller races this against the download promise.
 *
 * Usage:
 *   const guard = createDownloadStallGuard({ wallClockMs: 240_000 });
 *   page.on('download', async (download) => {
 *     const stream = await download.createReadStream();
 *     stream.on('data', (chunk) => guard.record(chunk.length));
 *     await Promise.race([download.saveAs(targetPath), guard.abortPromise]);
 *     guard.finish();
 *   });
 */
export function createDownloadStallGuard(opts: DownloadStallGuardOptions) {
  const stallMs = opts.stallMs ?? 10_000;
  const minBps = opts.minBytesPerSec ?? 10 * 1024;
  const warmupMs = opts.warmupMs ?? 5_000;

  const startMs = Date.now();
  let bytesReceived = 0;
  let lastProgressMs = startMs;
  let finished = false;
  let rejectFn: ((err: Error) => void) | null = null;
  // Sliding window for the throughput check.
  const windowMs = 10_000;
  const windowStarts: Array<{ at: number; bytes: number }> = [{ at: startMs, bytes: 0 }];

  const abortPromise = new Promise<never>((_, reject) => {
    rejectFn = reject;
  });

  // The interval is intentionally coarse (1 s). We only need to detect
  // stalls and slow rates within a few seconds, not millisecond precision.
  const interval = setInterval(() => {
    if (finished) return;
    const now = Date.now();
    const elapsed = now - startMs;

    // Wall clock check
    if (elapsed > opts.wallClockMs) {
      tripGuard('download_wall_clock', `elapsed:${elapsed}ms,limit:${opts.wallClockMs}ms`);
      return;
    }

    // Stall check
    if (now - lastProgressMs > stallMs) {
      tripGuard('download_stalled', `noProgressFor:${now - lastProgressMs}ms`);
      return;
    }

    // Throughput check (only after warmup)
    if (elapsed > warmupMs) {
      // Trim the window to the most recent windowMs
      while (windowStarts.length > 1 && now - windowStarts[0].at > windowMs) {
        windowStarts.shift();
      }
      const window = windowStarts[0];
      const windowDurationMs = now - window.at;
      if (windowDurationMs > 0) {
        const windowBytes = bytesReceived - window.bytes;
        const bps = (windowBytes * 1000) / windowDurationMs;
        if (bps < minBps && windowDurationMs >= windowMs) {
          tripGuard(
            'download_too_slow',
            `bps:${Math.round(bps)},minimum:${minBps}`,
          );
          return;
        }
      }
    }

    // Telemetry
    opts.onProgress?.(bytesReceived, elapsed);
  }, 1_000);
  // Don't keep the worker process alive on this timer.
  if (typeof interval.unref === 'function') interval.unref();

  function tripGuard(
    reason: DownloadStallError['reason'],
    detail: string,
  ): void {
    if (finished) return;
    finished = true;
    clearInterval(interval);
    if (rejectFn) {
      rejectFn(new DownloadStallError(`${reason}:${detail}`, reason, bytesReceived));
    }
  }

  return {
    record(byteCount: number): void {
      if (finished) return;
      bytesReceived += byteCount;
      lastProgressMs = Date.now();
      // Append to the sliding window if at least 1s has passed.
      const last = windowStarts[windowStarts.length - 1];
      if (Date.now() - last.at >= 1_000) {
        windowStarts.push({ at: Date.now(), bytes: bytesReceived });
      }
    },
    finish(): void {
      if (finished) return;
      finished = true;
      clearInterval(interval);
    },
    abortPromise,
    getBytesReceived(): number {
      return bytesReceived;
    },
  };
}
