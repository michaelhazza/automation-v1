import type { SkillExecutionContext, SkillHandler } from '../context.js';

export const capabilityDiscoveryHandlers: Record<string, SkillHandler> = {
  list_platform_capabilities: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { executeListPlatformCapabilities } = await import('../../../tools/capabilities/capabilityDiscoveryHandlers.js');
    return executeListPlatformCapabilities(input, context);
  },

  list_connections: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { executeListConnections } = await import('../../../tools/capabilities/capabilityDiscoveryHandlers.js');
    return executeListConnections(input, context);
  },

  check_capability_gap: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { executeCheckCapabilityGap } = await import('../../../tools/capabilities/capabilityDiscoveryHandlers.js');
    return executeCheckCapabilityGap(input, context);
  },

  request_feature: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { executeRequestFeature } = await import('../../../tools/capabilities/requestFeatureHandler.js');
    return executeRequestFeature(input, context);
  },

  ask_clarifying_questions: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { executeAskClarifyingQuestions } = await import('../../../tools/capabilities/askClarifyingQuestionsHandler.js');
    return executeAskClarifyingQuestions(
      context,
      input as unknown as Parameters<typeof executeAskClarifyingQuestions>[1],
    );
  },

  challenge_assumptions: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { executeChallengeAssumptions } = await import('../../../tools/capabilities/challengeAssumptionsHandler.js');
    return executeChallengeAssumptions(
      context,
      input as unknown as Parameters<typeof executeChallengeAssumptions>[1],
    );
  },

  ask_clarifying_question: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { executeAskClarifyingQuestion } = await import('../../../tools/internal/askClarifyingQuestion.js');
    return executeAskClarifyingQuestion(input, {
      runId: context.runId,
      organisationId: context.organisationId,
      subaccountId: context.subaccountId ?? undefined,
    });
  },

  request_clarification: async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const { executeRequestClarification } = await import('../../../tools/internal/requestClarification.js');
    return executeRequestClarification(input, {
      runId: context.runId,
      organisationId: context.organisationId,
      subaccountId: context.subaccountId ?? null,
      agentId: context.agentId,
      stepId: (context as { stepId?: string | null }).stepId ?? null,
    });
  },
};
