/**
 * _sidebar.js — Three-mode shared sidebar for the consolidation-2026-05-06 prototype.
 *
 * Usage:
 *   <div id="sidebar-mount"></div>
 *   <script src="_sidebar.js"></script>
 *   <script>renderSidebar(localStorage.getItem('prototype.sidebar.mode') || 'workspace', 'home.html');</script>
 *
 * Modes: 'workspace' | 'org' | 'system'
 * Mode persists in localStorage under key 'prototype.sidebar.mode'.
 * Stub links show a 2-second toast on click instead of navigating.
 */

/* ── Icons (inline SVG strings) ──────────────────────────────────────── */
const ICONS = {
  home:       '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  inbox:      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  calendar:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  agents:     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  automations:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  workflows:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  tasks:      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  sites:      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  triggers:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 8.35 22 4 17.65 4"/><path d="M21.97 8.35A10 10 0 1 0 19.79 17.35"/></svg>',
  goals:      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  orgchart:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><rect x="9" y="16" width="6" height="6" rx="1"/><path d="M8 10h8M12 8v8"/></svg>',
  portal:     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>',
  team:       '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  activity:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  actionlog:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  knowledge:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  connections:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="9" height="9"/><rect x="13" y="2" width="9" height="9"/><rect x="2" y="13" width="9" height="9"/><path d="M13 13h9v9h-9z" stroke-dasharray="2 2"/></svg>',
  dashboard:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  reports:    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17l-5-5-3 3-3-3"/></svg>',
  settings:   '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>',
  companies:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  skills:     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
  health:     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  budget:     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  orgs:       '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  incidents:  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  diagnostics:'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  queues:     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  llmpnl:     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  profile:    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  studio:     '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg>',
};

/* ── Nav config per mode ─────────────────────────────────────────────── */

const NAV = {
  workspace: {
    sections: [
      {
        label: 'Workspace',
        items: [
          { label: 'Home',         href: 'home.html',         icon: 'home' },
          { label: 'Inbox',        href: 'inbox.html',        icon: 'inbox',       badge: '7', badgeColor: 'amber' },
          { label: 'Calendar',     href: 'calendar.html',     icon: 'calendar' },
          { label: 'Agents',       href: 'agents.html',       icon: 'agents' },
          { label: 'Automations',  href: 'automations.html',  icon: 'automations' },
          { label: 'Workflows',    href: 'workflows.html',    icon: 'workflows' },
          { label: 'Tasks',        href: '#',                 icon: 'tasks',       stub: true },
          { label: 'Sites',        href: '#',                 icon: 'sites',       stub: true },
          { label: 'Triggers',     href: '#',                 icon: 'triggers',    stub: true },
          { label: 'Goals',        href: '#',                 icon: 'goals',       stub: true },
          { label: 'Org Chart',    href: '#',                 icon: 'orgchart',    stub: true },
          { label: 'Portal',       href: '#',                 icon: 'portal',      stub: true },
          { label: 'Team',         href: '#',                 icon: 'team',        stub: true },
          { label: 'Activity',     href: 'activity.html',     icon: 'activity' },
          { label: 'Action Log',   href: '#',                 icon: 'actionlog',   stub: true },
        ],
      },
      {
        label: 'Knowledge',
        items: [
          { label: 'Knowledge',    href: 'knowledge.html',    icon: 'knowledge' },
        ],
      },
      {
        label: 'Connections',
        items: [
          { label: 'Integrations', href: 'integrations.html', icon: 'connections' },
        ],
      },
      {
        label: 'ClientPulse',
        items: [
          { label: 'Dashboard',    href: '#', icon: 'dashboard',    stub: true, stubNote: 'separate thread' },
          { label: 'Reports',      href: '#', icon: 'reports',      stub: true, stubNote: 'separate thread' },
          { label: 'Settings',     href: '#', icon: 'settings',     stub: true, stubNote: 'separate thread' },
        ],
      },
    ],
    bottom: [
      { label: 'Manage',  href: 'manage-org.html', icon: 'settings' },
    ],
  },

  org: {
    sections: [
      {
        label: 'Organisation',
        items: [
          { label: 'Companies',        href: '#',             icon: 'companies',    stub: true },
          { label: 'Agents',           href: '#',             icon: 'agents',       stub: true },
          { label: 'Calendar',         href: 'calendar.html', icon: 'calendar' },
          { label: 'Automations',      href: '#',             icon: 'automations',  stub: true },
          { label: 'Knowledge',        href: '#',             icon: 'knowledge',    stub: true, stubNote: 'org-knowledge.html in 7b' },
          { label: 'Connections',      href: '#',             icon: 'connections',  stub: true },
          { label: 'Skills',           href: '#',             icon: 'skills',       stub: true },
          { label: 'Workflows',        href: '#',             icon: 'workflows',    stub: true },
          { label: 'Health',           href: '#',             icon: 'health',       stub: true },
          { label: 'Spending Budgets', href: '#',             icon: 'budget',       stub: true },
          { label: 'Team',             href: '#',             icon: 'team',         stub: true },
          { label: 'Teams',            href: '#',             icon: 'team',         stub: true },
          { label: 'Activity',         href: 'activity.html?scope=org', icon: 'activity' },
        ],
      },
      {
        label: 'ClientPulse',
        items: [
          { label: 'Dashboard', href: '#', icon: 'dashboard', stub: true, stubNote: 'separate thread' },
          { label: 'Reports',   href: '#', icon: 'reports',   stub: true, stubNote: 'separate thread' },
          { label: 'Settings',  href: '#', icon: 'settings',  stub: true, stubNote: 'separate thread' },
        ],
      },
    ],
    bottom: [
      { label: 'Manage', href: '#', icon: 'settings', stub: true },
    ],
  },

  system: {
    sections: [
      {
        label: 'System',
        items: [
          { label: 'Organisations',   href: '#',                          icon: 'orgs',        stub: true },
          { label: 'Agents',          href: '#',                          icon: 'agents',       stub: true },
          { label: 'Skills',          href: '#',                          icon: 'skills',       stub: true },
          { label: 'Workflow Studio', href: '#',                          icon: 'studio',       stub: true },
          { label: 'Automations',     href: '#',                          icon: 'automations',  stub: true },
          { label: 'Activity',        href: 'activity.html?scope=system', icon: 'activity' },
          { label: 'Incidents',       href: '#',                          icon: 'incidents',    stub: true, badge: '3', badgeColor: 'amber' },
          { label: 'Diagnostics',     href: '#',                          icon: 'diagnostics',  stub: true },
          { label: 'Job Queues',      href: '#',                          icon: 'queues',       stub: true },
          { label: 'LLM P&L',         href: '#',                          icon: 'llmpnl',       stub: true },
          { label: 'Settings',        href: '#',                          icon: 'settings',     stub: true },
        ],
      },
    ],
    bottom: [],
  },
};

