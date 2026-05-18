// server/services/validatorAuditService.ts
// Best-effort audit ledger writes for validator invocations.
// Enforces an 8 KB hard-stop on evidence_json; writes a redacted-placeholder
// row when the limit is exceeded. Write failures are logged and swallowed —
// the verdict ledger is source of truth; this ledger is secondary.
// Deterministic-validators spec §5.3, §9.1-9.6, §11 Step 5.

import { logger } from '../lib/logger.js';
import { getTraceContext } from '../instrumentation.js';
import type { DB, OrgScopedTx } from '../db/index.js';
import type { NewValidatorInvocation } from '../db/schema/validatorInvocations.js';

/**
 * Add OTel/Langfuse span attributes for a validator invocation.
 * No-ops silently when no trace is active (spec §9.5).
 */
export function addValidatorSpanAttributes(attrs: {
  slug: string;
  version: string;
  latencyMs: number;
  evaluationMethod: string;
}): void {
  try {
    const ctx = getTraceContext();
    if (!ctx) return;
    ctx.trace.update({
      metadata: {
        'synthetos.validator.slug': attrs.slug,
        'synthetos.validator.version': attrs.version,
        'synthetos.validator.latency_ms': attrs.latencyMs,
        'synthetos.validator.evaluation_method': attrs.evaluationMethod,
      },
    });
  } catch {
    // Best-effort observability — never fail the caller.
  }
}

const EVIDENCE_HARD_STOP_BYTES = 8192;

function measureEvidenceBytes(evidence: unknown): number {
  return Buffer.byteLength(JSON.stringify(evidence ?? null), 'utf8');
}

function redactedPlaceholder(original: NewValidatorInvocation, originalSize: number): NewValidatorInvocation {
  return {
    ...original,
    evidenceJson: { _hardStop: true, originalSize },
  };
}

/**
 * Write validator invocation audit rows.
 * - Enforces 8 KB hard-stop on evidence_json: oversized rows are replaced with
 *   a redacted placeholder `{ _hardStop: true, originalSize: <bytes> }`.
 * - Adds OTel/Langfuse trace context attributes when a trace is active.
 * - On write failure: logs at error level and swallows. Never fails the caller.
 */
export async function writeInvocations(
  invocations: NewValidatorInvocation[],
  db: DB | OrgScopedTx,
): Promise<void> {
  if (invocations.length === 0) return;

  const { validatorInvocations } = await import('../db/schema/validatorInvocations.js');

  const traceCtx = getTraceContext();
  const traceId = traceCtx?.trace.id ?? null;

  const rows = invocations.map((inv) => {
    const evidence = inv.evidenceJson;
    const size = evidence !== undefined && evidence !== null ? measureEvidenceBytes(evidence) : 0;
    let row = inv;

    if (size > EVIDENCE_HARD_STOP_BYTES) {
      logger.warn('validator_audit.evidence_hard_stop', {
        validatorSlug: inv.validatorSlug,
        verdictId: inv.verdictId,
        originalSize: size,
        limitBytes: EVIDENCE_HARD_STOP_BYTES,
      });
      row = redactedPlaceholder(inv, size);
    }

    // Populate trace_id from the active Langfuse trace when available.
    if (traceId && !row.traceId) {
      row = { ...row, traceId };
    }

    return row;
  });

  try {
    await db.insert(validatorInvocations).values(rows);
  } catch (err) {
    logger.error('validator_audit.write_failed', {
      count: rows.length,
      error: err instanceof Error ? err.message : String(err),
    });
    // Best-effort: swallow the error so the verdict ledger is unaffected.
  }
}
