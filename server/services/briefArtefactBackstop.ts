import { logger } from '../lib/logger.js';
import {
  runBackstopChecksPure,
  type BackstopPureInput,
  type BackstopPureResult,
} from './briefArtefactBackstopPure.js';
import type { BriefChatArtefact } from '../../shared/types/briefResultContract.js';
import type { PrincipalContext } from './principal/types.js';

export interface BackstopInput {
  artefact: BriefChatArtefact;
  briefContext: {
    organisationId: string;
    subaccountId?: string;
    scope: 'subaccount' | 'org' | 'system';
    userPrincipal: PrincipalContext;
  };
}

/**
 * Runs RLS-aware backstop checks on an artefact before it is persisted
 * into a Brief conversation message.
 *
 * The async wrapper is responsible for resolving idScopeCheck and scopedTotals
 * from the DB. In Phase 0, both are stubbed as undefined (no capabilities emit
 * artefacts yet). Phase 2+ progressively fills in per-entityType resolvers.
 *
 * On any violation, the orchestrator synthesises a BriefErrorResult and
 * does NOT return the offending artefact to the client (tenant leakage must
 * fail closed — see spec §6.4).
 */
export async function runBackstopChecks(input: BackstopInput): Promise<BackstopPureResult> {
  // TODO(phase-6.4-resolvers): implement per-entityType scope resolution.
  // For now, idScopeCheck and scopedTotals are undefined so checks that require
  // them are skipped. This is safe: no capability emits artefacts before Phase 2.
  const pureInput: BackstopPureInput = {
    artefact: input.artefact,
    briefContext: input.briefContext,
    idScopeCheck: undefined,
    scopedTotals: undefined,
  };

  const result = runBackstopChecksPure(pureInput);

  if (!result.passed) {
    logger.error('briefArtefactBackstop.violation', {
      artefactId: input.artefact.artefactId,
      organisationId: input.briefContext.organisationId,
      subaccountId: input.briefContext.subaccountId,
      scope: input.briefContext.scope,
      violations: result.violations,
    });
  }

  return result;
}

export { runBackstopChecksPure };
export type { BackstopPureResult };
