import { useState, useEffect } from 'react';
import api from '../../lib/api';
import BoardColumnEditor, { type BoardColumn } from '../BoardColumnEditor';

interface Props {
  subaccountId: string;
}

export function BoardConfigTab({ subaccountId }: Props) {
  const [boardColumns, setBoardColumns] = useState<BoardColumn[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardSaving, setBoardSaving] = useState(false);
  const [boardMsg, setBoardMsg] = useState('');

  useEffect(() => {
    api.get(`/api/subaccounts/${subaccountId}/board-config`)
      .then((res) => { if (res.data?.columns) setBoardColumns(res.data.columns); })
      .catch((err: { response?: { status?: number } }) => {
        if (err?.response?.status !== 404) console.error('[AdminSubaccountDetail] Failed to fetch board config:', err);
      });
  }, [subaccountId]);

  const handleSaveBoardConfig = async () => {
    setBoardSaving(true); setBoardMsg('');
    try {
      await api.patch(`/api/subaccounts/${subaccountId}/board-config`, { columns: boardColumns });
      setBoardMsg('Board configuration saved.');
      setTimeout(() => setBoardMsg(''), 3000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setBoardMsg(e.response?.data?.error ?? 'Failed to save board config');
    } finally { setBoardSaving(false); }
  };

  const handleResetFromOrg = async () => {
    setBoardSaving(true); setBoardMsg('');
    try {
      await api.post(`/api/subaccounts/${subaccountId}/board-config/push`);
      const { data } = await api.get(`/api/subaccounts/${subaccountId}/board-config`);
      if (data?.columns) setBoardColumns(data.columns);
      setBoardMsg('Board reset from organisation config.');
      setTimeout(() => setBoardMsg(''), 3000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setBoardMsg(e.response?.data?.error ?? 'Failed to reset board config');
    } finally { setBoardSaving(false); }
  };

  const handleInitBoard = async () => {
    setBoardLoading(true); setBoardMsg('');
    try {
      const { data } = await api.post(`/api/subaccounts/${subaccountId}/board-config/init`);
      if (data?.columns) setBoardColumns(data.columns);
      setBoardMsg('Board initialised from organisation config.');
      setTimeout(() => setBoardMsg(''), 3000);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setBoardMsg(e.response?.data?.error ?? 'Failed to initialise board');
    } finally { setBoardLoading(false); }
  };

  return (
    <div>
      {boardColumns.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <p className="text-slate-500 text-sm mb-4">No board configuration yet. Initialise from the organisation board config.</p>
          {boardMsg && <div className={`text-[13px] mb-3 ${boardMsg.includes('Failed') ? 'text-red-500' : 'text-green-600'}`}>{boardMsg}</div>}
          <button onClick={handleInitBoard} disabled={boardLoading} className="btn btn-primary">
            {boardLoading ? 'Initialising...' : 'Initialise from Org'}
          </button>
        </div>
      ) : (
        <>
          {boardMsg && <div className={`text-[13px] mb-3 ${boardMsg.includes('Failed') ? 'text-red-500' : 'text-green-600'}`}>{boardMsg}</div>}
          <BoardColumnEditor columns={boardColumns} onChange={setBoardColumns} />
          <div className="mt-5 flex gap-3">
            <button onClick={handleSaveBoardConfig} disabled={boardSaving} className="btn btn-primary">
              {boardSaving ? 'Saving...' : 'Save Changes'}
            </button>
            <button onClick={handleResetFromOrg} disabled={boardSaving} className="btn btn-secondary">
              {boardSaving ? 'Resetting...' : 'Reset from Org'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
