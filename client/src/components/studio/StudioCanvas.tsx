/**
 * StudioCanvas — read-only vertical step-card list.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14a.
 * Inspectors for editing steps come in Chunk 14b.
 */

import React from 'react';
import { groupStepsByLayer, hasBackEdge, type CanvasStep } from './studioCanvasPure';

interface StudioCanvasProps {
  steps: CanvasStep[];
  selectedStepId?: string;
  onSelectStep: (id: string) => void;
}

function StepTypeBadge({ type }: { type: string }) {
  const colours: Record<string, string> = {
    agent: 'bg-indigo-100 text-indigo-700',
    agent_call: 'bg-indigo-100 text-indigo-700',
    action: 'bg-blue-100 text-blue-700',
    action_call: 'bg-blue-100 text-blue-700',
    ask: 'bg-amber-100 text-amber-700',
    user_input: 'bg-amber-100 text-amber-700',
    approval: 'bg-orange-100 text-orange-700',
    prompt: 'bg-slate-100 text-slate-700',
    conditional: 'bg-purple-100 text-purple-700',
    agent_decision: 'bg-fuchsia-100 text-fuchsia-700',
    invoke_automation: 'bg-teal-100 text-teal-700',
  };
  const cls = colours[type] ?? 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {type}
    </span>
  );
}

function StepCard({
  step,
  selected,
  onSelect,
}: {
  step: CanvasStep;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
        selected
          ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-slate-800 text-sm">{step.name}</span>
        <StepTypeBadge type={step.type} />
      </div>
      <div className="mt-1 flex items-center gap-2 flex-wrap">
        <span className="font-mono text-xs text-slate-400">{step.id}</span>
        {step.dependsOn.length > 0 && (
          <span className="text-xs text-slate-400">
            depends on: {step.dependsOn.join(', ')}
          </span>
        )}
      </div>
    </button>
  );
}

function ForkIndicator() {
  return (
    <div className="flex items-center justify-center py-1">
      <div className="flex items-center gap-3">
        <div className="h-px w-8 bg-slate-300" />
        <span className="text-xs text-slate-400 uppercase tracking-wide">fork</span>
        <div className="h-px w-8 bg-slate-300" />
      </div>
    </div>
  );
}

function BackEdgeAnnotation({ fromId, toId }: { fromId: string; toId: string }) {
  return (
    <div className="flex items-center gap-1 text-xs text-orange-500 py-0.5 pl-4">
      <span className="border-t border-l border-orange-300 border-dashed w-4 h-3 inline-block" />
      <span>
        on reject: back to <span className="font-mono">{toId}</span> (from{' '}
        <span className="font-mono">{fromId}</span>)
      </span>
    </div>
  );
}

export default function StudioCanvas({ steps, selectedStepId, onSelectStep }: StudioCanvasProps) {
  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 py-20">
        <p className="text-sm">No steps yet</p>
        <p className="text-xs mt-1">Publish a workflow definition to see its steps here.</p>
      </div>
    );
  }

  const layers = groupStepsByLayer(steps);

  return (
    <div className="flex flex-col gap-3 p-4 max-w-2xl mx-auto" role="list" aria-label="Workflow steps">
      {layers.map((layer, layerIdx) => {
        const isFork = layer.length > 1;
        const prevLayerIds = layers
          .slice(0, layerIdx)
          .flat()
          .map((s) => s.id);

        // Back-edge annotations for this layer
        const backEdges: { fromId: string; toId: string }[] = [];
        for (const step of layer) {
          for (const prevId of prevLayerIds) {
            if (hasBackEdge(steps, step.id, prevId)) {
              backEdges.push({ fromId: step.id, toId: prevId });
            }
          }
        }

        return (
          <React.Fragment key={layerIdx}>
            {isFork && layerIdx > 0 && <ForkIndicator />}
            <div
              className={`flex gap-3 ${isFork ? 'flex-row' : 'flex-col'}`}
              role="group"
              aria-label={`Layer ${layerIdx + 1}`}
            >
              {layer.map((step) => (
                <div key={step.id} className={isFork ? 'flex-1' : ''} role="listitem">
                  <StepCard
                    step={step}
                    selected={selectedStepId === step.id}
                    onSelect={() => onSelectStep(step.id)}
                  />
                </div>
              ))}
            </div>
            {backEdges.map((be) => (
              <BackEdgeAnnotation key={`${be.fromId}->${be.toId}`} fromId={be.fromId} toId={be.toId} />
            ))}
            {layerIdx < layers.length - 1 && (
              <div className="flex justify-center">
                <div className="w-px h-4 bg-slate-200" />
              </div>
            )}
          </React.Fragment>
        );
      })}
      {/* Inspector mount-point for Chunk 14b */}
      <div data-testid="inspector-mount" />
    </div>
  );
}
