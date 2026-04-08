import { useState, useEffect } from 'react';
import api from '../lib/api';

interface OrgMemory {
  id: string;
  summary: string | null;
  runsSinceSummary: number;
  summaryThreshold: number;
  version: number;
  summaryGeneratedAt: string | null;
}

interface OrgMemoryEntry {
  id: string;
  content: string;
  entryType: string;
  scopeTags: Record<string, string> | null;
  qualityScore: number;
  evidenceCount: number;
  includedInSummary: boolean;
  createdAt: string;
}

const ENTRY_TYPE_CLS: Record<string, string> = {
  observation: 'bg-blue-100 text-blue-800',
  decision: 'bg-green-100 text-green-800',
  preference: 'bg-amber-100 text-amber-800',
  issue: 'bg-red-100 text-red-800',
  pattern: 'bg-indigo-100 text-indigo-800',
};

type Tab = 'summary' | 'entries';

export default function OrgMemoryPage({ embedded }: { embedded?: boolean } = {}) {
  const [memory, setMemory] = useState<OrgMemory | null>(null);
  const [entries, setEntries] = useState<OrgMemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('summary');
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      setLoading(true);
      const [memRes, entRes] = await Promise.all([
        api.get('/api/org/memory'),
        api.get('/api/org/memory/entries'),
      ]);
      setMemory(memRes.data);
      setEntries(entRes.data);
      setSummaryDraft(memRes.data?.summary ?? '');
    } catch { setError('Failed to load org memory'); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    try {
      setSaving(true);
      await api.put('/api/org/memory', { summary: summaryDraft });
      setEditingSummary(false);
      await load();
    } catch { setError('Failed to save'); }
    finally { setSaving(false); }
  }

  async function handleDelete(entryId: string) {
    if (!confirm('Delete this org memory entry?')) return;
    try {
      await api.delete(`/api/org/memory/entries/${entryId}`);
      setEntries(entries.filter(e => e.id !== entryId));
    } catch { setError('Failed to delete'); }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="h-6 w-48 rounded mb-4 bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        <div className="h-48 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      {!embedded && (
        <div className="mb-6">
          <h1 className="text-[24px] font-bold text-slate-900 mt-0 mb-1">Organisation Memory</h1>
          <p className="text-[14px] text-slate-500 m-0">Cross-subaccount intelligence compiled from agent runs across your organisation.</p>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg mb-4 text-[14px] flex justify-between items-center">
          {error}
          <button onClick={() => setError('')} className="bg-transparent border-0 cursor-pointer text-red-700 text-lg">&times;</button>
        </div>
      )}

      <div className="flex gap-4 mb-6 flex-wrap">
        {[
          { label: 'Version', value: String(memory?.version ?? 0) },
          { label: 'Runs Since Summary', value: `${memory?.runsSinceSummary ?? 0} / ${memory?.summaryThreshold ?? 5}` },
          { label: 'Last Generated', value: memory?.summaryGeneratedAt ? new Date(memory.summaryGeneratedAt).toLocaleString() : 'Never' },
          { label: 'Entries', value: String(entries.length) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 min-w-[100px]">
            <div className="text-[11px] text-slate-400 font-medium mb-0.5">{label}</div>
            <div className="text-[16px] font-semibold text-slate-900">{value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-0 border-b border-slate-200 mb-6">
        {(['summary', 'entries'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 bg-transparent border-b-2 -mb-px text-[14px] cursor-pointer transition-colors capitalize ${activeTab === tab ? 'border-indigo-600 text-indigo-600 font-semibold' : 'border-transparent text-slate-500 font-normal hover:text-slate-700'}`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'summary' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[16px] font-semibold text-slate-800 m-0">Compiled Summary</h2>
            <div className="flex gap-2">
              {!editingSummary ? (
                <button onClick={() => { setEditingSummary(true); setSummaryDraft(memory?.summary ?? ''); }} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13px] cursor-pointer">Edit</button>
              ) : (
                <>
                  <button onClick={() => setEditingSummary(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg text-[13px] text-slate-600 cursor-pointer">Cancel</button>
                  <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white border-0 rounded-lg text-[13px] cursor-pointer">{saving ? 'Saving...' : 'Save'}</button>
                </>
              )}
            </div>
          </div>
          {editingSummary ? (
            <textarea value={summaryDraft} onChange={e => setSummaryDraft(e.target.value)} className="w-full min-h-[300px] px-4 py-4 border border-slate-200 rounded-xl text-[14px] leading-relaxed font-[inherit] resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          ) : (
            <div className={`px-5 py-5 bg-slate-50 border border-slate-200 rounded-xl whitespace-pre-wrap text-[14px] leading-relaxed min-h-[100px] ${memory?.summary ? 'text-slate-800' : 'text-slate-400'}`}>
              {memory?.summary || 'No org memory compiled yet.'}
            </div>
          )}
        </div>
      )}

      {activeTab === 'entries' && (
        <div>
          <h2 className="text-[16px] font-semibold text-slate-800 mb-4">Entries ({entries.length})</h2>
          {entries.length === 0 ? (
            <div className="py-10 text-center text-[14px] text-slate-400">No entries yet.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {entries.map(entry => (
                <div key={entry.id} className="px-4 py-4 bg-white border border-slate-200 rounded-xl flex gap-3 items-start">
                  <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap mt-0.5 ${ENTRY_TYPE_CLS[entry.entryType] ?? 'bg-slate-100 text-slate-600'}`}>{entry.entryType}</span>
                  <div className="flex-1">
                    <p className="m-0 mb-1 text-[14px] text-slate-800 leading-relaxed">{entry.content}</p>
                    <div className="flex gap-3 text-[12px] text-slate-400 flex-wrap">
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                      <span>Quality: {entry.qualityScore?.toFixed(2)}</span>
                      <span>Evidence: {entry.evidenceCount}</span>
                      {entry.scopeTags && Object.keys(entry.scopeTags).length > 0 && (
                        <span>Tags: {Object.entries(entry.scopeTags).map(([k, v]) => `${k}=${v}`).join(', ')}</span>
                      )}
                      {entry.includedInSummary && <span className="text-green-600">In summary</span>}
                    </div>
                  </div>
                  <button onClick={() => handleDelete(entry.id)} title="Delete" className="bg-transparent border-0 text-slate-300 hover:text-red-400 cursor-pointer text-lg px-1">&times;</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
