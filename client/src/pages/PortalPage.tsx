/**
 * PortalPage — subaccount member's process browser.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface PortalProcess {
  id: string;
  name: string;
  description: string | null;
  inputSchema: string | null;
  outputSchema: string | null;
  category: { id: string; name: string; colour: string | null } | null;
  source: 'linked' | 'native';
}

interface Category { id: string; name: string; colour: string | null; }
interface SubaccountInfo { id: string; name: string; }

export default function PortalPage({ user: _user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [subaccount, setSubaccount] = useState<SubaccountInfo | null>(null);
  const [processes, setProcesses] = useState<PortalProcess[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!subaccountId) return;
    api.get(`/api/portal/${subaccountId}/processes`)
      .then(({ data }) => { setSubaccount(data.subaccount); setProcesses(data.processes ?? []); setCategories(data.categories ?? []); })
      .catch((err) => { const e = err as { response?: { data?: { error?: string } } }; setError(e.response?.data?.error ?? 'Failed to load processes'); })
      .finally(() => setLoading(false));
  }, [subaccountId]);

  const filtered = processes.filter((t) => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.description ?? '').toLowerCase().includes(search.toLowerCase());
    const matchCat = !selectedCategory || t.category?.id === selectedCategory;
    return matchSearch && matchCat;
  });

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  if (error) return <div className="text-red-600 p-8">{error}</div>;

  return (
    <>
      <h1 className="text-[28px] font-bold text-slate-800 mb-1">{subaccount?.name ?? 'Portal'}</h1>
      <p className="text-slate-500 mb-7">Select a process to run an automation.</p>

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-[200px] shrink-0">
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search processes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {categories.length > 0 && (
            <>
              <div className="font-semibold text-slate-700 text-[13px] mb-2">Categories</div>
              <div
                onClick={() => setSelectedCategory('')}
                className={`px-3 py-2 rounded-lg cursor-pointer text-[13px] mb-1 ${!selectedCategory ? 'bg-blue-100 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                All
              </div>
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-2 rounded-lg cursor-pointer text-[13px] mb-1 flex items-center gap-2 ${selectedCategory === cat.id ? 'bg-blue-100 text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  {cat.colour && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cat.colour }} />}
                  {cat.name}
                </div>
              ))}
            </>
          )}
          <div className="mt-5 pt-4 border-t border-slate-200">
            <Link to={`/portal/${subaccountId}/executions`} className="block text-[13px] text-blue-600 no-underline hover:underline py-2">
              View my executions →
            </Link>
          </div>
        </div>

        {/* Process grid */}
        <div className="flex-1">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
              No processes found. {search && 'Try a different search term.'}
            </div>
          ) : (
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
              {filtered.map((process) => (
                <Link key={process.id} to={`/portal/${subaccountId}/processes/${process.id}`} className="no-underline">
                  <div className="bg-white rounded-xl px-6 py-5 shadow-sm border border-slate-200 h-full hover:border-indigo-300 hover:shadow-md transition-all">
                    {process.category && (
                      <div className="flex items-center gap-1.5 mb-2">
                        {process.category.colour && <span className="w-2 h-2 rounded-full" style={{ background: process.category.colour }} />}
                        <span className="text-[11px] text-slate-500">{process.category.name}</span>
                      </div>
                    )}
                    <div className="font-semibold text-slate-800 mb-2 text-[16px]">{process.name}</div>
                    {process.description && <div className="text-[13px] text-slate-500 leading-relaxed mb-3">{process.description}</div>}
                    {process.inputSchema && (
                      <div className="text-[12px] text-sky-700 bg-sky-50 px-2.5 py-1.5 rounded-lg">
                        {process.inputSchema.substring(0, 80)}{process.inputSchema.length > 80 ? '...' : ''}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
