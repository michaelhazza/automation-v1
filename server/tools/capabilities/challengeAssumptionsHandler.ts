import type { SkillExecutionContext } from '../../services/skillExecutor.js';
import type { ChallengeAssumptionsPayload } from '../../../shared/types/briefSkills.js';
import type { BriefApprovalCard } from '../../../shared/types/briefResultContract.js';
import { routeCall } from '../../services/llmRouter.js';
import { ParseFailureError } from '../../lib/parseFailureError.js';
import {
  assembleChallengeAssumptionsPrompt,
  parseChallengeAssumptionsOutput,
} from './challengeAssumptionsHandlerPure.js';

export interface ChallengeAssumptionsArgs {
  briefId: string;
  approvalCard: BriefApprovalCard;
  runtimeConfidence: number;
  stakesDimensions: Array<'irreversibility' | 'cost' | 'scope' | 'compliance'>;
}

/**
 * challenge_assumptions skill handler.
 * When an approval card crosses cost / irreversibility / scope thresholds,
 * runs an adversarial analysis identifying weakest assumptions.
 * Tone: trusted colleague, never pedantic.
 */
export async function executeChallengeAssumptions(
  ctx: SkillExecutionContext,
  args: ChallengeAssumptionsArgs,
): Promise<ChallengeAssumptionsPayload> {
  const { approvalCard } = args;

  const prompt = assembleChallengeAssumptionsPrompt({
    briefText: approvalCard.summary,
    actionSummary: `Action: ${approvalCard.actionSlug}. Affects ${approvalCard.affectedRecordIds.length} records.`,
    runtimeConfidence: args.runtimeConfidence,
    stakesDimensions: args.stakesDimensions,
  });

  const response = await routeCall({
    messages: [{ role: 'user', content: `Review proposed action: "${approvalCard.summary}"` }],
    system: prompt,
    maxTokens: 1024,
    context: {
      sourceType: 'system',
      taskType: 'review',
      featureTag: 'challenge-assumptions',
      organisationId: ctx.organisationId,
      subaccountId: ctx.subaccountId ?? undefined,
    },
    postProcess: (content: string) => {
      try {
        parseChallengeAssumptionsOutput(content);
      } catch (err) {
        throw new ParseFailureError({ rawExcerpt: content.slice(0, 512) });
      }
    },
  });

  return parseChallengeAssumptionsOutput(response.content);
}
