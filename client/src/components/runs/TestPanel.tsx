// ---------------------------------------------------------------------------
// TestPanel — inline Run-Now test panel (Feature 2)
// ---------------------------------------------------------------------------
// Displayed as a collapsible right-hand panel on agent and skill authoring
// pages. Provides: fixture picker, prompt input, run button, live trace
// (via RunTraceView), and actions bar.
//
// State (open/closed) is persisted in localStorage keyed on panelKey.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import RunTraceView, { type RunDetail } from './RunTraceView';

export interface TestFixture {
  id: string;
  label: string;
  inputJson: Record<string, unknown>;
}

export interface TestPanelProps {
  /** Unique key for localStorage state. E.g. 'test-panel:agent:<linkId>' */
  panelKey: string;
  /** Label shown in the panel header */
  label?: string;
  /** API endpoint to trigger a test run. POST → { runId: string } */
  testRunEndpoint: string;
  /** API endpoint to list fixtures. GET → { fixtures: TestFixture[] } */
  fixturesEndpoint: string;
  /** API endpoint to save a fixture. POST { label, inputJson } → { fixture } */
  saveFixtureEndpoint: string;
  /** When true, Run button is disabled with "Save your changes first" tooltip */
  hasUnsavedChanges?: boolean;
  /** Deep link to run trace viewer page (prefix). runId is appended. */
  traceViewerBasePath?: string;
}

