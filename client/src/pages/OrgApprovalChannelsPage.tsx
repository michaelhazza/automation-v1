import { useEffect, useState, useRef } from 'react';
import api from '../lib/api';
import { toast } from 'sonner';
import GrantManagementSection from '../components/approval/GrantManagementSection';
import { ApprovalChannelsEditor, type ApprovalChannel } from '../components/approval/ApprovalChannelsEditor';
import { User, getActiveOrgId } from '../lib/auth';

interface OrgApprovalChannelsPageProps {
  user: User;
}

export default function OrgApprovalChannelsPage({ user: _user }: OrgApprovalChannelsPageProps) {
  const orgId = getActiveOrgId() ?? _user.organisationId ?? '';
  const [channels, setChannels] = useState<ApprovalChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState(false);
  const retryCountRef = useRef(0);
  const [activeTab, setActiveTab] = useState<'channels' | 'grants'>('channels');
  const mountedRef = useRef(true);

  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const load = async () => {
    try {
      const { data } = await api.get(`/api/approval-channels?scope=org&orgId=${orgId}`);
      if (mountedRef.current) {
        setChannels(data ?? []);
        setFatalError(false);
      }
    } catch {
      if (mountedRef.current) {
        toast.error('Failed to load org approval channels');
        retryCountRef.current += 1;
        if (retryCountRef.current >= 3) setFatalError(true);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => { if (orgId) load(); }, [orgId]);

  const handleAdd = async (form: { name: string; channelType: string; destination: string }) => {
    try {
      await api.post('/api/approval-channels', { ...form, orgId, scope: 'org' });
      toast.success('Org approval channel added');
      load();
    } catch {
      toast.error('Failed to add org approval channel');
      throw new Error('Failed to add org approval channel');
    }
  };

  const handleDelete = async (channelId: string) => {
    try {
      await api.delete(`/api/approval-channels/${channelId}`);
      toast.success('Channel removed');
      setChannels(prev => prev.filter(c => c.id !== channelId));
    } catch {
      toast.error('Failed to remove channel');
    }
  };

  if (fatalError) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4">
          <p className="text-[13px] font-semibold text-red-700 mb-1">Unable to load org approval channels</p>
          <p className="text-[12.5px] text-red-600 mb-3">
            Multiple attempts failed. Contact{' '}
            <a href="mailto:support@synthetos.ai" className="underline">support</a> if this persists.
          </p>
          <button
            onClick={() => { retryCountRef.current = 0; setFatalError(false); load(); }}
            className="px-3 py-1.5 text-[12.5px] font-semibold rounded-md bg-red-100 text-red-700 hover:bg-red-200 border-0 cursor-pointer [font-family:inherit]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-[18px] font-bold text-slate-900">Org Approval Channels</h1>
        <p className="text-[13px] text-slate-500 mt-0.5">
          Manage organisation-level channels and control which sub-accounts they serve.
        </p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {(['channels', 'grants'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-[13px] font-medium border-0 cursor-pointer [font-family:inherit] transition-colors duration-100 -mb-px ${
              activeTab === tab
                ? 'text-indigo-600 border-b-2 border-indigo-600 bg-transparent'
                : 'text-slate-500 hover:text-slate-700 bg-transparent'
            }`}
          >
            {tab === 'channels' ? 'Channels' : 'Grant management'}
          </button>
        ))}
      </div>

      {activeTab === 'channels' && (
        <ApprovalChannelsEditor
          channels={channels}
          loading={loading}
          onAdd={handleAdd}
          onDelete={handleDelete}
          addModalTitle="Add org approval channel"
        />
      )}

      {activeTab === 'grants' && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-4">
          <GrantManagementSection orgId={orgId} />
        </div>
      )}
    </div>
  );
}
