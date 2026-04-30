export type TaskStatus = 'pending' | 'in_progress' | 'done';

export interface ThreadContextDecision {
  id: string;
  decision: string;    // ≤ 500 chars
  rationale: string;   // ≤ 1500 chars
  addedAt: string;     // ISO
}

export interface ThreadContextTask {
  id: string;
  label: string;       // ≤ 200 chars
  status: TaskStatus;
  addedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ThreadContextPatch {
  decisions?: {
    add?: Array<{ clientRefId?: string; decision: string; rationale: string }>;
    remove?: string[];
  };
  tasks?: {
    add?: Array<{ clientRefId?: string; label: string }>;
    updateStatus?: Array<{ id: string; status: TaskStatus }>;
    remove?: string[];
  };
  approach?: { replace?: string; appendNote?: string };
}

export interface ThreadContextPatchResult {
  version: number;
  createdIds: Record<string, string>;  // clientRefId → server ID
  readModel: ThreadContextReadModel;
}

export interface ThreadContextReadModel {
  decisions: string[];
  approach: string;
  openTasks: string[];
  completedTasks: string[];
  version: number;
  updatedAt: string;
  // Keep full task/decision objects for the UI panel
  rawTasks?: ThreadContextTask[];
  rawDecisions?: ThreadContextDecision[];
}