export default function TestPanel({
  panelKey,
  label = 'Test',
  testRunEndpoint,
  fixturesEndpoint,
  saveFixtureEndpoint,
  hasUnsavedChanges = false,
  traceViewerBasePath,
}: TestPanelProps) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(`${panelKey}:open`) === 'true'; }
    catch { return false; }
  });
  const [prompt, setPrompt] = useState('');
  const [fixtures, setFixtures] = useState<TestFixture[]>([]);
  const [selectedFixture, setSelectedFixture] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveLabel, setSaveLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const toolCallsRef = useRef<HTMLDivElement | null>(null);

  // Persist open state
  useEffect(() => {
    try { localStorage.setItem(`${panelKey}:open`, String(open)); }
    catch { /* ignore */ }
  }, [open, panelKey]);

  // Load fixtures on open
  useEffect(() => {
    if (!open) return;
    api.get<{ fixtures: TestFixture[] }>(fixturesEndpoint)
      .then(r => setFixtures(r.data.fixtures ?? []))
      .catch(() => setFixtures([]));
  }, [open, fixturesEndpoint]);

  // Poll run status until terminal
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await api.get<RunDetail>(`/api/agent-runs/${runId}`);
        if (!cancelled) {
          setRun(r.data);
          const terminal = ['completed', 'failed', 'timeout', 'cancelled', 'budget_exceeded', 'loop_detected'];
          if (!terminal.includes(r.data.status)) {
            setTimeout(poll, 2000);
          } else {
            setRunning(false);
          }
        }
      } catch { if (!cancelled) setRunning(false); }
    };
    poll();
    return () => { cancelled = true; };
  }, [runId]);

  const handleFixtureChange = (id: string) => {
    setSelectedFixture(id);
    const f = fixtures.find(x => x.id === id);
    if (f) setPrompt(JSON.stringify(f.inputJson, null, 2));
  };

  const handleRun = async () => {
    setRunning(true);
    setRun(null);
    setRunId(null);
    setError(null);
    let inputJson: Record<string, unknown> = {};
    if (prompt.trim()) {
      try { inputJson = JSON.parse(prompt); }
      catch { inputJson = { prompt }; }
    }
    // Generate a per-click idempotency key so rapid double-clicks return the
    // same run rather than creating duplicates.
    const idempotencyKey = crypto.randomUUID();
    try {
      const r = await api.post<{ runId: string }>(testRunEndpoint, { prompt, inputJson, idempotencyKey });
      setRunId(r.data.runId);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string; message?: string } } };
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to start test run');
      setRunning(false);
    }
  };

  const handleSaveFixture = async () => {
    if (!saveLabel.trim()) return;
    let inputJson: Record<string, unknown> = {};
    if (prompt.trim()) {
      try { inputJson = JSON.parse(prompt); }
      catch { inputJson = { prompt }; }
    }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await api.post<{ fixture: TestFixture }>(saveFixtureEndpoint, {
        label: saveLabel.trim(),
        inputJson,
      });
      setFixtures(prev => [...prev, r.data.fixture]);
      setSaveLabel('');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setSaveError(err.response?.data?.error || 'Failed to save fixture');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!runId) return;
    try { await api.post(`/api/agent-runs/${runId}/cancel`); }
    catch { /* best-effort */ }
    setRunning(false);
  };

  return (
    <div className="flex flex-col border-l border-slate-200 bg-white" style={{ width: open ? 380 : 40, flexShrink: 0, transition: 'width 0.2s' }}>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-3 border-0 bg-transparent cursor-pointer text-[12px] font-semibold text-slate-500 hover:text-indigo-600 w-full text-left"
        title={open ? 'Collapse test panel' : 'Expand test panel'}
      >
        <span className={`transition-transform ${open ? 'rotate-0' : 'rotate-180'}`}>◀</span>
        {open && <span>{label}</span>}
      </button>

      {open && (
        <div className="flex-1 overflow-y-auto px-3 pb-4 flex flex-col gap-3">
          {/* Test-run indicator */}
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800 font-medium">
            This is a test run — excluded from P&L by default.
          </div>

          {/* Fixture picker */}
          {fixtures.length > 0 && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Load fixture</label>
              <select
                value={selectedFixture}
                onChange={e => handleFixtureChange(e.target.value)}
                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-[12px] bg-white"
              >
                <option value="">Select a fixture…</option>
                {fixtures.map(f => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Prompt / input JSON */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Prompt / input JSON (optional)</label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={4}
              className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-[12px] font-mono bg-white resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="Free-text prompt or JSON object…"
            />
          </div>

          {/* Run button */}
          <button
            onClick={handleRun}
            disabled={running || hasUnsavedChanges}
            title={hasUnsavedChanges ? 'Save your changes first' : undefined}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-lg transition-colors"
          >
            {running ? 'Running…' : 'Run test'}
          </button>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[12px] text-red-700">{error}</div>
          )}

          {/* Trace view */}
          {run && (
            <div className="border-t border-slate-100 pt-3">
              <RunTraceView run={run} toolCallsRef={toolCallsRef} />
            </div>
          )}

          {/* Actions bar */}
          {runId && (
            <div className="flex gap-2 flex-wrap border-t border-slate-100 pt-3">
              {traceViewerBasePath && (
                <Link
                  to={`${traceViewerBasePath}/${runId}`}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[12px] font-medium rounded-lg no-underline"
                >
                  Open in full viewer →
                </Link>
              )}
              {running && (
                <button
                  onClick={handleCancel}
                  className="px-3 py-1.5 border border-red-200 text-red-600 text-[12px] font-medium rounded-lg bg-white hover:bg-red-50"
                >
                  Cancel run
                </button>
              )}
            </div>
          )}

          {/* Save as fixture */}
          <div className="border-t border-slate-100 pt-3">
            <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Save input as fixture</div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={saveLabel}
                onChange={e => setSaveLabel(e.target.value)}
                placeholder="Fixture name…"
                className="flex-1 px-2 py-1 border border-slate-200 rounded-lg text-[12px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                onClick={handleSaveFixture}
                disabled={saving || !saveLabel.trim()}
                className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[12px] font-semibold rounded-lg transition-colors"
              >
                {saving ? '…' : 'Save'}
              </button>
            </div>
            {saveError && <div className="text-[11px] text-red-600 mt-1">{saveError}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
