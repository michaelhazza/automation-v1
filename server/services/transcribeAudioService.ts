/**
 * transcribeAudioService — backs the `transcribe_audio` system skill.
 *
 * Spec: docs/reporting-agent-paywall-workflow-spec.md §4 (Code Change B),
 * §4.4.1 (T22 — content-hash cache), §4.4 / T27 (transcript sanity floor).
 *
 * Responsibilities:
 *  1. Resolve the audio source (artifact path or HTTPS URL).
 *  2. Cache lookup keyed by contentHash so retries reuse prior results.
 *  3. Call OpenAI Whisper for the transcription.
 *  4. Persist the transcript as a new iee_artifacts row with inline_text
 *     populated (UTF-8-safe truncated via writeWithLimit).
 *  5. Apply the T27 sanity floor (reject < 50 words).
 *
 * The Whisper API call uses the unified withBackoff helper (T21) so retry
 * behaviour matches Slack and any future external integration.
 */

import { createHash } from 'crypto';
import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { ieeArtifacts } from '../db/schema/index.js';
import { withBackoff } from '../lib/withBackoff.js';
import { mergeReportingAgentRunMeta } from '../lib/reportingAgentRunHook.js';
import { writeWithLimit, INLINE_TEXT_LIMITS } from '../lib/inlineTextWriter.js';
import { failure, FailureError } from '../../shared/iee/failure.js';
import { logger } from '../lib/logger.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranscribeAudioInput {
  /** ID of an iee_artifacts row produced by a prior step. */
  executionArtifactId?: string;
  /** Direct URL to an audio/video file. */
  audioUrl?: string;
  /** Optional ISO-639-1 language code, e.g. 'en'. */
  language?: string;
}

export interface TranscribeAudioContext {
  runId: string;
  organisationId: string;
  subaccountId: string | null;
  agentId: string;
  /** The IEE run ID that owns the resulting transcript artifact. */
  ieeRunId?: string;
  correlationId: string;
}

export interface TranscribeAudioResult {
  transcript: string;
  transcriptArtifactId: string;
  wordCount: number;
  cached: boolean;
  contentHash: string;
}

const WORD_COUNT_FLOOR = 50; // T27
const WHISPER_MODEL = 'whisper-1';
const WHISPER_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

// ─── Public API ───────────────────────────────────────────────────────────────

