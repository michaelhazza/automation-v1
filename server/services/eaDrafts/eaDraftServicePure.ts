import type { EADraftSendState } from '../../../shared/types/eaDraft.js';

const LEGAL_SEND_TRANSITIONS: Record<EADraftSendState, EADraftSendState[]> = {
  idle: ['sending'],
  sending: ['sent', 'send_failed', 'idle'],
  sent: [],
  send_failed: ['sending'],
};

export function canTransition(from: EADraftSendState, to: EADraftSendState): boolean {
  return LEGAL_SEND_TRANSITIONS[from]?.includes(to) ?? false;
}

export function computeExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
}
