import { logger } from '../lib/logger.js';
import { db } from '../db/index.js';
import { conversationMessages } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';
import {
  validateArtefactPure,
  validateLifecycleChainPure,
  validateLifecycleWriteGuardPure,
  type ValidationError,
  type ValidateWriteGuardResult,
} from './briefArtefactValidatorPure.js';
import type { BriefChatArtefact, BriefErrorResult } from '../../shared/types/briefResultContract.js';
import { randomUUID } from 'crypto';

export interface ValidateArtefactOptions {
  capabilityName: string;
  briefId?: string;
  runId?: string;
}

export type ValidateArtefactForPersistenceResult =
  | { valid: true; artefact: BriefChatArtefact }
  | { valid: false; substitute: BriefErrorResult; errors: ValidationError[] };

/**
 * Validates a raw capability output at the orchestrator boundary.
 * On failure, synthesises a substitute BriefErrorResult and logs the
 * producer error — the offending artefact is never returned to the client.
 */
export async function validateArtefactForPersistence(
  artefact: unknown,
  opts: ValidateArtefactOptions,
): Promise<ValidateArtefactForPersistenceResult> {
  const result = validateArtefactPure(artefact);

  if (result.valid) {
    return { valid: true, artefact: result.artefact };
  }

  logger.error('briefArtefactValidator.invalid', {
    capabilityName: opts.capabilityName,
    briefId: opts.briefId,
    runId: opts.runId,
    errors: result.errors,
  });

  const substitute: BriefErrorResult = {
    kind: 'error',
    artefactId: randomUUID(),
    errorCode: 'internal_error',
    severity: 'high',
    message: 'Capability produced an invalid artefact; substitute rendered.',
  };

  return { valid: false, substitute, errors: result.errors };
}

/**
 * Fetches the existing artefacts for a conversation (flattened from the
 * conversation_messages.artefacts JSONB column) and runs the pure write-time
 * supersession guard against a set of new artefacts about to be persisted.
 *
 * Scoped to one invariant: a parent artefact can only be superseded once.
 * Orphan parents are deliberately NOT enforced — the UI's resolveLifecyclePure
 * tolerates out-of-order arrival.
 */
export async function validateLifecycleChainForWrite(
  conversationId: string,
  newArtefacts: BriefChatArtefact[],
): Promise<ValidateWriteGuardResult> {
  if (newArtefacts.length === 0) {
    return { valid: true, conflicts: [] };
  }

  const anyHasParent = newArtefacts.some((a) => a.parentArtefactId !== undefined);
  if (!anyHasParent) {
    // Nothing to check — no parent references in this batch means no
    // supersession invariant is in play.
    return { valid: true, conflicts: [] };
  }

  const rows = await db
    .select({ artefacts: conversationMessages.artefacts })
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId));

  const existing: BriefChatArtefact[] = [];
  for (const row of rows) {
    const arr = row.artefacts as unknown;
    if (Array.isArray(arr)) {
      for (const a of arr) {
        existing.push(a as BriefChatArtefact);
      }
    }
  }

  return validateLifecycleWriteGuardPure(existing, newArtefacts);
}

export { validateArtefactPure, validateLifecycleChainPure, validateLifecycleWriteGuardPure };
export type { ValidationError, ValidateWriteGuardResult };
