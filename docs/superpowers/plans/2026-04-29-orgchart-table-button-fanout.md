# OrgChart Table + Button Fan-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert OrgChartPage "List" view from a card grid to a sortable/filterable table, and fan out the `.btn` class system to ~48 files that still use inline Tailwind button styles.

**Architecture:** OrgChart table reuses the existing `layout` useMemo (DFS hierarchy order) for default sort. Button fan-out is a mechanical find-and-replace: map inline Tailwind patterns to `.btn` variant + size modifier, preserve truly custom decoration.

**Tech Stack:** React, TypeScript, Tailwind CSS, existing `.btn` class system in `client/src/index.css`

---

## Table of Contents

1. [Button Pattern Mapping Reference](#button-pattern-mapping-reference)
2. [Task 1: OrgChart List → Table](#task-1-orgchart-list--sortablefilterable-table)
3. [Task 2: clientpulse + pulse Components](#task-2-button-fan-out--clientpulse--pulse-components)
4. [Task 3: Admin + System Pages Batch A](#task-3-button-fan-out--admin--system-pages-batch-a)
5. [Task 4: Subaccount + Agent Pages](#task-4-button-fan-out--subaccount--agent-pages)
6. [Task 5: Remaining Pages + Components](#task-5-button-fan-out--remaining-pages--components)

---

## Button Pattern Mapping Reference

Use this table for ALL button fan-out tasks (Tasks 2–5).

| Inline pattern signature | Replacement classes |
|---|---|
| `bg-indigo-600 … text-white` | `btn btn-primary` |
| `bg-indigo-500 … text-white` | `btn btn-primary` |
| `bg-white border border-slate-200 … text-slate-7` | `btn btn-secondary` |
| `border border-slate-200 … text-slate-700 … hover:bg-slate-50` | `btn btn-secondary` |
| `bg-slate-100 … text-slate-600 … hover:bg-slate-200` | `btn btn-ghost` |
| `text-slate-600 hover:bg-slate-100` (no bg, no border) | `btn btn-ghost` |
| `text-slate-500 hover:bg-slate-50` | `btn btn-ghost` |
| `bg-red-600 … text-white` | `btn btn-danger` |
| `text-red-600 hover:bg-red-50` | `btn btn-ghost text-red-600 hover:bg-red-50` |
| `bg-emerald-600 … text-white` or `bg-green-600 … text-white` | `btn btn-success` |

**Size modifiers** — prepend to variant:

| Padding in inline style | Modifier |
|---|---|
| `px-5 py-2.5` or `px-6 py-2.5` | none (default `.btn`) |
| `px-4 py-2` or `px-3 py-1.5` | `btn-sm` |
| `px-3 py-1` or `px-2.5 py-1` or `px-2 py-1` | `btn-xs` |
| `px-2 py-0.5` or `px-1.5 py-0.5` | `btn-xs` |
| Square icon-only ~36×36 | `btn-icon` |
| Square icon-only ~28×28 | `btn-icon-sm` |

**Keep** custom decoration outside base `.btn` scope (width, ring, shadow).
**Remove** classes duplicated by `.btn`: padding, font-size, font-weight, border-radius, border, cursor, transition, display, flex, items-center, gap, white-space, user-select.

---

## Task 1: OrgChart List → Sortable/Filterable Table

**Files:**
- Modify: `client/src/pages/OrgChartPage.tsx`

- [ ] **Step 1: Add sort + filter state** (after line 173 `liveAgentIds` state)

```tsx
const [listSort, setListSort] = useState<{ col: 'hierarchy' | 'name' | 'title' | 'status' | 'live'; dir: 'asc' | 'desc' }>({ col: 'hierarchy', dir: 'asc' });
const [listFilter, setListFilter] = useState('');
```

- [ ] **Step 2: Add hierarchy order map + sorted list derivation** (after `heartbeatAgents` useMemo)

```tsx
const hierarchyOrderMap = useMemo(() => {
  const m = new Map<string, number>();
  layout.forEach((l, i) => m.set(l.node.id, i));
  return m;
}, [layout]);

const listAgents = useMemo(() => {
  const q = listFilter.toLowerCase();
  const filtered = agents.filter((a: any) =>
    !listFilter ||
    (a.agent.name ?? '').toLowerCase().includes(q) ||
    (a.agentTitle ?? '').toLowerCase().includes(q)
  );
  return [...filtered].sort((a: any, b: any) => {
    let cmp = 0;
    switch (listSort.col) {
      case 'hierarchy': cmp = (hierarchyOrderMap.get(a.id) ?? 999) - (hierarchyOrderMap.get(b.id) ?? 999); break;
      case 'name': cmp = (a.agent.name ?? '').localeCompare(b.agent.name ?? ''); break;
      case 'title': cmp = (a.agentTitle ?? '').localeCompare(b.agentTitle ?? ''); break;
      case 'status': cmp = Number(b.isActive) - Number(a.isActive); break;
      case 'live': cmp = Number(liveAgentIds.has(b.agentId)) - Number(liveAgentIds.has(a.agentId)); break;
    }
    return listSort.dir === 'asc' ? cmp : -cmp;
  });
}, [agents, listFilter, listSort, hierarchyOrderMap, liveAgentIds]);
```

- [ ] **Step 3: Replace the list view JSX** (entire `{viewMode === 'list' && ...}` block)

```tsx
{viewMode === 'list' && (
  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
    <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
      <input
        type="text"
        placeholder="Filter agents…"
        value={listFilter}
        onChange={(e) => setListFilter(e.target.value)}
        className="flex-1 max-w-xs text-[13px] border border-slate-200 rounded-lg px-3 py-1.5 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
      {listFilter && (
        <button onClick={() => setListFilter('')} className="btn btn-xs btn-ghost text-slate-400">Clear</button>
      )}
      {listSort.col !== 'hierarchy' && (
        <button onClick={() => setListSort({ col: 'hierarchy', dir: 'asc' })} className="btn btn-xs btn-ghost text-indigo-500">
          Reset order
        </button>
      )}
      <span className="ml-auto text-[12px] text-slate-400">{listAgents.length} agent{listAgents.length !== 1 ? 's' : ''}</span>
    </div>
    <table className="data-table w-full">
      <thead>
        <tr>
          {([
            { col: 'name' as const, label: 'Name' },
            { col: 'title' as const, label: 'Title' },
            { col: 'status' as const, label: 'Status' },
            { col: 'live' as const, label: 'Live' },
          ]).map(({ col, label }) => (
            <th
              key={col}
              onClick={() => setListSort((s) => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })}
              className="cursor-pointer select-none whitespace-nowrap"
            >
              <span className="flex items-center gap-1">
                {label}
                {listSort.col === col
                  ? <span className="text-indigo-500">{listSort.dir === 'asc' ? '↑' : '↓'}</span>
                  : <span className="text-slate-300">↕</span>}
              </span>
            </th>
          ))}
          <th className="whitespace-nowrap">Reports To</th>
        </tr>
      </thead>
      <tbody>
        {listAgents.map((a: any) => {
          const isLive = liveAgentIds.has(a.agentId);
          const parentAgent = a.parentSubaccountAgentId
            ? agents.find((p: any) => p.id === a.parentSubaccountAgentId)
            : null;
          return (
            <tr key={a.id} onClick={() => navigate(`/agents/${a.agentId}`)} className="cursor-pointer">
              <td>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-[16px] bg-[linear-gradient(135deg,#f5f3ff,#ede9fe)]">
                    {a.agent.icon || '🤖'}
                  </div>
                  <span className="font-medium text-[13px] text-slate-900">{a.agent.name}</span>
                </div>
              </td>
              <td className="text-[13px] text-slate-500">{a.agentTitle ?? '—'}</td>
              <td>
                <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold capitalize ${a.isActive ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                  {a.isActive ? 'active' : 'inactive'}
                </span>
              </td>
              <td>
                <span
                  className={`inline-block w-2 h-2 rounded-full${isLive ? ' animate-pulse' : ''}`}
                  style={{ background: isLive ? '#22c55e' : (STATUS_DOT[a.agent.status] ?? '#cbd5e1') }}
                />
              </td>
              <td className="text-[13px] text-slate-500">{parentAgent ? (parentAgent as any).agent.name : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    {listAgents.length === 0 && listFilter && (
      <div className="py-8 text-center text-[13px] text-slate-400">No agents match "{listFilter}"</div>
    )}
  </div>
)}
```

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors in OrgChartPage.tsx.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/OrgChartPage.tsx
git commit -m "feat(org-chart): convert list view to sortable/filterable table"
```

## Task 2: Button Fan-out — clientpulse + pulse Components

**Files:**
- `client/src/components/clientpulse/SendSmsEditor.tsx`
- `client/src/components/clientpulse/OperatorAlertEditor.tsx`
- `client/src/components/clientpulse/FireAutomationEditor.tsx`
- `client/src/components/clientpulse/EmailAuthoringEditor.tsx`
- `client/src/components/clientpulse/CreateTaskEditor.tsx`
- `client/src/components/pulse/ActionBar.tsx`
- `client/src/components/pulse/HistoryTab.tsx`

- [ ] **Step 1: Update each file**

For each file: read in full, find every `<button className="..."` (and any anchor styled as a button), apply the mapping reference at the top of this plan. Expected patterns:
- Save/submit: `bg-indigo-600 … text-white` → `btn btn-primary` (or `btn btn-sm btn-primary` for smaller padding)
- Cancel: `bg-white border border-slate-200 text-slate-700` → `btn btn-secondary`
- Small inline: `px-3 py-1 rounded text-xs …` → `btn btn-xs btn-ghost` or `btn btn-xs btn-secondary`

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Fix any errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/clientpulse/ client/src/components/pulse/
git commit -m "style(buttons): apply btn class system to clientpulse and pulse components"
```

---

## Task 3: Button Fan-out — Admin + System Pages Batch A

**Files:**
- `client/src/pages/ActivityPage.tsx`
- `client/src/pages/AdminAutomationsPage.tsx`
- `client/src/pages/AdminCategoriesPage.tsx`
- `client/src/pages/AdminEnginesPage.tsx`
- `client/src/pages/AdminSkillEditPage.tsx`
- `client/src/pages/SystemAgentsPage.tsx`
- `client/src/pages/SystemAutomationsPage.tsx`
- `client/src/pages/SystemEnginesPage.tsx`
- `client/src/pages/SystemIncidentsPage.tsx`
- `client/src/pages/SystemOrganisationTemplatesPage.tsx`
- `client/src/pages/SystemSkillsPage.tsx`
- `client/src/pages/SystemTaskQueuePage.tsx`

- [ ] **Step 1: Update each file**

For each file: read in full, find every `<button` with inline Tailwind sizing/color. Pay special attention to table row action buttons: `px-3 py-1 text-xs …` → `btn btn-xs btn-secondary` (or `btn btn-xs btn-ghost`). Header/page-level primary actions: `btn btn-primary`.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/ActivityPage.tsx client/src/pages/AdminAutomationsPage.tsx client/src/pages/AdminCategoriesPage.tsx client/src/pages/AdminEnginesPage.tsx client/src/pages/AdminSkillEditPage.tsx client/src/pages/SystemAgentsPage.tsx client/src/pages/SystemAutomationsPage.tsx client/src/pages/SystemEnginesPage.tsx client/src/pages/SystemIncidentsPage.tsx client/src/pages/SystemOrganisationTemplatesPage.tsx client/src/pages/SystemSkillsPage.tsx client/src/pages/SystemTaskQueuePage.tsx
git commit -m "style(buttons): apply btn class system to admin and system pages batch A"
```

## Task 4: Button Fan-out — Subaccount + Agent Pages

**Files:**
- `client/src/pages/SubaccountAgentEditPage.tsx`
- `client/src/pages/SubaccountAgentsPage.tsx`
- `client/src/pages/SubaccountBlueprintsPage.tsx`
- `client/src/pages/SubaccountTagsPage.tsx`
- `client/src/pages/SubaccountTeamPage.tsx`
- `client/src/pages/AgentChatPage.tsx`
- `client/src/pages/AutomationExecutionPage.tsx`
- `client/src/pages/ClientPulseSettingsPage.tsx`
- `client/src/pages/ConfigAssistantPage.tsx`
- `client/src/pages/WorkspaceMemoryPage.tsx`
- `client/src/pages/OrgAgentConfigsPage.tsx`
- `client/src/pages/OrgMemoryPage.tsx`

- [ ] **Step 1: Update each file**

For each file: read in full, find every `<button` with inline Tailwind. Common patterns in chat/agent pages: send buttons (`bg-indigo-600 px-4 py-2`) → `btn btn-sm btn-primary`; ghost icon buttons → `btn btn-icon btn-ghost`.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/SubaccountAgentEditPage.tsx client/src/pages/SubaccountAgentsPage.tsx client/src/pages/SubaccountBlueprintsPage.tsx client/src/pages/SubaccountTagsPage.tsx client/src/pages/SubaccountTeamPage.tsx client/src/pages/AgentChatPage.tsx client/src/pages/AutomationExecutionPage.tsx client/src/pages/ClientPulseSettingsPage.tsx client/src/pages/ConfigAssistantPage.tsx client/src/pages/WorkspaceMemoryPage.tsx client/src/pages/OrgAgentConfigsPage.tsx client/src/pages/OrgMemoryPage.tsx
git commit -m "style(buttons): apply btn class system to subaccount and agent pages"
```

---

## Task 5: Button Fan-out — Remaining Pages + Components

**Files:**
- `client/src/pages/AgentTriggersPage.tsx`
- `client/src/pages/ConnectorConfigsPage.tsx`
- `client/src/pages/HierarchyTemplatesPage.tsx`
- `client/src/pages/ProjectDetailPage.tsx`
- `client/src/pages/ProjectsPage.tsx`
- `client/src/pages/ScheduledTasksPage.tsx`
- `client/src/components/CredentialsTab.tsx`
- `client/src/components/McpCatalogue.tsx`

- [ ] **Step 1: Update each file**

For each file: read in full, apply mapping reference.

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Final build check**

```bash
npm run build:client 2>&1 | tail -20
```

Expected: exit 0, no errors (warnings acceptable).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/AgentTriggersPage.tsx client/src/pages/ConnectorConfigsPage.tsx client/src/pages/HierarchyTemplatesPage.tsx client/src/pages/ProjectDetailPage.tsx client/src/pages/ProjectsPage.tsx client/src/pages/ScheduledTasksPage.tsx client/src/components/CredentialsTab.tsx client/src/components/McpCatalogue.tsx
git commit -m "style(buttons): apply btn class system to remaining pages and components"
```
