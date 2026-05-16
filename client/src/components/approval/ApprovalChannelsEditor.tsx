import { useState } from 'react';
import Modal from '../Modal';

export interface ApprovalChannel {
  id: string;
  name: string;
  channelType: string;
  destination: string;
  isActive: boolean;
  createdAt: string;
}

interface ApprovalChannelsEditorProps {
  channels: ApprovalChannel[];
  loading: boolean;
  onAdd: (form: { name: string; channelType: string; destination: string }) => Promise<void>;
  onDelete: (channelId: string) => Promise<void>;
  addModalTitle: string;
}

export function ApprovalChannelsEditor({ channels, loading, onAdd, onDelete, addModalTitle }: ApprovalChannelsEditorProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', channelType: 'in_app', destination: '' });
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!form.name.trim()) return;
    setAdding(true);
    try {
      await onAdd(form);
      setShowAdd(false);
      setForm({ name: '', channelType: 'in_app', destination: '' });
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <div className="flex justify-end mb-3">
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors duration-100 border-0 cursor-pointer [font-family:inherit] shadow-sm"
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add channel
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />)}
        </div>
      ) : channels.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-slate-200 px-6 py-10 text-center">
          <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300 mx-auto mb-2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.36 2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <p className="text-[13px] font-semibold text-slate-600 mb-1">No approval channels</p>
          <p className="text-[12px] text-slate-400">Add an in-app channel to receive approval requests.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Destination</th>
                <th className="px-4 py-2.5 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 w-16" />
              </tr>
            </thead>
            <tbody>
              {channels.map(ch => (
                <tr key={ch.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors duration-75">
                  <td className="px-4 py-3 text-[13px] font-medium text-slate-800">{ch.name}</td>
                  <td className="px-4 py-3 text-[12.5px] text-slate-600">{ch.channelType.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-[12.5px] text-slate-500 max-w-[200px] truncate">{ch.destination || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${ch.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {ch.isActive ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => onDelete(ch.id)}
                      className="text-[12px] text-red-600 hover:text-red-700 border-none bg-transparent cursor-pointer [font-family:inherit]"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <Modal title={addModalTitle} onClose={() => setShowAdd(false)} maxWidth={420}>
          <div className="space-y-3 mb-5">
            <div>
              <label className="block text-[12px] font-medium text-slate-600 mb-1">Channel name</label>
              <input
                autoFocus
                type="text"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Spend Approvers"
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-slate-600 mb-1">Channel type</label>
              <select
                value={form.channelType}
                onChange={e => setForm(p => ({ ...p, channelType: e.target.value }))}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="in_app">In-app</option>
                <option value="email">Email</option>
                <option value="slack">Slack</option>
              </select>
            </div>
            {form.channelType !== 'in_app' && (
              <div>
                <label className="block text-[12px] font-medium text-slate-600 mb-1">Destination</label>
                <input
                  type="text"
                  value={form.destination}
                  onChange={e => setForm(p => ({ ...p, destination: e.target.value }))}
                  placeholder={form.channelType === 'email' ? 'approver@example.com' : '#spend-approvals'}
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}
          </div>
          <div className="flex gap-2.5 justify-end">
            <button
              onClick={() => setShowAdd(false)}
              className="inline-flex items-center px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 [font-family:inherit] bg-slate-100 text-gray-700 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={adding || !form.name.trim()}
              className="inline-flex items-center px-[18px] py-[9px] text-[13px] font-semibold rounded-lg border-0 cursor-pointer transition-all duration-150 [font-family:inherit] bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {adding ? 'Adding...' : 'Add channel'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
