/**
 * PlaybookStudioPage — system-admin chat authoring UI for Playbooks.
 *
 * Spec: tasks/playbooks-spec.md §10.8.
 *
 * Phase 1 layout:
 *   ┌────────┬──────────────┬────────────────┐
 *   │ Sessions│  Chat        │ Candidate file │
 *   │  list   │  + tools     │ (Monaco-lite)  │
 *   └────────┴──────────────┴────────────────┘
 *
 * Phase 1 ships the page with:
 *   - Sessions sidebar (create, switch, persist)
 *   - Editable candidate file textarea (right pane)
 *   - Four tool buttons that call the backend: Validate, Simulate, Estimate, Save & Open PR
 *   - Tool result panel below the chat input
 *   - System-admin gated route (server already enforces requireSystemAdmin)
 *
 * The chat-with-the-Playbook-Author-agent piece is a follow-up that
 * requires seeding the agent definition into the DB. The Phase 1 page
 * lets a system admin author by hand or paste agent output, validate,
 * simulate, estimate, and save through the same trust boundary the
 * agent would use.
 */

import React, { useEffect, useState } from 'react';
import api from '../lib/api';
import type { User } from '../lib/auth';

interface Session {
  id: string;
  candidateFileContents: string;
  candidateValidationState: 'unvalidated' | 'valid' | 'invalid';
  prUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ValidationError {
  rule: string;
  stepId?: string;
  message: string;
}

type ToolResult =
  | { kind: 'validate'; ok: boolean; errors?: ValidationError[]; definitionHash?: string }
  | {
      kind: 'simulate';
      ok: boolean;
      summary?: {
        stepCount: number;
        maxParallelism: number;
        criticalPathLength: number;
        irreversibleCount: number;
        reversibleCount: number;
        humanReviewCount: number;
        topologicalOrder: string[];
      };
      errors?: ValidationError[];
    }
  | { kind: 'estimate'; cents: number; mode: string; perStep: Record<string, number> }
  | { kind: 'save'; ok: boolean; prUrl?: string; errors?: ValidationError[] };

// Default starter definition shown in the JSON pane on first load.
// The user edits this; the server renders the corresponding .playbook.ts
// file body and returns it via the /render endpoint.
const STARTER_DEFINITION_JSON = `{
  "slug": "my-new-playbook",
  "name": "My New Playbook",
  "description": "",
  "version": 1,
  "steps": [
    {
      "id": "first_step",
      "name": "First step",
      "type": "user_input",
      "dependsOn": [],
      "sideEffectType": "none",
      "formSchema": {},
      "outputSchema": {}
    }
  ]
}`;

export default function PlaybookStudioPage(_props: { user: User }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Read-only preview of the .playbook.ts file the server would commit
  // for the current definition. Populated by the /render endpoint after
  // a successful Validate, and again by the /save-and-open-pr response.
  // The user never edits this directly — it is the server's
  // authoritative output. Click Validate any time to refresh it after
  // editing the definition JSON.
  const [renderedPreview, setRenderedPreview] = useState<string>(
    '// Click Validate after editing the definition below to refresh this preview.\n'
  );
  const [definitionJson, setDefinitionJson] = useState(STARTER_DEFINITION_JSON);
  const [toolResult, setToolResult] = useState<ToolResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [existingSlugs, setExistingSlugs] = useState<string[]>([]);

  async function loadSessions() {
    try {
      const res = await api.get('/api/system/playbook-studio/sessions');
      setSessions(res.data.sessions ?? []);
    } catch (err) {
      const msg =
        (err as { response?: { status?: number } })?.response?.status === 403
          ? 'Playbook Studio requires system_admin access.'
          : err instanceof Error
          ? err.message
          : 'Failed to load sessions';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function loadExistingSlugs() {
    try {
      const res = await api.get('/api/system/playbook-studio/playbooks');
      setExistingSlugs(res.data.slugs ?? []);
    } catch {
      // Ignore — sidebar reference list is non-critical.
    }
  }

  useEffect(() => {
    loadSessions();
    loadExistingSlugs();
  }, []);

  async function createSession() {
    try {
      const res = await api.post('/api/system/playbook-studio/sessions');
      const created: Session = res.data.session;
      setSessions([created, ...sessions]);
      setActiveSessionId(created.id);
      setRenderedPreview('// Edit the definition JSON below and click Validate to render a preview.\n');
      setToolResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    }
  }

  async function switchSession(s: Session) {
    setActiveSessionId(s.id);
    setRenderedPreview(
      s.candidateFileContents ||
        '// No saved candidate yet. Edit the definition JSON below and click Validate to render a preview.\n'
    );
    setToolResult(null);
  }

  async function loadReference(slug: string) {
    try {
      const res = await api.get(`/api/system/playbook-studio/playbooks/${slug}`);
      // Reference playbooks are loaded into the preview pane for the
      // user to read, but the source of truth is still the definition
      // JSON below — they should copy structural patterns into their
      // own definition rather than editing the preview directly.
      setRenderedPreview(res.data.contents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reference');
    }
  }

  async function callTool(
    kind: 'validate' | 'simulate' | 'estimate'
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(definitionJson);
      } catch (parseErr) {
        setToolResult({
          kind: kind === 'validate' ? 'validate' : kind === 'simulate' ? 'simulate' : 'estimate',
          ok: false,
          errors: [
            {
              rule: 'missing_field',
              message: `JSON parse error: ${
                parseErr instanceof Error ? parseErr.message : 'invalid JSON'
              }`,
            },
          ],
        } as ToolResult);
        setBusy(false);
        return;
      }

      if (kind === 'validate') {
        const res = await api.post('/api/system/playbook-studio/validate', { definition: parsed });
        setToolResult({ kind: 'validate', ...res.data });
        // On a successful validate, refresh the preview pane so the
        // user sees the canonical file body the server would commit
        // for this definition. The preview is the single source of
        // truth — it's exactly what saveAndOpenPr would render.
        if (res.data?.ok) {
          await refreshPreview(parsed);
        }
      } else if (kind === 'simulate') {
        const res = await api.post('/api/system/playbook-studio/simulate', { definition: parsed });
        setToolResult({ kind: 'simulate', ...res.data });
      } else {
        const res = await api.post('/api/system/playbook-studio/estimate', {
          definition: parsed,
          mode: 'pessimistic',
        });
        setToolResult({ kind: 'estimate', ...res.data });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tool call failed');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Re-runs validate against the current definition JSON. Returns the
   * fresh canonical hash on success, null on failure (with the error
   * surfaced via toolResult). Used by saveAndOpenPr to guarantee the
   * Definition-only save flow.
   *
   * The server is the only producer of the .playbook.ts file body —
   * the UI sends just the validated definition object. The server
   * validates, renders the file deterministically, and commits it.
   * There is no client-side fileContents anywhere in this path, so
   * there's nothing the client can tamper with that bypasses
   * validation.
   *
   * The "preview" pane shows what the server would commit (via the
   * /render endpoint, refreshed by Validate clicks and by the
   * save-and-open-pr response).
   */

  /**
   * Re-renders the preview pane against the current definition. Called
   * after a successful Validate so the user always sees the latest
   * server-rendered file body before they save. Simulate and Estimate
   * do not refresh the preview because they don't change the canonical
   * file body — only the definition does.
   */
  async function refreshPreview(definition: unknown): Promise<void> {
    try {
      const res = await api.post('/api/system/playbook-studio/render', { definition });
      if (res.data?.ok && typeof res.data?.fileContents === 'string') {
        setRenderedPreview(res.data.fileContents);
      }
    } catch {
      // Preview is best-effort; if the definition is invalid the render
      // endpoint returns 422 and the user sees the validate result.
    }
  }

  async function saveAndOpenPr() {
    if (!activeSessionId) {
      setError('Create or select a session first');
      return;
    }
    let parsedDefinition: unknown;
    try {
      parsedDefinition = JSON.parse(definitionJson);
    } catch (parseErr) {
      setError(
        `Definition JSON is invalid — fix it before saving: ${
          parseErr instanceof Error ? parseErr.message : 'parse failed'
        }`
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post(
        `/api/system/playbook-studio/sessions/${activeSessionId}/save-and-open-pr`,
        { definition: parsedDefinition }
      );
      // The server returns its rendered file alongside the PR URL —
      // surface it in the preview so the user sees exactly what landed.
      if (typeof res.data?.renderedFileContents === 'string') {
        setRenderedPreview(res.data.renderedFileContents);
      }
      setToolResult({ kind: 'save', ok: true, ...res.data });
      await loadSessions();
    } catch (err) {
      const data = (err as {
        response?: {
          data?: {
            ok?: boolean;
            errors?: ValidationError[];
            renderedFileContents?: string;
          };
        };
      })?.response?.data;
      if (data?.renderedFileContents) {
        setRenderedPreview(data.renderedFileContents);
      }
      if (data?.errors) {
        setToolResult({ kind: 'save', ok: false, errors: data.errors });
      } else {
        setError(err instanceof Error ? err.message : 'Save failed');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-slate-500">Loading Playbook Studio…</div>;
  }
  if (error && !activeSessionId) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold mb-4">Playbook Studio</h1>
        <div className="rounded border border-red-200 bg-red-50 p-4 text-red-800">{error}</div>
      </div>
    );
  }

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      {/* Sessions sidebar */}
      <aside className="w-64 border-r border-slate-200 bg-slate-50 flex flex-col">
        <div className="p-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-700">Playbook Studio</h2>
          <button
            onClick={createSession}
            className="mt-2 w-full px-3 py-1.5 text-sm rounded bg-slate-900 text-white hover:bg-slate-800"
          >
            + New session
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          <div className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-slate-500">
            Sessions
          </div>
          {sessions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">No sessions yet</div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => switchSession(s)}
                className={`w-full text-left px-3 py-2 text-xs border-l-2 ${
                  activeSessionId === s.id
                    ? 'bg-white border-slate-900'
                    : 'border-transparent hover:bg-white'
                }`}
              >
                <div className="font-medium truncate">
                  Session {s.id.slice(0, 8)}
                </div>
                <div
                  className={`text-[10px] uppercase mt-0.5 ${
                    s.candidateValidationState === 'valid'
                      ? 'text-emerald-600'
                      : s.candidateValidationState === 'invalid'
                      ? 'text-red-600'
                      : 'text-slate-500'
                  }`}
                >
                  {s.candidateValidationState}
                  {s.prUrl && ' · PR'}
                </div>
              </button>
            ))
          )}
          <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider text-slate-500">
            Reference playbooks
          </div>
          {existingSlugs.map((slug) => (
            <button
              key={slug}
              onClick={() => loadReference(slug)}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-white truncate"
              title={`Load ${slug}.playbook.ts into editor`}
            >
              {slug}
            </button>
          ))}
        </div>
      </aside>

      {/* Centre — file editor + tools */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2 text-xs">
          <span className="text-slate-500">
            {activeSession ? `Editing session ${activeSession.id.slice(0, 8)}` : 'No active session — create one to save'}
          </span>
          {activeSession?.prUrl && (
            <span className="text-emerald-600 font-mono">{activeSession.prUrl}</span>
          )}
        </div>

        {/* Read-only preview of the file the server would commit. The
            user never edits this directly — the source of truth is the
            definition JSON pane below. The server's /render endpoint
            populates this value after a successful Validate, and again
            from the save-and-open-pr response. */}
        <textarea
          value={renderedPreview}
          readOnly
          className="flex-1 font-mono text-xs p-4 border-0 focus:outline-none resize-none bg-slate-900 text-slate-100"
          spellCheck={false}
          aria-label="Server-rendered playbook file preview (read-only)"
        />

        <div className="border-t border-slate-200 p-3 bg-slate-50 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Definition JSON (for validate / simulate / estimate):</span>
          </div>
          <textarea
            value={definitionJson}
            onChange={(e) => setDefinitionJson(e.target.value)}
            className="w-full font-mono text-xs p-2 rounded border border-slate-300 h-24"
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => callTool('validate')}
              disabled={busy}
              className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Validate
            </button>
            <button
              onClick={() => callTool('simulate')}
              disabled={busy}
              className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Simulate
            </button>
            <button
              onClick={() => callTool('estimate')}
              disabled={busy}
              className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Estimate cost
            </button>
            <span className="flex-1" />
            <button
              onClick={saveAndOpenPr}
              disabled={busy || !activeSessionId}
              className="px-3 py-1.5 text-xs rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              title={!activeSessionId ? 'Create or select a session first' : ''}
            >
              Save & Open PR
            </button>
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {error}
            </div>
          )}

          {toolResult && (
            <div className="text-xs bg-white border border-slate-200 rounded p-3 max-h-72 overflow-auto">
              {toolResult.kind === 'validate' && (
                <>
                  <div className="font-semibold mb-1">
                    Validate result:{' '}
                    <span className={toolResult.ok ? 'text-emerald-600' : 'text-red-600'}>
                      {toolResult.ok ? 'ok' : `${toolResult.errors?.length ?? 0} errors`}
                    </span>
                  </div>
                  {toolResult.errors?.map((e, i) => (
                    <div key={i} className="text-red-700">
                      [{e.rule}] {e.stepId ? `${e.stepId}: ` : ''}
                      {e.message}
                    </div>
                  ))}
                </>
              )}
              {toolResult.kind === 'simulate' && (
                <>
                  <div className="font-semibold mb-1">
                    Simulate result:{' '}
                    <span className={toolResult.ok ? 'text-emerald-600' : 'text-red-600'}>
                      {toolResult.ok ? 'ok' : 'failed'}
                    </span>
                  </div>
                  {toolResult.summary && (
                    <pre className="text-xs">{JSON.stringify(toolResult.summary, null, 2)}</pre>
                  )}
                </>
              )}
              {toolResult.kind === 'estimate' && (
                <>
                  <div className="font-semibold mb-1">
                    Estimated cost ({toolResult.mode}):{' '}
                    <span className="text-slate-900">${(toolResult.cents / 100).toFixed(2)}</span>
                  </div>
                  <pre className="text-xs">{JSON.stringify(toolResult.perStep, null, 2)}</pre>
                </>
              )}
              {toolResult.kind === 'save' && (
                <>
                  <div className="font-semibold mb-1">
                    Save result:{' '}
                    <span className={toolResult.ok ? 'text-emerald-600' : 'text-red-600'}>
                      {toolResult.ok ? 'ok' : 'rejected'}
                    </span>
                  </div>
                  {toolResult.prUrl && (
                    <div className="text-emerald-700 font-mono">{toolResult.prUrl}</div>
                  )}
                  {toolResult.errors?.map((e, i) => (
                    <div key={i} className="text-red-700">
                      [{e.rule}] {e.stepId ? `${e.stepId}: ` : ''}
                      {e.message}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
