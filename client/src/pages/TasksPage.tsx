import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';

interface Process {
  id: string;
  name: string;
  description: string;
  orgCategoryId: string | null;
  inputSchema: string | null;
}

interface Category {
  id: string;
  name: string;
  colour: string | null;
}

export default function TasksPage({ user: _user }: { user: User }) {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [processRes, catRes] = await Promise.all([
          api.get('/api/processes', { params: { status: 'active' } }),
          api.get('/api/categories'),
        ]);
        setProcesses(processRes.data);
        setCategories(catRes.data);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filtered = processes.filter((t) => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.description ?? '').toLowerCase().includes(search.toLowerCase());
    const matchCat = !selectedCategory || t.orgCategoryId === selectedCategory;
    return matchSearch && matchCat;
  });

  const getCategoryForProcess = (process: Process) =>
    process.orgCategoryId ? categories.find((c) => c.id === process.orgCategoryId) : null;

  if (loading) {
    return (
      <div className="animate-[fadeIn_0.2s_ease-out_both] flex flex-col gap-4">
        <div className="h-9 w-48 rounded-lg bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        <div className="h-5 w-72 rounded bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        <div className="h-11 rounded-lg bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {[1,2,3,4,5,6].map((i) => <div key={i} className="h-36 rounded-xl bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[28px] font-extrabold text-slate-900 tracking-tight m-0">Automations</h1>
        <p className="text-sm text-slate-500 mt-1.5">
          {processes.length} automation{processes.length !== 1 ? 's' : ''} available to run
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <input
          type="text"
          placeholder="Search automations by name or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Category filter pills */}
      {categories.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-6">
          <button
            onClick={() => setSelectedCategory('')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
              !selectedCategory
                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            All
            <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold ${!selectedCategory ? 'bg-indigo-200 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
              {processes.length}
            </span>
          </button>
          {categories.map((cat) => {
            const count = processes.filter((t) => t.orgCategoryId === cat.id).length;
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                {cat.colour && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cat.colour }} />}
                {cat.name}
                <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-bold ${isActive ? 'bg-indigo-200 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Grid / Empty */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" className="bg-[linear-gradient(135deg,#f5f3ff,#ede9fe)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <p className="font-bold text-[16px] text-slate-900 mb-1.5">
            {search ? 'No automations match your search' : 'No automations available'}
          </p>
          <p className="text-[13.5px] text-slate-500 mb-5">
            {search ? 'Try a different search term or clear the filters.' : 'Automations will appear here once they are activated.'}
          </p>
          {search && (
            <button
              onClick={() => { setSearch(''); setSelectedCategory(''); }}
              className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {filtered.map((process) => {
            const cat = getCategoryForProcess(process);
            return (
              <Link
                key={process.id}
                to={`/processes/${process.id}`}
                className="bg-white border-2 border-slate-100 rounded-xl p-5 flex flex-col no-underline hover:border-indigo-200 hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 group"
              >
                {cat && (
                  <div className="mb-2.5">
                    <span
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                      style={{
                        background: cat.colour ? `${cat.colour}18` : '#f5f3ff',
                        border: `1px solid ${cat.colour ? `${cat.colour}40` : '#c7d2fe'}`,
                        color: cat.colour ?? '#6366f1',
                      }}
                    >
                      {cat.colour && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: cat.colour }} />}
                      {cat.name}
                    </span>
                  </div>
                )}

                <div className="flex items-start justify-between gap-2.5">
                  <div className="font-bold text-slate-900 text-[15px] leading-snug">{process.name}</div>
                  <span className="text-indigo-600 text-[13px] font-bold shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">Run →</span>
                </div>

                {process.description && (
                  <div className="mt-2 text-[13px] text-slate-500 leading-relaxed line-clamp-2">
                    {process.description}
                  </div>
                )}

                {process.inputSchema && (
                  <div className="mt-3 px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[11.5px] text-indigo-600 font-mono truncate">
                    {process.inputSchema.substring(0, 90)}{process.inputSchema.length > 90 ? '…' : ''}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
