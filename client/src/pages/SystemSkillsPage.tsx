import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { User } from '../lib/auth';
import ConfirmDialog from '../components/ConfirmDialog';
import VisibilitySegmentedControl, { type SkillVisibility } from '../components/VisibilitySegmentedControl';

interface SystemSkill {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  visibility: SkillVisibility;
  instructions: string | null;
  createdAt: string;
}

type SortCol = 'name' | 'slug' | 'instructions' | 'active' | 'visibility';
type SortDir = 'asc' | 'desc';
type OpenCol = SortCol | null;

// Visibility sort order
const VIS_ORDER: Record<SkillVisibility, number> = { none: 0, basic: 1, full: 2 };

// ─── Column header with dropdown ────────────────────────────────────────────

interface ColHeaderProps {
  label: string;
  col: SortCol;
  openCol: OpenCol;
  sortCol: SortCol | null;
  sortDir: SortDir;
  hasActiveFilter: boolean;
  onToggleOpen: (col: SortCol) => void;
  onSort: (col: SortCol, dir: SortDir) => void;
  children: React.ReactNode; // filter controls
}

function ColHeader({
  label, col, openCol, sortCol, sortDir, hasActiveFilter,
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
        {/* sort indicator */}
        {isSorted && (
          <span className="text-indigo-500 text-[11px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
        )}
        {/* filter active dot */}
        {hasActiveFilter && !isSorted && (
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
        )}
        {hasActiveFilter && isSorted && (
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
        )}
        {/* chevron */}
        <svg
          className={`ml-auto w-3 h-3 transition-transform ${isOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 min-w-[190px] bg-white border border-slate-200 rounded-lg shadow-lg py-1 mt-0.5">
          {/* Sort options */}
          <div className="px-2 pt-1 pb-0.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-2 py-1">Sort</div>
            <button
              onClick={() => onSort(col, 'asc')}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-[12px] rounded-md border-0 cursor-pointer transition-colors text-left ${isSorted && sortDir === 'asc' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-transparent text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="text-[11px] w-3">↑</span>
              {col === 'name' ? 'A → Z' : col === 'instructions' ? 'Has first' : col === 'active' ? 'Active first' : 'None → Full'}
              {isSorted && sortDir === 'asc' && <span className="ml-auto text-indigo-500">✓</span>}
            </button>
            <button
              onClick={() => onSort(col, 'desc')}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-[12px] rounded-md border-0 cursor-pointer transition-colors text-left ${isSorted && sortDir === 'desc' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-transparent text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="text-[11px] w-3">↓</span>
              {col === 'name' ? 'Z → A' : col === 'instructions' ? 'None first' : col === 'active' ? 'Inactive first' : 'Full → None'}
              {isSorted && sortDir === 'desc' && <span className="ml-auto text-indigo-500">✓</span>}
            </button>
          </div>

          {/* Divider + filter checkboxes */}
          <div className="border-t border-slate-100 mt-1 px-2 pt-1 pb-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-2 py-1">Filter</div>
            {children}
          </div>
        </div>
      )}
    </th>
  );
}

// ─── Checkbox + All/None controls inside a dropdown ─────────────────────────

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

// ─── Name column header (sort only, no filter) ───────────────────────────────

interface NameColHeaderProps {
  col: SortCol;
  label: string;
  openCol: OpenCol;
  sortCol: SortCol | null;
  sortDir: SortDir;
  onToggleOpen: (col: SortCol) => void;
  onSort: (col: SortCol, dir: SortDir) => void;
}

function NameColHeader({ col, label, openCol, sortCol, sortDir, onToggleOpen, onSort }: NameColHeaderProps) {
  const isOpen = openCol === col;
  const isSorted = sortCol === col;

  return (
    <th className="px-4 py-0 text-left relative" style={{ userSelect: 'none' }}>
      <button
        onClick={() => onToggleOpen(col)}
        className={`flex items-center gap-1.5 w-full py-3 bg-transparent border-0 cursor-pointer text-[13px] font-semibold text-left transition-colors ${isOpen ? 'text-indigo-600' : 'text-slate-700 hover:text-slate-900'}`}
      >
        <span>{label}</span>
        {isSorted && <span className="text-indigo-500 text-[11px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
        <svg
          className={`ml-auto w-3 h-3 transition-transform ${isOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 min-w-[160px] bg-white border border-slate-200 rounded-lg shadow-lg py-1 mt-0.5">
          <div className="px-2 py-1">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold px-2 py-1">Sort</div>
            <button
              onClick={() => onSort(col, 'asc')}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-[12px] rounded-md border-0 cursor-pointer transition-colors text-left ${isSorted && sortDir === 'asc' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-transparent text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="text-[11px] w-3">↑</span> A → Z
              {isSorted && sortDir === 'asc' && <span className="ml-auto text-indigo-500">✓</span>}
            </button>
            <button
              onClick={() => onSort(col, 'desc')}
              className={`flex items-center gap-2 w-full px-2 py-1.5 text-[12px] rounded-md border-0 cursor-pointer transition-colors text-left ${isSorted && sortDir === 'desc' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'bg-transparent text-slate-700 hover:bg-slate-50'}`}
            >
              <span className="text-[11px] w-3">↓</span> Z → A
              {isSorted && sortDir === 'desc' && <span className="ml-auto text-indigo-500">✓</span>}
            </button>
          </div>
        </div>
      )}
    </th>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SystemSkillsPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<SystemSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<Record<string, string>>({});

  // Sort state
  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Filter state — empty set = no filter (all pass)
  const [filterInstructions, setFilterInstructions] = useState<Set<'has' | 'none'>>(new Set());
  const [filterActive, setFilterActive] = useState<Set<'active' | 'inactive'>>(new Set());
  const [filterVisibility, setFilterVisibility] = useState<Set<SkillVisibility>>(new Set());

  // Which column dropdown is open
  const [openCol, setOpenCol] = useState<OpenCol>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/system/skills');
      setSkills(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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

  const handleVisibilityChange = async (skill: SystemSkill, next: SkillVisibility) => {
    try {
      await api.patch(`/api/system/skills/${skill.id}`, { visibility: next });
      setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, visibility: next } : s));
      setActionError(prev => { const { [skill.id]: _, ...rest } = prev; return rest; });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError(prev => ({ ...prev, [skill.id]: e.response?.data?.error ?? 'Failed to update' }));
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/api/system/skills/${deleteId}`);
      setDeleteId(null);
      load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setActionError(prev => ({ ...prev, [deleteId]: e.response?.data?.error ?? 'Failed to delete' }));
      setDeleteId(null);
    }
  };

  // Filter — the Sets are EXCLUSION sets: values in the set are hidden.
  // Empty set = nothing excluded = all rows shown.
  const filtered = skills.filter((s) => {
    if (filterInstructions.has(s.instructions ? 'has' : 'none')) return false;
    if (filterActive.has(s.isActive ? 'active' : 'inactive')) return false;
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
    } else if (sortCol === 'instructions') {
      cmp = (a.instructions ? 1 : 0) - (b.instructions ? 1 : 0);
    } else if (sortCol === 'active') {
      cmp = (a.isActive ? 1 : 0) - (b.isActive ? 1 : 0);
    } else if (sortCol === 'visibility') {
      cmp = VIS_ORDER[a.visibility] - VIS_ORDER[b.visibility];
    }
    return sortDir === 'asc' ? cmp : -cmp;
  }) : filtered;

  const activeFilterCount = filterInstructions.size + filterActive.size + filterVisibility.size;
  const clearAll = () => {
    setFilterInstructions(new Set());
    setFilterActive(new Set());
    setFilterVisibility(new Set());
    setSortCol(null);
  };

  if (loading) {
    return <div className="py-12 text-center text-slate-500 text-[14px]">Loading...</div>;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-[28px] font-bold text-slate-800 m-0">
            System Skills{' '}
            <span className="text-[16px] font-normal text-slate-400">
              ({activeFilterCount > 0 ? `${displayed.length} of ${skills.length}` : skills.length})
            </span>
          </h1>
          <p className="text-slate-500 mt-2 mb-0 text-[14px]">
            Platform-level skills that handle task board interactions and core agent capabilities. These are automatically attached to system agents and hidden from organisation admins.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(activeFilterCount > 0 || sortCol) && (
            <button
              onClick={clearAll}
              className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-0 rounded-lg text-[13px] font-medium cursor-pointer transition-colors"
            >
              Clear all
            </button>
          )}
          <button
            onClick={() => navigate('/system/skill-studio')}
            className="px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-[14px] font-medium whitespace-nowrap cursor-pointer transition-colors"
          >
            Skill Studio
          </button>
          <button
            onClick={() => navigate('/system/skill-analyser')}
            className="px-5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-[14px] font-medium whitespace-nowrap cursor-pointer transition-colors"
          >
            Analyser
          </button>
          <button
            onClick={() => navigate('/system/skills/new')}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[14px] font-medium whitespace-nowrap cursor-pointer transition-colors"
          >
            + New System Skill
          </button>
        </div>
      </div>

      {deleteId && (
        <ConfirmDialog
          title="Delete system skill"
          message="Are you sure you want to delete this system skill? System agents using it will lose access."
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-visible" ref={tableRef}>
        {skills.length === 0 ? (
          <div className="py-12 px-8 text-center">
            <div className="text-[36px] mb-3">🔧</div>
            <div className="text-[15px] font-semibold text-slate-800 mb-1.5">No system skills yet</div>
            <div className="text-[13px] text-slate-500 mb-4">Create system skills to define core capabilities.</div>
            <button
              onClick={() => navigate('/system/skills/new')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white border-0 rounded-lg text-[13px] font-medium cursor-pointer transition-colors"
            >
              + Create System Skill
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <NameColHeader
                  col="name"
                  label="Name"
                  openCol={openCol}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onToggleOpen={toggleOpen}
                  onSort={handleSort}
                />
                <NameColHeader
                  col="slug"
                  label="Slug"
                  openCol={openCol}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  onToggleOpen={toggleOpen}
                  onSort={handleSort}
                />

                <ColHeader
                  label="Instructions"
                  col="instructions"
                  openCol={openCol}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  hasActiveFilter={filterInstructions.size > 0}
                  onToggleOpen={toggleOpen}
                  onSort={handleSort}
                >
                  <FilterActions
                    onAll={() => setFilterInstructions(new Set())}
                    onNone={() => setFilterInstructions(new Set(['has', 'none']))}
                  />
                  <CheckOption
                    checked={!filterInstructions.has('has')}
                    onChange={() => toggleFilter(filterInstructions, setFilterInstructions, 'has')}
                    label={<span className="text-green-800 bg-green-100 px-1.5 py-0.5 rounded text-[11px]">Has instructions</span>}
                  />
                  <CheckOption
                    checked={!filterInstructions.has('none')}
                    onChange={() => toggleFilter(filterInstructions, setFilterInstructions, 'none')}
                    label={<span className="text-orange-800 bg-orange-50 px-1.5 py-0.5 rounded text-[11px]">No instructions</span>}
                  />
                </ColHeader>

                <ColHeader
                  label="Active"
                  col="active"
                  openCol={openCol}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  hasActiveFilter={filterActive.size > 0}
                  onToggleOpen={toggleOpen}
                  onSort={handleSort}
                >
                  <FilterActions
                    onAll={() => setFilterActive(new Set())}
                    onNone={() => setFilterActive(new Set(['active', 'inactive']))}
                  />
                  <CheckOption
                    checked={!filterActive.has('active')}
                    onChange={() => toggleFilter(filterActive, setFilterActive, 'active')}
                    label={<span className="text-green-800 bg-green-100 px-2 py-0.5 rounded-full text-[11px] font-medium">Active</span>}
                  />
                  <CheckOption
                    checked={!filterActive.has('inactive')}
                    onChange={() => toggleFilter(filterActive, setFilterActive, 'inactive')}
                    label={<span className="text-orange-800 bg-orange-50 px-2 py-0.5 rounded-full text-[11px] font-medium">Inactive</span>}
                  />
                </ColHeader>

                <ColHeader
                  label="Visibility"
                  col="visibility"
                  openCol={openCol}
                  sortCol={sortCol}
                  sortDir={sortDir}
                  hasActiveFilter={filterVisibility.size > 0}
                  onToggleOpen={toggleOpen}
                  onSort={handleSort}
                >
                  <FilterActions
                    onAll={() => setFilterVisibility(new Set())}
                    onNone={() => setFilterVisibility(new Set(['none', 'basic', 'full']))}
                  />
                  {(['none', 'basic', 'full'] as SkillVisibility[]).map((v) => (
                    <CheckOption
                      key={v}
                      checked={!filterVisibility.has(v)}
                      onChange={() => toggleFilter(filterVisibility, setFilterVisibility, v)}
                      label={<span className="text-slate-600 text-[12px]">{v.charAt(0).toUpperCase() + v.slice(1)}</span>}
                    />
                  ))}
                </ColHeader>

                <th className="px-4 py-3 text-right font-semibold text-slate-700 text-[13px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayed.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-slate-400">
                    No skills match the current filters.{' '}
                    <button onClick={clearAll} className="text-indigo-600 hover:text-indigo-800 bg-transparent border-0 cursor-pointer p-0 text-[13px]">
                      Clear filters
                    </button>
                  </td>
                </tr>
              )}
              {displayed.map((skill) => (
                <tr key={skill.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-800">{skill.name}</div>
                    {skill.description && <div className="text-[12px] text-slate-500 mt-0.5">{skill.description}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{skill.slug}</code>
                  </td>
                  <td className="px-4 py-3">
                    {skill.instructions ? (
                      <span className="text-[12px] text-green-800 bg-green-100 px-2 py-0.5 rounded">Has instructions</span>
                    ) : (
                      <span className="text-[12px] text-orange-800 bg-orange-50 px-2 py-0.5 rounded">No instructions</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[12px] font-medium ${skill.isActive ? 'bg-green-100 text-green-800' : 'bg-orange-50 text-orange-800'}`}>
                      {skill.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <VisibilitySegmentedControl
                      value={skill.visibility}
                      onChange={(next) => handleVisibilityChange(skill, next)}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end items-center">
                      <Link to={`/system/skills/${skill.id}`} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-[12px] font-medium no-underline transition-colors">Edit</Link>
                      <button onClick={() => setDeleteId(skill.id)} className="px-2.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 border-0 rounded-md text-[12px] font-medium cursor-pointer transition-colors">Delete</button>
                    </div>
                    {actionError[skill.id] && <div className="text-[11px] text-red-600 mt-1">{actionError[skill.id]}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
