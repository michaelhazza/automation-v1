/**
 * WorkflowsLibraryPage — list system + org Workflow templates and start runs.
 *
 * Spec: tasks/Workflows-spec.md §9.1 (Phase 1 client UI).
 *
 * Phase 1: minimal but functional. Shows the available templates, lets the
 * user pick a subaccount + provide initial input, and starts a run. Live
 * WebSocket updates and the visual stepper are deferred to Phase 1.5.
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import type { User } from '../lib/auth';

interface SystemTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  latestVersion: number;
}

interface OrgTemplate extends SystemTemplate {
  organisationId: string;
  forkedFromSystemId: string | null;
}

interface Subaccount {
  id: string;
  name: string;
}

export default function WorkflowsLibraryPage(_props: { user: User }) {
  const navigate = useNavigate();
  const [systemTemplates, setSystemTemplates] = useState<SystemTemplate[]>([]);
  const [orgTemplates, setOrgTemplates] = useState<OrgTemplate[]>([]);
  const [subaccounts, setSubaccounts] = useState<Subaccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startTarget, setStartTarget] = useState<{
    kind: 'system' | 'org';
    slug?: string;
    id?: string;
    name: string;
  } | null>(null);
  const [selectedSubaccountId, setSelectedSubaccountId] = useState('');
  const [initialInputJson, setInitialInputJson] = useState('{\n  \n}');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // System templates: requires system_admin. Try and fall through if 403.
        const sys = await api.get('/api/system/Workflow-templates').catch(() => null);
        const org = await api.get('/api/Workflow-templates').catch(() => null);
        const subs = await api.get('/api/subaccounts').catch(() => null);
        if (cancelled) return;
        setSystemTemplates(sys?.data?.templates ?? []);
        setOrgTemplates(org?.data?.templates ?? []);
        setSubaccounts(subs?.data?.subaccounts ?? subs?.data ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load templates');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!startTarget || !selectedSubaccountId) return;
    setStarting(true);
    setStartError(null);
    let parsedInput: Record<string, unknown>;
    try {
      parsedInput = JSON.parse(initialInputJson);
    } catch {
      setStartError('Invalid JSON in initial input');
      setStarting(false);
      return;
    }
    try {
      const body =
        startTarget.kind === 'system'
          ? { systemTemplateSlug: startTarget.slug, input: parsedInput }
          : { templateId: startTarget.id, input: parsedInput };
      const res = await api.post(`/api/subaccounts/${selectedSubaccountId}/Workflow-runs`, body);
      navigate(`/Workflow-runs/${res.data.runId}`);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data
          ?.error ??
        (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data
          ?.message ??
        'Failed to start run';
      setStartError(msg);
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Workflows</h1>
        <p className="text-slate-500">Loading templates…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Workflows</h1>
        <div className="rounded border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>
      </div>
    );
  }

  const allTemplates = [
    ...systemTemplates.map((t) => ({ ...t, kind: 'system' as const })),
    ...orgTemplates.map((t) => ({ ...t, kind: 'org' as const })),
  ];

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900">Workflows</h1>
          <p className="text-[13px] text-slate-500 mt-1">Multi-step flows your agents run.</p>
        </div>
        <Link
          to="/system/workflow-studio"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-semibold rounded-md inline-flex items-center gap-1.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          New Workflow
        </Link>
      </div>

      {allTemplates.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-8 text-center text-slate-600 text-[13px]">
          No workflows yet. System admins can author them via the Workflow Studio.
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 grid grid-cols-12 gap-4 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
            <div className="col-span-6">Name</div>
            <div className="col-span-3">Type</div>
            <div className="col-span-3">Version</div>
          </div>
          {allTemplates.map((t) => (
            <div
              key={t.id}
              className="px-4 py-3.5 border-b border-slate-100 last:border-0 grid grid-cols-12 gap-4 items-center hover:bg-slate-50"
            >
              <div className="col-span-6">
                <div className="text-[13.5px] font-medium text-slate-900">{t.name}</div>
                {t.description && (
                  <div className="text-[12px] text-slate-500 mt-0.5 truncate">{t.description}</div>
                )}
              </div>
              <div className="col-span-3 text-[12.5px] text-slate-600 capitalize">{t.kind}</div>
              <div className="col-span-2 text-[12px] text-slate-500">v{t.latestVersion}</div>
              <div className="col-span-1 flex justify-end">
                <button
                  onClick={() => setStartTarget({ kind: t.kind, slug: 'slug' in t ? t.slug : undefined, id: t.id, name: t.name })}
                  className="px-3 py-1.5 text-[12px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-md"
                >
                  Run
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {startTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold mb-4">Start &ldquo;{startTarget.name}&rdquo;</h2>
            <form onSubmit={handleStart} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Subaccount</label>
                <select
                  value={selectedSubaccountId}
                  onChange={(e) => setSelectedSubaccountId(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2"
                  required
                >
                  <option value="">Select a subaccount…</option>
                  {subaccounts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Initial input (JSON)</label>
                <textarea
                  value={initialInputJson}
                  onChange={(e) => setInitialInputJson(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm h-40"
                  placeholder='{ "eventName": "Launch Party", "audience": "developers" }'
                />
              </div>
              {startError && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {startError}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStartTarget(null)}
                  disabled={starting}
                  className="px-4 py-2 text-sm rounded border border-slate-200 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={starting || !selectedSubaccountId}
                  className="px-4 py-2 text-sm rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {starting ? 'Starting…' : 'Start run'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
