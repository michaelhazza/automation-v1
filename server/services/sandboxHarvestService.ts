/**
 * sandboxHarvestService.ts — Post-terminal harvest pipeline orchestrator.
 *
 * Spec B §8.4, §11.3, §11.4, §13.1, §14.1, §14.5, §20.3, §20.4, §20.5,
 * §20.7, §20.8, §22, §24.1, §24.4, §24.5.
 *
 * Public interface:
 *   runHarvest(sandboxExecutionId)            — normal post-terminal path (spec §22).
 *   runHarvestReconciliation(sandboxExecutionId, attempt) — recovery path (spec §13.1).
 *
 * Each of the 12 steps is implemented as a separate function. The entrypoint
 * walks them in order and stops on the first failure. Every step is idempotent
 * on its own write. No single transaction spans all 12 steps (spec §8.4).
 *
 * Provider file API calls (steps 2, 5, 6) are wrapped via withSandboxProvider.
 */

import { eq, and, sql } from 'drizzle-orm';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { sandboxExecutions } from '../db/schema/sandboxExecutions.js';
import { sandboxArtefacts } from '../db/schema/sandboxArtefacts.js';
import { sandboxLogs } from '../db/schema/sandboxLogs.js';
import { llmRequests } from '../db/schema/llmRequests.js';
import { getOrgScopedDb } from '../lib/orgScopedDb.js';
import { allocateAndInsertTelemetryEvent } from '../lib/sandboxTelemetrySequencePure.js';
import type { SandboxTelemetryEventType, SandboxTelemetryCriticality } from '../db/schema/sandboxTelemetryEvents.js';
import { getS3Client, getBucketName } from '../lib/storage.js';
import { redactValue } from '../lib/redaction.js';
import { logger } from '../lib/logger.js';
import { assertValidTransition, describeTransition } from '../../shared/stateMachineGuards.js';
import type { SandboxRunTaskOutput, SandboxTerminalState } from '../../shared/types/sandbox.js';
import {
  composeRedactionPatternSet,
  classifyHarvestOutcome,
  validateOutputAgainstSchema,
  type HarvestStepResult,
} from './sandboxHarvestServicePure.js';
import type { RedactionPattern } from '../lib/redaction.js';
import { withSandboxProvider, type ProviderDiagnosticEvent } from '../lib/withSandboxProvider.js';
import { subaccountIeeBrowserSettingsService } from './subaccountIeeBrowserSettingsService.js';
import { evaluateTaskCost, IEE_BROWSER_EVENT_TASK_COST_ANOMALY } from './sandbox/ieeBrowserCostAlarmEvaluatorPure.js';
import { isCredentialLeakFilename } from './sandbox/credentialLeakFilenameGuardPure.js';
import { sanitiseArtefactFilename } from './sandbox/artefactFilenameSanitiserPure.js';
import { recordIncident } from './incidentIngestor.js';
import { checkLogStorageQuota } from './sandbox/logStorageQuotaPure.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface HarvestContext {
  sandboxExecutionId: string;
  organisationId: string;
  subaccountId: string;
  runId: string;
  agentId: string;
  taskId: string;
  provider: string;
  templateName: string;
  templateVersion: string;
  /** Active redaction patterns for this execution (default bundle + per-alias). */
  redactionPatterns: RedactionPattern[];
  /** Reconciliation attempt count: 0 = canonical run, 1+ = reconciliation. */
  reconciliationAttempt: number;
}

interface ArtefactEntry {
  filename: string;
  bytes: number;
  contentHash: string;
  mime: string;
  content: Buffer;
}

interface LogEntry {
  stream: 'stdout' | 'stderr';
  line: string;
  emittedAt: Date;
}

// Maximum log line length (spec §20.8 — over-cap lines are truncated).
// Must match DB CHECK constraint char_length(line) <= 10000 in migration 0362.
const MAX_LOG_LINE_CHARS = 10000;

// ---------------------------------------------------------------------------
// Telemetry write helper — delegates to the advisory-lock-serialised allocator.
// ---------------------------------------------------------------------------

async function writeTelemetryEvent(
  ctx: HarvestContext,
  eventType: SandboxTelemetryEventType,
  criticality: SandboxTelemetryCriticality,
  payloadJson: Record<string, unknown>,
): Promise<void> {
  const db = getOrgScopedDb('sandboxHarvestService.writeTelemetryEvent');
  await allocateAndInsertTelemetryEvent(db, {
    sandboxExecutionId: ctx.sandboxExecutionId,
    organisationId: ctx.organisationId,
    subaccountId: ctx.subaccountId,
    runId: ctx.runId,
    agentId: ctx.agentId,
    taskId: ctx.taskId,
    provider: ctx.provider,
    templateName: ctx.templateName,
    templateVersion: ctx.templateVersion,
    eventType,
    criticality,
    payloadJson,
  });
}

function makeTelemetryWriter(ctx: HarvestContext): (event: ProviderDiagnosticEvent) => Promise<void> {
  return async (event) => {
    const db = getOrgScopedDb('sandboxHarvestService.telemetryWriter');
    await allocateAndInsertTelemetryEvent(db, {
      sandboxExecutionId: ctx.sandboxExecutionId,
      organisationId: ctx.organisationId,
      subaccountId: ctx.subaccountId,
      runId: ctx.runId,
      agentId: ctx.agentId,
      taskId: ctx.taskId,
      provider: ctx.provider,
      templateName: ctx.templateName,
      templateVersion: ctx.templateVersion,
      eventType: 'provider_diagnostic',
      criticality: 'info',
      payloadJson: {
        subKind: event.subKind,
        attempt: event.attempt,
        elapsedMs: event.elapsedMs,
        status: event.status,
        code: event.code,
      },
    });
  };
}

// ---------------------------------------------------------------------------
// Step 1 — Terminal classification (spec §8.4 step 1).
// Reads the current sandbox_executions row to obtain the provider signal.
// Returns a step result carrying the provider-derived terminal state.
// ---------------------------------------------------------------------------

