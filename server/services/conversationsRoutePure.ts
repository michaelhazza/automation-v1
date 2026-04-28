export type ConversationFollowUpAction = 'brief_followup' | 'noop';

export function selectConversationFollowUpAction(
  conv: { scopeType: string | null | undefined } | null | undefined,
): ConversationFollowUpAction {
  if (!conv || conv.scopeType !== 'brief') return 'noop';
  return 'brief_followup';
}
