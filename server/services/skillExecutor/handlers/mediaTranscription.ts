import type { SkillHandler } from '../context.js';

export const mediaTranscriptionHandlers: Record<string, SkillHandler> = {
  transcribe_audio: async (input, context) => {
    const { transcribeAudio } = await import('../../transcribeAudioService.js');
    return transcribeAudio(
      input as Parameters<typeof transcribeAudio>[0],
      {
        runId: context.runId,
        organisationId: context.organisationId,
        subaccountId: context.subaccountId,
        agentId: context.agentId,
        correlationId: (context as { correlationId?: string }).correlationId ?? context.runId,
      },
    );
  },
  fetch_paywalled_content: async (input, context) => {
    const { fetchPaywalledContent } = await import('../../fetchPaywalledContentService.js');
    return fetchPaywalledContent(
      input as unknown as Parameters<typeof fetchPaywalledContent>[0],
      {
        runId: context.runId,
        organisationId: context.organisationId,
        subaccountId: context.subaccountId,
        agentId: context.agentId,
        correlationId: (context as { correlationId?: string }).correlationId ?? context.runId,
      },
    );
  },
  send_to_slack: async (input, context) => {
    const { sendToSlack } = await import('../../sendToSlackService.js');
    return sendToSlack(
      input as unknown as Parameters<typeof sendToSlack>[0],
      {
        runId: context.runId,
        organisationId: context.organisationId,
        subaccountId: context.subaccountId,
        agentId: context.agentId,
        correlationId: (context as { correlationId?: string }).correlationId ?? context.runId,
      },
    );
  },
};
