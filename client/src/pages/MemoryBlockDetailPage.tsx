/**
 * MemoryBlockDetailPage — version history + diff + reset-to-canonical (S24)
 *
 * Tabs: Content · Version History · Diff vs Canonical (protected blocks only).
 *
 * Spec: docs/memory-and-briefings-spec.md §S24
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';

interface Version {
  id: string;
  version: number;
  content: string;
  createdAt: string;
  createdByUserId: string | null;
  changeSource: string;
  notes: string | null;
}

interface CanonicalDiff {
  blockId: string;
  blockName: string;
  canonicalPath: string;
  dbContent: string;
  canonicalContent: string;
  diverges: boolean;
  unifiedDiff: string;
}

type Tab = 'history' | 'diff-canonical';

export default function MemoryBlockDetailPage() {
  const { blockId } = useParams<{ blockId: string }>();
  const [tab, setTab] = useState<Tab>('history');
  const [versions, setVersions] = useState<Version[]>([]);
  const [canonical, setCanonical] = useState<CanonicalDiff | null>(null);
  const [canonicalError, setCanonicalError] = useState<string | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<[number | null, number | null]>([null, null]);
  const [diffContent, setDiffContent] = useState<{
    fromVersion: number;
    toVersion: number;
    unifiedDiff: string;
  } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const loadVersions = async () => {
    if (!blockId) return;
    try {
      const res = await api.get<{ versions: Version[] }>(
        `/api/memory-blocks/${blockId}/versions`,
      );
      setVersions(res.data.versions ?? []);
    } catch {
      // non-fatal
    }
  };

  const loadCanonical = async () => {
    if (!blockId) return;
    try {
      const res = await api.get<CanonicalDiff>(
        `/api/memory-blocks/${blockId}/diff-canonical`,
      );
      setCanonical(res.data);
      setCanonicalError(null);
    } catch (err) {
      const code = (err as { response?: { data?: { errorCode?: string } } })?.response?.data
        ?.errorCode;
      if (code === 'NOT_PROTECTED_BLOCK') {
        setCanonicalError('This block is not protected — no canonical file to diff against.');
      } else {
        setCanonicalError('Failed to load canonical diff.');
      }
    }
  };

  useEffect(() => {
    loadVersions();
    if (tab === 'diff-canonical') loadCanonical();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId, tab]);

  async function loadDiff() {
    const [a, b] = selectedVersions;
    if (!blockId || a === null || b === null) return;
    try {
      const res = await api.get<{
        fromVersion: number;
        toVersion: number;
        unifiedDiff: string;
      }>(`/api/memory-blocks/${blockId}/versions/${a}/diff/${b}`);
      setDiffContent(res.data);
    } catch {
      // non-fatal
    }
  }

  async function doReset() {
    if (!blockId) return;
    setResetting(true);
    try {
      await api.post(`/api/memory-blocks/${blockId}/reset-canonical`, {});
      await loadVersions();
      await loadCanonical();
      setShowResetConfirm(false);
    } catch {
      // error surfaced via next load
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-xl font-semibold text-slate-800 mb-1">Memory Block</h1>
      <p className="text-xs text-slate-500 mb-3">ID: {blockId}</p>

      <div className="flex gap-2 border-b border-slate-200 mb-4">
        <button
          type="button"
          className={`px-3 py-1.5 text-sm ${tab === 'history' ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-600'}`}
          onClick={() => setTab('history')}
        >
          Version History
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 text-sm ${tab === 'diff-canonical' ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-600'}`}
          onClick={() => setTab('diff-canonical')}
        >
          Diff vs Canonical
        </button>
      </div>

      {tab === 'history' && (
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2">
            Select two versions to compare
          </p>
          <div className="flex flex-col gap-1 mb-3">
            {versions.map((v) => (
              <label
                key={v.id}
                className="flex items-center gap-2 text-sm border border-slate-200 rounded p-2 cursor-pointer hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selectedVersions.includes(v.version)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedVersions(([a, b]) => {
                        if (a === null) return [v.version, b];
                        if (b === null) return [a, v.version];
                        return [b, v.version];
                      });
                    } else {
                      setSelectedVersions(([a, b]) => [
                        a === v.version ? null : a,
                        b === v.version ? null : b,
                      ]);
                    }
                  }}
                />
                <span className="text-slate-700 font-medium">v{v.version}</span>
                <span className="text-xs text-slate-500">{v.changeSource}</span>
                <span className="text-xs text-slate-400 ml-auto">
                  {new Date(v.createdAt).toLocaleString()}
                </span>
              </label>
            ))}
          </div>
          {selectedVersions[0] !== null && selectedVersions[1] !== null && (
            <button
              type="button"
              onClick={loadDiff}
              className="text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
            >
              Compare v{selectedVersions[0]} ↔ v{selectedVersions[1]}
            </button>
          )}
          {diffContent && (
            <pre className="mt-3 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap max-h-80 overflow-y-auto">
              {diffContent.unifiedDiff}
            </pre>
          )}
        </div>
      )}

      {tab === 'diff-canonical' && (
        <div>
          {canonicalError && (
            <div className="text-sm text-slate-600 italic">{canonicalError}</div>
          )}
          {canonical && (
            <div>
              {canonical.diverges ? (
                <div className="border border-amber-300 bg-amber-50 rounded p-3 mb-3">
                  <p className="text-sm font-semibold text-amber-800">
                    Block diverges from canonical file
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    Canonical: <code>{canonical.canonicalPath}</code>
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(true)}
                    disabled={resetting}
                    className="mt-2 text-sm px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    Reset to canonical
                  </button>
                  {showResetConfirm && (
                    <div className="mt-2 text-xs text-amber-800">
                      This will overwrite the runtime content with the canonical
                      file. A new version row will be created with
                      changeSource=&lsquo;reset_to_canonical&rsquo;.
                      <div className="flex gap-2 mt-1">
                        <button
                          type="button"
                          onClick={doReset}
                          disabled={resetting}
                          className="text-xs px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          {resetting ? 'Resetting…' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowResetConfirm(false)}
                          className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-100"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2 mb-3">
                  Runtime content matches canonical file.
                </div>
              )}
              <pre className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap max-h-96 overflow-y-auto">
                {canonical.unifiedDiff}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
