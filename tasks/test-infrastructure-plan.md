# Test Infrastructure Plan

## Architecture Notes

### Framework choices

**Vitest over Jest** for all unit and integration tests:
- Native ESM support — this project uses `"type": "module"` and ESM throughout. Jest requires extensive transform configuration for ESM; Vitest handles it natively.
- Vite-native — the frontend already uses Vite, so Vitest shares the same transform pipeline and config. No duplicate bundler config.
- Same assertion API as Jest (`expect`, `describe`, `it`) — zero learning curve.
- Faster startup and HMR-based watch mode.

**Playwright** for E2E (already installed as `@playwright/test@1.59.1`). Just needs config and test files.

**Additional dependencies needed:**
- `vitest` — test runner
- `@vitest/coverage-v8` — coverage reporting
- `supertest` + `@types/supertest` — HTTP assertions for route integration tests
- `@testing-library/react` + `@testing-library/jest-dom` + `@testing-library/user-event` — React component testing
- `jsdom` — browser environment for component tests
- `msw` (Mock Service Worker) — API mocking for frontend tests

**Explicitly NOT needed:**
- `ts-jest` / `babel-jest` — Vitest handles TypeScript natively
- Testcontainers / in-memory PG — overkill for this stage. Use a real test database with transaction rollback.
- `faker` / `fishery` — premature. Simple factory functions are sufficient to start.

### Test database strategy

**Real PostgreSQL with transaction rollback**, not in-memory SQLite or testcontainers.

Rationale: Drizzle queries use PostgreSQL-specific features (JSON operators, `isNull`, `sql` template literals). SQLite would require a parallel schema and miss real bugs. A dedicated test database (`automation_os_test`) with the same migrations is the simplest correct approach.

For **unit tests** of services: mock the `db` object at the module level using `vi.mock`. Services import `db` from `../db/index.js` — Vitest can intercept this cleanly.

For **integration tests** of routes: use a real test database, wrap each test in a transaction that rolls back. This gives real SQL execution without test pollution.

### Mocking strategy (backend)

| Layer | What to mock | What NOT to mock |
|-------|-------------|-----------------|
| Service unit tests | `db` (Drizzle), external services (LLM, email, S3) | Pure business logic, validation, error shaping |
| Route integration tests | Auth middleware (inject `req.user` / `req.orgId`), external APIs | Database queries, service logic, Express routing |
| Lib unit tests | Nothing — these are pure functions | Everything |

Key principle: **mock at boundaries, not at internals**. The `db` object is a boundary. Service-to-service calls within the same process are NOT mocked in integration tests — that defeats the purpose.

### Directory structure

```
tests/
  setup/
    globalSetup.ts         -- create test DB, run migrations (runs once before all suites)
    globalTeardown.ts      -- drop test DB (runs once after all suites)
    testDb.ts              -- test DB connection, transaction helper
    factories.ts           -- entity factory functions (createOrg, createUser, etc.)
    authHelpers.ts         -- JWT generation, authenticated supertest agent
    mockDb.ts              -- vi.mock helper for service unit tests
  server/
    unit/
      services/            -- service unit tests (mocked DB)
        orgAgentConfigService.test.ts
        canonicalDataService.test.ts
        orgMemoryService.test.ts
        intelligenceSkillExecutor.test.ts
        ...
      lib/
        rateLimiter.test.ts
        asyncHandler.test.ts
        resolveSubaccount.test.ts
    integration/
      routes/              -- route integration tests (real DB + supertest)
        orgAgentConfigs.test.ts
        agentRuns.test.ts
        connectorConfigs.test.ts
        subaccountTags.test.ts
        orgMemory.test.ts
        reviewItems.test.ts
      webhooks/
        ghlWebhook.test.ts
  client/
    unit/
      components/          -- React component tests
        Layout.test.tsx
        TaskCard.test.tsx
        Modal.test.tsx
      pages/               -- Page-level smoke tests
        AgentsPage.test.tsx
      lib/
        api.test.ts
  e2e/
    auth.spec.ts
    agents.spec.ts
    tasks.spec.ts
    fixtures/
      seed.ts              -- E2E data seeding
```

Naming convention: `*.test.ts` for Vitest, `*.spec.ts` for Playwright. This separation is intentional — different runners, different configs, no ambiguity.

---

## Configuration Files

