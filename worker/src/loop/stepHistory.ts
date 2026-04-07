// ---------------------------------------------------------------------------
// Step history compression. Spec §12.9.
// The LLM only sees compact summaries of previous steps, never raw payloads.
// ---------------------------------------------------------------------------

import type { ExecutionAction } from '../../../shared/iee/actionSchema.js';

export interface CompressedStep {
  stepNumber: number;
  actionType: string;
  success: boolean;
  summary: string;
}

export function summariseStep(
  stepNumber: number,
  action: ExecutionAction,
  result: { success: boolean; summary?: string },
): CompressedStep {
  let summary: string;
  if (result.summary) {
    summary = result.summary;
  } else {
    switch (action.type) {
      case 'navigate':    summary = `navigated to ${action.url}`; break;
      case 'click':       summary = `clicked ${action.selector}`; break;
      case 'type':        summary = `typed into ${action.selector}`; break;
      case 'extract':     summary = `extracted: ${action.query}`; break;
      case 'download':    summary = `downloaded via ${action.selector}`; break;
      case 'run_command': summary = `ran command: ${action.command}`; break;
      case 'write_file':  summary = `wrote ${action.path}`; break;
      case 'read_file':   summary = `read ${action.path}`; break;
      case 'git_clone':   summary = `cloned ${action.repoUrl}`; break;
      case 'git_commit':  summary = `committed: ${action.message}`; break;
      case 'done':        summary = `done: ${action.summary}`; break;
      case 'failed':      summary = `failed: ${action.reason}`; break;
      default:            summary = '(unknown action)';
    }
  }
  if (summary.length > 200) summary = summary.slice(0, 197) + '...';
  return { stepNumber, actionType: action.type, success: result.success, summary };
}