/* ── Toast notification ──────────────────────────────────────────────── */
function showStubToast() {
  const existing = document.getElementById('sidebar-stub-toast');
  if (existing) { existing.remove(); }

  const toast = document.createElement('div');
  toast.id = 'sidebar-stub-toast';
  toast.style.cssText = [
    'position:fixed',
    'top:16px',
    'right:20px',
    'z-index:9999',
    'background:#1e293b',
    'color:#f1f5f9',
    'font-size:12.5px',
    'font-family:Inter,ui-sans-serif,system-ui,sans-serif',
    'padding:8px 14px',
    'border-radius:8px',
    'box-shadow:0 4px 16px rgba(0,0,0,0.22)',
    'pointer-events:none',
    'opacity:1',
    'transition:opacity 0.3s',
  ].join(';');
  toast.textContent = 'Prototype stub: not implemented';
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 320);
  }, 2000);
}

/* ── Active-link detection ───────────────────────────────────────────── */
function isActive(itemHref, activeHref) {
  if (!itemHref || itemHref === '#') return false;
  // Strip query strings for comparison
  const itemBase = itemHref.split('?')[0];
  const activeBase = activeHref ? activeHref.split('?')[0] : '';
  return itemBase === activeBase;
}

/* ── Build a single nav link element ────────────────────────────────── */
function buildLink(item, activeHref) {
  const active = isActive(item.href, activeHref);
  const isStub = item.stub || item.href === '#';

  const a = document.createElement(isStub ? 'a' : 'a');
  a.className = 'sidebar-link' + (active ? ' active' : '');
  a.href = isStub ? '#' : item.href;

  if (isStub) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      showStubToast();
    });
  }

  // Icon
  a.innerHTML = ICONS[item.icon] || '';

  // Label node
  const labelSpan = document.createElement('span');
  labelSpan.style.cssText = 'flex:1;display:flex;align-items:center;gap:6px;';

  const labelText = document.createTextNode(item.label);
  labelSpan.appendChild(labelText);

  // Stub suffix (muted "coming" or custom note)
  if (isStub && !item.badge) {
    const muted = document.createElement('span');
    muted.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.2);font-weight:400;';
    muted.textContent = item.stubNote ? '(' + item.stubNote + ')' : '(stub)';
    labelSpan.appendChild(muted);
  }

  a.appendChild(labelSpan);

  // Badge
  if (item.badge) {
    const badge = document.createElement('span');
    badge.className = 'sidebar-badge' + (item.badgeColor === 'amber' ? ' amber' : '');
    badge.textContent = item.badge;
    a.appendChild(badge);
  }

  return a;
}

