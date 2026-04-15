import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';

interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  skillType: 'built_in' | 'custom';
  isActive: boolean;
  visibility: 'none' | 'basic' | 'full';
  subaccountId: string | null;
  organisationId: string | null;
  createdAt: string;
  updatedAt: string;
}

type Tier = 'System' | 'Org' | 'Subaccount';
type SkillType = 'built_in' | 'custom';
type Visibility = 'none' | 'basic' | 'full';
type SortCol = 'name' | 'slug' | 'tier' | 'type' | 'visibility';
type SortDir = 'asc' | 'desc';
type OpenCol = SortCol | null;

function tierLabel(skill: Skill): Tier {
  if (!skill.organisationId) return 'System';
  if (!skill.subaccountId) return 'Org';
  return 'Subaccount';
}

function tierBadgeClass(tier: Tier): string {
  switch (tier) {
    case 'System': return 'bg-purple-50 text-purple-700';
    case 'Org': return 'bg-blue-50 text-blue-700';
    default: return 'bg-green-50 text-green-700';
  }
}

const TIER_ORDER: Record<Tier, number> = { System: 0, Org: 1, Subaccount: 2 };
const VIS_ORDER: Record<Visibility, number> = { none: 0, basic: 1, full: 2 };

// ─── Column header with dropdown ────────────────────────────────────────────

interface ColHeaderProps {
  label: string;
  col: SortCol;
  openCol: OpenCol;
  sortCol: SortCol | null;
  sortDir: SortDir;
  hasActiveFilter: boolean;
  ascLabel: string;
  descLabel: string;
  onToggleOpen: (col: SortCol) => void;
  onSort: (col: SortCol, dir: SortDir) => void;
  children?: React.ReactNode;
}

