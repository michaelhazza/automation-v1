import { useState, useEffect, useMemo } from 'react';
import { getActiveClientId, getActiveClientName } from '../lib/auth';
import { User } from '../lib/auth';
import { fetchGoals, createGoal, deleteGoal, type Goal } from '../api/goals';

const LEVEL_LABELS: Record<string, string> = { mission: 'Mission', objective: 'Objective', key_result: 'Key Result' };
const LEVEL_CLS: Record<string, string> = {
  mission:    'bg-purple-100 text-purple-700',
  objective:  'bg-blue-100 text-blue-700',
  key_result: 'bg-emerald-100 text-emerald-700',
};

const STATUS_LABELS: Record<string, string> = { planned: 'Planned', active: 'Active', completed: 'Completed', archived: 'Archived' };
const STATUS_CLS: Record<string, string> = {
  planned:   'bg-slate-100 text-slate-500',
  active:    'bg-green-100 text-green-700',
  completed: 'bg-indigo-100 text-indigo-700',
  archived:  'bg-slate-100 text-slate-400',
};

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500';

interface TreeNode extends Goal {
  children: TreeNode[];
}

function buildTree(goals: Goal[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const g of goals) {
    map.set(g.id, { ...g, children: [] });
  }

  for (const g of goals) {
    const node = map.get(g.id)!;
    if (g.parentGoalId && map.has(g.parentGoalId)) {
      map.get(g.parentGoalId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function GoalTreeItem({ node, depth, expanded, onToggle, onDelete }: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <div
        className="flex items-center gap-2 py-2.5 px-3 hover:bg-slate-50 rounded-lg transition-colors"
        style={{ paddingLeft: `${12 + depth * 24}px` }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(node.id)}
            className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-600 bg-transparent border-0 cursor-pointer text-[12px]"
          >
            {isExpanded ? '\u25BC' : '\u25B6'}
          </button>
        ) : (
          <span className="w-5 h-5 flex items-center justify-center text-slate-300 text-[8px]">{'\u25CF'}</span>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[13px] text-slate-900 truncate">{node.title}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${LEVEL_CLS[node.level]}`}>
              {LEVEL_LABELS[node.level]}
            </span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_CLS[node.status]}`}>
              {STATUS_LABELS[node.status]}
            </span>
          </div>
          {node.description && (
            <div className="text-[12px] text-slate-500 mt-0.5 truncate">{node.description}</div>
          )}
        </div>

        {node.targetDate && (
          <div className="text-[11px] text-slate-400 shrink-0">
            {new Date(node.targetDate).toLocaleDateString()}
          </div>
        )}

        <button
          onClick={() => onDelete(node.id)}
          className="px-2 py-1 bg-transparent hover:bg-red-50 text-slate-400 hover:text-red-500 rounded text-[11px] border-0 cursor-pointer transition-colors"
        >
          Delete
        </button>
      </div>

      {isExpanded && node.children.map((child) => (
        <GoalTreeItem
          key={child.id}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

export default function GoalsPage({ user: _user }: { user: User }) {
  const clientId = getActiveClientId();
  const clientName = getActiveClientName();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newLevel, setNewLevel] = useState<Goal['level']>('objective');
  const [newParentId, setNewParentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | 'planned' | 'active' | 'completed' | 'archived'>('all');

  useEffect(() => {
    if (!clientId) { setLoading(false); return; }
    fetchGoals(clientId)
      .then(setGoals)
      .catch((err) => console.error('[GoalsPage] Failed to load goals:', err))
      .finally(() => setLoading(false));
  }, [clientId]);

  const tree = useMemo(() => {
    const filtered = filter === 'all' ? goals : goals.filter((g) => g.status === filter);
    return buildTree(filtered);
  }, [goals, filter]);

  const handleToggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!newTitle.trim() || !clientId) return;
    setSaving(true);
    try {
      const goal = await createGoal(clientId, {
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
        level: newLevel,
        parentGoalId: newParentId || undefined,
      });
      setGoals((prev) => [goal, ...prev]);
      setShowNew(false);
      setNewTitle('');
      setNewDesc('');
      setNewLevel('objective');
      setNewParentId('');
    } catch {
      // TODO: error toast
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!clientId) return;
    try {
      await deleteGoal(clientId, id);
      // Remove deleted goal and its descendants from local state
      const idsToRemove = new Set<string>();
      const collectDescendants = (goalId: string) => {
        idsToRemove.add(goalId);
        for (const g of goals) {
          if (g.parentGoalId === goalId) collectDescendants(g.id);
        }
      };
      collectDescendants(id);
      setGoals((prev) => prev.filter((g) => !idsToRemove.has(g.id)));
    } catch {
      // TODO: error toast
    }
  };

  if (!clientId) {
    return (
      <div className="animate-[fadeIn_0.2s_ease-out_both] flex flex-col items-center justify-center py-20 text-center">
        <div className="text-4xl mb-4">&#127919;</div>
        <div className="font-bold text-[18px] text-slate-900 mb-2">No client selected</div>
        <div className="text-[14px] text-slate-500">Select a client from the sidebar to view goals.</div>
      </div>
    );
  }

  // Missions as parent options for the create form
  const parentOptions = goals.filter((g) => g.level !== 'key_result');

  return (
    <div className="animate-[fadeIn_0.2s_ease-out_both]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-slate-900 tracking-tight m-0">Goals</h1>
          {clientName && <div className="text-[13px] text-slate-500 mt-0.5">{clientName}</div>}
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="btn btn-sm btn-primary"
        >
          + New Goal
        </button>
      </div>

      <div className="flex gap-2 mb-6">
        {(['all', 'planned', 'active', 'completed', 'archived'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-full border text-[12px] font-semibold cursor-pointer transition-colors ${
              filter === f
                ? 'border-indigo-500 bg-indigo-50 text-indigo-600'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            {f === 'all'
              ? `All (${goals.length})`
              : `${STATUS_LABELS[f]} (${goals.filter((g) => g.status === f).length})`}
          </button>
        ))}
      </div>

      {showNew && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
          <div className="font-semibold text-[14px] text-slate-900 mb-3.5">New Goal</div>
          <div className="flex flex-col gap-3">
            <input
              className={inputCls}
              placeholder="Goal title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <input
              className={inputCls}
              placeholder="Description (optional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-[12px] text-slate-500 font-medium mb-1 block">Level</label>
                <select
                  className={inputCls}
                  value={newLevel}
                  onChange={(e) => setNewLevel(e.target.value as Goal['level'])}
                >
                  <option value="mission">Mission</option>
                  <option value="objective">Objective</option>
                  <option value="key_result">Key Result</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-[12px] text-slate-500 font-medium mb-1 block">Parent Goal (optional)</label>
                <select
                  className={inputCls}
                  value={newParentId}
                  onChange={(e) => setNewParentId(e.target.value)}
                >
                  <option value="">None (root)</option>
                  {parentOptions.map((g) => (
                    <option key={g.id} value={g.id}>
                      {LEVEL_LABELS[g.level]}: {g.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim() || saving}
                className="btn btn-sm btn-primary"
              >
                {saving ? 'Creating...' : 'Create Goal'}
              </button>
              <button
                onClick={() => { setShowNew(false); setNewTitle(''); setNewDesc(''); setNewParentId(''); }}
                className="btn btn-sm btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-[linear-gradient(90deg,#f1f5f9_25%,#e2e8f0_50%,#f1f5f9_75%)] bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite]" />
          ))}
        </div>
      )}

      {!loading && tree.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-4xl mb-4">&#127919;</div>
          <div className="font-bold text-[18px] text-slate-900 mb-2">
            {filter === 'all' ? 'No goals yet' : `No ${filter} goals`}
          </div>
          <div className="text-[14px] text-slate-500">
            {filter === 'all'
              ? 'Create your first goal to give agents strategic direction.'
              : `No goals with ${filter} status.`}
          </div>
          {filter === 'all' && (
            <button
              onClick={() => setShowNew(true)}
              className="btn btn-sm btn-primary mt-3.5"
            >
              + New Goal
            </button>
          )}
        </div>
      )}

      {!loading && tree.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {tree.map((node) => (
            <GoalTreeItem
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
