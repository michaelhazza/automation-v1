import { useState, useEffect, useCallback } from 'react';
import api from '../lib/api';
import { logAndSwallow } from '../lib/silentCatchHelper';
import { useSocketRoom } from './useSocket';

interface BadgesInput {
  activeClientId: string | null;
  isSystemAdmin: boolean;
}

interface BudgetAlert { pct: number; spent: number; limit: number; }

export interface LayoutBadges {
  reviewCount: number;
  liveAgentCount: number;
  incidentCount: number;
  budgetAlert: BudgetAlert | null;
  dismissBudgetAlert(): void;
}

export function useLayoutBadges({ activeClientId, isSystemAdmin }: BadgesInput): LayoutBadges {
  const [reviewCount, setReviewCount] = useState(0);
  const [liveAgentCount, setLiveAgentCount] = useState(0);
  const [incidentCount, setIncidentCount] = useState(0);
  const [budgetAlert, setBudgetAlert] = useState<BudgetAlert | null>(null);

  // Review queue badge — initial load + WebSocket updates
  useEffect(() => {
    if (!activeClientId) { setReviewCount(0); return; }
    api.get(`/api/subaccounts/${activeClientId}/review-queue/count`).then(({ data }) => setReviewCount(data.count ?? 0)).catch((err) => console.error('[Layout] Failed to fetch review queue count:', err));
  }, [activeClientId]);

  // Incident badge — system admin only, initial load
  useEffect(() => {
    if (!isSystemAdmin) return;
    api.get('/api/system/incidents/badge-count').then(({ data }) => setIncidentCount(data.count ?? 0)).catch(logAndSwallow('Layout: incident badge refresh', { severity: 'critical' }));
  }, [isSystemAdmin]);

  // Live agent badge — initial load + WebSocket updates
  useEffect(() => {
    if (!activeClientId) { setLiveAgentCount(0); return; }
    api.get(`/api/subaccounts/${activeClientId}/live-status`).then(({ data }) => setLiveAgentCount(data.runningAgents ?? 0)).catch((err) => console.error('[Layout] Failed to fetch live status:', err));
  }, [activeClientId]);

  // Budget alert — initial load (updates come via WebSocket 'budget:update')
  useEffect(() => {
    if (!activeClientId) { setBudgetAlert(null); return; }
    api.get(`/api/subaccounts/${activeClientId}/usage/summary`)
      .then(({ data }) => {
        const spent = data.monthly?.totalCostCents ?? 0;
        const limit = data.limits?.monthlyCostLimitCents;
        if (!limit || limit <= 0) { setBudgetAlert(null); return; }
        const pct = spent / limit;
        if (pct >= 0.75) setBudgetAlert({ pct, spent, limit });
        else setBudgetAlert(null);
      }).catch((err) => console.error('[Layout] Failed to fetch budget alert:', err));
  }, [activeClientId]);

  // Resync function — re-fetch all badge counts from REST (used on reconnect)
  const resyncBadges = useCallback(() => {
    if (!activeClientId) return;
    api.get(`/api/subaccounts/${activeClientId}/review-queue/count`).then(({ data }) => setReviewCount(data.count ?? 0)).catch((err) => console.error('[Layout] Failed to resync review count:', err));
    api.get(`/api/subaccounts/${activeClientId}/live-status`).then(({ data }) => setLiveAgentCount(data.runningAgents ?? 0)).catch((err) => console.error('[Layout] Failed to resync live status:', err));
    api.get(`/api/subaccounts/${activeClientId}/usage/summary`)
      .then(({ data }) => {
        const spent = data.monthly?.totalCostCents ?? 0;
        const limit = data.limits?.monthlyCostLimitCents;
        if (!limit || limit <= 0) { setBudgetAlert(null); return; }
        const pct = spent / limit;
        if (pct >= 0.75) setBudgetAlert({ pct, spent, limit });
        else setBudgetAlert(null);
      }).catch((err) => console.error('[Layout] Failed to resync usage summary:', err));
  }, [activeClientId]);

  // WebSocket: subscribe to subaccount room for live updates
  // On reconnect, re-fetch baseline state via REST to avoid stale counts
  useSocketRoom('subaccount', activeClientId, {
    'live:agent_started': () => setLiveAgentCount(c => c + 1),
    'live:agent_completed': () => setLiveAgentCount(c => Math.max(0, c - 1)),
    'review:item_updated': () => {
      // Re-fetch count on any review change
      if (activeClientId) api.get(`/api/subaccounts/${activeClientId}/review-queue/count`).then(({ data }) => setReviewCount(data.count ?? 0)).catch((err) => console.error('[Layout] Failed to refresh review count:', err));
    },
    'review:item_created': () => setReviewCount(c => c + 1),
    'budget:update': (data: unknown) => {
      const d = data as { pct?: number; spent?: number; limit?: number };
      if (d.pct !== undefined && d.pct >= 0.75) setBudgetAlert({ pct: d.pct, spent: d.spent ?? 0, limit: d.limit ?? 0 });
      else setBudgetAlert(null);
    },
  }, resyncBadges);

  const dismissBudgetAlert = useCallback(() => setBudgetAlert(null), []);

  return { reviewCount, liveAgentCount, incidentCount, budgetAlert, dismissBudgetAlert };
}
