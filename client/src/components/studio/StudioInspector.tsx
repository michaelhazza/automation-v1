/**
 * StudioInspector — slide-out right-side panel for step inspection.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14b.
 */

import type { CanvasStep } from './studioCanvasPure';
import AgentInspector from './inspectors/AgentInspector';
import ActionInspector from './inspectors/ActionInspector';
import ApprovalInspector from './inspectors/ApprovalInspector';
import AskInspector from './inspectors/AskInspector';

interface StudioInspectorProps {
  step: CanvasStep | null;
  onClose: () => void;
}

function InspectorBody({ step }: { step: CanvasStep }) {
  const { type } = step;
  if (type === 'agent' || type === 'agent_call') {
    return <AgentInspector step={step} />;
  }
  if (type === 'action' || type === 'action_call') {
    return <ActionInspector step={step} />;
  }
  if (type === 'ask' || type === 'user_input') {
    return <AskInspector step={step} />;
  }
  if (type === 'approval') {
    return <ApprovalInspector step={step} />;
  }
  return (
    <div className="p-4 text-sm text-slate-500">
      No inspector available for this step type.
    </div>
  );
}

export default function StudioInspector({ step, onClose }: StudioInspectorProps) {
  if (!step) return null;

  return (
    <div className="fixed right-0 top-0 bottom-0 w-80 bg-white border-l border-slate-200 shadow-lg flex flex-col z-40">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <span className="text-sm font-medium text-slate-700">Step inspector</span>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 text-lg leading-none"
          aria-label="Close inspector"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <InspectorBody key={step.id} step={step} />
      </div>
    </div>
  );
}
