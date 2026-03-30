# UI Redesign — Paperclip-Inspired

## Status: In Progress

## Phase 1: Tailwind Setup + New Layout
- [x] Install Tailwind CSS, PostCSS, autoprefixer
- [ ] Create postcss.config.js
- [ ] Create tailwind.config.ts (preflight disabled)
- [ ] Update index.css with Tailwind directives
- [ ] Rewrite Layout.tsx — icon rail (client switcher) + flat sidebar + breadcrumb bar

## Phase 2: Live Agent Status Badges
- [ ] Add GET /api/subaccounts/:id/live-status endpoint
- [ ] Poll live-status in Layout every 15s
- [ ] Show badge on "AI Team" nav item

## Phase 3: Breadcrumb Bar
- [ ] URL-derived breadcrumbs in Layout (no page changes needed)
- [ ] BreadcrumbContext for page-level overrides

## Phase 4: Projects
- [ ] DB schema: server/db/schema/projects.ts
- [ ] Migration: migrations/0022_add_projects.sql
- [ ] Route: server/routes/projects.ts
- [ ] Update server/db/schema/index.ts
- [ ] Update server/index.ts
- [ ] Frontend: client/src/pages/ProjectsPage.tsx
- [ ] Add /projects route to App.tsx

## Phase 5: Command Palette (Cmd+K)
- [ ] CommandPalette component (search clients, agents, nav)
- [ ] Global Cmd+K keyboard handler in Layout
- [ ] Wire into Layout with subaccounts + agent data

## Outcome
Discord-style client switcher icon rail, flat always-visible nav, live agent badges, breadcrumbs, projects section, command palette.
