import type { BaselineStatus } from '../db/schema/subaccountBaselines.js';

export const TERMINAL_STATUSES: ReadonlySet<BaselineStatus> = new Set(['captured', 'failed', 'reset']);
export const RUNNABLE_STATUSES: ReadonlySet<BaselineStatus> = new Set(['pending', 'ready']);

/** Allowed status transitions per spec §5.1. */
const ALLOWED_TRANSITIONS: Record<BaselineStatus, ReadonlySet<BaselineStatus>> = {
  pending:   new Set(['capturing', 'reset']),
  ready:     new Set(['capturing', 'reset']),
  capturing: new Set(['captured', 'ready', 'failed', 'manual']),
  captured:  new Set(['reset', 'manual']),
  failed:    new Set(['manual', 'reset']),
  manual:    new Set(['reset']),
  reset:     new Set(),
};

export function canTransition(from: BaselineStatus, to: BaselineStatus): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function isTerminal(status: BaselineStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isRunnable(status: BaselineStatus): boolean {
  return RUNNABLE_STATUSES.has(status);
}
