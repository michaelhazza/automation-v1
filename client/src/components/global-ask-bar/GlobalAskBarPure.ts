import type { BriefCreatedResponse, BriefCreationEnvelope } from '../../../../shared/types/briefFastPath.js';

/** Returns true when the text is long enough and not a slash command. */
export function isValidBriefText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= 3 && !trimmed.startsWith('/');
}

/** Detects a /remember prefix, returning the rest of the text as a rule candidate. */
export function parseSlashRemember(text: string): { isRemember: boolean; ruleText: string } {
  const trimmed = text.trim();
  if (trimmed.toLowerCase().startsWith('/remember ')) {
    return { isRemember: true, ruleText: trimmed.slice('/remember '.length).trim() };
  }
  return { isRemember: false, ruleText: '' };
}

export interface ScopeCandidate {
  id: string;
  name: string;
  type: 'org' | 'subaccount';
  orgName?: string; // parent org name for subaccounts — shown in disambiguation buttons
}

export type { BriefCreationEnvelope, BriefCreatedResponse };

export type SessionMessageResponse =
  | { type: 'disambiguation'; candidates: ScopeCandidate[]; question: string; remainder: string | null }
  | { type: 'context_switch'; organisationId: string | null; organisationName: string | null; subaccountId: string | null; subaccountName: string | null }
  | BriefCreatedResponse
  | { type: 'error'; message: string };
