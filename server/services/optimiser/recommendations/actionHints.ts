// ---------------------------------------------------------------------------
// Deep-link action hints per spec §6.5.
//
// Format: configuration-assistant://<entity>/<id>?<params>
//
// Pure URL builders — no I/O, no side effects.
// ---------------------------------------------------------------------------

export function budgetActionHint(agentId: string): string {
  return `configuration-assistant://agent/${agentId}?focus=budget`;
}

export function escalationActionHint(workflowId: string, stepId?: string | null): string {
  const step = stepId ? `&step=${encodeURIComponent(stepId)}` : '';
  return `configuration-assistant://workflow/${workflowId}?focus=escalation-step${step}`;
}

export function skillSlowActionHint(skillSlug: string, subaccountId: string): string {
  return `configuration-assistant://skill/${encodeURIComponent(skillSlug)}?focus=latency&subaccountId=${subaccountId}`;
}

export function inactiveWorkflowActionHint(subaccountAgentId: string): string {
  return `configuration-assistant://subaccount-agent/${subaccountAgentId}?focus=schedule`;
}

export function phraseActionHint(subaccountId: string, phrase: string): string {
  return `configuration-assistant://brand-voice/${subaccountId}?phrase=${encodeURIComponent(phrase)}`;
}

export function memoryCitationActionHint(agentId: string): string {
  return `configuration-assistant://agent/${agentId}?focus=memory-cleanup`;
}

export function routingActionHint(agentId: string): string {
  return `configuration-assistant://agent/${agentId}?focus=routing`;
}

export function cacheActionHint(agentId: string): string {
  return `configuration-assistant://agent/${agentId}?focus=cache-prefix`;
}
