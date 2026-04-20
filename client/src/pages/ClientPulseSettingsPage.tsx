/**
 * ClientPulseSettingsPage — the org-admin surface for tuning the effective
 * operational_config_override. Session 1 / spec §6 / ship gate S1-5.1.
 *
 * Per contract (j): this page and the Configuration Assistant popup are
 * equal surfaces on the same mechanism — both write through
 * POST /api/organisation/config/apply, produce the same config_history
 * audit trail, and respect the same sensitive-path split.
 *
 * Session 1 ships a JSON-per-block editor for every block in
 * operationalConfigSchema — lightweight, schema-validated on the server,
 * preserves the save flow + provenance + reset-to-default semantics end to
 * end. Typed form editors per block are Session 2 work.
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { User } from '../lib/auth';
import api from '../lib/api';
import ProvenanceStrip from '../components/clientpulse-settings/shared/ProvenanceStrip';
import { OverrideBadge, ManuallySetIndicator, ResetToDefaultButton } from '../components/clientpulse-settings/shared/indicators';
import {
  differsFromTemplate,
  hasExplicitOverride,
  readPath,
} from '../components/clientpulse-settings/shared/differsFromTemplate';

// Per spec §6.2 — the 10 blocks surfaced on the Settings page.
const BLOCKS: Array<{ path: string; title: string; description: string }> = [
  { path: 'healthScoreFactors', title: 'Health score factors', description: 'Weighted factors that sum to 1.0 (sum-constraint enforced server-side).' },
  { path: 'churnRiskSignals', title: 'Churn risk signals', description: 'Weighted signals that inform churn risk scoring.' },
  { path: 'churnBands', title: 'Churn bands', description: 'Healthy / Watch / At-risk / Critical 0-100 ranges.' },
  { path: 'interventionDefaults', title: 'Intervention defaults', description: 'Cooldowns, gate level, per-day quotas.' },
  { path: 'interventionTemplates', title: 'Intervention templates (JSON)', description: 'Typed editor deferred to Session 2; Session 1 ships JSON + schema validation.' },
  { path: 'alertLimits', title: 'Alert limits', description: 'Max alerts per run, per account per day, batching.' },
  { path: 'staffActivity', title: 'Staff activity', description: 'Counted mutation types, excluded kinds, automation resolution.' },
  { path: 'integrationFingerprints', title: 'Integration fingerprints', description: 'Seed library + scan types + unclassified promotion thresholds.' },
  { path: 'dataRetention', title: 'Data retention', description: 'Per-resource retention days (null = unlimited).' },
  { path: 'onboardingMilestones', title: 'Onboarding milestones', description: 'Milestone slug / label / targetDays / signal.' },
];

interface ConfigResponse {
  effective: Record<string, unknown>;
  overrides: Record<string, unknown> | null;
  systemDefaults: Record<string, unknown> | null;
  appliedSystemTemplateId: string | null;
  appliedSystemTemplateName: string | null;
}

export default function ClientPulseSettingsPage({ user: _user }: { user: User }) {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/organisation/config');
      setConfig(res.data);
      setError(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e?.response?.data?.message ?? 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const summary = useMemo(() => {
    if (!config) return { overridden: 0, total: BLOCKS.length };
    const overridden = BLOCKS.filter((b) =>
      differsFromTemplate(config.systemDefaults, config.effective, b.path),
    ).length;
    return { overridden, total: BLOCKS.length };
  }, [config]);

  if (loading) return <div className="p-6 text-sm text-slate-500">Loading configuration…</div>;
  if (error || !config) return <div className="p-6 text-sm text-red-600">{error ?? 'No configuration'}</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold text-slate-900">ClientPulse Settings</h1>
        <p className="mt-1 text-[13px] text-slate-600">
          Per-leaf values are effective after deep-merging the adopted system
          template defaults with any explicit org-level override. Changes here
          and changes made by the Configuration Assistant converge on the
          same audited write path.
        </p>
      </div>
      <ProvenanceStrip
        appliedSystemTemplateId={config.appliedSystemTemplateId}
        appliedSystemTemplateName={config.appliedSystemTemplateName}
        overriddenLeafCount={summary.overridden}
        totalLeafCount={summary.total}
      />
      <div className="space-y-4">
        {BLOCKS.map((b) => (
          <BlockCard
            key={b.path}
            block={b}
            config={config}
            onSaved={loadConfig}
          />
        ))}
      </div>
    </div>
  );
}

interface BlockCardProps {
  block: { path: string; title: string; description: string };
  config: ConfigResponse;
  onSaved: () => void;
}

function BlockCard({ block, config, onSaved }: BlockCardProps) {
  const effectiveValue = readPath(config.effective, block.path);
  const systemDefaultValue = readPath(config.systemDefaults ?? {}, block.path);
  const overrideExists = hasExplicitOverride(config.overrides, block.path);
  const isOverridden = differsFromTemplate(config.systemDefaults, config.effective, block.path);

  const [editing, setEditing] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(effectiveValue ?? null, null, 2));
  const [saving, setSaving] = useState(false);

  const reset = async () => {
    if (!window.confirm(`Reset ${block.title} to the adopted template default?`)) return;
    setSaving(true);
    try {
      await api.post('/api/organisation/config/apply', {
        path: block.path,
        value: systemDefaultValue ?? null,
        reason: `Reset ${block.path} to adopted template default via Settings page`,
      });
      toast.success(`${block.title} reset to template default.`);
      onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message ?? 'Reset failed');
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      toast.error('Invalid JSON — fix syntax before saving.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/api/organisation/config/apply', {
        path: block.path,
        value: parsed,
        reason: `Update ${block.path} via Settings page`,
      });
      // Server returns HTTP 200 for schema/sum-constraint rejections with
      // { committed: false, errorCode } — surface the failure and keep the
      // editor open so operators can fix the payload instead of silently
      // closing as if the save succeeded.
      if (res.data?.errorCode) {
        toast.error(res.data?.message ?? `Save rejected (${res.data.errorCode}).`);
        return;
      }
      if (res.data?.committed) {
        toast.success(`${block.title} saved · history v${res.data.configHistoryVersion}`);
      } else if (res.data?.requiresApproval) {
        toast.success(`${block.title} sent to review queue · action ${String(res.data.actionId).slice(0, 8)}`);
      }
      setEditing(false);
      onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-slate-200">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-semibold text-slate-900">{block.title}</h2>
            <OverrideBadge visible={isOverridden} />
            <ManuallySetIndicator visible={overrideExists && !isOverridden} />
          </div>
          <p className="mt-0.5 text-[12px] text-slate-600">{block.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ResetToDefaultButton
            disabled={!isOverridden || saving || !config.appliedSystemTemplateId}
            onClick={reset}
          />
          <button
            type="button"
            onClick={() => {
              setJsonText(JSON.stringify(effectiveValue ?? null, null, 2));
              setEditing((v) => !v);
            }}
            className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 border border-slate-200 text-slate-700 hover:border-slate-300"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </div>
      <div className="p-4">
        {editing ? (
          <div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              rows={Math.min(Math.max(6, jsonText.split('\n').length + 1), 24)}
              className="w-full px-3 py-2 rounded-md border border-slate-300 font-mono text-[12px] text-slate-800 focus:outline-none focus:border-indigo-500"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={save}
                className="px-3 py-1 rounded-md text-[12px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <pre className="bg-slate-50 rounded p-3 text-[12px] text-slate-700 font-mono overflow-auto max-h-64 whitespace-pre-wrap break-words">
            {JSON.stringify(effectiveValue ?? null, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
