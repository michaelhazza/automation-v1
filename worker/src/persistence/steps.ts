// ---------------------------------------------------------------------------
// iee_steps persistence — append-only writes during the loop. Spec §2.1.2.
// ---------------------------------------------------------------------------

import { db } from '../db.js';
import { ieeSteps } from '../../../server/db/schema/ieeSteps.js';
import type { FailureReason } from '../../../shared/iee/failureReason.js';

export interface RecordStepInput {
  ieeRunId: string;
  organisationId: string;
  stepNumber: number;
  actionType: string;
  input: unknown;
  output: unknown;
  success: boolean;
  failureReason?: FailureReason | null;
  durationMs: number;
}

export async function recordStep(input: RecordStepInput): Promise<void> {
  await db
    .insert(ieeSteps)
    .values({
      ieeRunId:       input.ieeRunId,
      organisationId: input.organisationId,
      stepNumber:     input.stepNumber,
      actionType:     input.actionType,
      input:          input.input as object,
      output:         input.output as object,
      success:        input.success,
      failureReason:  input.failureReason ?? undefined,
      durationMs:     input.durationMs,
    })
    .onConflictDoNothing();
}
