/**
 * PortalLandingPage — shown when a user has subaccount assignments.
 * Lets them pick which subaccount portal to enter.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface SubaccountEntry {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export default function PortalLandingPage({ user: _user }: { user: User }) {
  const navigate = useNavigate();
  const [subaccounts, setSubaccounts] = useState<SubaccountEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/portal/my-subaccounts')
      .then(({ data }) => {
        setSubaccounts(data);
        if (data.length === 1) navigate(`/portal/${data[0].id}`, { replace: true });
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;

  if (subaccounts.length === 0) {
    return (
      <div className="max-w-[480px] mx-auto mt-16 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-[22px] font-bold text-slate-800 mb-2">No portal access</h2>
        <p className="text-[14px] text-slate-500">You haven't been assigned to any subaccounts yet. Contact your administrator for access.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[560px] mx-auto mt-10">
      <h1 className="text-[26px] font-bold text-slate-800 mb-2">Select subaccount</h1>
      <p className="text-slate-500 mb-7">Choose which subaccount you'd like to access.</p>
      <div className="flex flex-col gap-3">
        {subaccounts.map((sa) => (
          <button
            key={sa.id}
            onClick={() => navigate(`/portal/${sa.id}`)}
            className="flex items-center justify-between px-5 py-4 bg-white border border-slate-200 rounded-xl cursor-pointer text-left shadow-sm hover:border-indigo-300 hover:shadow-md transition-all"
          >
            <div>
              <div className="font-semibold text-[16px] text-slate-800 mb-0.5">{sa.name}</div>
              <div className="text-[13px] text-slate-500 font-mono">{sa.slug}</div>
            </div>
            <span className="text-slate-400 text-xl">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
