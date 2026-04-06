import { useEffect, useState, useRef, useCallback } from 'react';
import api from '../lib/api';
import Modal from './Modal';

interface Agent {
  id: string;
  name: string;
  slug: string;
}

interface Activity {
  id: string;
  activityType: string;
  message: string;
  createdAt: string;
  agentId?: string;
}

interface Deliverable {
  id: string;
  deliverableType: string;
  title: string;
  path?: string;
  description?: string;
  createdAt: string;
}

interface Attachment {
  id: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  createdAt: string;
}

interface MyVote {
  id: string;
  entityId: string;
  vote: 'up' | 'down';
}

interface TaskData {
  id: string;
  title: string;
  description: string | null;
  brief: string | null;
  status: string;
  priority: string;
  assignedAgentIds: string[];
  assignedAgents: Agent[];
  dueDate: string | null;
  activities: Activity[];
  deliverables: Deliverable[];
}

interface Props {
  subaccountId: string;
  itemId: string;
  agents: Agent[];
  columns: Array<{ key: string; label: string }>;
  onClose: () => void;
  onSaved: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'img';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/')) return 'txt';
  return 'file';
}

function AttachmentTypeIcon({ type }: { type: string }) {
  const label = attachmentIcon(type);
  const bgCls =
    label === 'img'
      ? 'bg-emerald-100 text-emerald-700'
      : label === 'pdf'
        ? 'bg-red-100 text-red-700'
        : label === 'txt'
          ? 'bg-sky-100 text-sky-700'
          : 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-[10px] font-bold uppercase shrink-0 ${bgCls}`}>
      {label}
    </span>
  );
}

function ThumbButton({ direction, filled, onClick }: { direction: 'up' | 'down'; filled: boolean; onClick: () => void }) {
  const isUp = direction === 'up';
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`bg-transparent border-0 cursor-pointer p-0.5 rounded transition-colors ${
        filled
          ? isUp ? 'text-green-600' : 'text-red-500'
          : 'text-slate-300 hover:text-slate-500'
      }`}
      title={isUp ? 'Thumbs up' : 'Thumbs down'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {isUp ? (
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
        ) : (
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
        )}
      </svg>
    </button>
  );
}

const activityIcons: Record<string, string> = {
  created: '➕',
  assigned: '👤',
  status_changed: '↔',
  progress: '📝',
  completed: '✅',
  note: '💬',
  blocked: '🚫',
};

const inputCls = 'px-3 py-2 border border-gray-300 rounded-lg text-[13px] outline-none w-full';
const labelCls = 'text-xs font-semibold text-slate-500';

export default function TaskModal({ subaccountId, itemId, agents, columns, onClose, onSaved }: Props) {
  const [task, setTask] = useState<TaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'details' | 'activity' | 'deliverables' | 'attachments'>('details');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Edit form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [brief, setBrief] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('normal');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');

  // Activity form
  const [noteMessage, setNoteMessage] = useState('');

  // Attachments state
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Feedback votes state
  const [myVotes, setMyVotes] = useState<Record<string, MyVote>>({});
  const [votingId, setVotingId] = useState<string | null>(null);

  const loadAttachments = useCallback(async () => {
    setAttachmentsLoading(true);
    try {
      const { data } = await api.get(`/api/tasks/${itemId}/attachments`);
      setAttachments(data);
    } catch {
      // ignore
    } finally {
      setAttachmentsLoading(false);
    }
  }, [itemId]);

  const loadMyVotes = useCallback(async (activities: Activity[]) => {
    const agentActivityIds = activities.filter(a => a.agentId).map(a => a.id);
    if (!agentActivityIds.length) return;
    try {
      const { data } = await api.get('/api/feedback/my-votes', {
        params: { entityType: 'task_activity', entityIds: agentActivityIds.join(',') },
      });
      const map: Record<string, MyVote> = {};
      for (const v of data) map[v.entityId] = v;
      setMyVotes(map);
    } catch {
      // ignore
    }
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/subaccounts/${subaccountId}/tasks/${itemId}`);
      setTask(data);
      setTitle(data.title);
      setDescription(data.description ?? '');
      setBrief(data.brief ?? '');
      setStatus(data.status);
      setPriority(data.priority);
      // Prefer the new assignedAgentIds array; fall back to legacy singular
      const ids: string[] = data.assignedAgentIds?.length
        ? data.assignedAgentIds
        : data.assignedAgentId
          ? [data.assignedAgentId]
          : [];
      setSelectedAgentIds(ids);
      setDueDate(data.dueDate ? data.dueDate.slice(0, 10) : '');
      loadMyVotes(data.activities);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); loadAttachments(); }, [itemId]);

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds(prev =>
      prev.includes(agentId) ? prev.filter(id => id !== agentId) : [...prev, agentId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/api/subaccounts/${subaccountId}/tasks/${itemId}`, {
        title,
        description: description || null,
        brief: brief || null,
        status,
        priority,
        assignedAgentIds: selectedAgentIds,
        dueDate: dueDate || null,
      });
      onSaved();
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteMessage.trim()) return;
    try {
      await api.post(`/api/subaccounts/${subaccountId}/tasks/${itemId}/activities`, {
        activityType: 'note',
        message: noteMessage,
      });
      setNoteMessage('');
      load();
    } catch {
      // ignore
    }
  };

  const handleUploadFile = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setUploadError('');
    try {
      for (let i = 0; i < files.length; i++) {
        const formData = new FormData();
        formData.append('file', files[i]);
        await api.post(`/api/tasks/${itemId}/attachments`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      loadAttachments();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } } };
      setUploadError(e.response?.data?.error ?? e.response?.data?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    try {
      await api.delete(`/api/attachments/${attachmentId}`);
      setAttachments(prev => prev.filter(a => a.id !== attachmentId));
    } catch {
      // ignore
    }
  };

  const handleDownloadAttachment = async (attachmentId: string) => {
    try {
      const { data, headers } = await api.get(`/api/attachments/${attachmentId}/download`, {
        responseType: 'blob',
      });
      const blob = new Blob([data], { type: headers['content-type'] || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Extract filename from content-disposition if available
      const disposition = headers['content-disposition'] as string | undefined;
      const match = disposition?.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  const handleVote = async (activityId: string, vote: 'up' | 'down', agentId?: string) => {
    const existing = myVotes[activityId];
    setVotingId(activityId);
    try {
      if (existing && existing.vote === vote) {
        // Toggle off — remove the vote
        await api.delete(`/api/feedback/${existing.id}`);
        setMyVotes(prev => {
          const next = { ...prev };
          delete next[activityId];
          return next;
        });
      } else {
        // Upsert vote
        const { data } = await api.post('/api/feedback', {
          entityType: 'task_activity',
          entityId: activityId,
          vote,
          agentId,
        });
        setMyVotes(prev => ({ ...prev, [activityId]: { id: data.id, entityId: activityId, vote } }));
      }
    } catch {
      // ignore
    } finally {
      setVotingId(null);
    }
  };

  if (loading) return <Modal title="Loading..." onClose={onClose}><div className="p-5">Loading...</div></Modal>;
  if (!task) return null;

  const tabs = [
    { key: 'details', label: 'Details' },
    { key: 'activity', label: `Activity (${task.activities.length})` },
    { key: 'deliverables', label: `Deliverables (${task.deliverables.length})` },
    { key: 'attachments', label: `Attachments (${attachments.length})` },
  ];

  return (
    <Modal title={task.title} onClose={onClose} maxWidth={640}>
      <div className="flex border-b border-slate-200 mb-4 -mt-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`px-4 py-2 border-0 bg-transparent cursor-pointer text-[13px] border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-indigo-500 text-indigo-500 font-semibold'
                : 'border-transparent text-slate-500 font-normal hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <div className="flex flex-col gap-3 px-1">
          {error && <div className="text-red-500 text-[13px]">{error}</div>}

          <div className="flex flex-col gap-1">
            <label className={labelCls}>Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} />
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className={`${inputCls} resize-y`} />
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>Brief</label>
            <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={4} className={`${inputCls} resize-y`} />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 flex flex-col gap-1">
              <label className={labelCls}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
                {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>

            <div className="flex-1 flex flex-col gap-1">
              <label className={labelCls}>Priority</label>
              <select value={priority} onChange={e => setPriority(e.target.value)} className={inputCls}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>
              Assigned Agents
              {selectedAgentIds.length > 0 && (
                <span className="ml-1.5 text-[11px] text-indigo-500 font-normal">
                  {selectedAgentIds.length} selected
                </span>
              )}
            </label>
            {agents.length === 0 ? (
              <div className="text-xs text-slate-400 italic">No agents available</div>
            ) : (
              <div className="border border-gray-300 rounded-lg max-h-40 overflow-y-auto">
                {agents.map((a, i) => (
                  <label
                    key={a.id}
                    className={`flex items-center gap-2 px-3 py-[7px] cursor-pointer text-[13px] text-slate-800 ${
                      i < agents.length - 1 ? 'border-b border-slate-100' : ''
                    } ${selectedAgentIds.includes(a.id) ? 'bg-violet-50' : 'bg-transparent'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedAgentIds.includes(a.id)}
                      onChange={() => toggleAgent(a.id)}
                      className="accent-indigo-500"
                    />
                    {a.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>Due Date</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !title}
            className={`mt-2 px-5 py-2.5 bg-indigo-500 text-white border-0 rounded-lg cursor-pointer text-sm font-semibold transition-opacity ${saving ? 'opacity-60' : 'hover:bg-indigo-600'} disabled:cursor-not-allowed`}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}

      {tab === 'activity' && (
        <div className="flex flex-col gap-3 px-1">
          <div className="flex gap-2">
            <input
              value={noteMessage}
              onChange={e => setNoteMessage(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddNote()}
              placeholder="Add a note..."
              className={`${inputCls} flex-1`}
            />
            <button
              onClick={handleAddNote}
              disabled={!noteMessage.trim()}
              className={`px-4 py-2 border-0 rounded-lg text-[13px] font-semibold transition-colors ${
                noteMessage.trim()
                  ? 'bg-indigo-500 text-white cursor-pointer hover:bg-indigo-600'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              Add
            </button>
          </div>

          <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto">
            {task.activities.length === 0 && <div className="text-slate-400 text-[13px] italic">No activity yet</div>}
            {task.activities.map(a => {
              const isAgentGenerated = !!a.agentId;
              const currentVote = myVotes[a.id];
              return (
                <div key={a.id} className="flex gap-2 py-1.5 border-b border-slate-100">
                  <span className="text-sm">{activityIcons[a.activityType] ?? '•'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] text-slate-800">{a.message}</div>
                    <div className="text-[11px] text-slate-400">{new Date(a.createdAt).toLocaleString()}</div>
                  </div>
                  {isAgentGenerated && (
                    <div className="flex items-center gap-1 shrink-0">
                      <ThumbButton
                        direction="up"
                        filled={currentVote?.vote === 'up'}
                        onClick={() => votingId !== a.id && handleVote(a.id, 'up', a.agentId)}
                      />
                      <ThumbButton
                        direction="down"
                        filled={currentVote?.vote === 'down'}
                        onClick={() => votingId !== a.id && handleVote(a.id, 'down', a.agentId)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'deliverables' && (
        <div className="flex flex-col gap-2 px-1">
          {task.deliverables.length === 0 && <div className="text-slate-400 text-[13px] italic">No deliverables yet</div>}
          {task.deliverables.map(d => (
            <div key={d.id} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-[13px] font-semibold text-slate-800">{d.title}</span>
                <span className="text-[10px] text-slate-400 bg-slate-200 px-1.5 py-px rounded">{d.deliverableType}</span>
              </div>
              {d.description && <div className="text-xs text-slate-500 mt-1">{d.description}</div>}
              {d.path && (
                <a href={d.path} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 mt-1 block">
                  {d.path}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'attachments' && (
        <div className="flex flex-col gap-3 px-1">
          {/* Upload area */}
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown"
              onChange={(e) => handleUploadFile(e.target.files)}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={`flex items-center gap-1.5 px-4 py-2 border-0 rounded-lg text-[13px] font-semibold transition-colors ${
                uploading
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-500 text-white cursor-pointer hover:bg-indigo-600'
              }`}
            >
              {uploading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Upload file
                </>
              )}
            </button>
            <span className="text-[11px] text-slate-400">PNG, JPEG, GIF, WebP, PDF, TXT, Markdown (max 10 MB)</span>
          </div>

          {uploadError && (
            <div className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {uploadError}
            </div>
          )}

          {/* Attachments list */}
          {attachmentsLoading && <div className="text-slate-400 text-[13px]">Loading attachments...</div>}
          {!attachmentsLoading && attachments.length === 0 && (
            <div className="text-slate-400 text-[13px] italic">No attachments yet</div>
          )}
          {attachments.map(att => (
            <div key={att.id} className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
              <AttachmentTypeIcon type={att.fileType} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-slate-800 truncate">{att.fileName}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{formatBytes(att.fileSizeBytes)}</div>
              </div>
              <button
                onClick={() => handleDownloadAttachment(att.id)}
                className="bg-transparent border-0 cursor-pointer text-indigo-500 hover:text-indigo-700 transition-colors p-1"
                title="Download"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
              <button
                onClick={() => handleDeleteAttachment(att.id)}
                className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-red-500 transition-colors p-1"
                title="Delete"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