### vitest.config.ts (root — server tests)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    root: '.',
    include: ['tests/server/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    globals: true,
    environment: 'node',
    setupFiles: [],
    globalSetup: ['tests/setup/globalSetup.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    pool: 'forks',            // isolate tests in separate processes for DB safety
    poolOptions: {
      forks: { singleFork: false },
    },
    coverage: {
      provider: 'v8',
      include: ['server/services/**', 'server/lib/**', 'server/routes/**'],
      exclude: ['server/db/schema/**', 'server/skills/**'],
    },
  },
});
```

### vitest.config.client.ts (client tests)

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
  test: {
    name: 'client',
    root: '.',
    include: ['tests/client/**/*.test.{ts,tsx}'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['tests/client/setup.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['client/src/**'],
      exclude: ['client/src/main.tsx'],
    },
  },
});
```

### playwright.config.ts

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,        // sequential for now — DB state dependencies
  retries: 1,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5000',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
```

### tsconfig for tests

The root `tsconfig.json` only includes `client/src`. The server has `server/tsconfig.json`. Tests need their own config that covers both.

```jsonc
// tests/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["vitest/globals"],
    "paths": {
      "@/*": ["../client/src/*"]
    }
  },
  "include": ["./**/*.ts", "./**/*.tsx"],
  "references": [
    { "path": "../server/tsconfig.json" }
  ]
}
```

### package.json script additions

```json
{
  "scripts": {
    "test:server": "vitest run --config vitest.config.ts",
    "test:server:watch": "vitest --config vitest.config.ts",
    "test:client": "vitest run --config vitest.config.client.ts",
    "test:client:watch": "vitest --config vitest.config.client.ts",
    "test:e2e": "playwright test",
    "test:unit": "npm run test:server && npm run test:client",
    "test:coverage": "vitest run --config vitest.config.ts --coverage && vitest run --config vitest.config.client.ts --coverage"
  }
}
```

Keep existing `test`, `test:gates`, and `test:qa` scripts unchanged — they serve a different purpose (static analysis gates).

---

## Test Setup Files

### tests/setup/globalSetup.ts

Runs once before all server test suites. Creates the test database and runs migrations.

```typescript
// Contract:
// - Reads DATABASE_URL from .env.test (or falls back to DATABASE_URL with _test suffix on dbname)
// - Connects to the 'postgres' maintenance DB to CREATE DATABASE if needed
// - Runs all Drizzle migrations against the test DB
// - Exports nothing — side-effect only

// Environment: TEST_DATABASE_URL must be set in .env.test
// Format: postgresql://user:pass@host:port/automation_os_test
```

### tests/setup/globalTeardown.ts

Drops the test database after all suites complete (optional — can be toggled via env var `KEEP_TEST_DB=1` for debugging).

### tests/setup/testDb.ts

```typescript
// Contract:
export function getTestDb(): DB;
// Returns a Drizzle instance connected to the test database.

export async function withTransaction<T>(fn: (tx: DB) => Promise<T>): Promise<T>;
// Wraps fn in a transaction that ALWAYS rolls back.
// Used by integration tests to isolate DB state.

export async function cleanupTestDb(): Promise<void>;
// Truncates all tables. Used between integration test files if transaction
// rollback is insufficient (e.g., tests that commit intentionally).
```

### tests/setup/factories.ts

```typescript
// Minimal factory functions — no library, just functions that return insert-ready objects.
// Each factory accepts partial overrides.

export function buildOrg(overrides?: Partial<...>): { id, name, slug, plan, status }
export function buildUser(overrides?: Partial<...>): { id, organisationId, email, passwordHash, role, ... }
export function buildSubaccount(overrides?: Partial<...>): { id, organisationId, name, ... }
export function buildAgent(overrides?: Partial<...>): { id, organisationId, name, slug, ... }
export function buildOrgAgentConfig(overrides?: Partial<...>): { id, organisationId, agentId, ... }
export function buildCanonicalAccount(overrides?: Partial<...>): { ... }
export function buildConnectorConfig(overrides?: Partial<...>): { ... }
export function buildSubaccountTag(overrides?: Partial<...>): { ... }

// Insert helpers that use the test DB directly:
export async function insertOrg(db: DB, overrides?): Promise<Org>
export async function insertUser(db: DB, overrides?): Promise<User>
export async function insertSubaccount(db: DB, overrides?): Promise<Subaccount>
// ... etc
```

### tests/setup/authHelpers.ts

```typescript
import jwt from 'jsonwebtoken';

// Generate a valid JWT for test requests
export function createTestToken(payload: {
  id: string;
  organisationId: string;
  role?: string;
  email?: string;
}): string;

