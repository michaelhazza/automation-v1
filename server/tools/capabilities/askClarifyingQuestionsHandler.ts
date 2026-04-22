import type { SkillExecutionContext } from '../../services/skillExecutor.js';
import type { ClarifyingQuestionsPayload } from '../../../shared/types/briefSkills.js';
import { routeCall } from '../../services/llmRouter.js';
import { ParseFailureError } from '../../lib/parseFailureError.js';
import {
  assembleClarifyingQuestionsPrompt,
  parseClarifyingQuestionsOutput,
} from './askClarifyingQuestionsHandlerPure.js';

export interface AskClarifyingQuestionsArgs {
  briefId: string;
  briefText: string;
  conversationContext?: Array<{ role: 'user' | 'assistant'; content: string }>;
  orchestratorConfidence: number;
  ambiguityDimensions: Array<'scope' | 'target' | 'action' | 'timing' | 'content' | 'other'>;
}

/**
 * ask_clarifying_questions skill handler.
 * When Orchestrator confidence is < 0.85, drafts ≤5 ranked questions to resolve ambiguity.
 * Single LLM call via llmRouter. Budget-bounded per-invocation.
 */
export async function executeAskClarifyingQuestions(
  ctx: SkillExecutionContext,
  args: AskClarifyingQuestionsArgs,
): Promise<ClarifyingQuestionsPayload> {
  const prompt = assembleClarifyingQuestionsPrompt({
    briefText: args.briefText,
    orchestratorConfidence: args.orchestratorConfidence,
    ambiguityDimensions: args.ambiguityDimensions,
    conversationContext: args.conversationContext,
  });

  const response = await routeCall({
    messages: [{ role: 'user', content: `Generate clarifying questions for: "${args.briefText}"` }],
    system: prompt,
    maxTokens: 1024,
    context: {
      sourceType: 'system',
      taskType: 'general',
      featureTag: 'ask-clarifying-questions',
      organisationId: ctx.organisationId,
      subaccountId: ctx.subaccountId ?? undefined,
    },
    postProcess: (content: string) => {
      try {
        parseClarifyingQuestionsOutput(content);
      } catch (err) {
        throw new ParseFailureError({ rawExcerpt: content.slice(0, 512) });
      }
    },
  });

  return parseClarifyingQuestionsOutput(response.content);
}
