/**
 * StudioPage — org-admin Workflow Studio.
 *
 * Routes:
 *   /admin/workflows/:id/edit  — load and display an existing template
 *   /admin/workflows/new       — empty canvas placeholder
 *
 * Canvas is read-only in Chunk 14a. Step inspectors come in Chunk 14b.
 *
 * Spec: tasks/builds/workflows-v1-phase-2/plan.md Chunk 14a.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../lib/api';
import type { User } from '../lib/auth';
import StudioCanvas from '../components/studio/StudioCanvas';
import StudioBottomBar from '../components/studio/StudioBottomBar';
import PublishModal from '../components/studio/PublishModal';
import type { CanvasStep } from '../components/studio/studioCanvasPure';

interface WorkflowTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  latestVersion: number;
  updatedAt: string;
}

interface LoadedState {
  template: WorkflowTemplate;
  steps: CanvasStep[];
  upstreamUpdatedAt: string;
  latestVersionPublishedByUserId: string | null;
}

export default function StudioPage({ user: _user }: { user: User }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id || id === 'new';

  const [loaded, setLoaded] = useState<LoadedState | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>();
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [concurrentEdit, setConcurrentEdit] = useState<{
    updatedAt: string;
    userId: string;
  } | null>(null);

  useEffect(() => {
    if (isNew) return;
    setLoading(true);
    api
      .get<{
        template: WorkflowTemplate;
        definition: Record<string, unknown> | null;
        latestVersionPublishedByUserId: string | null;
      }>(`/api/admin/workflows/${id}`)
      .then(({ data }) => {
        const steps = (data.definition?.steps ?? []) as CanvasStep[];
        setLoaded({
          template: data.template,
          steps,
          upstreamUpdatedAt: data.template.updatedAt,
          latestVersionPublishedByUserId: data.latestVersionPublishedByUserId,
        });
      })
      .catch((err) => {
        if (err?.response?.status === 404) {
          navigate('/workflows', { replace: true });
        } else {
          toast.error('Failed to load workflow template');
        }
      })
      .finally(() => setLoading(false));
  }, [id, isNew, navigate]);

  async function handlePublishConfirm(notes: string, force: boolean) {
    const steps = loaded?.steps ?? [];
    const expectedUpstreamUpdatedAt = force ? undefined : loaded?.upstreamUpdatedAt;

    setPublishing(true);
    try {
      await api.post(`/api/admin/workflows/${id}/publish`, {
        steps,
        publishNotes: notes || undefined,
        expectedUpstreamUpdatedAt,
      });
      setPublishModalOpen(false);
      setConcurrentEdit(null);
      setValidationErrors([]);
      toast.success('Workflow published');
      // Reload to get the updated upstreamUpdatedAt
      const { data } = await api.get<{
        template: WorkflowTemplate;
        definition: Record<string, unknown> | null;
        latestVersionPublishedByUserId: string | null;
      }>(`/api/admin/workflows/${id}`);
      const newSteps = (data.definition?.steps ?? []) as CanvasStep[];
      setLoaded({
        template: data.template,
        steps: newSteps,
        upstreamUpdatedAt: data.template.updatedAt,
        latestVersionPublishedByUserId: data.latestVersionPublishedByUserId,
      });
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { error?: string; upstream_updated_at?: string; upstream_user_id?: string | null; errors?: unknown } } };
      if (e.response?.status === 409 && e.response.data?.error === 'concurrent_publish') {
        setPublishModalOpen(false);
        setConcurrentEdit({
          updatedAt: e.response.data.upstream_updated_at ?? '',
          userId: e.response.data.upstream_user_id ?? '',
        });
        // Re-open modal with concurrent edit warning
        setTimeout(() => setPublishModalOpen(true), 50);
      } else if (e.response?.status === 422) {
        const errs = e.response.data?.errors;
        const errList = Array.isArray(errs)
          ? (errs as { message?: string }[]).map((er) => er.message ?? String(er))
          : [String(errs)];
        setValidationErrors(errList);
        setPublishModalOpen(false);
        toast.error('Validation failed — see errors below');
      } else {
        toast.error('Publish failed');
      }
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return <div className="p-8 text-sm text-slate-400">Loading...</div>;
  }

  const steps: CanvasStep[] = isNew ? [] : (loaded?.steps ?? []);
  const templateName = isNew ? 'New Workflow' : (loaded?.template.name ?? 'Workflow');

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-base font-semibold text-slate-800">{templateName}</h1>
          {loaded?.template.description && (
            <p className="text-sm text-slate-500 mt-0.5">{loaded.template.description}</p>
          )}
        </div>
        {loaded && (
          <span className="text-xs text-slate-400">
            Version {loaded.template.latestVersion}
          </span>
        )}
      </div>

      {/* Canvas area — scrollable */}
      <div className="flex-1 overflow-y-auto">
        <StudioCanvas
          steps={steps}
          selectedStepId={selectedStepId}
          onSelectStep={setSelectedStepId}
        />
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div className="border-t border-red-200 bg-red-50 px-6 py-3">
          <p className="text-sm font-medium text-red-700 mb-1">Validation errors</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {validationErrors.map((err, i) => (
              <li key={i} className="text-xs text-red-600">
                {err}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bottom bar */}
      {!isNew && (
        <StudioBottomBar
          steps={steps}
          onPublish={() => {
            setConcurrentEdit(null);
            setPublishModalOpen(true);
          }}
          validationErrors={validationErrors}
        />
      )}

      {/* Publish modal */}
      <PublishModal
        open={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        onConfirm={handlePublishConfirm}
        concurrentEditUpstream={concurrentEdit}
        publishing={publishing}
      />
    </div>
  );
}
