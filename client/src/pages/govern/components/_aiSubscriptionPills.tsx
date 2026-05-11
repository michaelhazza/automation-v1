// client/src/pages/govern/components/_aiSubscriptionPills.tsx
// Shared pill/badge components for AI Subscription status and tier display.
// Extracted from AiSubscriptionsTab, AiSubscriptionDetailModal, ModelAccessSection.

import type { AiSubscriptionConnection } from '../../../../../shared/types/govern.js';

// ── Type aliases ──────────────────────────────────────────────────────────────

export type UsabilityState = AiSubscriptionConnection['usabilityState'];
export type PlanTier = AiSubscriptionConnection['planTier'];

// ── STATE_PILL ────────────────────────────────────────────────────────────────

export const STATE_PILL: Record<UsabilityState, { label: (r: AiSubscriptionConnection) => string; className: string }> = {
  connected_usable: {
    label: () => 'Connected',
    className: 'inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700',
  },
  connected_needs_consent: {
    label: () => 'Needs consent',
    className: 'inline-flex items-center gap-1 text-[10.5px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded',
  },
  connected_needs_reauth: {
    label: () => 'Needs sign in',
    className: 'inline-flex items-center gap-1 text-[10.5px] font-semibold text-amber-700 bg-yellow-50 border border-yellow-300 px-1.5 py-0.5 rounded',
  },
  connected_unverified: {
    label: () => 'Plan not verified',
    className: 'inline-flex items-center gap-1 text-[10.5px] font-semibold text-stone-600 bg-stone-50 border border-stone-300 px-1.5 py-0.5 rounded',
  },
  revoked: {
    label: () => 'Revoked',
    className: 'inline-flex items-center gap-1 text-[10.5px] font-semibold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded',
  },
  disabled: {
    label: (r) => {
      const causeMap: Record<NonNullable<AiSubscriptionConnection['disabledReason']>, string> = {
        owner_inactive: 'owner inactive',
        admin_disabled: 'admin disabled',
        permission_revoked: 'permission revoked',
      };
      const cause = r.disabledReason ? causeMap[r.disabledReason] : null;
      return cause ? `Disabled: ${cause}` : 'Disabled';
    },
    className: 'inline-flex items-center gap-1 text-[10.5px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded',
  },
};

// ── TIER_PILL ─────────────────────────────────────────────────────────────────

export const TIER_PILL: Record<PlanTier, string> = {
  pro: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  team: 'bg-blue-50 text-blue-700 border-blue-200',
  enterprise: 'bg-violet-50 text-violet-700 border-violet-200',
  plus: 'bg-amber-50 text-amber-700 border-amber-200',
  unknown: 'bg-slate-100 text-slate-500 border-slate-200',
};

// ── StatusPill ────────────────────────────────────────────────────────────────

export function StatusPill({ row }: { row: AiSubscriptionConnection }) {
  const cfg = STATE_PILL[row.usabilityState];
  if (row.usabilityState === 'connected_usable') {
    return (
      <span className={cfg.className}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
        {cfg.label(row)}
      </span>
    );
  }
  return <span className={cfg.className}>{cfg.label(row)}</span>;
}

// ── TierBadge ─────────────────────────────────────────────────────────────────

export function TierBadge({ tier }: { tier: PlanTier }) {
  return (
    <span className={`inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded border capitalize ${TIER_PILL[tier]}`}>
      {tier}
    </span>
  );
}
