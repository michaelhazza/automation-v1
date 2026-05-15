import { useEffect, useState } from 'react';
import api from '../../lib/api';
import AgentConfigExecutionTab from '../agent-config/ExecutionTab';
import type { AllowedEnvironment } from '../agent-config/ExecutionTab';
import type { LinkDetail } from './types';

interface ExecutionTabProps {
  link: LinkDetail;
  onSaved(): Promise<void>;
}

export function ExecutionTab({ link, onSaved }: ExecutionTabProps) {
  const [execution, setExecution] = useState<{
    controllerStyleAllowed: 'native_only' | 'native_and_operator';
    allowedEnvironments: AllowedEnvironment[];
  }>({
    controllerStyleAllowed: link.controllerStyleAllowed ?? 'native_only',
    allowedEnvironments: (link.allowedEnvironments ?? ['api_tool', 'headless', 'browser']) as AllowedEnvironment[],
  });
  const [scheduling, setScheduling] = useState({
    scheduleCron: link.scheduleCron ?? '',
    scheduleEnabled: link.scheduleEnabled,
    scheduleTimezone: link.scheduleTimezone,
    concurrencyPolicy: link.concurrencyPolicy,
    catchUpPolicy: link.catchUpPolicy,
    catchUpCap: link.catchUpCap,
    maxConcurrentRuns: link.maxConcurrentRuns,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setExecution({
      controllerStyleAllowed: link.controllerStyleAllowed ?? 'native_only',
      allowedEnvironments: (link.allowedEnvironments ?? ['api_tool', 'headless', 'browser']) as AllowedEnvironment[],
    });
    setScheduling({
      scheduleCron: link.scheduleCron ?? '',
      scheduleEnabled: link.scheduleEnabled,
      scheduleTimezone: link.scheduleTimezone,
      concurrencyPolicy: link.concurrencyPolicy,
      catchUpPolicy: link.catchUpPolicy,
      catchUpCap: link.catchUpCap,
      maxConcurrentRuns: link.maxConcurrentRuns,
    });
  }, [link]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await api.patch(`/api/subaccounts/${link.subaccountId}/agents/${link.id}`, {
        controllerStyleAllowed: execution.controllerStyleAllowed,
        allowedEnvironments: execution.allowedEnvironments,
        scheduleCron: scheduling.scheduleCron || null,
        scheduleEnabled: scheduling.scheduleEnabled,
        scheduleTimezone: scheduling.scheduleTimezone,
        concurrencyPolicy: scheduling.concurrencyPolicy,
        catchUpPolicy: scheduling.catchUpPolicy,
        catchUpCap: Number(scheduling.catchUpCap),
        maxConcurrentRuns: Number(scheduling.maxConcurrentRuns),
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
      <AgentConfigExecutionTab
        controllerStyleAllowed={execution.controllerStyleAllowed}
        allowedEnvironments={execution.allowedEnvironments}
        isSystemAgent={false}
        scheduling={scheduling}
        saving={saving}
        saved={saved}
        onControllerStyleChange={v => setExecution(e => ({ ...e, controllerStyleAllowed: v }))}
        onAllowedEnvironmentsChange={v => setExecution(e => ({ ...e, allowedEnvironments: v }))}
        onSchedulingChange={setScheduling}
        onSave={save}
      />
    </div>
  );
}
