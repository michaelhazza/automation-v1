# UI Redesign — Paperclip-Inspired

## Status: Complete (phases 1–5) ✅

## Phase 1: Tailwind Setup + New Layout ✅
- [x] Install Tailwind CSS v4 + @tailwindcss/vite
- [x] Wire into vite.config.ts
- [x] Update index.css (theme + utilities only, no preflight — preserves existing page styles)
- [x] Rewrite Layout.tsx — icon rail (client switcher) + flat sidebar + breadcrumb bar

## Phase 2: Live Agent Status Badges ✅
- [x] GET /api/subaccounts/:id/live-status endpoint (queries agentRuns where status=running)
- [x] Poll live-status in Layout every 15s
- [x] Badge on "AI Team" nav item

## Phase 3: Breadcrumb Bar ✅
- [x] URL-derived breadcrumbs in Layout (no page changes needed)
- [x] Always-visible bar at top of main content, with ⌘K search button

## Phase 4: Projects ✅
- [x] DB schema: server/db/schema/projects.ts
- [x] Migration: migrations/0022_add_projects.sql — **needs applying to DB**
- [x] Routes: server/routes/projects.ts (CRUD + live-status)
- [x] Updated server/db/schema/index.ts + server/index.ts
- [x] Frontend: client/src/pages/ProjectsPage.tsx (grid, create, filter, archive)
- [x] /projects route in App.tsx

## Phase 5: Command Palette (Cmd+K) ✅
- [x] CommandPalette.tsx — search nav, clients, agents
- [x] Keyboard navigation (↑↓ arrows, enter, esc)
- [x] Global Cmd/Ctrl+K shortcut in Layout
- [x] Search button affordance in breadcrumb bar

## Phase 6: Page-level Tailwind migration (deferred)
- [ ] Migrate individual page components from inline styles to Tailwind

## Notes
- Run migration before using Projects: `psql $DATABASE_URL < migrations/0022_add_projects.sql`
- All changes on branch: `claude/explore-paperclip-agents-wQQKo`
