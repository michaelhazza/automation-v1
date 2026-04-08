/**
 * PlaybooksLibraryPage — list system + org playbook templates and start runs.
 *
 * Spec: tasks/playbooks-spec.md §9.1 (Phase 1 client UI).
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

export default function PlaybooksLibraryPage(_props: { user: User }) {
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
        const sys = await api.get('/api/system/playbook-templates').catch(() => null);
        const org = await api.get('/api/playbook-templates').catch(() => null);
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
      const res = await api.post(`/api/subaccounts/${selectedSubaccountId}/playbook-runs`, body);
      navigate(`/playbook-runs/${res.data.runId}`);
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
        <h1 className="text-2xl font-semibold mb-4">Playbooks</h1>
        <p className="text-slate-500">Loading templates…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Playbooks</h1>
        <div className="rounded border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>
      </div>
    );
  }

  const allEmpty = systemTemplates.length === 0 && orgTemplates.length === 0;

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-semibold mb-1">Playbooks</h1>
      <p className="text-slate-500 mb-6">
        Multi-step automated workflows. Pick a template and start a run against a subaccount.
      </p>

      {allEmpty && (
        <div className="rounded border border-slate-200 bg-slate-50 p-6 text-slate-700">
          No playbook templates available yet. System admins can author them via the seeder
          (server/playbooks/*.playbook.ts) or via the Playbook Studio.
        </div>
      )}

      {systemTemplates.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-medium mb-3">System templates</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {systemTemplates.map((t) => (
              <div key={t.id} className="rounded-lg border border-slate-200 p-4 bg-white">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium">{t.name}</h3>
                  <span className="text-xs text-slate-500">v{t.latestVersion}</span>
                </div>
                <p className="text-sm text-slate-600 mb-3 line-clamp-3">{t.description}</p>
                <button
                  onClick={() =>
                    setStartTarget({ kind: 'system', slug: t.slug, name: t.name })
                  }
                  className="px-3 py-1.5 text-sm rounded bg-slate-900 text-white hover:bg-slate-800"
                >
                  Start run
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {orgTemplates.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-3">Org templates</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {orgTemplates.map((t) => (
              <div key={t.id} className="rounded-lg border border-slate-200 p-4 bg-white">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium">{t.name}</h3>
                  <span className="text-xs text-slate-500">v{t.latestVersion}</span>
                </div>
                <p className="text-sm text-slate-600 mb-3 line-clamp-3">{t.description}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setStartTarget({ kind: 'org', id: t.id, name: t.name })}
                    className="px-3 py-1.5 text-sm rounded bg-slate-900 text-white hover:bg-slate-800"
                  >
                    Start run
                  </button>
                  <Link
                    to={`/playbook-templates/${t.id}`}
                    className="px-3 py-1.5 text-sm rounded border border-slate-200 hover:bg-slate-50"
                  >
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
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
