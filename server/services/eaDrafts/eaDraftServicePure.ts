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

// ---------------------------------------------------------------------------
// Admin redaction (spec §21.2): admins see EA draft row metadata but never
// the body. Owner sees full body. Non-owner non-admin sees nothing (RLS
// already filters; this is the field-level defence-in-depth at the API
// serialisation layer).
// ---------------------------------------------------------------------------

export interface EADraftViewer {
  userId: string;
  /** Role of the viewer — admins see metadata only, body redacted. */
  role: 'system_admin' | 'org_admin' | 'subaccount_admin' | 'user' | string;
}

export interface EADraftLike {
  ownerUserId: string | null;
  body: Record<string, unknown>;
  [key: string]: unknown;
}

const ADMIN_ROLES = new Set(['system_admin', 'org_admin', 'subaccount_admin']);

/**
 * Returns true when the viewer is the owner of the draft. Owners see the
 * full body; everyone else (admins included) sees redacted output.
 */
export function isDraftOwner(viewer: EADraftViewer, draft: EADraftLike): boolean {
  return draft.ownerUserId !== null && draft.ownerUserId === viewer.userId;
}

/**
 * Field-level redaction: returns the draft with `body` set to null when the
 * viewer is NOT the owner. The non-owner branch covers the admin case
 * explicitly — RLS allows admins to see the row, but we strip body content
 * at serialisation time per the §21.2 / §3.6 admin-redaction policy.
 *
 * Caller must have already verified RLS visibility (i.e. the row WAS
 * returned from the DB). This helper does NOT filter rows; it only
 * redacts fields on a row the viewer is allowed to see at the row level.
 */
export function redactDraftForViewer<T extends EADraftLike>(
  draft: T,
  viewer: EADraftViewer,
): T & { bodyRedacted: boolean } {
  const isOwner = isDraftOwner(viewer, draft);
  const isAdmin = ADMIN_ROLES.has(viewer.role);

  if (isOwner) {
    return { ...draft, bodyRedacted: false };
  }

  // Non-owner: either an admin who sees metadata only, or a non-admin
  // who should not see this row at all. We never return an unredacted body
  // to anyone but the owner.
  if (isAdmin) {
    return { ...draft, body: {} as Record<string, unknown>, bodyRedacted: true };
  }

  // Non-owner non-admin reached here — RLS should have filtered. Treat as
  // fully redacted to fail closed.
  return { ...draft, body: {} as Record<string, unknown>, bodyRedacted: true };
}
