import { logger } from '../lib/logger.js';
import {
  validateArtefactPure,
  validateLifecycleChainPure,
  type ValidationError,
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

export { validateArtefactPure, validateLifecycleChainPure };
export type { ValidationError };
