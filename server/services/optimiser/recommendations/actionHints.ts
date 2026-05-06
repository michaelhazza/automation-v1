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

export function escalationActionHint(workflowId: string): string {
  return `configuration-assistant://workflow/${workflowId}?focus=escalation`;
}

export function skillSlowActionHint(skillSlug: string, subaccountId: string): string {
  return `configuration-assistant://skill/${encodeURIComponent(skillSlug)}?focus=latency&subaccountId=${subaccountId}`;
}

export function inactiveWorkflowActionHint(workflowId: string): string {
  return `configuration-assistant://workflow/${workflowId}?focus=schedule`;
}

export function phraseActionHint(subaccountId: string): string {
  return `configuration-assistant://subaccount/${subaccountId}?focus=escalation_phrases`;
}

export function memoryCitationActionHint(agentId: string): string {
  return `configuration-assistant://agent/${agentId}?focus=memory`;
}

export function routingActionHint(agentId: string): string {
  return `configuration-assistant://agent/${agentId}?focus=routing`;
}

export function cacheActionHint(agentId: string): string {
  return `configuration-assistant://agent/${agentId}?focus=llm_cache`;
}