function ColHeader({
  label, col, openCol, sortCol, sortDir, hasActiveFilter, ascLabel, descLabel,
  onToggleOpen, onSort, children,
}: ColHeaderProps) {
  const isOpen = openCol === col;
  const isSorted = sortCol === col;

  return (
    <th className="px-4 py-0 text-left relative" style={{ userSelect: 'none' }}>
      <button
        onClick={() => onToggleOpen(col)}
        className={`flex items-center gap-1.5 w-full py-3 bg-transparent border-0 cursor-pointer text-[13px] font-semibold text-left transition-colors ${isOpen ? 'text-indigo-600' : 'text-slate-700 hover:text-slate-900'}`}
      >
        <span>{label}</span>
        {isSorted && (
          <span className="text-indigo-500 text-[11px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
        )}
        {hasActiveFilter && (
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
        )}
        <svg
          className={`ml-auto w-3 h-3 transition-transform ${isOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 min-w-[190px] bg-white border border-slate-200 rounded-lg shadow-lg py-1 mt-0.5">
          <div className="px-2 pt-1 pb-0.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-2 py-1">Sort</div>
            <button
              onClick={() => onSort(col, 'asc')}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-[12px] rounded-md border-0 cursor-pointer transition-colors text-left ${isSorted && sortDir === 'asc' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-transparent text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="text-[11px] w-3">↑</span> {ascLabel}
              {isSorted && sortDir === 'asc' && <span className="ml-auto text-indigo-500">✓</span>}
            </button>
            <button
              onClick={() => onSort(col, 'desc')}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-[12px] rounded-md border-0 cursor-pointer transition-colors text-left ${isSorted && sortDir === 'desc' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-transparent text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="text-[11px] w-3">↓</span> {descLabel}
              {isSorted && sortDir === 'desc' && <span className="ml-auto text-indigo-500">✓</span>}
            </button>
          </div>

          {children && (
            <div className="border-t border-slate-100 mt-1 px-2 pt-1 pb-1">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-2 py-1">Filter</div>
              {children}
            </div>
          )}
        </div>
      )}
    </th>
  );
}

function CheckOption({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer text-[12px] text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
      />
      {label}
    </label>
  );
}

function FilterActions({ onAll, onNone }: { onAll: () => void; onNone: () => void }) {
  return (
    <div className="flex items-center gap-2 px-2 pb-1.5">
      <button onClick={onAll} className="text-[11px] text-indigo-600 hover:text-indigo-800 bg-transparent border-0 p-0 cursor-pointer">All</button>
      <span className="text-slate-300 text-[11px]">·</span>
      <button onClick={onNone} className="text-[11px] text-indigo-600 hover:text-indigo-800 bg-transparent border-0 p-0 cursor-pointer">None</button>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SubaccountSkillsPage({ user: _user }: { user: User }) {
  const { subaccountId } = useParams<{ subaccountId: string }>();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Sort state
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Filter state — values in the set are EXCLUDED
  const [filterTier, setFilterTier] = useState<Set<Tier>>(new Set());
  const [filterType, setFilterType] = useState<Set<SkillType>>(new Set());
  const [filterVisibility, setFilterVisibility] = useState<Set<Visibility>>(new Set());

  // Which column dropdown is open
  const [openCol, setOpenCol] = useState<OpenCol>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!subaccountId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get(`/api/subaccounts/${subaccountId}/skills`);
      setSkills(res.data);
    } catch (err) {
      console.error('[SubaccountSkills] Failed to load:', err);
      setLoadError('Failed to load skills. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  }, [subaccountId]);

  useEffect(() => { load(); }, [load]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!openCol) return;
    const handler = (e: MouseEvent) => {
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) {
        setOpenCol(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openCol]);

  const toggleOpen = useCallback((col: SortCol) => {
    setOpenCol(prev => prev === col ? null : col);
  }, []);

  const handleSort = useCallback((col: SortCol, dir: SortDir) => {
    setSortCol(col);
    setSortDir(dir);
    setOpenCol(null);
  }, []);

  const toggleFilter = <T extends string>(
    set: Set<T>,
    setFn: React.Dispatch<React.SetStateAction<Set<T>>>,
    val: T,
  ) => {
    setFn(prev => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val); else next.add(val);
      return next;
    });
  };

  async function handleDelete() {
    if (!deleteTarget || !subaccountId) return;
    try {
      await api.delete(`/api/subaccounts/${subaccountId}/skills/${deleteTarget.id}`);
      setDeleteError(null);
      setDeleteTarget(null);
      load();
    } catch (err) {
      console.error('[SubaccountSkills] Delete failed:', err);
      setDeleteError('Failed to delete skill. Please try again.');
    }
  }

  // Filter
  const filtered = skills.filter((s) => {
    if (filterTier.has(tierLabel(s))) return false;
    if (filterType.has(s.skillType)) return false;
    if (filterVisibility.has(s.visibility)) return false;
    return true;
  });

  // Sort
  const displayed = sortCol ? [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortCol === 'name') {
      cmp = a.name.localeCompare(b.name);
    } else if (sortCol === 'slug') {
      cmp = a.slug.localeCompare(b.slug);
    } else if (sortCol === 'tier') {
      cmp = TIER_ORDER[tierLabel(a)] - TIER_ORDER[tierLabel(b)];
    } else if (sortCol === 'type') {
      cmp = a.skillType.localeCompare(b.skillType);
    } else if (sortCol === 'visibility') {
      cmp = VIS_ORDER[a.visibility] - VIS_ORDER[b.visibility];
    }
    return sortDir === 'asc' ? cmp : -cmp;
  }) : filtered;

  const activeFilterCount = filterTier.size + filterType.size + filterVisibility.size;
  const clearAll = () => {
    setFilterTier(new Set());
    setFilterType(new Set());
    setFilterVisibility(new Set());
    setSortCol(null);
  };

  return (
    <div className="px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Subaccount Skills{' '}
            <span className="text-[14px] font-normal text-slate-400">
              ({activeFilterCount > 0 ? `${displayed.length} of ${skills.length}` : skills.length})
            </span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage skills scoped to this workspace. Subaccount skills override org and system skills with the same slug.
          </p>
        </div>
        {(activeFilterCount > 0 || sortCol) && (
          <button
            onClick={clearAll}
            className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-0 rounded-lg text-[13px] font-medium cursor-pointer transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <div className="text-center py-16 border border-dashed border-red-200 rounded-xl">
          <p className="text-red-500 text-sm">{loadError}</p>
        </div>
      ) : skills.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-slate-200 rounded-xl">
          <p className="text-slate-500 text-sm">No skills available for this workspace.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-visible" ref={tableRef}>
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <ColHeader
                  label="Name" col="name" openCol={openCol} sortCol={sortCol} sortDir={sortDir}
                  hasActiveFilter={false} ascLabel="A → Z" descLabel="Z → A"
                  onToggleOpen={toggleOpen} onSort={handleSort}
                />
                <ColHeader
                  label="Slug" col="slug" openCol={openCol} sortCol={sortCol} sortDir={sortDir}
                  hasActiveFilter={false} ascLabel="A → Z" descLabel="Z → A"
                  onToggleOpen={toggleOpen} onSort={handleSort}
                />
                <ColHeader
                  label="Tier" col="tier" openCol={openCol} sortCol={sortCol} sortDir={sortDir}
                  hasActiveFilter={filterTier.size > 0} ascLabel="System first" descLabel="Subaccount first"
                  onToggleOpen={toggleOpen} onSort={handleSort}
                >
                  <FilterActions
                    onAll={() => setFilterTier(new Set())}
                    onNone={() => setFilterTier(new Set(['System', 'Org', 'Subaccount']))}
                  />
                  {(['System', 'Org', 'Subaccount'] as Tier[]).map((t) => (
                    <CheckOption
                      key={t}
                      checked={!filterTier.has(t)}
                      onChange={() => toggleFilter(filterTier, setFilterTier, t)}
                      label={<span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${tierBadgeClass(t)}`}>{t}</span>}
                    />
                  ))}
                </ColHeader>
                <ColHeader
                  label="Type" col="type" openCol={openCol} sortCol={sortCol} sortDir={sortDir}
                  hasActiveFilter={filterType.size > 0} ascLabel="Built-in first" descLabel="Custom first"
                  onToggleOpen={toggleOpen} onSort={handleSort}
                >
                  <FilterActions
                    onAll={() => setFilterType(new Set())}
                    onNone={() => setFilterType(new Set(['built_in', 'custom']))}
                  />
                  <CheckOption
                    checked={!filterType.has('built_in')}
                    onChange={() => toggleFilter(filterType, setFilterType, 'built_in')}
                    label={<span className="text-slate-600 text-[12px]">Built in</span>}
                  />
                  <CheckOption
                    checked={!filterType.has('custom')}
                    onChange={() => toggleFilter(filterType, setFilterType, 'custom')}
                    label={<span className="text-slate-600 text-[12px]">Custom</span>}
                  />
                </ColHeader>
                <ColHeader
                  label="Visibility" col="visibility" openCol={openCol} sortCol={sortCol} sortDir={sortDir}
                  hasActiveFilter={filterVisibility.size > 0} ascLabel="None → Full" descLabel="Full → None"
                  onToggleOpen={toggleOpen} onSort={handleSort}
                >
                  <FilterActions
                    onAll={() => setFilterVisibility(new Set())}
                    onNone={() => setFilterVisibility(new Set(['none', 'basic', 'full']))}
                  />
                  {(['none', 'basic', 'full'] as Visibility[]).map((v) => (
                    <CheckOption
                      key={v}
                      checked={!filterVisibility.has(v)}
                      onChange={() => toggleFilter(filterVisibility, setFilterVisibility, v)}
                      label={<span className="text-slate-600 text-[12px]">{v.charAt(0).toUpperCase() + v.slice(1)}</span>}
                    />
                  ))}
                </ColHeader>
                <th className="px-4 py-3 text-left text-[13px] font-semibold text-slate-700">Created</th>
                <th className="px-4 py-3 text-right text-[13px] font-semibold text-slate-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-slate-400">
                    No skills match the current filters.{' '}
                    <button onClick={clearAll} className="text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer p-0 text-[13px]">
                      Clear filters
                    </button>
                  </td>
                </tr>
              )}
              {displayed.map((skill) => {
                const tier = tierLabel(skill);
                const isOwned = tier === 'Subaccount';
                return (
                  <tr key={skill.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{skill.name}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{skill.slug}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${tierBadgeClass(tier)}`}>
                        {tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 capitalize">{skill.skillType.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-slate-500 capitalize">{skill.visibility}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {new Date(skill.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isOwned && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(skill); }}
                          className="text-xs text-red-500 hover:text-red-700 bg-transparent border-0 cursor-pointer"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {deleteError && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {deleteError}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Skill"
          message={`Are you sure you want to delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => { setDeleteError(null); setDeleteTarget(null); }}
        />
      )}
    </div>
  );
}