/* ── Build mode-switcher pill row ────────────────────────────────────── */
function buildModeSwitcher(currentMode, activeHref) {
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:4px',
    'padding:10px 12px 8px',
    'border-bottom:1px solid rgba(255,255,255,0.06)',
  ].join(';');

  ['workspace', 'org', 'system'].forEach((mode) => {
    const pill = document.createElement('button');
    const isActive = mode === currentMode;
    pill.style.cssText = [
      'flex:1',
      'padding:4px 0',
      'border:none',
      'border-radius:6px',
      'font-size:10.5px',
      'font-weight:' + (isActive ? '700' : '500'),
      'cursor:pointer',
      'transition:background 0.12s,color 0.12s',
      'background:' + (isActive ? '#4f46e5' : 'transparent'),
      'color:' + (isActive ? '#fff' : 'rgba(255,255,255,0.35)'),
      'font-family:Inter,ui-sans-serif,system-ui,sans-serif',
      'letter-spacing:-0.01em',
    ].join(';');
    pill.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
    pill.title = 'Switch to ' + mode + ' mode';

    pill.addEventListener('click', () => {
      localStorage.setItem('prototype.sidebar.mode', mode);
      renderSidebar(mode, activeHref);
    });

    wrap.appendChild(pill);
  });

  return wrap;
}

/* ── Build client switcher (workspace mode only) ─────────────────────── */
function buildClientSwitcher() {
  const div = document.createElement('div');
  div.className = 'sidebar-client-switcher';
  div.innerHTML = [
    '<div class="sidebar-client-dot"></div>',
    '<span class="sidebar-client-name">Acme Corp</span>',
    '<span class="sidebar-client-caret">&#9660;</span>',
  ].join('');
  return div;
}

/* ── Build profile link (bottom of all modes) ────────────────────────── */
function buildProfileLink() {
  const section = document.createElement('div');
  section.style.cssText = [
    'border-top:1px solid rgba(255,255,255,0.08)',
    'padding:8px 0 12px',
    'margin-top:auto',
  ].join(';');

  const a = document.createElement('a');
  a.className = 'sidebar-link';
  a.href = '#';
  a.addEventListener('click', (e) => { e.preventDefault(); showStubToast(); });

  // Avatar circle
  const avatar = document.createElement('div');
  avatar.style.cssText = [
    'width:22px',
    'height:22px',
    'border-radius:50%',
    'background:linear-gradient(135deg,#6366f1,#8b5cf6)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'flex-shrink:0',
    'font-size:9px',
    'font-weight:700',
    'color:white',
  ].join(';');
  avatar.textContent = 'SC';

  const labelSpan = document.createElement('span');
  labelSpan.style.cssText = 'flex:1;display:flex;align-items:center;gap:6px;';
  labelSpan.appendChild(document.createTextNode('Profile Settings'));

  const stubNote = document.createElement('span');
  stubNote.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.2);font-weight:400;';
  stubNote.textContent = '(stub)';
  labelSpan.appendChild(stubNote);

  a.appendChild(avatar);
  a.appendChild(labelSpan);
  section.appendChild(a);

  return section;
}

/* ── Main render function ────────────────────────────────────────────── */
function renderSidebar(mode, activeHref) {
  const mount = document.getElementById('sidebar-mount');
  if (!mount) return;

  // Normalise mode
  if (!['workspace', 'org', 'system'].includes(mode)) mode = 'workspace';

  // Clear
  mount.innerHTML = '';

  // Build <nav class="sidebar">
  const nav = document.createElement('nav');
  nav.className = 'sidebar';

  // 1. Logo
  const logo = document.createElement('div');
  logo.className = 'sidebar-logo';
  logo.innerHTML = [
    '<div class="sidebar-logo-mark">',
      '<div class="sidebar-logo-icon">',
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">',
          '<circle cx="12" cy="12" r="3"/>',
          '<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
          '<path d="M4.93 4.93a10 10 0 0 0 0 14.14"/>',
        '</svg>',
      '</div>',
      '<span class="sidebar-logo-text">Automation OS</span>',
    '</div>',
  ].join('');
  nav.appendChild(logo);

  // 2. Mode switcher
  nav.appendChild(buildModeSwitcher(mode, activeHref));

  // 3. Client switcher (workspace mode only)
  if (mode === 'workspace') {
    nav.appendChild(buildClientSwitcher());
  }

  // 4. Sections
  const config = NAV[mode];
  config.sections.forEach((section) => {
    const sectionEl = document.createElement('div');
    sectionEl.className = 'sidebar-section';

    if (section.label) {
      const labelEl = document.createElement('div');
      labelEl.className = 'sidebar-section-label';
      labelEl.textContent = section.label;
      sectionEl.appendChild(labelEl);
    }

    section.items.forEach((item) => {
      sectionEl.appendChild(buildLink(item, activeHref));
    });

    nav.appendChild(sectionEl);
  });

  // 5. Bottom section (Manage + Profile)
  const bottomWrap = document.createElement('div');
  bottomWrap.style.cssText = 'margin-top:auto;display:flex;flex-direction:column;';

  if (config.bottom.length > 0) {
    const bottomSection = document.createElement('div');
    bottomSection.className = 'sidebar-section';
    config.bottom.forEach((item) => {
      bottomSection.appendChild(buildLink(item, activeHref));
    });
    bottomWrap.appendChild(bottomSection);
  }

  bottomWrap.appendChild(buildProfileLink());
  nav.appendChild(bottomWrap);

  mount.appendChild(nav);
}

/* ── Auto-init from data attribute if present ─────────────────────────
   Pages can use: <div id="sidebar-mount" data-page="home.html"></div>
   and call renderSidebar() without arguments. Not required. */
