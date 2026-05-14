export type ConversationFollowUpAction = 'brief_followup' | 'noop';

export function selectConversationFollowUpAction(
  conv: { scopeType: string | null | undefined } | null | undefined,
): ConversationFollowUpAction {
  if (!conv || conv.scopeType !== 'brief') return 'noop';
  return 'brief_followup';
}

// DR2 response-shape contract — both `route` and `fastPathDecision` keys are
// always present in the conversation-message POST response. Brief branch:
// populated. Noop branch: literal null (never undefined, never omitted).
export type ConversationFollowUpResponseExtras =
  | { route: null; fastPathDecision: null }
  | { route: string; fastPathDecision: { route: string; [k: string]: unknown } };

export function buildConversationFollowUpResponseExtras(
  briefResult: { route: string; fastPathDecision: { route: string; [k: string]: unknown } } | null,
): ConversationFollowUpResponseExtras {
  if (briefResult === null) return { route: null, fastPathDecision: null };
  return { route: briefResult.route, fastPathDecision: briefResult.fastPathDecision };
}
