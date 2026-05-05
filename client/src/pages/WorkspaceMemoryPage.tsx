import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import api from '../lib/api';
import ConfirmDialog from '../components/ConfirmDialog';

interface WorkspaceMemory {
  id: string;
  summary: string | null;
  boardSummary: string | null;
  runsSinceSummary: number;
  summaryThreshold: number;
  version: number;
  summaryGeneratedAt: string | null;
  updatedAt: string;
}

interface MemoryEntry {
  id: string;
  agentId: string;
  agentRunId: string;
  content: string;
  entryType: 'observation' | 'decision' | 'preference' | 'issue' | 'pattern';
  includedInSummary: boolean;
  createdAt: string;
}

const ENTRY_TYPE_CLS: Record<string, string> = {
  observation: 'bg-blue-100 text-blue-800',
  decision:    'bg-green-100 text-green-800',
  preference:  'bg-amber-100 text-amber-800',
  issue:       'bg-red-100 text-red-800',
  pattern:     'bg-indigo-100 text-indigo-800',
};

interface SearchResult {
  content: string;
  similarity: number;
  confidence: 'high' | 'medium' | 'low';
}

type ActiveTab = 'summary' | 'entries' | 'board' | 'search';

export default function WorkspaceMemoryPage({ user: _user, embedded = false }: { user: { id: string; role: string }; embedded?: boolean }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [memory, setMemory] = useState<WorkspaceMemory | null>(null);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('summary');
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchLatency, setSearchLatency] = useState<number | null>(null);

  useEffect(() => { load(); }, [subaccountId]);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get(`/api/subaccounts/${subaccountId}/memory`);
      const data = res.data;
      setMemory(data); setEntries(data.entries ?? []); setSummaryDraft(data.summary ?? '');
    } catch { setError('Failed to load workspace memory'); }
    finally { setLoading(false); }
  }

  async function handleSaveSummary() {
    try {
      setSaving(true);
      await api.put(`/api/subaccounts/${subaccountId}/memory`, { summary: summaryDraft });
      setEditingSummary(false); await load();
    } catch { setError('Failed to save memory'); }
    finally { setSaving(false); }
  }

  async function handleRegenerate() {
    try {
      setRegenerating(true);
      await api.post(`/api/subaccounts/${subaccountId}/memory/regenerate`);
      await load();
    } catch { setError('Failed to regenerate memory'); }
    finally { setRegenerating(false); }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchLatency(null);
    const start = Date.now();
    try {
      const res = await api.post(`/api/subaccounts/${subaccountId}/workspace-memory/search-test`, { query: searchQuery });
      setSearchResults(res.data);
      setSearchLatency(Date.now() - start);
    } catch { setError('Search failed'); }
    finally { setSearching(false); }
  }

  async function handleDeleteEntryConfirm() {
    if (!deleteEntryId) return;
    try {
      await api.delete(`/api/subaccounts/${subaccountId}/memory/entries/${deleteEntryId}`);
      setEntries(entries.filter((e) => e.id !== deleteEntryId));
      toast.success('Memory entry deleted');
    } catch { toast.error('Failed to delete entry'); }
    finally { setDeleteEntryId(null); }
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
          <Link to={`/admin/subaccounts/${subaccountId}`} className="text-[14px] text-indigo-600 hover:text-indigo-700 no-underline mb-2 inline-block">&larr; Back to Company</Link>
          <h1 className="text-[24px] font-bold text-slate-900 mt-2 mb-1">Workspace Memory</h1>
          <p className="text-[14px] text-slate-500 m-0">Shared knowledge compiled from agent runs in this workspace.</p>
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
        {(['summary', 'entries', 'board', 'search'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 bg-transparent border-b-2 -mb-px text-[14px] cursor-pointer transition-colors capitalize ${activeTab === tab ? 'border-indigo-600 text-indigo-600 font-semibold' : 'border-transparent text-slate-500 font-normal hover:text-slate-700'}`}
          >
            {tab === 'board' ? 'Board Summary' : tab === 'search' ? 'Search Diagnostics' : tab}
          </button>
        ))}
      </div>

      {activeTab === 'summary' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-[16px] font-semibold text-slate-800 m-0">Compiled Memory</h2>
            <div className="flex gap-2">
              <button onClick={handleRegenerate} disabled={regenerating} className="btn btn-sm btn-secondary disabled:opacity-50">
                {regenerating ? 'Regenerating...' : 'Regenerate'}
              </button>
              {!editingSummary ? (
                <button onClick={() => { setEditingSummary(true); setSummaryDraft(memory?.summary ?? ''); }} className="btn btn-sm btn-primary">Edit</button>
              ) : (
                <>
                  <button onClick={() => setEditingSummary(false)} className="btn btn-sm btn-secondary">Cancel</button>
                  <button onClick={handleSaveSummary} disabled={saving} className="btn btn-sm btn-success disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
                </>
              )}
            </div>
          </div>

          {editingSummary ? (
            <textarea
              value={summaryDraft}
              onChange={(e) => setSummaryDraft(e.target.value)}
              className="w-full min-h-[300px] px-4 py-4 border border-slate-200 rounded-xl text-[14px] leading-relaxed font-[inherit] resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          ) : (
            <div className={`px-5 py-5 bg-slate-50 border border-slate-200 rounded-xl whitespace-pre-wrap text-[14px] leading-relaxed min-h-[100px] ${memory?.summary ? 'text-slate-800' : 'text-slate-400'}`}>
              {memory?.summary || 'No memory compiled yet. Memory will be generated automatically after agents run.'}
            </div>
          )}
        </div>
      )}

      {activeTab === 'entries' && (
        <div>
          <h2 className="text-[16px] font-semibold text-slate-800 mb-4">Memory Entries ({entries.length})</h2>
          {entries.length === 0 ? (
            <div className="py-10 text-center text-[14px] text-slate-400">No entries yet. Entries are extracted automatically after each agent run.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {entries.map((entry) => (
                <div key={entry.id} className="px-4 py-4 bg-white border border-slate-200 rounded-xl flex gap-3 items-start">
                  <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap mt-0.5 ${ENTRY_TYPE_CLS[entry.entryType] ?? 'bg-slate-100 text-slate-600'}`}>
                    {entry.entryType}
                  </span>
                  <div className="flex-1">
                    <p className="m-0 mb-1 text-[14px] text-slate-800 leading-relaxed">{entry.content}</p>
                    <div className="flex gap-3 text-[12px] text-slate-400">
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                      {entry.includedInSummary && <span className="text-green-600">Included in summary</span>}
                    </div>
                  </div>
                  <button onClick={() => setDeleteEntryId(entry.id)} title="Delete entry" className="bg-transparent border-0 text-slate-300 hover:text-red-400 cursor-pointer text-lg px-1 leading-none transition-colors">&times;</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'board' && (
        <div>
          <h2 className="text-[16px] font-semibold text-slate-800 mb-2">Board Summary</h2>
          <p className="text-[13px] text-slate-500 mb-4">
            A compressed snapshot of the board state, injected into agent context instead of raw task listings. Regenerated alongside the main memory summary.
          </p>
          <div className={`px-5 py-5 bg-slate-50 border border-slate-200 rounded-xl whitespace-pre-wrap text-[14px] leading-relaxed min-h-[100px] ${memory?.boardSummary ? 'text-slate-800' : 'text-slate-400'}`}>
            {memory?.boardSummary || 'No board summary generated yet. This will be created when memory is regenerated.'}
          </div>
        </div>
      )}

      {activeTab === 'search' && (
        <div>
          <h2 className="text-[16px] font-semibold text-slate-800 mb-2">Search Diagnostics</h2>
          <p className="text-[13px] text-slate-500 mb-4">
            Test memory retrieval quality. Enter a query to see what memory entries would be surfaced to an agent.
          </p>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              placeholder="Enter a test query..."
              className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !searchQuery.trim()}
              className="btn btn-primary disabled:opacity-50"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>

          {searchLatency !== null && (
            <div className="text-[12px] text-slate-400 mb-4">
              {searchResults.length} results · {searchLatency}ms
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="flex flex-col gap-3">
              {searchResults.map((result, idx) => {
                const confidenceCls = result.confidence === 'high' ? 'bg-green-100 text-green-700' :
                  result.confidence === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600';
                return (
                  <div key={idx} className="px-4 py-4 bg-white border border-slate-200 rounded-xl">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[13px] font-semibold text-slate-700">Score: {result.similarity?.toFixed(3) ?? '—'}</span>
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${confidenceCls}`}>
                        {result.confidence}
                      </span>
                    </div>
                    <p className="m-0 text-[14px] text-slate-800 leading-relaxed">{result.content}</p>
                  </div>
                );
              })}
            </div>
          )}

          {searchLatency !== null && searchResults.length === 0 && (
            <div className="py-10 text-center text-[14px] text-slate-400">
              No results found. Try a different query or check that entries have embeddings.
            </div>
          )}
        </div>
      )}

      {deleteEntryId && (
        <ConfirmDialog
          title="Delete Entry"
          message="Delete this memory entry? This cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDeleteEntryConfirm}
          onCancel={() => setDeleteEntryId(null)}
        />
      )}
    </div>
  );
}
