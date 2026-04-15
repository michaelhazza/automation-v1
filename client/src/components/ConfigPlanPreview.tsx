import React, { useState } from 'react';

export interface ConfigPlanStep {
  stepNumber: number;
  action: string;
  entityType: string;
  entityId?: string;
  summary: string;
  currentValue?: Record<string, unknown>;
  parameters: Record<string, unknown>;
  dependsOn?: number[];
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ConfigPlan {
  summary: string;
  targetScope: {
    type: 'org' | 'subaccount' | 'multiple_subaccounts';
    subaccountIds?: string[];
    subaccountNames?: string[];
  };
  planBudget: { maxSteps: number };
  failFast: boolean;
  steps: ConfigPlanStep[];
}

interface Props {
  plan: ConfigPlan;
  onExecute: (approvedStepNumbers: number[]) => void;
  onCancel: () => void;
  executing?: boolean;
  executionProgress?: Map<number, 'pending' | 'running' | 'done' | 'failed' | 'skipped'>;
}

const RISK_STYLES: Record<string, { bar: string; badge: string; badgeText: string }> = {
  high: { bar: 'border-l-red-500', badge: 'bg-red-50 text-red-700 border-red-200', badgeText: 'High impact' },
  medium: { bar: 'border-l-amber-400', badge: 'bg-amber-50 text-amber-700 border-amber-200', badgeText: 'Medium' },
  low: { bar: 'border-l-transparent', badge: '', badgeText: '' },
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  running: <div className="w-3.5 h-3.5 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />,
  done: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
  failed: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
  skipped: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /></svg>,
};

function formatCurrentValue(cv: Record<string, unknown>): string {
  return Object.entries(cv)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ');
}

function scopeLabel(scope: ConfigPlan['targetScope']): string {
  if (scope.type === 'org') return 'Organisation-wide';
  if (scope.type === 'subaccount' && scope.subaccountNames?.length) return scope.subaccountNames[0];
  if (scope.type === 'multiple_subaccounts' && scope.subaccountNames?.length)
    return `${scope.subaccountNames.length} subaccounts`;
  return scope.type;
}

export default function ConfigPlanPreview({ plan, onExecute, onCancel, executing, executionProgress }: Props) {
  const [checked, setChecked] = useState<Set<number>>(() => new Set(plan.steps.map((s) => s.stepNumber)));

  const toggle = (stepNum: number) => {
    if (executing) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(stepNum)) next.delete(stepNum);
      else next.add(stepNum);
      return next;
    });
  };

  const toggleAll = () => {
    if (executing) return;
    if (checked.size === plan.steps.length) setChecked(new Set());
    else setChecked(new Set(plan.steps.map((s) => s.stepNumber)));
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden max-w-[600px]">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-violet-50 border-b border-slate-200">
        <div className="font-bold text-[15px] text-slate-900 mb-1">Configuration Plan</div>
        <div className="text-[13px] text-slate-600 leading-snug">{plan.summary}</div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
            Scope: {scopeLabel(plan.targetScope)}
          </span>
          <span className="text-[11px] text-slate-400">
            {plan.steps.length} step{plan.steps.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y divide-slate-100 max-h-[400px] overflow-y-auto">
        {plan.steps.map((step) => {
          const risk = RISK_STYLES[step.riskLevel] ?? RISK_STYLES.low;
          const isChecked = checked.has(step.stepNumber);
          const status = executionProgress?.get(step.stepNumber);
          const isBlocked = step.dependsOn?.some((dep) => !checked.has(dep));

          return (
            <div
              key={step.stepNumber}
              className={`flex items-start gap-2.5 px-4 py-2.5 border-l-[3px] ${risk.bar} ${isBlocked ? 'opacity-50' : ''}`}
            >
              <label className="flex items-center shrink-0 mt-0.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggle(step.stepNumber)}
                  disabled={executing || isBlocked}
                  className="w-4 h-4 accent-indigo-600"
                />
              </label>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-slate-400 font-mono shrink-0">{step.stepNumber}.</span>
                  <span className={`text-[13px] leading-snug ${isChecked ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                    {step.summary}
                  </span>
                  {risk.badgeText && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${risk.badge}`}>
                      {risk.badgeText}
                    </span>
                  )}
                </div>
                {step.currentValue && Object.keys(step.currentValue).length > 0 && (
                  <div className="text-[11px] text-slate-400 mt-0.5 font-mono truncate">
                    was: {formatCurrentValue(step.currentValue)}
                  </div>
                )}
                {isBlocked && (
                  <div className="text-[10.5px] text-amber-600 mt-0.5">
                    Blocked — depends on step {step.dependsOn?.join(', ')}
                  </div>
                )}
              </div>
              {status && <div className="shrink-0 mt-0.5">{STATUS_ICONS[status]}</div>}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center gap-2">
        <button
          type="button"
          onClick={toggleAll}
          disabled={executing}
          className="text-[12px] text-indigo-600 hover:text-indigo-800 font-semibold bg-transparent border-0 cursor-pointer px-0 disabled:opacity-50"
        >
          {checked.size === plan.steps.length ? 'Uncheck all' : 'Check all'}
        </button>
        <div className="flex-1" />
        {!executing && checked.size === 0 && (
          <span className="text-[12px] text-slate-400">Select at least one step to execute</span>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={executing}
          className="px-3.5 py-1.5 text-[13px] font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onExecute(Array.from(checked).sort((a, b) => a - b))}
          disabled={executing || checked.size === 0}
          className="px-4 py-1.5 text-[13px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 border-0 rounded-lg cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {executing ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Executing…
            </>
          ) : (
            <>Execute Plan ({checked.size})</>
          )}
        </button>
      </div>
    </div>
  );
}
