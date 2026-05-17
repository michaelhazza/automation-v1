import { useEffect, useState } from 'react';
import api from '../../lib/api';
import Modal from '../Modal';
import { toast } from 'sonner';
import type { Belief } from './types';

export function BeliefsTab({ subaccountId }: { subaccountId: string }) {
  const [agents, setAgents] = useState<Array<{ id: string; agentId: string; agentName: string }>>([]);
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);
  const [beliefs, setBeliefs] = useState<Belief[]>([]);
  const [loading, setLoading] = useState(true);
  const [editBelief, setEditBelief] = useState<Belief | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    api.get(`/api/subaccounts/${subaccountId}/agents`).then(r => {
      const list = (r.data as Array<{ id: string; agentId: string; agentName?: string; name?: string }>).map(a => ({
        id: a.id, agentId: a.agentId, agentName: a.agentName ?? a.name ?? 'Agent',
      }));
      setAgents(list);
      if (list.length > 0) setSelectedLinkId(list[0].id);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [subaccountId]);

  useEffect(() => {
    if (!selectedLinkId) return;
    setLoading(true);
    api.get(`/api/subaccounts/${subaccountId}/agents/${selectedLinkId}/beliefs`).then(r => {
      setBeliefs(r.data as Belief[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [subaccountId, selectedLinkId]);

  const handleDelete = async (b: Belief) => {
    try {
      await api.delete(`/api/subaccounts/${subaccountId}/agents/${selectedLinkId}/beliefs/${b.beliefKey}`);
      setBeliefs(prev => prev.filter(x => x.id !== b.id));
      toast.success('Belief deleted');
    } catch { toast.error('Failed to delete belief'); }
  };

  const handleEdit = async () => {
    if (!editBelief || !editValue.trim()) return;
    try {
      const { data } = await api.put(
        `/api/subaccounts/${subaccountId}/agents/${selectedLinkId}/beliefs/${editBelief.beliefKey}`,
        { value: editValue, category: editBelief.category, subject: editBelief.subject },
      );
      setBeliefs(prev => prev.map(b => b.beliefKey === editBelief.beliefKey ? { ...b, ...data as Belief } : b));
      setEditBelief(null);
      toast.success('Belief updated (user override)');
    } catch { toast.error('Failed to update belief'); }
  };

  if (loading && agents.length === 0) return <div className="text-[13px] text-slate-500">Loading...</div>;
  if (agents.length === 0) return <div className="text-[13px] text-slate-500">No agents linked to this subaccount.</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-[13px] font-medium text-slate-600">Agent:</label>
        <select
          className="px-3 py-1.5 border border-slate-200 rounded-lg text-[13px] bg-white"
          value={selectedLinkId ?? ''}
          onChange={e => setSelectedLinkId(e.target.value)}
        >
          {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-[13px] text-slate-500">Loading beliefs...</div>
      ) : beliefs.length === 0 ? (
        <div className="text-[13px] text-slate-500">No beliefs formed yet. Beliefs are extracted automatically after agent runs.</div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Category</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Subject</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Belief</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Confidence</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Source</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Updated</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {beliefs.map(b => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 capitalize text-slate-600">{b.category}</td>
                  <td className="px-4 py-2.5 text-slate-500">{b.subject ?? '-'}</td>
                  <td className="px-4 py-2.5 text-slate-800 max-w-[300px] truncate">{b.value}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded text-[12px] font-medium ${
                      b.confidence >= 0.8 ? 'bg-green-50 text-green-700' :
                      b.confidence >= 0.5 ? 'bg-amber-50 text-amber-700' :
                      'bg-red-50 text-red-700'
                    }`}>
                      {b.confidence.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{b.source === 'user_override' ? 'User' : 'Agent'}</td>
                  <td className="px-4 py-2.5 text-slate-400">{new Date(b.updatedAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-right space-x-2">
                    <button
                      type="button"
                      onClick={() => { setEditBelief(b); setEditValue(b.value); }}
                      className="text-indigo-600 hover:text-indigo-800 text-[12px] font-medium"
                    >Edit</button>
                    <button
                      type="button"
                      onClick={() => handleDelete(b)}
                      className="text-red-500 hover:text-red-700 text-[12px] font-medium"
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editBelief && (
        <Modal title="Edit Belief" onClose={() => setEditBelief(null)}>
          <div className="space-y-3">
            <div>
              <label className="block text-[13px] font-medium text-slate-600 mb-1">Key: {editBelief.beliefKey}</label>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-slate-600 mb-1">Value</label>
              <textarea
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                rows={3}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
              />
            </div>
            <div className="text-[12px] text-slate-500">Saving sets source to "User Override" with confidence 1.0</div>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setEditBelief(null)} className="btn btn-secondary">Cancel</button>
              <button type="button" onClick={handleEdit} className="btn btn-primary">Save Override</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