// Create a supertest agent with auth headers pre-set
export function authenticatedAgent(app: Express, token: string): SuperTest;

// Convenience: create org + user + token in one call
export async function createAuthenticatedOrg(db: DB): Promise<{
  org: Org;
  user: User;
  token: string;
  agent: SuperTest;  // supertest agent with auth
}>;
```

### tests/setup/mockDb.ts

Helper for service unit tests that need to mock the database layer.

```typescript
// Usage in a service unit test:
//
//   vi.mock('../../server/db/index.js', () => mockDbModule());
//
//   // Then in each test:
//   mockQuery(orgAgentConfigs, 'select', [{ id: '...', ... }]);

export function mockDbModule(): { db: MockDb };
export function mockQuery(table: any, operation: string, returnValue: any): void;
export function resetMocks(): void;
```

### tests/client/setup.ts

```typescript
import '@testing-library/jest-dom/vitest';
// Extends vitest matchers with toBeInTheDocument(), toHaveTextContent(), etc.

// MSW server setup for API mocking
import { setupServer } from 'msw/node';
export const mswServer = setupServer();

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
```

---

## Backend Unit Test Patterns

### Pure lib tests (no mocks needed)

```typescript
// tests/server/unit/lib/rateLimiter.test.ts
import { RateLimiter } from '../../../../server/lib/rateLimiter';

