export type FastPathRoute =
  | 'simple_reply'       // direct canned answer; no Orchestrator LLM call
  | 'needs_clarification' // Orchestrator masterPrompt invokes ask_clarifying_questions skill
  | 'needs_orchestrator'  // full Path A/B/C/D routing
  | 'cheap_answer';      // bounded direct answer (e.g. pipeline velocity → canned query)

export type BriefScope = 'subaccount' | 'org' | 'system';

export interface BriefUiContext {
  surface: 'global_ask_bar' | 'brief_chat' | 'task_chat' | 'agent_chat' | 'agent_run_chat';
  currentSubaccountId?: string;
  currentOrgId: string;
  userPermissions: Set<string>;
}

export interface FastPathDecision {
  route: FastPathRoute;
  scope: BriefScope;
  confidence: number;
  tier: 1 | 2;
  secondLookTriggered: boolean;
  keywords?: string[];
  reasoning?: string;
}
