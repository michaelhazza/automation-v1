import { useState } from 'react';
import api from '../../lib/api';
import type { SubaccountAgent } from '../task-modal/TaskAgentPickerPure';
import { TaskAgentPicker } from '../task-modal/TaskAgentPicker';
import { TaskAttachmentDropZone } from '../task-modal/TaskAttachmentDropZone';

interface NewTaskModalProps {
  subaccountId: string;
  agents: SubaccountAgent[];
  onCreated: () => void;
  onClose: () => void;
}

export function NewTaskModal({ subaccountId, agents, onCreated, onClose }: NewTaskModalProps) {
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && instructions.trim().length > 0 && !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.post<{ id: string }>(`/api/subaccounts/${subaccountId}/tasks`, {
        title: title.trim(),
        description: instructions.trim(),
        status: 'inbox',
        priority,
        assignedAgentId: assignedAgentId ?? undefined,
        dueDate: dueDate || undefined,
      });
      setCreatedTaskId(res.data.id);
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to create task');
    } finally {
      setSaving(false);
    }
  };

  const uploadAttachment = async (args: { taskId: string; file: File; idempotencyKey: string; signal: AbortSignal }) => {
    const form = new FormData();
    form.append('file', args.file);
    form.append('idempotencyKey', args.idempotencyKey);
    const res = await api.post<{ attachmentId: string; filename: string }>(
      `/api/tasks/${args.taskId}/attachments`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' }, signal: args.signal },
    );
    return res.data;
  };

  const deleteAttachment = async (args: { attachmentId: string }) => {
    await api.delete(`/api/attachments/${args.attachmentId}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out_both]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white z-10">
          <h2 className="text-[17px] font-bold text-slate-900 m-0">New Task</h2>
          <button onClick={onClose} className="bg-transparent border-0 cursor-pointer text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Instructions</label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Describe what the agent should do..."
              rows={4}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] resize-vertical focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <TaskAgentPicker
            agents={agents}
            variant="review-queue"
            value={assignedAgentId}
            onChange={setAssignedAgentId}
          />

          <TaskAttachmentDropZone
            taskId={createdTaskId}
            uploadAttachment={uploadAttachment}
            deleteAttachment={deleteAttachment}
            disabled={saving}
          />

          {/* Advanced section */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="bg-transparent border-0 cursor-pointer text-[13px] text-indigo-600 hover:text-indigo-800 p-0 flex items-center gap-1"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
              Advanced
            </button>

            {showAdvanced && (
              <div className="flex flex-col gap-4 mt-4">
                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Due Date <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1.5">Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as typeof priority)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-[13px] text-red-600 m-0">{error}</p>}

          <div className="flex gap-2 justify-end pt-1">
            <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
            <button type="submit" disabled={!canSubmit} className="btn btn-primary">
              {saving ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