export async function transcribeAudio(
  input: TranscribeAudioInput,
  ctx: TranscribeAudioContext,
): Promise<TranscribeAudioResult> {
  // T23 — assert run is within budget BEFORE Whisper call. Spec v3.4 §8.4.1.
  const { assertWithinRunBudget } = await import('../lib/runCostBreaker.js');
  await assertWithinRunBudget({
    runId: ctx.runId,
    organisationId: ctx.organisationId,
    correlationId: ctx.correlationId,
  });

  if (!input.executionArtifactId && !input.audioUrl) {
    throw new FailureError(
      failure('data_incomplete', 'transcribe_input_missing', {
        runId: ctx.runId,
        correlationId: ctx.correlationId,
      }),
    );
  }

  // 1. Resolve source to a local file path. For artifacts we read the path
  //    directly. For URLs we download to a temp file. The temp file is
  //    cleaned up at the end of the function in the finally block.
  let localPath: string;
  let cleanupTemp = false;
  if (input.executionArtifactId) {
    const sourceArtifact = await getArtifactById(input.executionArtifactId, ctx.organisationId);
    if (!sourceArtifact) {
      throw new FailureError(
        failure('data_incomplete', 'source_artifact_not_found', {
          executionArtifactId: input.executionArtifactId,
        }),
      );
    }
    localPath = sourceArtifact.path;
  } else {
    localPath = await downloadToTemp(input.audioUrl!);
    cleanupTemp = true;
  }

  try {
    // 2. Compute content hash (streaming sha256) for cache lookup.
    const contentHash = await sha256Stream(localPath);

    // 3. Cache lookup — same content within the same org → reuse.
    const cached = await findCachedTranscript(contentHash, ctx.organisationId);
    if (cached) {
      logger.info('transcribeAudio.cache_hit', {
        runId: ctx.runId,
        correlationId: ctx.correlationId,
        contentHash,
        cachedArtifactId: cached.id,
      });
      return {
        transcript: cached.inlineText ?? '',
        transcriptArtifactId: cached.id,
        wordCount: countWords(cached.inlineText ?? ''),
        cached: true,
        contentHash,
      };
    }

    // 4. Cache miss — call Whisper.
    const apiKey = getOpenAiKey();
    const transcript = await withBackoff(
      () => callWhisper(localPath, apiKey, input.language),
      {
        label: 'whisper.transcribe',
        runId: ctx.runId,
        correlationId: ctx.correlationId,
        maxAttempts: 3,
        baseDelayMs: 1_000,
        maxDelayMs: 8_000,
        isRetryable: (err: unknown) => {
          // Retry on 429 / 5xx / network errors. Bail on 4xx (other).
          if (err instanceof WhisperHttpError) {
            return err.status === 429 || err.status >= 500;
          }
          return true; // network/transient
        },
        retryAfterMs: (err: unknown) => {
          if (err instanceof WhisperHttpError && err.retryAfterSeconds) {
            return err.retryAfterSeconds * 1000;
          }
          return undefined;
        },
      },
    );

    // 5. Sanity floor (T27) — reject empty / too-short transcripts before
    //    persisting. Catches silent Whisper failures and corrupted audio.
    const wordCount = countWords(transcript);
    if (wordCount < WORD_COUNT_FLOOR) {
      throw new FailureError(
        failure('data_incomplete', 'transcript_too_short', {
          wordCount,
          floor: WORD_COUNT_FLOOR,
          runId: ctx.runId,
        }),
      );
    }

    // 6. Persist as a new artifact with inline_text via writeWithLimit so
    //    the transcript survives worker container cleanup (T12).
    const { stored, wasTruncated } = writeWithLimit(
      'transcript',
      transcript,
      INLINE_TEXT_LIMITS.ARTIFACT_INLINE_TEXT,
    );

    const tempPath = await writeTranscriptTempFile(transcript);
    const [created] = await db
      .insert(ieeArtifacts)
      .values({
        // ieeRunId is nullable since this skill may run outside an IEE
        // execution (e.g. from a regular skill-executor agent run). The
        // metadata.runId / metadata.correlationId fields below carry the
        // parent-run trace context for observability.
        ieeRunId: ctx.ieeRunId ?? null,
        organisationId: ctx.organisationId,
        kind: 'file',
        path: tempPath,
        sizeBytes: Buffer.byteLength(transcript, 'utf8'),
        mimeType: 'text/plain',
        inlineText: stored,
        inlineTextTruncated: wasTruncated,
        metadata: {
          source: 'transcribe_audio',
          sourceArtifactId: input.executionArtifactId ?? null,
          sourceUrl: input.audioUrl ?? null,
          contentHash,
          language: input.language ?? null,
          runId: ctx.runId,
          correlationId: ctx.correlationId,
        },
      })
      .returning();

    // T25 — mark Reporting Agent run state so the end-of-run invariant can
    // confirm a transcript landed. Spec v3.4 §8.4.2.
    await mergeReportingAgentRunMeta(ctx.runId, {
      transcriptArtifactId: created.id,
    });

    return {
      transcript,
      transcriptArtifactId: created.id,
      wordCount,
      cached: false,
      contentHash,
    };
  } finally {
    if (cleanupTemp) {
      try {
        await fs.unlink(localPath);
      } catch {
        /* best effort */
      }
    }
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function getArtifactById(id: string, organisationId: string) {
  const [row] = await db
    .select()
    .from(ieeArtifacts)
    .where(and(eq(ieeArtifacts.id, id), eq(ieeArtifacts.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

async function findCachedTranscript(contentHash: string, organisationId: string) {
  // Look for any existing artifact in the same org whose metadata.contentHash
  // matches and whose source was 'transcribe_audio'. Order by createdAt desc
  // (per pr-reviewer MAJOR-4) so we deterministically prefer the most recent
  // cached transcript rather than getting an arbitrary row.
  const rows = await db
    .select()
    .from(ieeArtifacts)
    .where(
      and(
        eq(ieeArtifacts.organisationId, organisationId),
        sql`${ieeArtifacts.metadata}->>'source' = 'transcribe_audio'`,
        sql`${ieeArtifacts.metadata}->>'contentHash' = ${contentHash}`,
      ),
    )
    .orderBy(desc(ieeArtifacts.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function sha256Stream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

async function downloadToTemp(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new FailureError(
      failure('connector_timeout', `audio_url_fetch_failed:${res.status}`, { url }),
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const tempPath = path.join(tmpdir(), `transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.bin`);
  await fs.writeFile(tempPath, buf);
  return tempPath;
}

async function writeTranscriptTempFile(transcript: string): Promise<string> {
  const tempPath = path.join(tmpdir(), `transcript-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  await fs.writeFile(tempPath, transcript, 'utf8');
  return tempPath;
}

function getOpenAiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new FailureError(
      failure('internal_error', 'openai_api_key_missing', {
        hint: 'Set OPENAI_API_KEY in the server environment.',
      }),
    );
  }
  return key;
}

class WhisperHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

async function callWhisper(
  filePath: string,
  apiKey: string,
  language: string | undefined,
): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  const filename = path.basename(filePath);

  // Build a multipart/form-data body via the global FormData (Node 18+).
  const form = new FormData();
  form.append('file', new Blob([fileBuffer]), filename);
  form.append('model', WHISPER_MODEL);
  if (language) form.append('language', language);
  form.append('response_format', 'json');

  const res = await fetch(WHISPER_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    let retryAfter: number | undefined;
    const retryHeader = res.headers.get('retry-after');
    if (retryHeader) {
      const parsed = Number(retryHeader);
      if (!Number.isNaN(parsed)) retryAfter = parsed;
    }
    const text = await res.text().catch(() => '');
    throw new WhisperHttpError(
      `whisper:${res.status}:${text.slice(0, 200)}`,
      res.status,
      retryAfter,
    );
  }

  const json = (await res.json()) as { text?: string };
  if (!json.text) {
    throw new WhisperHttpError('whisper:empty_response', 502);
  }
  return json.text;
}
