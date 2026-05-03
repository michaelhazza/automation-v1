import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { toast } from 'sonner';

interface OrgChannel {
  id: string;
  name: string;
  channelType: string;
}

interface SubaccountOption {
  id: string;
  name: string;
}

interface Grant {
  id: string;
  orgChannelId: string;
  subaccountId: string;
  orgChannel: OrgChannel;
  subaccount: SubaccountOption;
}

interface GrantManagementSectionProps {
  orgId: string;
}

/**
 * Org admin section for granting org-level approval channels to sub-account fan-out.
 * Lets the org admin add/revoke which org channels receive approvals from which sub-accounts.
 */
export default function GrantManagementSection({ orgId }: GrantManagementSectionProps) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [orgChannels, setOrgChannels] = useState<OrgChannel[]>([]);
  const [subaccounts, setSubaccounts] = useState<SubaccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [addForm, setAddForm] = useState({ orgChannelId: '', subaccountId: '' });
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try {
      const [grantsRes, channelsRes, subRes] = await Promise.all([
        api.get(`/api/approval-channels/grants?orgId=${orgId}`),
        api.get(`/api/approval-channels?scope=org`),
        api.get('/api/subaccounts'),
      ]);
      setGrants(grantsRes.data ?? []);
      setOrgChannels(channelsRes.data ?? []);
      setSubaccounts(subRes.data ?? []);
    } catch {
      toast.error('Failed to load grant data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [orgId]);

  const handleAdd = async () => {
    if (!addForm.orgChannelId || !addForm.subaccountId) return;
    setAdding(true);
    try {
      await api.post('/api/approval-channels/grants', {
        orgChannelId: addForm.orgChannelId,
        subaccountId: addForm.subaccountId,
      });
      toast.success('Grant added');
      setAddForm({ orgChannelId: '', subaccountId: '' });
      load();
    } catch {
      toast.error('Failed to add grant');
    } finally {
      setAdding(false);
    }
  };

  const handleRevoke = async (grantId: string) => {
    try {
      await api.delete(`/api/approval-channels/grants/${grantId}`);
      toast.success('Grant revoked');
      setGrants(prev => prev.filter(g => g.id !== grantId));
    } catch {
      toast.error('Failed to revoke grant');
    }
  };

  if (loading) {
    return <div className="text-[13px] text-slate-400 py-4">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-semibold text-slate-700 mb-1">Channel grants</p>
        <p className="text-[12px] text-slate-500 mb-3">
          Choose which org channels receive approval requests from each sub-account.
        </p>
      </div>

      {/* Add grant form */}
      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex flex-col gap-1 min-w-[180px]">
          <label className="text-[11.5px] font-medium text-slate-600">Org channel</label>
          <select
            value={addForm.orgChannelId}
            onChange={e => setAddForm(p => ({ ...p, orgChannelId: e.target.value }))}
            className="border border-slate-200 rounded-md px-2.5 py-1.5 text-[12.5px] bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Select channel...</option>
            {orgChannels.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-[180px]">
          <label className="text-[11.5px] font-medium text-slate-600">Sub-account</label>
          <select
            value={addForm.subaccountId}
            onChange={e => setAddForm(p => ({ ...p, subaccountId: e.target.value }))}
            className="border border-slate-200 rounded-md px-2.5 py-1.5 text-[12.5px] bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Select sub-account...</option>
            {subaccounts.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleAdd}
          disabled={adding || !addForm.orgChannelId || !addForm.subaccountId}
          className="px-3 py-1.5 text-[12.5px] font-semibold rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors duration-100 disabled:opacity-50 disabled:cursor-not-allowed border-0 cursor-pointer [font-family:inherit]"
        >
          {adding ? 'Adding...' : 'Add grant'}
        </button>
      </div>

      {/* Grants table */}
      {grants.length === 0 ? (
        <p className="text-[12.5px] text-slate-400 py-2">No grants configured.</p>
      ) : (
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Org channel</th>
              <th className="px-3 py-2 text-[11.5px] font-semibold text-slate-500 uppercase tracking-wide">Sub-account</th>
              <th className="px-3 py-2 w-20" />
            </tr>
          </thead>
          <tbody>
            {grants.map(g => (
              <tr key={g.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 text-[12.5px] text-slate-700">{g.orgChannel.name}</td>
                <td className="px-3 py-2 text-[12.5px] text-slate-700">{g.subaccount.name}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => handleRevoke(g.id)}
                    className="text-[12px] text-red-600 hover:text-red-700 border-none bg-transparent cursor-pointer [font-family:inherit]"
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
