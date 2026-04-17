import { getActionDefinition } from '../config/actionRegistry.js';

export type PulseLane = 'client' | 'major' | 'internal';

export type MajorReason =
  | 'irreversible'
  | 'cross_subaccount'
  | 'cost_per_action'
  | 'cost_per_run';

export interface PulseItemDraft {
  kind: 'review' | 'task' | 'failed_run' | 'health_finding';
  actionType?: string;
  estimatedCostMinor: number | null;
  runTotalCostMinor: number | null;
  subaccountScope: 'single' | 'multiple';
  subaccountName: string;
}

export interface ClassifyResult {
  lane: PulseLane;
  majorReason?: MajorReason;
}

export function classify(
  draft: PulseItemDraft,
  thresholds: { perActionMinor: number; perRunMinor: number },
): ClassifyResult {
  if (draft.kind !== 'review') {
    return { lane: 'internal' };
  }

  const def = draft.actionType ? getActionDefinition(draft.actionType) : undefined;

  if (draft.actionType && !def) {
    console.warn('[pulse] unknown action type in classifier:', draft.actionType);
    return { lane: 'major', majorReason: 'irreversible' };
  }

  const isExternal  = def?.isExternal === true;
  const destructive = def?.mcp?.annotations?.destructiveHint === true;
  const idempotent  = def?.mcp?.annotations?.idempotentHint === true;
  const openWorld   = def?.mcp?.annotations?.openWorldHint === true;

  const costExceedsPerAction =
    (draft.estimatedCostMinor ?? 0) > thresholds.perActionMinor;
  const costExceedsPerRun =
    (draft.runTotalCostMinor ?? 0) > thresholds.perRunMinor;
  const affectsMultipleSubaccounts =
    draft.subaccountScope === 'multiple';
  const isIrreversible = isExternal && (destructive || !idempotent);

  if (isIrreversible)             return { lane: 'major', majorReason: 'irreversible' };
  if (affectsMultipleSubaccounts) return { lane: 'major', majorReason: 'cross_subaccount' };
  if (costExceedsPerAction)       return { lane: 'major', majorReason: 'cost_per_action' };
  if (costExceedsPerRun)          return { lane: 'major', majorReason: 'cost_per_run' };

  if (isExternal || openWorld) return { lane: 'client' };

  return { lane: 'internal' };
}

export function buildAckText(
  draft: PulseItemDraft,
  reason: MajorReason,
  currencyCode: string,
  thresholds: { perActionMinor: number; perRunMinor: number },
): { text: string; amountMinor: number | null } {
  const locale = 'en-AU';
  const fmt = (minor: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode })
      .format(minor / 100);

  switch (reason) {
    case 'cost_per_action': {
      const amount = draft.estimatedCostMinor ?? 0;
      return {
        text: `I understand this action will spend approximately ${fmt(amount)} on ${draft.subaccountName}.`,
        amountMinor: amount,
      };
    }
    case 'cost_per_run': {
      return {
        text: `I understand this run's total spend exceeds ${fmt(thresholds.perRunMinor)} across its actions.`,
        amountMinor: draft.runTotalCostMinor ?? null,
      };
    }
    case 'cross_subaccount':
      return {
        text: `I understand this change affects more than one client and will be visible across accounts.`,
        amountMinor: null,
      };
    case 'irreversible':
      return {
        text: `I understand this action is not reversible once approved.`,
        amountMinor: null,
      };
  }
}
