// Shared types for the Learned Rules system (Universal Brief Phase 5 / W3a).
// Spec: docs/universal-brief-dev-spec.md §4.6, §4.7

export type RuleScope =
  | { kind: 'subaccount'; subaccountId: string }
  | { kind: 'agent'; agentId: string }
  | { kind: 'org' };

export interface RuleCaptureRequest {
  text: string;
  scope: RuleScope;
  context?: string;
  originatingArtefactId?: string;
  originatingBriefId?: string;
  priority?: 'low' | 'medium' | 'high';
  isAuthoritative?: boolean;
  // Optional [0..1] confidence score carried forward from the producing source
  // (LLM-drafted suggestion, heuristic, etc.). Used by the auto-pause policy
  // to keep low-confidence rules out of the active decision path until a human
  // reviews them. Absent for pure user-triggered captures.
  confidence?: number;
}

export interface SaveRuleResult {
  ruleId: string;
  conflicts: RuleConflictReport;
  saved: boolean;
}

export interface RuleConflict {
  existingRuleId: string;
  existingText: string;
  existingScope: RuleScope;
  conflictKind: 'direct_contradiction' | 'scope_overlap' | 'subset' | 'superset';
  confidence: number;
  suggestedResolution: 'keep_new' | 'keep_existing' | 'keep_both_with_priorities' | 'user_decides';
}

export interface RuleConflictReport {
  conflicts: RuleConflict[];
  checkedAt: string;
}

export type RuleDerivedStatus = 'active' | 'paused' | 'deprecated';

export interface RuleRow {
  id: string;
  organisationId: string;
  subaccountId: string | null;
  ownerAgentId: string | null;
  text: string;
  scope: RuleScope;
  priority: 'low' | 'medium' | 'high';
  isAuthoritative: boolean;
  capturedVia: 'manual_edit' | 'auto_synthesised' | 'user_triggered' | 'approval_suggestion';
  status: RuleDerivedStatus;
  qualityScore: number;
  context: string | null;
  originatingArtefactId: string | null;
  originatingBriefId: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RuleListFilter {
  scopeType?: 'subaccount' | 'agent' | 'org';
  scopeId?: string;
  status?: RuleDerivedStatus;
  createdByUserId?: string;
  limit?: number;
  cursor?: string;
}

export interface RuleListResult {
  rules: RuleRow[];
  totalCount: number;
  cursor?: string;
}

export interface RulePatch {
  text?: string;
  priority?: 'low' | 'medium' | 'high';
  isAuthoritative?: boolean;
  status?: 'active' | 'paused';
}