async function step1TerminalClassification(ctx: HarvestContext): Promise<{
  result: HarvestStepResult;
  providerTerminalState: SandboxTerminalState;
  outputJson: unknown | null;
  metricsJson: unknown | null;
  costCents: number;
}> {
  const db = getOrgScopedDb('sandboxHarvestService.step1');
  const rows = await db
    .select()
    .from(sandboxExecutions)
    .where(eq(sandboxExecutions.id, ctx.sandboxExecutionId))
    .limit(1);

  if (rows.length === 0) {
    return {
      result: { ok: false, reason: 'provider_unavailable' },
      providerTerminalState: 'provider_unavailable',
      outputJson: null,
      metricsJson: null,
      costCents: 0,
    };
  }

  const row = rows[0];
  // The execution must currently be in 'harvesting' status for this harvest to be valid.
  // If it's already terminal, a prior harvest completed — return its state.
  if (row.status !== 'harvesting') {
    const alreadyTerminal = row.status as SandboxTerminalState;
    return {
      result: { ok: true },
      providerTerminalState: alreadyTerminal,
      outputJson: row.outputJson,
      metricsJson: row.metricsJson,
      costCents: row.costCents ?? 0,
    };
  }

  // Harvest in progress — derive terminal state from stored error_reason or default to 'completed'.
  // The actual terminal state is decided collectively across steps; step 1 provides the
  // provider-signal input: if errorReason is set (from a prior ceiling/crash), relay it.
  const providerTerminalState: SandboxTerminalState = (row.errorReason as SandboxTerminalState | null) ?? 'completed';

  return {
    result: { ok: true },
    providerTerminalState,
    outputJson: row.outputJson,
    metricsJson: row.metricsJson,
    costCents: row.costCents ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Step 2 — Output read (spec §8.4 step 2).
// ---------------------------------------------------------------------------

interface OutputReadResult {
  result: HarvestStepResult;
  parsed: unknown;
  bytes: number;
}

const MAX_OUTPUT_BYTES = 1_048_576; // 1 MB default cap

async function step2OutputRead(
  ctx: HarvestContext,
  storedOutputJson: unknown | null,
): Promise<OutputReadResult> {
  // Fast-path: the execution service persists the provider's terminal output
  // onto `sandbox_executions.output_json` BEFORE invoking the harvest pipeline
  // (see sandboxExecutionService._attemptProviderStart). Step 1 surfaced it
  // via `step1.outputJson`. Until the provider SDK file-read API for
  // `/workspace/output.json` is wired, use the stored row output as the
  // authoritative source so the normal harvest path does not route every
  // successful sandbox call to `output_validation_failed`.
  //
  // Canonical mode (reconciliationAttempt === 0): the execution service has
  // just written `outputJson` immediately before invoking runHarvest, so the
  // stored value is authoritative even when it is `null` (a provider may
  // legitimately return JSON null for a completed task with no structured
  // output). Trust the stored value as-is.
  //
  // Reconciliation mode (reconciliationAttempt > 0): the row's output_json may
  // be null because the original worker died before persisting output. Only
  // short-circuit when a non-null/non-undefined value is present; otherwise
  // fall through to the provider SDK file-read path (currently stubbed).
  const canonical = ctx.reconciliationAttempt === 0;
  const storedAvailable = canonical
    ? storedOutputJson !== undefined
    : storedOutputJson !== null && storedOutputJson !== undefined;
  if (storedAvailable) {
    const serialised = JSON.stringify(storedOutputJson);
    const bytes = Buffer.byteLength(serialised, 'utf8');
    if (bytes > MAX_OUTPUT_BYTES) {
      return { result: { ok: false, reason: 'output_validation_failed' }, parsed: null, bytes };
    }
    return { result: { ok: true }, parsed: storedOutputJson, bytes };
  }

  try {
    const rawContent = await withSandboxProvider({
      phase: 'harvest',
      sandboxExecutionId: ctx.sandboxExecutionId,
      telemetryWriter: makeTelemetryWriter(ctx),
      call: async () => {
        // Providers expose file reads through their SDK. Stubbed until C8/C9/C10.
        // The actual provider call will read /workspace/output.json.
        throw new Error('provider_file_read_not_implemented: awaiting C8/C9/C10');
      },
    });

    // rawContent is the file content as string/Buffer — type assertion for stub path.
    const contentStr = typeof rawContent === 'string' ? rawContent : String(rawContent);
    const bytes = Buffer.byteLength(contentStr, 'utf8');

    if (bytes > MAX_OUTPUT_BYTES) {
      return { result: { ok: false, reason: 'output_validation_failed' }, parsed: null, bytes };
    }

    const parsed = JSON.parse(contentStr) as unknown;
    return { result: { ok: true }, parsed, bytes };
  } catch (err: unknown) {
    const message = (err as Error).message ?? '';
    if (message.startsWith('provider_file_read_not_implemented')) {
      // Stub path — treat as missing output for now.
      return { result: { ok: false, reason: 'output_validation_failed' }, parsed: null, bytes: 0 };
    }
    logger.warn('sandbox.harvest.output_read_failed', {
      sandboxExecutionId: ctx.sandboxExecutionId,
      error: message,
    });
    return { result: { ok: false, reason: 'output_validation_failed' }, parsed: null, bytes: 0 };
  }
}

// ---------------------------------------------------------------------------
// Step 3 — Output validate (spec §8.4 step 3).
// ---------------------------------------------------------------------------

interface OutputValidateResult {
  result: HarvestStepResult;
  validated: unknown;
}

async function step3OutputValidate(
  ctx: HarvestContext,
  parsed: unknown,
  outputSchemaRef: string,
): Promise<OutputValidateResult> {
  // Schema resolution: in V1, schemas are registered by key. Until the schema
  // registry is built (post-C7), we use z.unknown() as a permissive fallback.
  // This keeps harvest working end-to-end while schema registration is wired.
  const { z } = await import('zod');
  const schema = resolveOutputSchema(outputSchemaRef) ?? z.unknown();

  const validationResult = validateOutputAgainstSchema(parsed, schema);
  if (!validationResult.ok) {
    await writeTelemetryEvent(ctx, 'output_validation_failed', 'warn', {
      subReason: validationResult.subReason,
    });
    return { result: { ok: false, reason: 'output_validation_failed' }, validated: null };
  }

  return { result: { ok: true }, validated: validationResult.validated };
}

/**
 * Resolves an outputSchemaRef to a Zod schema. V1 implementation uses a
 * simple in-process registry; the registry is populated by task schema
 * registration at service startup (post-C7 concern). Returns null when
 * the ref is unknown (caller falls back to z.unknown()).
 */
function resolveOutputSchema(_schemaRef: string): import('zod').ZodSchema<unknown> | null {
  // TODO(C7-schema-registry): wire to the task schema registry when available.
  return null;
}

// ---------------------------------------------------------------------------
// Step 4 — Output redact (spec §8.4 step 4).
// ---------------------------------------------------------------------------

interface OutputRedactResult {
  result: HarvestStepResult;
  redacted: unknown;
  redactionCount: number;
}

function step4OutputRedact(ctx: HarvestContext, validated: unknown): OutputRedactResult {
  const { value, redactions } = redactValue(validated, ctx.redactionPatterns);
  return {
    result: { ok: true },
    redacted: value,
    redactionCount: redactions.length,
  };
}

// ---------------------------------------------------------------------------
// Step 5 — Log read (spec §8.4 step 5).
// ---------------------------------------------------------------------------

interface LogReadResult {
  result: HarvestStepResult;
  stdout: LogEntry[];
  stderr: LogEntry[];
}

const MAX_LOG_STREAM_BYTES = 10_485_760; // 10 MB per stream

async function step5LogRead(ctx: HarvestContext): Promise<LogReadResult> {
  const readStream = async (stream: 'stdout' | 'stderr'): Promise<{ lines: LogEntry[]; bytes: number }> => {
    try {
      const content = await withSandboxProvider({
        phase: 'harvest',
        sandboxExecutionId: ctx.sandboxExecutionId,
        telemetryWriter: makeTelemetryWriter(ctx),
        call: async () => {
          // Actual provider read of /workspace/logs/{stdout|stderr}.log — stubbed until C8/C9/C10.
          return '';
        },
      });
      const contentStr = typeof content === 'string' ? content : String(content);
      const bytes = Buffer.byteLength(contentStr, 'utf8');
      if (bytes > MAX_LOG_STREAM_BYTES) {
        return { lines: [], bytes };
      }
      const rawLines = contentStr.split('\n');
      const lines: LogEntry[] = rawLines
        .filter((l) => l.length > 0)
        .map((l) => ({
          stream,
          // Truncate over-cap lines (spec §20.8 — truncate, never drop).
          line: l.length > MAX_LOG_LINE_CHARS
            ? l.slice(0, MAX_LOG_LINE_CHARS)
            : l,
          emittedAt: new Date(),
        }));
      return { lines, bytes };
    } catch (err) {
      logger.warn('sandbox.harvest.output_read_failed', {
        sandboxExecutionId: ctx.sandboxExecutionId,
        stream,
        err: err instanceof Error ? err.message : String(err),
      });
      return { lines: [], bytes: 0 };
    }
  };

  const [stdoutResult, stderrResult] = await Promise.all([
    readStream('stdout'),
    readStream('stderr'),
  ]);

  if (stdoutResult.bytes > MAX_LOG_STREAM_BYTES || stderrResult.bytes > MAX_LOG_STREAM_BYTES) {
    await writeTelemetryEvent(ctx, 'output_validation_failed', 'warn', {
      subReason: 'log_overflow',
      stream: stdoutResult.bytes > MAX_LOG_STREAM_BYTES ? 'stdout' : 'stderr',
      observedBytes: Math.max(stdoutResult.bytes, stderrResult.bytes),
      capBytes: MAX_LOG_STREAM_BYTES,
    });
    return { result: { ok: false, reason: 'output_validation_failed' }, stdout: [], stderr: [] };
  }

  // Redact each log line (spec §8.4 step 5).
  const redactLines = (entries: LogEntry[]): LogEntry[] =>
    entries.map((e) => ({
      ...e,
      line: (redactValue(e.line, ctx.redactionPatterns).value as string),
    }));

  return {
    result: { ok: true },
    stdout: redactLines(stdoutResult.lines),
    stderr: redactLines(stderrResult.lines),
  };
}

// ---------------------------------------------------------------------------
// Step 6 — Artefact enumeration (spec §8.4 step 6).
// ---------------------------------------------------------------------------

interface ArtefactEnumResult {
  result: HarvestStepResult;
  artefacts: ArtefactEntry[];
}

const MAX_PER_ARTEFACT_BYTES = 10_485_760;  // 10 MB
const MAX_TOTAL_ARTEFACT_BYTES = 104_857_600; // 100 MB

async function step6ArtefactEnumeration(
  ctx: HarvestContext,
  perArtefactBytes: number,
  totalArtefactBytes: number,
): Promise<ArtefactEnumResult> {
  let artefactList: Array<{ filename: string; bytes: number; mime: string }>;

  try {
    artefactList = await withSandboxProvider({
      phase: 'harvest',
      sandboxExecutionId: ctx.sandboxExecutionId,
      telemetryWriter: makeTelemetryWriter(ctx),
      call: async () => {
        // Actual provider list of /workspace/artefacts/ — stubbed until C8/C9/C10.
        return [] as Array<{ filename: string; bytes: number; mime: string }>;
      },
    });
  } catch (err) {
    logger.warn('sandbox.harvest.artefact_enum_failed', {
      sandboxExecutionId: ctx.sandboxExecutionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      result: { ok: false, reason: 'artefact_upload_failed' },
      artefacts: [],
    };
  }

  // Credential-leak defense-in-depth (spec §11.4).
  // Normalize before matching to prevent case/separator bypass (SANDBOX-ADV-4.1).
  for (const entry of artefactList) {
    if (isCredentialLeakFilename(entry.filename)) {
      await writeTelemetryEvent(ctx, 'credential_leak_attempted', 'error', {
        filename: entry.filename,
      });
      logger.error('sandbox.credential.leak_attempted', {
        sandboxExecutionId: ctx.sandboxExecutionId,
        filename: entry.filename,
      });
      return { result: { ok: false, reason: 'artefact_upload_failed' }, artefacts: [] };
    }

    // S3 path-traversal sanitisation (spec §8.4, SANDBOX-ADV-4.2).
    const sanitised = sanitiseArtefactFilename(entry.filename);
    if (!sanitised.ok) {
      await writeTelemetryEvent(ctx, 'artefact_upload_failed', 'error', {
        filename: entry.filename,
        reason: sanitised.reason,
      });
      return { result: { ok: false, reason: 'artefact_upload_failed' }, artefacts: [] };
    }
  }

  // Size-cap checks (spec §9.4).
  const capBytes = perArtefactBytes ?? MAX_PER_ARTEFACT_BYTES;
  const totalCapBytes = totalArtefactBytes ?? MAX_TOTAL_ARTEFACT_BYTES;
  let totalBytes = 0;

  for (const entry of artefactList) {
    if (entry.bytes > capBytes) {
      await writeTelemetryEvent(ctx, 'artefact_upload_failed', 'error', {
        filename: entry.filename,
        reason: 'artefact_oversized',
        observedBytes: entry.bytes,
        capBytes,
      });
      return { result: { ok: false, reason: 'artefact_upload_failed' }, artefacts: [] };
    }
    totalBytes += entry.bytes;
  }

  if (totalBytes > totalCapBytes) {
    await writeTelemetryEvent(ctx, 'artefact_upload_failed', 'error', {
      filename: '(total)',
      reason: 'artefact_oversized',
      observedBytes: totalBytes,
      capBytes: totalCapBytes,
    });
    return { result: { ok: false, reason: 'artefact_upload_failed' }, artefacts: [] };
  }

  // Read each artefact's content via the provider file API.
  const artefacts: ArtefactEntry[] = [];
  for (const entry of artefactList) {
    const content = await withSandboxProvider({
      phase: 'harvest',
      sandboxExecutionId: ctx.sandboxExecutionId,
      telemetryWriter: makeTelemetryWriter(ctx),
      call: async () => Buffer.alloc(0), // stub — actual read in C9/C10
    });

    // Compute content hash.
    const { createHash } = await import('crypto');
    const contentHash = `sha256:${createHash('sha256').update(content).digest('hex')}`;

    artefacts.push({
      filename: entry.filename,
      bytes: entry.bytes,
      contentHash,
      mime: entry.mime,
      content,
    });
  }

  return { result: { ok: true }, artefacts };
}

// ---------------------------------------------------------------------------
// Step 7 — Artefact metadata redact (spec §8.4 step 7).
// ---------------------------------------------------------------------------

interface ArtefactRedactResult {
  result: HarvestStepResult;
  artefacts: ArtefactEntry[];
}

function step7ArtefactMetadataRedact(
  ctx: HarvestContext,
  artefacts: ArtefactEntry[],
): ArtefactRedactResult {
  const redacted = artefacts.map((a) => ({
    ...a,
    filename: (redactValue(a.filename, ctx.redactionPatterns).value as string),
  }));
  return { result: { ok: true }, artefacts: redacted };
}

// ---------------------------------------------------------------------------
// Step 8 — Object storage upload (spec §8.4 step 8).
// ---------------------------------------------------------------------------

interface UploadResult {
  result: HarvestStepResult;
  refs: Array<{ filename: string; objectKey: string; bytes: number; contentHash: string }>;
}

async function step8ObjectStorageUpload(
  ctx: HarvestContext,
  artefacts: ArtefactEntry[],
): Promise<UploadResult> {
  const db = getOrgScopedDb('sandboxHarvestService.step8');
  const s3 = getS3Client();
  const bucket = getBucketName();
  const refs: Array<{ filename: string; objectKey: string; bytes: number; contentHash: string }> = [];

  for (const artefact of artefacts) {
    const objectKey = `sandbox-artefacts/${ctx.organisationId}/${ctx.subaccountId}/${ctx.sandboxExecutionId}/${artefact.filename}`;

    try {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: artefact.content,
        ContentLength: artefact.bytes,
        ContentType: artefact.mime,
      }));
    } catch (err: unknown) {
      await writeTelemetryEvent(ctx, 'artefact_upload_failed', 'error', {
        filename: artefact.filename,
        reason: 'upload_io_error',
      });
      logger.error('sandbox.artefact_upload_failed', {
        sandboxExecutionId: ctx.sandboxExecutionId,
        filename: artefact.filename,
        error: (err as Error).message,
      });
      return { result: { ok: false, reason: 'artefact_upload_failed' }, refs: [] };
    }

    // Write pointer row — idempotent on (sandbox_execution_id, filename) unique index.
    try {
      await db.insert(sandboxArtefacts).values({
        sandboxExecutionId: ctx.sandboxExecutionId,
        organisationId: ctx.organisationId,
        subaccountId: ctx.subaccountId,
        filename: artefact.filename,
        objectKey,
        bytes: artefact.bytes,
        contentHash: artefact.contentHash,
        mime: artefact.mime,
        objectStorageState: 'uploaded',
      }).onConflictDoNothing();
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== '23505') {
        return { result: { ok: false, reason: 'artefact_upload_failed' }, refs: [] };
      }
      // Already exists — idempotent hit, emit wasIdempotent flag.
      await writeTelemetryEvent(ctx, 'artefact_uploaded', 'info', {
        filename: artefact.filename,
        bytes: artefact.bytes,
        contentHash: artefact.contentHash,
        wasIdempotent: true,
      });
      refs.push({ filename: artefact.filename, objectKey, bytes: artefact.bytes, contentHash: artefact.contentHash });
      continue;
    }

    await writeTelemetryEvent(ctx, 'artefact_uploaded', 'info', {
      filename: artefact.filename,
      bytes: artefact.bytes,
      contentHash: artefact.contentHash,
    });

    refs.push({ filename: artefact.filename, objectKey, bytes: artefact.bytes, contentHash: artefact.contentHash });
  }

  return { result: { ok: true }, refs };
}

