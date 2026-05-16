import type { LinkedEntityType } from './agentExecutionLog';

export interface AgentExecutionLogEdit {
  id: string;
  entityType: LinkedEntityType;
  entityId: string;
  editedAt: string;             // ISO timestamp
  editedByUserId: string;
  editSummary: string;
}
