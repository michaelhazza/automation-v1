import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../lib/api';

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

interface Props {
  user: { id: string; role: string };
}

const ENTRY_TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  observation: { bg: '#dbeafe', text: '#1e40af' },
  decision: { bg: '#dcfce7', text: '#166534' },
  preference: { bg: '#fef3c7', text: '#92400e' },
  issue: { bg: '#fee2e2', text: '#991b1b' },
  pattern: { bg: '#e0e7ff', text: '#3730a3' },
};

export default function WorkspaceMemoryPage({ user }: Props) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [memory, setMemory] = useState<WorkspaceMemory | null>(null);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'entries' | 'board'>('summary');

  useEffect(() => {
    load();
  }, [subaccountId]);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get(`/api/subaccounts/${subaccountId}/memory`);
      const data = res.data;
      setMemory(data);
      setEntries(data.entries ?? []);
      setSummaryDraft(data.summary ?? '');
    } catch (err) {
      setError('Failed to load workspace memory');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSummary() {
    try {
      setSaving(true);
      await api.put(`/api/subaccounts/${subaccountId}/memory`, { summary: summaryDraft });
      setEditingSummary(false);
      await load();
    } catch (err) {
      setError('Failed to save memory');
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerate() {
    try {
      setRegenerating(true);
      await api.post(`/api/subaccounts/${subaccountId}/memory/regenerate`);
      await load();
    } catch (err) {
      setError('Failed to regenerate memory');
    } finally {
      setRegenerating(false);
    }
  }

  async function handleDeleteEntry(entryId: string) {
    if (!confirm('Delete this memory entry?')) return;
    try {
      await api.delete(`/api/subaccounts/${subaccountId}/memory/entries/${entryId}`);
      setEntries(entries.filter(e => e.id !== entryId));
    } catch (err) {
      setError('Failed to delete entry');
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ height: 24, width: 200, background: '#e2e8f0', borderRadius: 4, marginBottom: 16 }} />
        <div style={{ height: 200, background: '#e2e8f0', borderRadius: 8 }} />
      </div>
    );
  }

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Link
          to={`/admin/subaccounts/${subaccountId}`}
          style={{ color: '#6366f1', textDecoration: 'none', fontSize: 14, marginBottom: 8, display: 'inline-block' }}
        >
          &larr; Back to Subaccount
        </Link>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', margin: '8px 0 4px' }}>
          Workspace Memory
        </h1>
        <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
          Shared knowledge compiled from agent runs in this workspace.
        </p>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fee2e2', color: '#991b1b', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b' }}>
            &times;
          </button>
        </div>
      )}

      {/* Metadata bar */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 24, flexWrap: 'wrap' }}>
        <MetaStat label="Version" value={String(memory?.version ?? 0)} />
        <MetaStat label="Runs Since Summary" value={`${memory?.runsSinceSummary ?? 0} / ${memory?.summaryThreshold ?? 5}`} />
        <MetaStat
          label="Last Generated"
          value={memory?.summaryGeneratedAt ? new Date(memory.summaryGeneratedAt).toLocaleString() : 'Never'}
        />
        <MetaStat label="Entries" value={String(entries.length)} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e2e8f0', marginBottom: 24 }}>
        {(['summary', 'entries', 'board'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '10px 20px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #6366f1' : '2px solid transparent',
              marginBottom: -2,
              color: activeTab === tab ? '#6366f1' : '#64748b',
              fontWeight: activeTab === tab ? 600 : 400,
              cursor: 'pointer',
              fontSize: 14,
              textTransform: 'capitalize',
            }}
          >
            {tab === 'board' ? 'Board Summary' : tab}
          </button>
        ))}
      </div>

      {/* Summary Tab */}
      {activeTab === 'summary' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: 0 }}>Compiled Memory</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                style={{
                  padding: '8px 16px',
                  background: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  cursor: regenerating ? 'not-allowed' : 'pointer',
                  fontSize: 13,
                  color: '#475569',
                }}
              >
                {regenerating ? 'Regenerating...' : 'Regenerate'}
              </button>
              {!editingSummary ? (
                <button
                  onClick={() => { setEditingSummary(true); setSummaryDraft(memory?.summary ?? ''); }}
                  style={{
                    padding: '8px 16px',
                    background: '#6366f1',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  Edit
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setEditingSummary(false)}
                    style={{
                      padding: '8px 16px',
                      background: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 13,
                      color: '#475569',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveSummary}
                    disabled={saving}
                    style={{
                      padding: '8px 16px',
                      background: '#16a34a',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: saving ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </>
              )}
            </div>
          </div>

          {editingSummary ? (
            <textarea
              value={summaryDraft}
              onChange={e => setSummaryDraft(e.target.value)}
              style={{
                width: '100%',
                minHeight: 300,
                padding: 16,
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                fontSize: 14,
                lineHeight: 1.6,
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
            />
          ) : (
            <div
              style={{
                padding: 20,
                background: '#f8fafc',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                whiteSpace: 'pre-wrap',
                fontSize: 14,
                lineHeight: 1.6,
                color: memory?.summary ? '#1e293b' : '#94a3b8',
                minHeight: 100,
              }}
            >
              {memory?.summary || 'No memory compiled yet. Memory will be generated automatically after agents run.'}
            </div>
          )}
        </div>
      )}

      {/* Entries Tab */}
      {activeTab === 'entries' && (
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 16px' }}>
            Memory Entries ({entries.length})
          </h2>

          {entries.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
              No entries yet. Entries are extracted automatically after each agent run.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {entries.map(entry => (
                <div
                  key={entry.id}
                  style={{
                    padding: 16,
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      background: ENTRY_TYPE_COLORS[entry.entryType]?.bg ?? '#f1f5f9',
                      color: ENTRY_TYPE_COLORS[entry.entryType]?.text ?? '#475569',
                      whiteSpace: 'nowrap',
                      marginTop: 2,
                    }}
                  >
                    {entry.entryType}
                  </span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 4px', fontSize: 14, color: '#1e293b', lineHeight: 1.5 }}>
                      {entry.content}
                    </p>
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#94a3b8' }}>
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                      {entry.includedInSummary && <span style={{ color: '#16a34a' }}>Included in summary</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteEntry(entry.id)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: 16,
                      padding: '0 4px',
                    }}
                    title="Delete entry"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Board Summary Tab */}
      {activeTab === 'board' && (
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', margin: '0 0 16px' }}>
            Board Summary
          </h2>
          <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 16px' }}>
            A compressed snapshot of the board state, injected into agent context instead of raw task listings. Regenerated alongside the main memory summary.
          </p>
          <div
            style={{
              padding: 20,
              background: '#f8fafc',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              whiteSpace: 'pre-wrap',
              fontSize: 14,
              lineHeight: 1.6,
              color: memory?.boardSummary ? '#1e293b' : '#94a3b8',
              minHeight: 100,
            }}
          >
            {memory?.boardSummary || 'No board summary generated yet. This will be created when memory is regenerated.'}
          </div>
        </div>
      )}
    </div>
  );
}

function MetaStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 16px', minWidth: 100 }}>
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#0f172a' }}>{value}</div>
    </div>
  );
}
