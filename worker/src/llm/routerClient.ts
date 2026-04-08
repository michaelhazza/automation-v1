// ---------------------------------------------------------------------------
// Worker LLM router client. Spec §5.5, §11.7.1, §13.1.
//
// Imports the existing routeCall() from server/services/llmRouter.ts and
// always sets:
//   sourceType:    'iee'
//   callSite:      'worker'
//   ieeRunId:      <required by router guard>
//   executionPhase: 'iee_loop_step'
//
// Cost tracking, model selection, fallback chain, Langfuse generation
// creation, and the llm_requests row write are all delegated to the existing
// router. We add NO new LLM abstraction.
// ---------------------------------------------------------------------------

import { routeCall } from '../../../server/services/llmRouter.js';

export interface RouterCallInput {
  systemPrompt: string;
  userMessage: string;
  organisationId: string;
  subaccountId: string | null;
  agentRunId: string | null;
  ieeRunId: string;
  correlationId: string;
}

export async function callRouter(input: RouterCallInput): Promise<string> {
  const response = await routeCall({
    messages: [{ role: 'user', content: input.userMessage }],
    system: input.systemPrompt,
    maxTokens: 2048,
    temperature: 0.2,
    context: {
      organisationId: input.organisationId,
      subaccountId:   input.subaccountId ?? undefined,
      runId:          input.agentRunId ?? undefined,
      sourceType:     'iee',
      taskType:       'general',
      executionPhase: 'iee_loop_step',
      routingMode:    'ceiling',
      callSite:       'worker',
      ieeRunId:       input.ieeRunId,
    },
  });

  // Provider responses use { content, ... }; coerce to string
  if (typeof response.content === 'string') return response.content;
  if (Array.isArray(response.content)) {
    // Some providers return content blocks
    return (response.content as Array<{ type?: string; text?: string }>)
      .filter(b => b && b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text as string)
      .join('\n');
  }
  return String(response.content ?? '');
}
