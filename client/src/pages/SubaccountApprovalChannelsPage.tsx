import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';
import { toast } from 'sonner';
import { ApprovalChannelsEditor, type ApprovalChannel } from '../components/approval/ApprovalChannelsEditor';

export default function SubaccountApprovalChannelsPage() {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [channels, setChannels] = useState<ApprovalChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState(false);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const load = async () => {
    if (!subaccountId) return;
    try {
      const { data } = await api.get(`/api/approval-channels?subaccountId=${subaccountId}`);
      if (mountedRef.current) {
        setChannels(data ?? []);
        setFatalError(false);
      }
    } catch {
      if (mountedRef.current) {
        toast.error('Failed to load approval channels');
        retryCountRef.current += 1;
        if (retryCountRef.current >= 3) setFatalError(true);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => { load(); }, [subaccountId]);

  const handleAdd = async (form: { name: string; channelType: string; destination: string }) => {
    try {
      await api.post('/api/approval-channels', { ...form, subaccountId, scope: 'subaccount' });
      toast.success('Approval channel added');
      load();
    } catch {
      toast.error('Failed to add approval channel');
      throw new Error('Failed to add approval channel');
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
      <div className="p-8 max-w-3xl mx-auto">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4">
          <p className="text-[13px] font-semibold text-red-700 mb-1">Unable to load approval channels</p>
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
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[18px] font-bold text-slate-900">Approval Channels</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Channels that receive spend approval requests for this sub-account.
          </p>
        </div>
      </div>

      <ApprovalChannelsEditor
        channels={channels}
        loading={loading}
        onAdd={handleAdd}
        onDelete={handleDelete}
        addModalTitle="Add approval channel"
      />
    </div>
  );
}