// ---------------------------------------------------------------------------
// Step 9 — Log persistence (spec §8.4 step 9, §20.8).
// ---------------------------------------------------------------------------

async function step9LogPersistence(
  ctx: HarvestContext,
  stdout: LogEntry[],
  stderr: LogEntry[],
): Promise<{ result: HarvestStepResult; stdoutRef: string; stderrRef: string }> {
  const db = getOrgScopedDb('sandboxHarvestService.step9');

  // Per-tenant log-storage quota check (spec §8.5, SANDBOX-ADV-5.2).
  const allLines = [...stdout, ...stderr];
  const thisBatchBytes = allLines.reduce((sum, e) => sum + Buffer.byteLength(e.line, 'utf8'), 0);

  // date_trunc('day', NOW() AT TIME ZONE 'UTC') produces a `timestamp without
  // time zone`. Comparing that to a timestamptz column depends on the session
  // timezone — wrapping the result in `AT TIME ZONE 'UTC'` rebuilds a
  // canonical UTC timestamptz so the daily quota boundary is invariant under
  // session timezone settings.
  const [{ today_bytes }] = await db.execute<{ today_bytes: string }>(sql`
    SELECT COALESCE(SUM(octet_length(line)), 0)::bigint AS today_bytes
    FROM sandbox_logs
    WHERE organisation_id = ${ctx.organisationId}
      AND persisted_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
  `);
  const todayBytesAlreadyPersisted = Number(today_bytes);

  const quotaResult = checkLogStorageQuota({
    organisationId: ctx.organisationId,
    todayBytesAlreadyPersisted,
    thisBatchBytes,
  });

  if (!quotaResult.allowed) {
    await writeTelemetryEvent(ctx, 'artefact_upload_failed', 'error', {
      reason: 'log_quota_exceeded',
      capBytes: quotaResult.capBytes,
      exceededBy: quotaResult.exceededBy,
    });
    return {
      result: { ok: false, reason: 'harvest_failed' },
      stdoutRef: '',
      stderrRef: '',
    };
  }

  const persistStream = async (
    stream: 'stdout' | 'stderr',
    lines: LogEntry[],
  ): Promise<boolean> => {
    // Allocate sequences starting at 1 for this stream.
    for (let i = 0; i < lines.length; i++) {
      const sequence = i + 1;
      try {
        await db.insert(sandboxLogs).values({
          sandboxExecutionId: ctx.sandboxExecutionId,
          organisationId: ctx.organisationId,
          subaccountId: ctx.subaccountId,
          runId: ctx.runId,
          logStream: stream,
          sequence,
          line: lines[i].line,
          emittedAt: lines[i].emittedAt,
        }).onConflictDoNothing();
      } catch (err: unknown) {
        if ((err as { code?: string }).code !== '23505') {
          logger.error('sandbox.harvest.log_persist_failed', {
            sandboxExecutionId: ctx.sandboxExecutionId,
            stream,
            sequence,
            error: (err as Error).message,
          });
          return false;
        }
        // 23505 = idempotent hit — already written on a prior attempt.
      }
    }
    return true;
  };

  const [stdoutOk, stderrOk] = await Promise.all([
    persistStream('stdout', stdout),
    persistStream('stderr', stderr),
  ]);

  if (!stdoutOk || !stderrOk) {
    return {
      result: { ok: false, reason: 'harvest_failed' },
      stdoutRef: '',
      stderrRef: '',
    };
  }

  // Log refs are opaque identifiers — keyed by (execution_id, stream).
  const stdoutRef = `${ctx.sandboxExecutionId}:stdout`;
  const stderrRef = `${ctx.sandboxExecutionId}:stderr`;

  return { result: { ok: true }, stdoutRef, stderrRef };
}

