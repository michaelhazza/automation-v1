/**
 * ApprovalInspector — inspector panel for approval steps.
 *
 * Spec: tasks/Workflows-spec.md §10.3 (four A's inspectors).
 *
 * Fields:
 *   - Approver pool (UserPicker + TeamPicker from Chunk 10)
 *   - Quorum (min number of approvals required)
 *   - isCritical (read-only — synthesised by engine)
 *   - seenConfidence preview (read-only)
 *   - Audit-on-decision footnote (read-only)
 */

import React, { useState } from 'react';
import type { CanvasStep } from '../studioCanvasPure.js';
import type { AssignableUser, AssignableTeam } from '../../../../../shared/types/assignableUsers.js';
import UserPicker from '../../UserPicker.js';
import TeamPicker from '../../TeamPicker.js';

interface ApprovalInspectorProps {
  step: CanvasStep;
  onClose: () => void;
  onUpdate: (stepId: string, patch: Partial<CanvasStep>) => void;
}

interface LocalState {
  approverUsers: AssignableUser[];
  approverTeams: AssignableTeam[];
  quorum: number;
}

function stateFromStep(step: CanvasStep): LocalState {
  const p = step.params ?? {};
  return {
    approverUsers: Array.isArray(p.approverUsers)
      ? (p.approverUsers as AssignableUser[])
      : [],
    approverTeams: Array.isArray(p.approverTeams)
      ? (p.approverTeams as AssignableTeam[])
      : [],
    quorum: typeof p.quorum === 'number' ? p.quorum : 1,
  };
}

export default function ApprovalInspector({ step, onClose, onUpdate }: ApprovalInspectorProps) {
  const [local, setLocal] = useState<LocalState>(() => stateFromStep(step));

  // Read-only fields from params (synthesised by engine)
  const isCritical = step.params?.isCritical === true;
  const seenConfidence = typeof step.params?.seenConfidence === 'object'
    ? (step.params.seenConfidence as { value?: string; reason?: string } | null)
    : null;

  function handleSave() {
    onUpdate(step.id, {
      params: {
        ...step.params,
        approverUsers: local.approverUsers,
        approverTeams: local.approverTeams,
        quorum: local.quorum,
      },
    });
    onClose();
  }

  return (
    <div className="p-4 space-y-5">
      {/* Approver pool — users */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Approver users
        </label>
        <UserPicker
          users={[]} // populated from assignable-users API at runtime; V1 shows empty list
          value={local.approverUsers}
          onChange={(next) => setLocal((s) => ({ ...s, approverUsers: next }))}
          multiple
          placeholder="Search users (V2: load from API)"
        />
        <div className="text-[11px] text-slate-400 mt-0.5">
          User picker fetches the assignable-users pool from the API at runtime in V2.
        </div>
      </div>

      {/* Approver pool — teams */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Approver teams
        </label>
        <TeamPicker
          teams={[]} // populated from teams API at runtime
          value={local.approverTeams}
          onChange={(next) => setLocal((s) => ({ ...s, approverTeams: next }))}
          multiple
          placeholder="Search teams (V2: load from API)"
        />
      </div>

      {/* Quorum */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 mb-1">
          Quorum (minimum approvals required)
        </label>
        <input
          type="number"
          min={1}
          className="w-32 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          value={local.quorum}
          onChange={(e) =>
            setLocal((s) => ({ ...s, quorum: Math.max(1, parseInt(e.target.value, 10) || 1) }))
          }
        />
      </div>

      {/* isCritical — read-only */}
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
            Is critical
          </span>
          <span
            className={[
              'text-[11px] font-semibold px-2 py-0.5 rounded-full',
              isCritical
                ? 'bg-red-100 text-red-700'
                : 'bg-slate-200 text-slate-500',
            ].join(' ')}
          >
            {isCritical ? 'Yes' : 'No'}
          </span>
        </div>
        <div className="text-[10px] text-slate-400">
          Synthesised by the engine based on downstream step analysis. Not editable here.
        </div>
      </div>

      {/* seenConfidence — read-only */}
      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 space-y-1">
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">
          Seen confidence
        </div>
        {seenConfidence ? (
          <>
            <div className="text-sm font-medium text-slate-800 capitalize">
              {seenConfidence.value ?? 'unknown'}
            </div>
            {seenConfidence.reason && (
              <div className="text-[11px] text-slate-500">{seenConfidence.reason}</div>
            )}
          </>
        ) : (
          <div className="text-[11px] text-slate-400">
            Computed at run time. Preview not available until a run completes.
          </div>
        )}
      </div>

      {/* Audit footnote — read-only */}
      <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2.5">
        <div className="text-[11px] text-violet-700">
          Approval decisions land in the audit trail with the seen_payload and
          seen_confidence snapshot at the time of decision.
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 focus:outline-none"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
