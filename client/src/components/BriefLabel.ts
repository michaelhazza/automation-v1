import type { BriefChatArtefact } from '../../../shared/types/briefResultContract.js';

/** Maps a task status value → user-facing Brief label. */
export function briefStatusLabel(status: string): string {
  switch (status) {
    case 'inbox': return 'New';
    case 'in_progress': return 'In Progress';
    case 'done': return 'Done';
    case 'cancelled': return 'Cancelled';
    case 'awaiting_clarification': return 'Awaiting Clarification';
    case 'awaiting_approval': return 'Awaiting Approval';
    case 'closed_with_answer': return 'Closed with Answer';
    case 'closed_with_action': return 'Closed with Action';
    case 'closed_no_action': return 'Closed (No Action)';
    default: return status;
  }
}

/** Returns a short label for the Brief artefact kind. */
export function briefArtefactKindLabel(kind: BriefChatArtefact['kind']): string {
  switch (kind) {
    case 'structured': return 'Result';
    case 'approval': return 'Action Required';
    case 'error': return 'Error';
    default: return kind;
  }
}

/** Maps a task record to its Brief-facing display title. Prefers title; falls back to 'Brief'. */
export function briefTitle(title?: string | null): string {
  return title?.trim() || 'Task';
}