// ---------------------------------------------------------------------------
// Step 10 — Cost row write (spec §8.4 step 10, §12, §24.1).
// ---------------------------------------------------------------------------

interface CostRowResult {
  result: HarvestStepResult;
  costCents: number;
}

async function step10CostRowWrite(
  ctx: HarvestContext,
  metricsJson: unknown,
  providerCostCents: number,
): Promise<CostRowResult> {
  const db = getOrgScopedDb('sandboxHarvestService.step10');

  const metrics = (metricsJson as { wallClockMs?: number; vcpuSeconds?: number } | null) ?? {};
  const wallClockMs = metrics.wallClockMs ?? 0;
  const vcpuSeconds = metrics.vcpuSeconds ?? 0;

  // Generate an idempotency key: sandbox executions get one cost row (unique by sandboxExecutionId + source_type).
  const idempotencyKey = `sandbox_compute:${ctx.sandboxExecutionId}`;
  const billingMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const billingDay = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD

  const costWithMarginCents = providerCostCents; // V1: no margin on sandbox compute
  const costRaw = (providerCostCents / 100).toFixed(8);
  const costWithMargin = costRaw;

  try {
    await db.insert(llmRequests).values({
      idempotencyKey,
      organisationId: ctx.organisationId,
      subaccountId: ctx.subaccountId,
      sourceType: 'sandbox_compute',
      subtype: 'task',
      featureTag: 'sandbox-execution',
      callSite: 'worker',
      provider: ctx.provider,
      model: `sandbox:${ctx.templateName}`,
      costRaw,
      costWithMargin,
      costWithMarginCents,
      billingMonth,
      billingDay,
      sandboxExecutionId: ctx.sandboxExecutionId,
      sandboxVcpuSeconds: String(vcpuSeconds),
      sandboxWallClockMs: wallClockMs,
      sandboxProvider: ctx.provider,
      sandboxTemplateVersion: ctx.templateVersion,
      status: 'success',
    });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      // Idempotent hit — row already written by a prior harvest attempt.
      // Confirm cost matches within tolerance (spec §24.3).
      const [existing] = await db
        .select()
        .from(llmRequests)
        .where(and(
          eq(llmRequests.sandboxExecutionId, ctx.sandboxExecutionId),
          eq(llmRequests.sourceType, 'sandbox_compute'),
        ))
        .limit(1);

      if (existing) {
        const existingCents = existing.costWithMarginCents ?? 0;
        const delta = Math.abs(existingCents - costWithMarginCents);
        if (delta > 1) {
          // Cost mismatch beyond 1-cent tolerance — log but do not fail (spec §24.1).
          logger.warn('sandbox.harvest.cost_row_mismatch', {
            sandboxExecutionId: ctx.sandboxExecutionId,
            existingCents,
            newCents: costWithMarginCents,
            delta,
          });
        }
        return { result: { ok: true }, costCents: existingCents };
      }
    } else {
      logger.error('sandbox.harvest.cost_row_write_failed', {
        sandboxExecutionId: ctx.sandboxExecutionId,
        error: (err as Error).message,
      });
      return { result: { ok: false, reason: 'harvest_failed' }, costCents: 0 };
    }
  }

  return { result: { ok: true }, costCents: costWithMarginCents };
}

