import { useEffect, useState } from 'react';
import api from '../../lib/api';
import AgentConfigGovernanceTab from '../agent-config/GovernanceTab';
import type { LinkDetail } from './types';

interface GovernanceTabProps {
  link: LinkDetail;
  onSaved(): Promise<void>;
}

export function GovernanceTab({ link, onSaved }: GovernanceTabProps) {
  const [governance, setGovernance] = useState({
    maxRiskTier: link.maxRiskTier ?? 3,
    requireApprovalAtTier: link.requireApprovalAtTier ?? 4,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setGovernance({
      maxRiskTier: link.maxRiskTier ?? 3,
      requireApprovalAtTier: link.requireApprovalAtTier ?? 4,
    });
  }, [link]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await api.patch(`/api/subaccounts/${link.subaccountId}/agents/${link.id}`, {
        maxRiskTier: governance.maxRiskTier,
        requireApprovalAtTier: governance.requireApprovalAtTier,
      });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
      const apiErr = err.response?.data?.error;
      const msg = typeof apiErr === 'string' ? apiErr : apiErr?.message;
      setSaveError(msg ?? err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {saveError && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{saveError}</div>
      )}
      <AgentConfigGovernanceTab
        maxRiskTier={governance.maxRiskTier}
        requireApprovalAtTier={governance.requireApprovalAtTier}
        saving={saving}
        saved={saved}
        onMaxRiskTierChange={v => setGovernance(g => ({ ...g, maxRiskTier: v }))}
        onRequireApprovalAtTierChange={v => setGovernance(g => ({ ...g, requireApprovalAtTier: v }))}
        onSave={save}
      />
    </div>
  );
}
