/**
 * StudioPage — canvas UI for authoring and publishing org workflow templates.
 *
 * Spec: tasks/Workflows-spec.md §10.1, §10.2, §10.4, §10.5.
 *
 * Routes:
 *   /admin/workflows/:id/edit   — edit existing template
 *   /admin/workflows/new        — create new template (V1 stub: shows empty canvas)
 *
 * Query params:
 *   ?fromDraft=:draftId  — read but not yet used (Chunk 14b wires draft hydration)
 *
 * Studio is admin/power-user only — not in the operator nav. The API enforces
 * org.workflow_templates.publish permission on the publish endpoint.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../lib/api.js';
import type { User } from '../lib/auth.js';
import StudioCanvas from '../components/studio/StudioCanvas.js';
import StudioBottomBar from '../components/studio/StudioBottomBar.js';
import PublishModal from '../components/studio/PublishModal.js';
import {
  aggregateCostEstimate,
  aggregateValidationStatus,
  type CanvasStep,
  type StepValidationResult,
  type ValidationSummary,
} from '../components/studio/studioCanvasPure.js';
import type { ValidatorError } from '../../../shared/types/workflowValidator.js';

// ─── API shapes ───────────────────────────────────────────────────────────────

interface TemplateMetadata {
  id: string;
  name: string;
  slug: string;
  description: string;
  latestVersion: number;
}

interface TemplateVersion {
  id: string;
  version: number;
  definitionJson: {
    steps?: Array<{
      id: string;
      name: string;
      type: string;
      dependsOn?: string[];
      branches?: Array<{ id: string; label: string; onSuccess?: string | string[] }>;
      onReject?: string;
      params?: Record<string, unknown>;
    }>;
  };
  updatedAt?: string;
  publishedAt?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function definitionToCanvasSteps(def: TemplateVersion['definitionJson']): CanvasStep[] {
  if (!def?.steps) return [];
  return def.steps.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    dependsOn: s.dependsOn ?? [],
    branches: s.branches,
    onReject: s.onReject,
    params: s.params,
  }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StudioPage({ user: _user }: { user: User }) {
  const { id } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // fromDraft param: read but not wired yet (Chunk 14b hydrates the canvas from a draft)
  const _fromDraftId = searchParams.get('fromDraft');

  const isNew = !id || id === 'new';

  // ── Template metadata ──────────────────────────────────────────────────────
  const [template, setTemplate] = useState<TemplateMetadata | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Canvas state ───────────────────────────────────────────────────────────
  const [steps, setSteps] = useState<CanvasStep[]>([]);
  const [dirty, setDirty] = useState(false);

  // Captured from the latest loaded version for concurrent-edit detection.
  const [expectedUpstreamUpdatedAt, setExpectedUpstreamUpdatedAt] = useState<
    string | undefined
  >(undefined);

  // ── Validation state ───────────────────────────────────────────────────────
  // Map<stepId, ValidatorError[]> — populated from the last publish 422 response
  // or from a local pre-validate call (Chunk 14b adds live validation).
  const [validationErrorsByStep, setValidationErrorsByStep] = useState<
    Map<string, ValidatorError[]>
  >(new Map());

  // ── Publish modal ──────────────────────────────────────────────────────────
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // ── Load template on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    setLoading(true);
    api
      .get<{ template: TemplateMetadata; latestVersion: TemplateVersion | null }>(
        `/api/workflow-templates/${id}`
      )
      .then(({ data }) => {
        if (cancelled) return;
        setTemplate(data.template);
        if (data.latestVersion) {
          setSteps(definitionToCanvasSteps(data.latestVersion.definitionJson));
          // Capture the version's publishedAt as the upstream timestamp for
          // concurrent-edit detection. publishedAt is the canonical immutable
          // timestamp; use it in preference to the template's updatedAt.
          setExpectedUpstreamUpdatedAt(
            data.latestVersion.publishedAt ?? undefined
          );
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          setLoadError('Workflow template not found.');
        } else if (status === 403) {
          setLoadError('You do not have permission to access this workflow.');
        } else {
          setLoadError('Failed to load workflow template.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, isNew]);

  // ── Derived validation summary ─────────────────────────────────────────────
  const validationSummary: ValidationSummary = aggregateValidationStatus(
    validationErrorsByStep as Map<string, StepValidationResult[]>
  );

  const estimatedCostCents = aggregateCostEstimate(steps);

  // ── Publish callback ───────────────────────────────────────────────────────
  function handlePublishSuccess(versionId: string, versionNumber: number) {
    setPublishing(false);
    setDirty(false);
    toast.success(`Version ${versionNumber} published`);
    // Refresh the page to reload canvas from new version.
    navigate(0);
    void versionId;
  }

  function handleValidationErrors(errorsByStepId: Map<string, ValidatorError[]>) {
    setValidationErrorsByStep(errorsByStepId);
    toast.error('Publish blocked: fix validation errors on the canvas');
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="w-8 h-8 border-[3px] border-slate-200 border-t-indigo-500 rounded-full [animation:spin_0.8s_linear_infinite]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6">
        <div className="rounded border border-red-200 bg-red-50 p-4 text-red-800 text-sm">
          {loadError}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 bg-white flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          Back
        </button>
        <div className="w-px h-4 bg-slate-200" />
        <h1 className="text-sm font-semibold text-slate-900 truncate">
          {isNew
            ? 'New workflow'
            : template?.name ?? 'Workflow Studio'}
        </h1>
        {template?.slug && (
          <span className="text-xs text-slate-400 font-mono">{template.slug}</span>
        )}
        {dirty && (
          <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
        )}
        <div className="flex-1" />
        {template && (
          <span className="text-xs text-slate-400">v{template.latestVersion}</span>
        )}
      </div>

      {/* Canvas area (scrollable) */}
      <div className="flex-1 overflow-auto bg-slate-50">
        {isNew ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-sm">
            <div className="mb-2 text-lg font-medium text-slate-600">New workflow</div>
            <div>
              Draft hydration is available in the next update. Use the draft URL parameter
              <span className="font-mono text-xs ml-1">?fromDraft=:id</span> to load a draft.
            </div>
            {/* Inspector mount-point */}
            <div id="studio-inspector-mount" />
          </div>
        ) : (
          <StudioCanvas
            steps={steps}
            validationErrors={validationErrorsByStep as Map<string, StepValidationResult[]>}
            onEditStep={(stepId) => {
              // Chunk 14b wires the inspector. Placeholder.
              void stepId;
            }}
          />
        )}
      </div>

      {/* Bottom action bar */}
      <StudioBottomBar
        validation={validationSummary}
        estimatedCostCents={estimatedCostCents}
        publishing={publishing}
        onPublish={() => setPublishModalOpen(true)}
      />

      {/* Publish modal */}
      {publishModalOpen && template && (
        <PublishModal
          templateId={template.id}
          steps={steps}
          expectedUpstreamUpdatedAt={expectedUpstreamUpdatedAt}
          onClose={() => setPublishModalOpen(false)}
          onSuccess={handlePublishSuccess}
          onValidationErrors={handleValidationErrors}
        />
      )}
    </div>
  );
}