// ---------------------------------------------------------------------------
// Step 11 — Telemetry terminal event (spec §8.4 step 11, §14.2, §24.4).
// ---------------------------------------------------------------------------

async function step11TelemetryTerminalEvent(
  ctx: HarvestContext,
  terminalState: SandboxTerminalState,
  harvestStepReached: number,
  metricsJson: unknown,
  costCents: number,
): Promise<HarvestStepResult> {
  const isCanonical = ctx.reconciliationAttempt === 0;
  const metrics = (metricsJson as {
    wallClockMs?: number;
    vcpuSeconds?: number;
    peakMemoryMb?: number;
    egressBytes?: number;
  } | null) ?? {};

  try {
    await writeTelemetryEvent(ctx, 'sandbox_terminal', 'info', {
      terminalState,
      wallClockMs: metrics.wallClockMs ?? 0,
      vcpuSeconds: metrics.vcpuSeconds ?? 0,
      providerReportedCostCents: costCents,
      harvestStepReached,
      isCanonical,
      ...(ctx.reconciliationAttempt > 0
        ? { reconciliationAttempt: ctx.reconciliationAttempt }
        : {}),
    });
    return { ok: true };
  } catch (err: unknown) {
    logger.error('sandbox.harvest.telemetry_terminal_failed', {
      sandboxExecutionId: ctx.sandboxExecutionId,
      error: (err as Error).message,
    });
    return { ok: false, reason: 'harvest_failed' };
  }
}