describe('RateLimiter', () => {
  it('allows acquisition when bucket has tokens', async () => {
    const limiter = new RateLimiter({ maxTokens: 5, refillRate: 5, refillIntervalMs: 1000 });
    await limiter.acquire('key-1'); // should not throw
    expect(limiter.remaining('key-1')).toBe(4);
  });

  it('creates separate buckets per key', async () => {
    const limiter = new RateLimiter({ maxTokens: 2, refillRate: 2, refillIntervalMs: 1000 });
    await limiter.acquire('a');
    expect(limiter.remaining('a')).toBe(1);
    expect(limiter.remaining('b')).toBe(2); // fresh bucket
  });

  it('refills tokens after interval', async () => {
    const limiter = new RateLimiter({ maxTokens: 1, refillRate: 1, refillIntervalMs: 50 });
    await limiter.acquire('k');
    expect(limiter.canAcquire('k')).toBe(false);
    await new Promise(r => setTimeout(r, 60));
    expect(limiter.canAcquire('k')).toBe(true);
  });

  it('fires threshold callback when tokens drop below 20%', async () => {
    const onThreshold = vi.fn();
    const limiter = new RateLimiter({ maxTokens: 5, refillRate: 5, refillIntervalMs: 10000, onThreshold });
    // Drain to 0 (below 20% = 1)
    for (let i = 0; i < 5; i++) await limiter.acquire('k');
    expect(onThreshold).toHaveBeenCalled();
  });
});
```

### Service unit tests (mocked DB)

```typescript
// tests/server/unit/services/orgAgentConfigService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module BEFORE importing the service
vi.mock('../../../../server/db/index.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

import { orgAgentConfigService } from '../../../../server/services/orgAgentConfigService';
import { db } from '../../../../server/db/index';

describe('orgAgentConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('get', () => {
    it('returns config when found', async () => {
      const mockConfig = { id: 'cfg-1', organisationId: 'org-1', agentId: 'agent-1' };
      // Chain: db.select().from().where() returns array
      const mockWhere = vi.fn().mockResolvedValue([mockConfig]);
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      (db.select as any).mockReturnValue({ from: mockFrom });

      const result = await orgAgentConfigService.get('cfg-1', 'org-1');
      expect(result).toEqual(mockConfig);
    });

    it('throws 404 when config not found', async () => {
      const mockWhere = vi.fn().mockResolvedValue([]);
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      (db.select as any).mockReturnValue({ from: mockFrom });

      await expect(orgAgentConfigService.get('missing', 'org-1'))
        .rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
```

### Intelligence skill executor tests (mocked dependencies)

```typescript
// tests/server/unit/services/intelligenceSkillExecutor.test.ts

// Mock all downstream services
vi.mock('../../../../server/services/canonicalDataService.js', () => ({
  canonicalDataService: {
    getAccountsByOrg: vi.fn(),
    getLatestHealthSnapshot: vi.fn(),
    getContactMetrics: vi.fn(),
    getOpportunityMetrics: vi.fn(),
  },
}));
vi.mock('../../../../server/services/subaccountTagService.js', () => ({
  subaccountTagService: { getSubaccountsByTags: vi.fn() },
}));

import { executeQuerySubaccountCohort } from '../../../../server/services/intelligenceSkillExecutor';

describe('executeQuerySubaccountCohort', () => {
  it('rejects when called from subaccount context', async () => {
    const result = await executeQuerySubaccountCohort({}, {
      subaccountId: 'sa-1',  // non-null = subaccount context
      organisationId: 'org-1',
    } as any);
    expect(result).toMatchObject({ error: expect.stringContaining('only available to org-level') });
  });

  it('returns empty when no subaccounts match filters', async () => {
    const { subaccountTagService } = await import('../../../../server/services/subaccountTagService');
    (subaccountTagService.getSubaccountsByTags as any).mockResolvedValue([]);

    const result = await executeQuerySubaccountCohort(
      { tag_filters: [{ key: 'tier', value: 'enterprise' }] },
      { subaccountId: null, organisationId: 'org-1' } as any,
    );
    expect(result).toMatchObject({ accounts: [], summary: expect.any(String) });
  });
});
```

---

## Backend Integration Test Patterns

### Express app isolation

The real `server/index.ts` initializes WebSocket, pg-boss, seeds data on startup — all side-effects unsuitable for testing. Create a minimal app factory.

```typescript
// tests/setup/createTestApp.ts
//
// Builds an Express app with:
//   - JSON body parsing
//   - Correlation middleware
//   - All route routers mounted
//   - NO WebSocket, NO pg-boss, NO seed calls
//
// Contract:
export function createTestApp(): Express;
```

This function imports only the route routers and middleware, not the full `server/index.ts`. It mounts them identically to `server/index.ts` but without side-effects.

### Route integration test pattern

```typescript
// tests/server/integration/routes/orgAgentConfigs.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../../../setup/createTestApp';
import { getTestDb, cleanupTestDb } from '../../../setup/testDb';
import { insertOrg, insertUser, insertAgent } from '../../../setup/factories';
import { createTestToken } from '../../../setup/authHelpers';

describe('GET /api/org/agent-configs', () => {
  const app = createTestApp();
  let token: string;
  let orgId: string;

  beforeAll(async () => {
    const db = getTestDb();
    const org = await insertOrg(db);
    const user = await insertUser(db, { organisationId: org.id, role: 'org_admin' });
    // Also insert permission set with AGENTS_VIEW for this user
    orgId = org.id;
    token = createTestToken({ id: user.id, organisationId: org.id, role: 'org_admin', email: user.email });
  });

  afterAll(async () => {
    await cleanupTestDb();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/org/agent-configs');
    expect(res.status).toBe(401);
  });

  it('returns empty array when no configs exist', async () => {
    const res = await request(app)
      .get('/api/org/agent-configs')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns configs scoped to the org', async () => {
    const db = getTestDb();
    const agent = await insertAgent(db, { organisationId: orgId });
    // insert an orgAgentConfig...
    const res = await request(app)
      .get('/api/org/agent-configs')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].agent.id).toBe(agent.id);
  });
});
```

### GHL webhook integration test (special — no auth, HMAC verification)

```typescript
// tests/server/integration/webhooks/ghlWebhook.test.ts
//
// Tests:
// - Returns 400 for invalid JSON
// - Returns 400 for missing locationId
// - Returns 200 (accepted) when no connector config matches
// - Returns 401 when HMAC signature is missing but secret is configured
// - Returns 401 when HMAC signature is invalid
// - Returns 200 and processes event when signature is valid
//
// Requires: test DB seeded with a connectorConfig + canonicalAccount linked to a locationId
// Note: ghlWebhook uses raw() body parser — the test app must mount it BEFORE json parsing,
// matching server/index.ts order.
```

---

## Frontend Unit Test Patterns

### Component test example

```typescript
// tests/client/unit/components/Modal.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '@/components/Modal';

describe('Modal', () => {
  it('renders title and children', () => {
    render(<Modal isOpen={true} onClose={() => {}} title="Test Modal"><p>Content</p></Modal>);
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(<Modal isOpen={true} onClose={onClose} title="X" />);
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not render when isOpen is false', () => {
    render(<Modal isOpen={false} onClose={() => {}} title="Hidden" />);
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });
});
```

### Page test with MSW

```typescript
// tests/client/unit/pages/AgentsPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../../setup';

// Must use lazy-loaded component's resolved module
import AgentsPage from '@/pages/AgentsPage';

describe('AgentsPage', () => {
  it('renders agent list from API', async () => {
    mswServer.use(
      http.get('/api/agents', () => {
        return HttpResponse.json([
          { id: 'a1', name: 'Agent Alpha', status: 'active' },
        ]);
      }),
      http.get('/api/my-permissions', () => {
        return HttpResponse.json({ permissions: ['agents.view'] });
      }),
    );

    render(
      <MemoryRouter>
        <AgentsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    });
  });
});
```

---

## E2E Strategy

### Scope for first E2E tests

Cover the critical user paths only — not every page:

1. **Auth flow** — login, redirect to dashboard, logout
2. **Agent config CRUD** — create org agent config, verify it appears in list, update, disable
3. **Task board** — create task, move between columns, verify real-time update

### Data seeding

```typescript
// tests/e2e/fixtures/seed.ts
// Uses the existing scripts/seed-local.ts pattern but targeted for E2E.
// Connects directly to the DB, inserts a known org + user + subaccount.
// Returns credentials for Playwright to use in login.

export async function seedE2E(): Promise<{
  adminEmail: string;
  adminPassword: string;
  orgId: string;
  subaccountId: string;
}>;

export async function cleanupE2E(): Promise<void>;
```

Playwright `globalSetup` calls `seedE2E()` before test suites; `globalTeardown` calls `cleanupE2E()`.

---

## Environment file

Create `.env.test` with test-specific overrides:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/automation_os_test
JWT_SECRET=test-secret-key-that-is-at-least-32-chars-long
NODE_ENV=test
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=test-key
PORT=3001
```

Add to `.gitignore` if not already there: `.env.test` (or commit it if it contains no real secrets — test-only values).

---

## Implementation Order

### Chunk 1: Install dependencies and create config files

**Scope:** npm install, create vitest configs, playwright config, .env.test, tsconfig for tests, update package.json scripts.

**Files to create:**
- `vitest.config.ts`
- `vitest.config.client.ts`
- `playwright.config.ts`
- `tests/tsconfig.json`
- `.env.test`

**Files to modify:**
- `package.json` — add devDependencies and scripts

**Dependencies:** None. This is the foundation.

**Verification:** `npx vitest --version` succeeds. `npx playwright test --list` runs (even with 0 tests).

**devDependencies to add:**
```
vitest
@vitest/coverage-v8
supertest
@types/supertest
@testing-library/react
@testing-library/jest-dom
@testing-library/user-event
jsdom
msw
```

### Chunk 2: Test setup infrastructure

**Scope:** All files in `tests/setup/`. The test database lifecycle, factories, auth helpers, mock helpers, client setup.

**Files to create:**
- `tests/setup/globalSetup.ts`
- `tests/setup/globalTeardown.ts`
- `tests/setup/testDb.ts`
- `tests/setup/factories.ts`
- `tests/setup/authHelpers.ts`
- `tests/setup/mockDb.ts`
- `tests/setup/createTestApp.ts`
- `tests/client/setup.ts`

**Dependencies:** Chunk 1.

**Verification:** Run `npx vitest run --config vitest.config.ts` with a single trivial test (`tests/server/unit/lib/smoke.test.ts` that does `expect(1+1).toBe(2)`) to confirm the full setup lifecycle works: DB created, migrations run, test passes, teardown completes.

**Key decisions for createTestApp.ts:**
- Import route routers individually (same list as `server/index.ts` lines 28-82)
- Apply `express.json()`, `cors()`, `correlationMiddleware`
- Mount GHL webhook router BEFORE json parsing (matching production order)
- Do NOT import or call: `initWebSocket`, `agentScheduleService`, `queueService`, `seedPermissions`, or any other startup side-effect

### Chunk 3: Backend lib unit tests

**Scope:** Pure unit tests for `server/lib/` — no DB, no mocks needed.

**Files to create:**
- `tests/server/unit/lib/rateLimiter.test.ts`
- `tests/server/unit/lib/asyncHandler.test.ts`

**Test scenarios — rateLimiter:**
- Token consumption decrements correctly
- Separate buckets per key
- Refill after interval elapsed
- `canAcquire` returns false when empty
- Threshold callback fires at < 20%
- `acquire` waits and retries when empty (use fake timers)

**Test scenarios — asyncHandler:**
- Calls the handler function
- Returns JSON error when handler throws `{ statusCode, message }`
- Returns 500 for unknown errors
- Populates `errorCode` from thrown error or defaults

**Dependencies:** Chunk 2.

### Chunk 4: Backend service unit tests (Phase 1-3 services)

**Scope:** Unit tests for the key services from the org-level agents feature. All use mocked DB.

**Files to create:**
- `tests/server/unit/services/orgAgentConfigService.test.ts`
- `tests/server/unit/services/orgMemoryService.test.ts`
- `tests/server/unit/services/canonicalDataService.test.ts`
- `tests/server/unit/services/intelligenceSkillExecutor.test.ts`
- `tests/server/unit/services/integrationConnectionService.test.ts`

**Key test scenarios per service:**

orgAgentConfigService:
- `listByOrg` returns joined agent data
- `get` throws 404 when not found
- `create` inserts with correct org scoping
- `update` respects org scoping (cannot update another org's config)

orgMemoryService:
- `getOrCreateMemory` creates on first call, returns existing on second
- `scoreMemoryEntry` returns 0 for short content
- `listEntries` filters by entryType and scope tags
- `addEntry` validates entry type

intelligenceSkillExecutor:
- `executeQuerySubaccountCohort` rejects subaccount-scoped context
- `executeQuerySubaccountCohort` returns empty when no matches
- `executeQuerySubaccountCohort` aggregates health data correctly
- Health score calculation uses correct weights

integrationConnectionService:
- `getDecryptedConnection` with null subaccountId uses org-level lookup
- `getDecryptedConnection` with subaccountId filters by it
- Throws when no active connection exists

**Dependencies:** Chunk 2.

### Chunk 5: Backend route integration tests

**Scope:** Integration tests using supertest against the test app with real DB.

**Files to create:**
- `tests/server/integration/routes/orgAgentConfigs.test.ts`
- `tests/server/integration/routes/subaccountTags.test.ts`
- `tests/server/integration/routes/orgMemory.test.ts`
- `tests/server/integration/webhooks/ghlWebhook.test.ts`

**Key test scenarios:**

orgAgentConfigs routes:
- GET returns 401 without auth
- GET returns 200 with empty list
- POST creates config, GET returns it
- PUT updates config
- Permission checks (non-admin user without AGENTS_VIEW gets 403)

subaccountTags routes:
- CRUD operations with org scoping
- JSON parse validation on tag values
- Filter by tag key/value

ghlWebhook:
- 400 for invalid JSON
- 400 for missing locationId
- 401 for missing/invalid HMAC signature
- 200 for valid webhook event

orgMemory routes:
- GET returns or creates memory
- POST adds entry
- Entry type validation

**Dependencies:** Chunk 2, Chunk 3 (for confidence in helpers).

### Chunk 6: Frontend test setup and first component tests

**Scope:** Client-side testing infrastructure and initial component tests.

**Files to create:**
- `tests/client/unit/components/Modal.test.tsx`
- `tests/client/unit/components/ConfirmDialog.test.tsx`
- `tests/client/unit/components/ErrorBoundary.test.tsx`
- `tests/client/unit/lib/api.test.ts`

**Test scenarios:**
- Modal: render/hide, onClose callback, title display
- ConfirmDialog: confirm/cancel callbacks, button text
- ErrorBoundary: catches render errors, shows fallback
- api.ts: auth header attachment, 401 handling (mock localStorage and axios)

**Dependencies:** Chunk 1, Chunk 2 (client setup.ts).

### Chunk 7: E2E foundation

**Scope:** Playwright config, seed fixture, auth flow test.

**Files to create:**
- `tests/e2e/fixtures/seed.ts`
- `tests/e2e/auth.spec.ts`

**Test scenarios:**
- Login with valid credentials redirects to dashboard
- Login with invalid credentials shows error
- Logout clears session

**Dependencies:** Chunks 1-2. Requires a running dev server (Playwright `webServer` config handles this).

---

## Error Handling Conventions in Tests

- Service unit tests assert the **shape** of thrown errors: `toMatchObject({ statusCode: 404, message: expect.any(String) })`
- Route integration tests assert HTTP status codes and response body structure: `{ error: { code, message }, correlationId }`
- Never assert exact error messages unless the message is part of the contract (e.g., displayed to users)

## What This Plan Does NOT Cover

- **Performance/load testing** — not needed at this stage
- **Snapshot testing** — low value for this UI; prefer explicit assertions
- **Visual regression** — can add Playwright visual comparisons later
- **CI pipeline** — the plan sets up local test running. CI integration is a separate task.
- **Full coverage of all 73 services** — start with the 9 key services from the recent feature. Expand coverage incrementally as new features are built.
