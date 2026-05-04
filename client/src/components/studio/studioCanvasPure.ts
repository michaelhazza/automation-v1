/**
 * studioCanvasPure — pure layout utilities for the Studio canvas.
 *
 * No React, no side effects. Tested directly via npx tsx.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14a.
 */

/** Minimal step shape needed for canvas layout — matches WorkflowStep server type. */
export interface CanvasStep {
  id: string;
  name: string;
  type: string;
  dependsOn: string[];
  sideEffectType?: string;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Groups steps into topological layers.
 *
 * Layer 0 = steps with no dependsOn.
 * Layer N = steps whose every dependsOn is in layers 0..N-1.
 *
 * Steps with unresolvable dependencies (missing dep ids) are placed in a
 * final overflow layer rather than thrown, so the canvas degrades gracefully.
 */
export function groupStepsByLayer(steps: CanvasStep[]): CanvasStep[][] {
  if (steps.length === 0) return [];

  const assigned = new Set<string>();
  const layers: CanvasStep[][] = [];

  let remaining = [...steps];

  while (remaining.length > 0) {
    const layer: CanvasStep[] = [];
    const nextRemaining: CanvasStep[] = [];

    for (const step of remaining) {
      const allDepsAssigned = step.dependsOn.every((dep) => assigned.has(dep));
      if (allDepsAssigned) {
        layer.push(step);
      } else {
        nextRemaining.push(step);
      }
    }

    if (layer.length === 0) {
      // Cycle or unresolvable deps — dump remainder in a final layer.
      layers.push(nextRemaining);
      break;
    }

    layers.push(layer);
    for (const s of layer) assigned.add(s.id);
    remaining = nextRemaining;
  }

  return layers;
}

/**
 * Returns true if the onReject of step `fromId` points back to `toId`
 * (an earlier step in the DAG — a back-edge).
 *
 * Checks both `params.onReject` (V1 storage) and a top-level `onReject` field.
 */
export function hasBackEdge(steps: CanvasStep[], fromId: string, toId: string): boolean {
  const step = steps.find((s) => s.id === fromId);
  if (!step) return false;
  const onReject =
    (step.params?.onReject as string | undefined) ??
    (step.onReject as string | undefined);
  return onReject === toId;
}