// ---------------------------------------------------------------------------
// Step 12 — sandbox_executions row update (spec §8.4 step 12, §24.3).
// ---------------------------------------------------------------------------

async function step12StatusUpdate(
  ctx: HarvestContext,
  terminalState: SandboxTerminalState,
  redactedOutput: unknown,
  artefactRefs: Array<{ filename: string; objectKey: string; bytes: number; contentHash: string }>,
  metricsJson: unknown,
  costCents: number,
): Promise<HarvestStepResult> {
  const db = getOrgScopedDb('sandboxHarvestService.step12');

  // Wrap assertValidTransition (spec DEVELOPMENT_GUIDELINES §8.18).
  assertValidTransition({
    kind: 'sandbox_execution',
    recordId: ctx.sandboxExecutionId,
    from: 'harvesting',
    to: terminalState,
  });

  logger.info('state_transition', describeTransition({
    kind: 'sandbox_execution',
    recordId: ctx.sandboxExecutionId,
    from: 'harvesting',
    to: terminalState,
    site: 'sandboxHarvestService.step12',
    guarded: true,
  }));

  const result = await db
    .update(sandboxExecutions)
    .set({
      status: terminalState,
      outputJson: redactedOutput,
      metricsJson,
      costCents,
      harvestedAt: new Date(),
    })
    .where(
      and(
        eq(sandboxExecutions.id, ctx.sandboxExecutionId),
        eq(sandboxExecutions.status, 'harvesting'),
      ),
    )
    .returning({ id: sandboxExecutions.id });

  if (result.length === 0) {
    // 0 rows updated — losing race with another harvester (spec §24.3).
    logger.info('sandbox.harvest.step12_race_lost', {
      sandboxExecutionId: ctx.sandboxExecutionId,
      targetState: terminalState,
    });
    // Read canonical and exit.
    const [canonical] = await db
      .select({ status: sandboxExecutions.status })
      .from(sandboxExecutions)
      .where(eq(sandboxExecutions.id, ctx.sandboxExecutionId))
      .limit(1);
    logger.info('sandbox.harvest.step12_canonical', {
      sandboxExecutionId: ctx.sandboxExecutionId,
      canonicalStatus: canonical?.status,
    });
    return { ok: true };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public entrypoint — runHarvest
// ---------------------------------------------------------------------------

/**
 * Run the 12-step harvest pipeline for a sandbox execution that has just
 * terminated. Called inline from runTask in sandboxExecutionService (spec §22).
 *
 * @param sandboxExecutionId - The execution ID to harvest.
 * @param input - Minimal context needed for harvest; pulled from the row for
 *   reconciliation paths. Passed directly from runTask for the happy path.
 */
export async function runHarvest(
  sandboxExecutionId: string,
  input: {
    organisationId: string;
    subaccountId: string;
    runId: string;
    agentId: string;
    taskId: string;
    provider: string;
    templateName: string;
    templateVersion: string;
    outputSchemaRef: string;
    credentialAliases: Array<{ alias: string; connectionId: string }>;
    policyArtefactLimits?: { perArtefactBytes: number; totalBytes: number };
  },
): Promise<SandboxRunTaskOutput> {
  const redactionPatterns = composeRedactionPatternSet(
    (await import('../lib/redaction.js')).DEFAULT_REDACTION_PATTERNS,
    input.credentialAliases,
  );

  const ctx: HarvestContext = {
    sandboxExecutionId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    runId: input.runId,
    agentId: input.agentId,
    taskId: input.taskId,
    provider: input.provider,
    templateName: input.templateName,
    templateVersion: input.templateVersion,
    redactionPatterns,
    reconciliationAttempt: 0,
  };

  await writeTelemetryEvent(ctx, 'harvest_started', 'info', {});
  logger.info('sandbox.harvest.started', { sandboxExecutionId });

  return runHarvestPipeline(ctx, input.outputSchemaRef, input.policyArtefactLimits);
}

/**
 * Re-run the harvest pipeline on a previously-terminal or stuck-harvesting
 * execution (spec §13.1 reconciliation-recoverable exception).
 *
 * Events emitted with isCanonical: false and reconciliationAttempt: N.
 */
export async function runHarvestReconciliation(
  sandboxExecutionId: string,
  attempt: number,
  input: {
    organisationId: string;
    subaccountId: string;
    runId: string;
    agentId: string;
    taskId: string;
    provider: string;
    templateName: string;
    templateVersion: string;
    outputSchemaRef: string;
    credentialAliases: Array<{ alias: string; connectionId: string }>;
    policyArtefactLimits?: { perArtefactBytes: number; totalBytes: number };
  },
): Promise<void> {
  const redactionPatterns = composeRedactionPatternSet(
    (await import('../lib/redaction.js')).DEFAULT_REDACTION_PATTERNS,
    input.credentialAliases,
  );

  const ctx: HarvestContext = {
    sandboxExecutionId,
    organisationId: input.organisationId,
    subaccountId: input.subaccountId,
    runId: input.runId,
    agentId: input.agentId,
    taskId: input.taskId,
    provider: input.provider,
    templateName: input.templateName,
    templateVersion: input.templateVersion,
    redactionPatterns,
    reconciliationAttempt: attempt,
  };

  await writeTelemetryEvent(ctx, 'harvest_started', 'info', {
    reconciliationAttempt: attempt,
    isCanonical: false,
  });
  logger.info('sandbox.harvest.reconciliation_started', { sandboxExecutionId, attempt });

  await runHarvestPipeline(ctx, input.outputSchemaRef, input.policyArtefactLimits);
}

// ---------------------------------------------------------------------------
// Core pipeline walker
// ---------------------------------------------------------------------------

async function runHarvestPipeline(
  ctx: HarvestContext,
  outputSchemaRef: string,
  policyArtefactLimits?: { perArtefactBytes: number; totalBytes: number },
): Promise<SandboxRunTaskOutput> {
  const stepResults: HarvestStepResult[] = [];
  let harvestStepReached = 1;

  // --- Step 1: Terminal classification ---
  const step1 = await step1TerminalClassification(ctx);
  stepResults.push(step1.result);

  if (!step1.result.ok) {
    const terminalState = classifyHarvestOutcome(stepResults);
    await step11TelemetryTerminalEvent(ctx, terminalState, harvestStepReached, null, 0);
    await step12StatusUpdate(ctx, terminalState, null, [], null, 0);
    return buildOutput(ctx, terminalState, null, [], { stdout: `${ctx.sandboxExecutionId}:stdout`, stderr: `${ctx.sandboxExecutionId}:stderr` }, 0, step1.metricsJson);
  }

  // If step1 observed the execution is already terminal (prior harvest completed), return early.
  if (step1.result.ok && step1.providerTerminalState !== 'completed' && step1.outputJson !== undefined) {
    // Row is already in a terminal state (concurrent harvest completed). Return canonical output.
    return buildOutput(
      ctx,
      step1.providerTerminalState,
      step1.outputJson,
      [],
      { stdout: `${ctx.sandboxExecutionId}:stdout`, stderr: `${ctx.sandboxExecutionId}:stderr` },
      step1.costCents,
      step1.metricsJson,
    );
  }

  // --- Step 2: Output read ---
  // Pass step1.outputJson so step 2 can short-circuit when the execution service
  // has already persisted the provider's terminal output onto the row (the
  // normal success path). The provider SDK file-read fallback remains in step 2
  // for the reconciliation path where the row may not carry pre-stored output.
  const step2 = await step2OutputRead(ctx, step1.outputJson);
  stepResults.push(step2.result);
  harvestStepReached = 2;

  if (!step2.result.ok) {
    const terminalState = classifyHarvestOutcome(stepResults);
    await step11TelemetryTerminalEvent(ctx, terminalState, harvestStepReached, step1.metricsJson, step1.costCents);
    await step12StatusUpdate(ctx, terminalState, null, [], step1.metricsJson, step1.costCents);
    return buildOutput(ctx, terminalState, null, [], { stdout: `${ctx.sandboxExecutionId}:stdout`, stderr: `${ctx.sandboxExecutionId}:stderr` }, step1.costCents, step1.metricsJson);
  }

  // --- Step 3: Output validate ---
  const step3 = await step3OutputValidate(ctx, step2.parsed, outputSchemaRef);
  stepResults.push(step3.result);
  harvestStepReached = 3;

  if (!step3.result.ok) {
    const terminalState = classifyHarvestOutcome(stepResults);
    await step11TelemetryTerminalEvent(ctx, terminalState, harvestStepReached, step1.metricsJson, step1.costCents);
    await step12StatusUpdate(ctx, terminalState, null, [], step1.metricsJson, step1.costCents);
    return buildOutput(ctx, terminalState, null, [], { stdout: `${ctx.sandboxExecutionId}:stdout`, stderr: `${ctx.sandboxExecutionId}:stderr` }, step1.costCents, step1.metricsJson);
  }

  // Emit output_validated telemetry.
  await writeTelemetryEvent(ctx, 'output_validated', 'info', {
    outputBytes: step2.bytes,
    redactedFieldCount: 0,
  });

  // --- Step 4: Output redact ---
  const step4 = step4OutputRedact(ctx, step3.validated);
  stepResults.push(step4.result);
  // Step 4 cannot fail in V1 (redactValue is total).

  // --- Step 5: Log read ---
  const step5 = await step5LogRead(ctx);
  stepResults.push(step5.result);
  harvestStepReached = 5;

  if (!step5.result.ok) {
    const terminalState = classifyHarvestOutcome(stepResults);
    await step11TelemetryTerminalEvent(ctx, terminalState, harvestStepReached, step1.metricsJson, step1.costCents);
    await step12StatusUpdate(ctx, terminalState, step4.redacted, [], step1.metricsJson, step1.costCents);
    return buildOutput(ctx, terminalState, step4.redacted, [], { stdout: `${ctx.sandboxExecutionId}:stdout`, stderr: `${ctx.sandboxExecutionId}:stderr` }, step1.costCents, step1.metricsJson);
  }

  // --- Step 6: Artefact enumeration ---
  const step6 = await step6ArtefactEnumeration(
    ctx,
    policyArtefactLimits?.perArtefactBytes ?? MAX_PER_ARTEFACT_BYTES,
    policyArtefactLimits?.totalBytes ?? MAX_TOTAL_ARTEFACT_BYTES,
  );
  stepResults.push(step6.result);
  harvestStepReached = 6;

  if (!step6.result.ok) {
    const terminalState = classifyHarvestOutcome(stepResults);
    await step11TelemetryTerminalEvent(ctx, terminalState, harvestStepReached, step1.metricsJson, step1.costCents);
    await step12StatusUpdate(ctx, terminalState, step4.redacted, [], step1.metricsJson, step1.costCents);
    return buildOutput(ctx, terminalState, step4.redacted, [], { stdout: `${ctx.sandboxExecutionId}:stdout`, stderr: `${ctx.sandboxExecutionId}:stderr` }, step1.costCents, step1.metricsJson);
  }

  // --- Step 7: Artefact metadata redact ---
  const step7 = step7ArtefactMetadataRedact(ctx, step6.artefacts);
  stepResults.push(step7.result);

  // --- Step 8: Object storage upload ---
  const step8 = await step8ObjectStorageUpload(ctx, step7.artefacts);
  stepResults.push(step8.result);
  harvestStepReached = 8;

  if (!step8.result.ok) {
    const terminalState = classifyHarvestOutcome(stepResults);
    await step11TelemetryTerminalEvent(ctx, terminalState, harvestStepReached, step1.metricsJson, step1.costCents);
    await step12StatusUpdate(ctx, terminalState, step4.redacted, [], step1.metricsJson, step1.costCents);
    return buildOutput(ctx, terminalState, step4.redacted, [], { stdout: `${ctx.sandboxExecutionId}:stdout`, stderr: `${ctx.sandboxExecutionId}:stderr` }, step1.costCents, step1.metricsJson);
  }

  // --- Step 9: Log persistence ---
  const step9 = await step9LogPersistence(ctx, step5.stdout, step5.stderr);
  stepResults.push(step9.result);
  harvestStepReached = 9;

  if (!step9.result.ok) {
    const terminalState = classifyHarvestOutcome(stepResults);
    await step11TelemetryTerminalEvent(ctx, terminalState, harvestStepReached, step1.metricsJson, step1.costCents);
    await step12StatusUpdate(ctx, terminalState, step4.redacted, step8.refs, step1.metricsJson, step1.costCents);
    return buildOutput(ctx, terminalState, step4.redacted, step8.refs, { stdout: step9.stdoutRef, stderr: step9.stderrRef }, step1.costCents, step1.metricsJson);
  }

  // --- Step 10: Cost row write ---
  const step10 = await step10CostRowWrite(ctx, step1.metricsJson, step1.costCents);
  stepResults.push(step10.result);
  harvestStepReached = 10;

  if (!step10.result.ok) {
    const terminalState = classifyHarvestOutcome(stepResults);
    await step11TelemetryTerminalEvent(ctx, terminalState, harvestStepReached, step1.metricsJson, step10.costCents);
    await step12StatusUpdate(ctx, terminalState, step4.redacted, step8.refs, step1.metricsJson, step10.costCents);
    return buildOutput(ctx, terminalState, step4.redacted, step8.refs, { stdout: step9.stdoutRef, stderr: step9.stderrRef }, step10.costCents, step1.metricsJson);
  }

  const finalCostCents = step10.costCents;

  // Per-task cost alarm (iee-browser only, fire-and-forget — spec §15A).
  if (ctx.templateName === 'iee-browser') {
    void fireTaskCostAlarmIfBreached(ctx, step10.costCents);
  }

  // --- Step 11: Telemetry terminal event ---
  const step11result = await step11TelemetryTerminalEvent(
    ctx,
    'completed',
    harvestStepReached + 1,
    step1.metricsJson,
    finalCostCents,
  );
  stepResults.push(step11result);

  if (!step11result.ok) {
    const terminalState = classifyHarvestOutcome(stepResults);
    await step12StatusUpdate(ctx, terminalState, step4.redacted, step8.refs, step1.metricsJson, finalCostCents);
    return buildOutput(ctx, terminalState, step4.redacted, step8.refs, { stdout: step9.stdoutRef, stderr: step9.stderrRef }, finalCostCents, step1.metricsJson);
  }

  // --- Step 12: sandbox_executions row update ---
  const step12result = await step12StatusUpdate(
    ctx,
    'completed',
    step4.redacted,
    step8.refs,
    step1.metricsJson,
    finalCostCents,
  );
  stepResults.push(step12result);

  if (!step12result.ok) {
    const terminalState = classifyHarvestOutcome(stepResults);
    return buildOutput(ctx, terminalState, step4.redacted, step8.refs, { stdout: step9.stdoutRef, stderr: step9.stderrRef }, finalCostCents, step1.metricsJson);
  }

  logger.info('sandbox.harvest.completed', { sandboxExecutionId: ctx.sandboxExecutionId });

  return buildOutput(
    ctx,
    'completed',
    step4.redacted,
    step8.refs,
    { stdout: step9.stdoutRef, stderr: step9.stderrRef },
    finalCostCents,
    step1.metricsJson,
  );
}

// ---------------------------------------------------------------------------
// Per-task cost alarm helper (iee-browser only, spec §15A)
// ---------------------------------------------------------------------------

async function fireTaskCostAlarmIfBreached(
  ctx: HarvestContext,
  costCents: number,
): Promise<void> {
  try {
    const settings = await subaccountIeeBrowserSettingsService.getSettings(
      ctx.organisationId,
      ctx.subaccountId,
    );
    const result = evaluateTaskCost(
      { agentRunId: ctx.runId, ieeRunId: ctx.taskId, subaccountId: ctx.subaccountId, costCents },
      { perTaskCostCeilingCents: settings.perTaskCostCeilingCents },
    );
    if (result.fire) {
      const idempotencyKey = `${IEE_BROWSER_EVENT_TASK_COST_ANOMALY}:${ctx.runId}`;
      void recordIncident({
        source: 'job',
        summary: `iee_browser task cost anomaly: subaccount=${ctx.subaccountId} costCents=${costCents} ceiling=${result.payload.ceilingCents}`,
        errorCode: IEE_BROWSER_EVENT_TASK_COST_ANOMALY,
        idempotencyKey,
        errorDetail: result.payload as unknown as Record<string, unknown>,
        subaccountId: ctx.subaccountId,
        organisationId: ctx.organisationId,
      });
    }
  } catch (err) {
    // Advisory alarm — do not fail harvest on alarm error.
    logger.warn('iee_browser.task_cost_alarm_failed', {
      sandboxExecutionId: ctx.sandboxExecutionId,
      error: (err as Error).message,
    });
  }
}

// ---------------------------------------------------------------------------
// Output builder
// ---------------------------------------------------------------------------

function buildOutput(
  ctx: HarvestContext,
  terminalState: SandboxTerminalState,
  output: unknown | null,
  artefactRefs: Array<{ filename: string; objectKey: string; bytes: number; contentHash: string }>,
  logRefs: { stdout: string; stderr: string },
  costCents: number,
  metricsJson: unknown,
): SandboxRunTaskOutput {
  const metrics = (metricsJson as {
    wallClockMs?: number;
    vcpuSeconds?: number;
    peakMemoryMb?: number;
    egressBytes?: number;
  } | null) ?? {};

  return {
    sandboxExecutionId: ctx.sandboxExecutionId,
    terminalState,
    output: terminalState === 'completed' ? output : null,
    artefactRefs: artefactRefs.map((r) => ({
      filename: r.filename,
      objectKey: r.objectKey,
      bytes: r.bytes,
      contentHash: r.contentHash,
    })),
    logRefs,
    metrics: {
      wallClockMs: metrics.wallClockMs ?? 0,
      vcpuSeconds: metrics.vcpuSeconds ?? 0,
      peakMemoryMb: metrics.peakMemoryMb ?? 0,
      egressBytes: metrics.egressBytes ?? 0,
    },
    costCents,
    templateName: ctx.templateName,
    templateVersion: ctx.templateVersion,
    provider: ctx.provider as import('../../shared/types/sandbox.js').SandboxProviderName,
  };
}


