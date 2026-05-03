/**
 * StudioInspector — slide-out inspector container for Studio step editing.
 *
 * Spec: tasks/Workflows-spec.md §10.3.
 *
 * Renders as a right-side slide-out panel (40% width).
 * Displays the appropriate sub-inspector based on step.type.
 * Controlled visibility: visible when `step` is non-null.
 */

import React from 'react';
import type { CanvasStep } from './studioCanvasPure.js';
import AgentInspector from './inspectors/AgentInspector.js';
import ActionInspector from './inspectors/ActionInspector.js';
import AskInspector from './inspectors/AskInspector.js';
import ApprovalInspector from './inspectors/ApprovalInspector.js';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StudioInspectorProps {
  step: CanvasStep | null;
  onClose: () => void;
  onUpdate: (stepId: string, patch: Partial<CanvasStep>) => void;
}

// ─── Sub-inspector router ─────────────────────────────────────────────────────

function resolveInspector(
  step: CanvasStep,
  onClose: () => void,
  onUpdate: (stepId: string, patch: Partial<CanvasStep>) => void
): React.ReactNode {
  const type = step.type;

  if (type === 'agent' || type === 'agent_call') {
    return <AgentInspector step={step} onClose={onClose} onUpdate={onUpdate} />;
  }
  if (type === 'action' || type === 'action_call') {
    return <ActionInspector step={step} onClose={onClose} onUpdate={onUpdate} />;
  }
  if (type === 'ask' || type === 'user_input') {
    return <AskInspector step={step} onClose={onClose} onUpdate={onUpdate} />;
  }
  if (type === 'approval') {
    return <ApprovalInspector step={step} onClose={onClose} onUpdate={onUpdate} />;
  }

  // Generic fallback for other step types (prompt, conditional, etc.)
  return (
    <div className="p-4">
      <div className="text-xs text-slate-500 font-mono mb-1">{type}</div>
      <div className="text-sm text-slate-600">
        No dedicated inspector for this step type in V1.
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StudioInspector({ step, onClose, onUpdate }: StudioInspectorProps) {
  // Hidden when no step is selected.
  if (!step) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-20"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out panel */}
      <div
        className="fixed top-0 right-0 h-full z-30 bg-white border-l border-slate-200 shadow-xl flex flex-col"
        style={{ width: '40%', minWidth: 320, maxWidth: 640 }}
        role="dialog"
        aria-label={`Edit step: ${step.name}`}
      >
        {/* Panel header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <span className="text-xs font-mono text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">
            {step.type}
          </span>
          <span className="text-sm font-semibold text-slate-800 truncate flex-1">
            {step.name}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-lg leading-none px-1"
            aria-label="Close inspector"
          >
            &times;
          </button>
        </div>

        {/* Inspector body (scrollable) */}
        <div className="flex-1 overflow-y-auto">
          {resolveInspector(step, onClose, onUpdate)}
        </div>
      </div>
    </>
  );
}
