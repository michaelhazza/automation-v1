import React from 'react';
import type { ValidatorEvidence } from '../../lib/api/validators';

export interface VerdictDrillInProps {
  evaluationMethod:
    | 'deterministic'
    | 'deterministic_external'
    | 'hybrid_deterministic_fail'
    | 'hybrid_semantic'
    | 'semantic'
    | 'inconclusive';
  validatorSlug?: string;
  validatorVersion?: string;
  evidence?: ValidatorEvidence;
  reasoning: string;
  gateEvidence?: ValidatorEvidence;
}

export function VerdictDrillIn({
  evaluationMethod,
  validatorSlug,
  validatorVersion,
  evidence,
  reasoning,
  gateEvidence,
}: VerdictDrillInProps) {
  if (evaluationMethod === 'inconclusive') {
    return (
      <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
        This rubric references a validator that no longer exists or whose tests are failing. Edit the rubric to fix or remove this check.
      </div>
    );
  }

  if (evaluationMethod === 'semantic') {
    return (
      <div className="mt-2 space-y-1.5">
        <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">LLM judge</span>
        {reasoning && (
          <p className="text-sm text-slate-600 leading-relaxed">{reasoning}</p>
        )}
      </div>
    );
  }

  if (evaluationMethod === 'deterministic' || evaluationMethod === 'deterministic_external') {
    return (
      <div className="mt-2 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
            {evaluationMethod === 'deterministic_external' ? 'Deterministic (external)' : 'Deterministic'}
          </span>
          {validatorSlug && (
            <span className="text-xs font-mono text-slate-600">{validatorSlug}</span>
          )}
          {validatorVersion && (
            <span className="text-xs text-slate-400">v{validatorVersion}</span>
          )}
        </div>
        {reasoning && (
          <p className="text-sm text-slate-600 leading-relaxed">{reasoning}</p>
        )}
        {evidence && <EvidenceTable evidence={evidence} />}
      </div>
    );
  }

  if (evaluationMethod === 'hybrid_deterministic_fail') {
    return (
      <div className="mt-2 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
            Hybrid (gate failed)
          </span>
          {validatorSlug && (
            <span className="text-xs font-mono text-slate-600">{validatorSlug}</span>
          )}
        </div>
        {reasoning && (
          <p className="text-sm text-slate-600 leading-relaxed">{reasoning}</p>
        )}
        {gateEvidence && (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Gate evidence</p>
            <EvidenceTable evidence={gateEvidence} />
          </div>
        )}
      </div>
    );
  }

  if (evaluationMethod === 'hybrid_semantic') {
    return (
      <div className="mt-2 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
            Hybrid (gate passed, LLM judge)
          </span>
          {validatorSlug && (
            <span className="text-xs font-mono text-slate-600">{validatorSlug}</span>
          )}
        </div>
        {reasoning && (
          <p className="text-sm text-slate-600 leading-relaxed">{reasoning}</p>
        )}
        {gateEvidence && (
          <div>
            <p className="text-xs font-medium text-slate-500 mb-1">Gate evidence</p>
            <EvidenceTable evidence={gateEvidence} />
          </div>
        )}
      </div>
    );
  }

  return null;
}

function EvidenceTable({ evidence }: { evidence: ValidatorEvidence }) {
  const entries = Object.entries(evidence).filter(
    ([k]) => k !== '_truncated',
  );
  if (entries.length === 0) return null;
  return (
    <div className="rounded border border-slate-200 overflow-hidden text-xs">
      <table className="w-full">
        <tbody className="divide-y divide-slate-100">
          {entries.map(([key, val]) => (
            <tr key={key}>
              <td className="px-2 py-1.5 text-slate-500 font-medium w-1/3 align-top">{key}</td>
              <td className="px-2 py-1.5 text-slate-700 font-mono break-all">
                {val === null || val === undefined
                  ? <span className="text-slate-400">null</span>
                  : typeof val === 'object'
                  ? JSON.stringify(val)
                  : String(val)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {evidence._truncated && (
        <p className="px-2 py-1 bg-amber-50 text-amber-700 text-xs border-t border-slate-100">
          Evidence was truncated to stay under the size limit.
        </p>
      )}
    </div>
  );
}
