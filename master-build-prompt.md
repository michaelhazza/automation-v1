# Master Build Prompt - Unified Specification Pipeline

## Version Reference
- **This Document**: master-build-prompt-unified.md v48
- **Linked Documents**: 
  - spec-generator-unified.md
  - quality-checker-gpt.md

## VERSION HISTORY

| Version | Date | Changes |
|---------|------|---------|
| 48 | 2026-02 | **Cross-framework consistency audit (3 fixes)**: (1) **Non-ASCII em dashes replaced**: Two Unicode em dashes (U+2014) at Phase 1 step 7 and package.json Note replaced with ASCII double hyphens. Violates ASCII-only working standard. (2) **Success Criteria absolute guarantee softened**: "100% first-build success with zero manual intervention" replaced with language matching spec-generator v4.28 softening: "First-build success with minimal manual intervention through constitutional enforcement." Constitutional enforcement is the mechanism, not a guarantee. (3) **Final Test absolute guarantee softened**: Same pattern -- "100% functionality with zero manual intervention" replaced with "designed so that Claude Code can generate a working application on first build with minimal manual fixes." Aligns MBP operational text with spec-generator's established posture on success claims. |
| 47 | 2026-02 | **Cross-framework consistency audit (3 fixes)**: (1) **`authRequired` phantom field replaced with `authentication` field**: 6 references throughout the document used legacy `authRequired` boolean flag which does not exist in spec-generator output. The actual field is `authentication: "required" | "optional" | "public"` at endpoint level. Claude Code following MBP literally would look for a field that doesn't exist, silently skipping auth middleware on protected endpoints. All references updated to match spec-generator schema. (2) **Orchestration runner scripts explicitly specified (Step 2.5.3)**: `run-all-gates.sh` and `run-all-qa-tests.sh` were expected to exist after splitter extraction but never generated -- splitters only extract individual gate/QA scripts. New Step 2.5.3 provides explicit generation requirements for both runners including discovery pattern, exit code aggregation, `build-gate-results.json` output format, and failure semantics. (3) **`drizzle.config.ts` generation explicitly specified (Step 2.2)**: `npm run db:generate` and `npm run migrate` require `drizzle.config.ts` but it was never instructed. Added explicit generation instruction with schema path, output directory, dialect, and database URL derivation from spec artifacts. |
| 46 | 2026-02 | **Cross-framework consistency audit (6 fixes)**: (1) **Artifact count corrected 9->10 in 4 locations**: Phase 1 description, critical output format, Phase 2 critical note, and Success Criteria checklist all updated to match spec-generator OUTPUT MANIFEST (10 files). (2) **Phase 1 output format rules rewritten**: Removed ### FILE: delimiter approach which contradicted actual spec-generator tool-based output model (create_file/present_files to /mnt/user-data/outputs/docs/). Rules now describe actual mechanism. (3) **Step 2.5.1 gate extraction rewritten**: Replaced generate-your-own-extractor pattern with bash docs/gate-splitter.sh invocation, matching how QA scripts are extracted via docs/qa-splitter.sh. docs/gate-splitter.sh is a spec-generator artifact; creating a parallel extractor was redundant and introduced coupling. Step 2.5.3 validation block updated in parallel. (4) **Internal spec-generator rule counts removed from Phase 1**: "24-point coverage checklist" and "20 extraction discipline rules" were stale (count changed to 21 in Round 13) and create maintenance coupling across documents. Phase 1 now describes what the spec-generator does without enumerating internal rule counts. (5) **Major version pins removed from body Note**: "React 18, Vite 5, TypeScript 5" Note removed from package.json section; the example package.json already illustrates versions with Example Only labelling. (6) **Validation Date removed from PROMPT HYGIENE GATE**: Specific date in operational body text was already stale.
| 45 | 2026-02 | **MAJOR ARCHITECTURE CHANGE**: Complete rewrite for unified specification generator pipeline. (1) Single-stage specification generation: Replaced 11-agent pipeline with unified Constitutional Specification Generator that produces all 9 artifacts in one pass. (2) Streamlined build flow: Brief -> Specifications -> Implementation in 2 phases instead of 11 sequential agents. (3) Enhanced constitutional enforcement: Built-in schema validation, cross-file invariant checking, and placeholder detection in specification phase. (4) Improved first-build success: Prevention-first design with comprehensive validation before code generation begins. (5) Optional quality checker: Preserved Agent 8 functionality as optional post-build review (disabled by default). (6) Maintained feature parity: All capabilities of previous 11-agent system preserved in consolidated approach. Critical transformation enabling faster development cycles while maintaining 100% build success rates through enhanced upstream specification quality. |

---

## PURPOSE

Transform executive IDEA briefs into production-ready SaaS applications using a constitutional specification generator followed by deterministic implementation.

**Target Environment**: Replit (React 18 + Vite, Express.js/TypeScript, PostgreSQL)  
**Success Criteria**: First-build success with minimal manual intervention through constitutional enforcement  
**Language Standard**: Australian English throughout

---

## CONSTITUTIONAL FOUNDATION

This build process operates under **constitutional governance** enforced by the specification generator (spec-generator-unified.md). The specification phase performs zero-tolerance validation for:
- Schema violations or cross-file inconsistencies
- Placeholder tokens in any generated content  
- Missing required artifacts or malformed specifications
- Deviation from proven architectural patterns

**Enforcement**: Constitutional validation occurs at specification phase before any code generation begins. See spec-generator-unified.md for complete constitutional enforcement rules.

---

## BUILD CONFIGURATION

### Core Parameters
- `IDEA_BRIEF`: Executive brief describing the SaaS application requirements
- `APPLICATION_NAME`: Derived from brief or specified explicitly
- `QUALITY_CHECKER_ENABLED`: Boolean flag for post-build review (default: false)

### Quality Checker Configuration (Optional)
When `QUALITY_CHECKER_ENABLED: true`:
- Executes comprehensive post-build code review
- Validates implementation against specifications
- Performs security, performance, and maintainability analysis
- Applies fixes and optimisations automatically
- Re-validates after changes

---

## PIPELINE

**Phase 1**: Constitutional specification generation (produces 10 files under docs/)

**Phase 2**: Full application implementation from those specs

**Optional**: Post-build Quality Checker review (disabled by default)

---

## PHASE 1: SPECIFICATION GENERATION

**CRITICAL OUTPUT RULES (NON-NEGOTIABLE):**
- The spec-generator produces files via create_file and present_files tool calls to /mnt/user-data/outputs/docs/
- Do not produce specification content as inline text output or code blocks
- Do not produce explanatory text before or after artifact generation
- No placeholder tokens in any generated file
- All 10 artifacts must be present in /mnt/user-data/outputs/docs/ before proceeding to Phase 2

Use the Universal SaaS Application Specification Generator (Freeze-Ready) to process the IDEA brief. The generator will:

1. **Extract business logic** from the IDEA brief
2. **Model data relationships** with full cascade and FK coverage
3. **Generate API contracts** with proper endpoint patterns and type coercion
4. **Specify UI requirements** with page classification and API dependencies
5. **Create quality gates** with deterministic script generation
6. **Generate QA framework** with schema-governed verification
7. **Validate constitutionally** before emission -- all validations must pass before any artifact is emitted

**Critical**: Do not proceed to Phase 2 until all 10 artifacts are generated and validated.

---

## PHASE 2: APPLICATION IMPLEMENTATION

**Implementation Rule (Non-Negotiable)**: Any example snippets in this prompt are illustrative only. Never copy example entity names, routes, fields, or table structures. All implementation must be derived from the Phase 1 specs under docs/.

Do not generate authentication, RBAC, or user management unless they exist in service-contracts.json and ui-api-deps.json.

Do not add extra entities, routes, or pages beyond what is declared in the specs.

### Step 2.1: Project Structure and Configuration

Create complete project structure and configuration files:

#### package.json (Dependencies Derived from Specs)

**Example only. Do not copy. Implement exactly per docs/ specs.**

```json
{
  "name": "APPLICATION_NAME",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm run dev:server\" \"npm run dev:client\"",
    "dev:server": "tsx watch server/index.ts",
    "dev:client": "vite",
    "build": "npm run build:server && npm run build:client",
    "build:server": "tsc -p server/tsconfig.json",
    "build:client": "vite build",
    "start": "node dist/server/index.js",
    "migrate": "drizzle-kit migrate",
    "db:generate": "drizzle-kit generate",
    "db:studio": "drizzle-kit studio",
    "test": "npm run test:gates && npm run test:qa",
    "test:gates": "bash scripts/run-all-gates.sh",
    "test:qa": "bash scripts/run-all-qa-tests.sh"
  },
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.0",
    "helmet": "^7.0.0",
    "drizzle-orm": "^0.29.0",
    "postgres": "^3.4.0",
    "zod": "^3.22.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/express": "^4.17.0",
    "@types/cors": "^2.8.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "vite": "^5.0.0",
    "tsx": "^4.6.0",
    "typescript": "^5.3.0",
    "drizzle-kit": "^0.20.0",
    "concurrently": "^8.2.0"
  }
}
```

**Note**: Use latest stable versions at build time. The example package.json above is illustrative only -- do not copy version numbers.

**Only include `@neondatabase/serverless` and `drizzle-orm/neon-serverless` usage if Neon is required by specs or architecture-notes.**

- If Neon is required by specs/architecture-notes, add `@neondatabase/serverless` and use `drizzle-orm/neon-serverless`.
- If service contracts include endpoints with `"authentication": "required"`, add `jsonwebtoken` and `bcryptjs` (and types).

#### TypeScript Configurations
Generate `tsconfig.json`, `server/tsconfig.json`, and `client/tsconfig.json` with appropriate paths and module resolution.

#### Vite Configuration  
Generate `vite.config.ts` with proxy settings, build optimisation, and path aliases based on architecture notes.

#### Environment Configuration
Generate `.env.example` based on env-manifest.json with all required, conditionally required, and optional variables properly documented.

### Step 2.2: Database Implementation

#### Database Schema Generation
For each table in data-relationships.json:

```typescript
// Example: server/db/schema/users.ts
import { pgTable, uuid, text, timestamp, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('member'),
  organisationId: uuid('organisation_id').references(() => organisations.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

#### Migration Generation
Generate Drizzle migrations for all tables with proper foreign key constraints, indexes, and soft-delete support.

#### Drizzle Configuration
Generate `drizzle.config.ts` at project root. Derive configuration from specification artifacts:
- Schema path: `./server/db/schema` (where schema files are generated from data-relationships.json)
- Output directory: `./migrations` (for generated SQL migration files)
- Dialect: `postgresql` (from target environment)
- Database URL: from `DATABASE_URL` environment variable (declared in env-manifest.json)

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './server/db/schema/*',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

**Note**: Use latest stable drizzle-kit config format at build time. The example above is illustrative only.

#### Database Connection
Default postgresjs connection; add Neon branch only if required by specs:

**Only implement `DB_DRIVER` if it exists in `docs/env-manifest.json`. If it does not exist, default to postgresjs driver and do not reference `env.DB_DRIVER` anywhere.**

**Only include Neon driver dependencies and imports if DB_DRIVER exists in env-manifest OR the architecture-notes explicitly specifies Neon.**

```typescript
// server/db/index.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../lib/env';
import * as schema from './schema';

// Default to postgresjs driver
export const db = drizzle(postgres(env.DATABASE_URL), { schema });
```

**If Neon is required by specs/architecture-notes, implement the Neon branch and add the required imports and deps.**

### Step 2.3: Backend Implementation

#### Environment Validation
Generate `server/lib/env.ts` with Zod validation for all environment variables from env-manifest.json:

**Only include `DB_DRIVER` in `envSchema` if it exists in `docs/env-manifest.json`. Otherwise omit it entirely.**

```typescript
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().startsWith('postgresql://'),
  // JWT_SECRET: include only if service contracts have endpoints with "authentication": "required"
  APP_URL: z.string().url(),
  PORT: z.coerce.number().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // DB_DRIVER: include only if declared in docs/env-manifest.json
  // Additional variables based on env-manifest.json
});

export const env = envSchema.parse(process.env);
```

#### Middleware Implementation
Generate authentication, validation, and RBAC middleware based on service contracts:

**Only generate this file if service-contracts.json contains endpoints with `"authentication": "required"` (and corresponding UI flows exist if applicable).**

```typescript
// server/middleware/auth.ts
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  // JWT authentication logic based on service contracts
};

export const requireRole = (requiredRole: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // RBAC logic based on user roles from scope manifest
  };
};
```

#### Service Layer Implementation
For each entity in scope-manifest.json, generate corresponding service:

**Example only. Do not copy. Implement exactly per docs/ specs.**

```typescript
// server/services/users.service.ts
import { db } from '../db';
import { users } from '../db/schema/users';
import { isNull } from 'drizzle-orm';

export class UsersService {
  async listUsers() {
    // Basic listing - implement tenant filtering only if defined in specs
    return db.select().from(users)
      .where(isNull(users.deletedAt));
  }

  async createUser(data: NewUser) {
    // Business logic based on entity contracts
  }
  
  // Additional CRUD methods based on service contracts
}
```

#### Route Implementation
For each endpoint in service-contracts.json, generate Express route:

**Only include auth middleware imports and usage when the endpoint's `"authentication"` field is `"required"`.**

**If authentication is `"public"` or `"optional"`, do not import `authenticate` or `requireRole`, and do not reference `req.user` in handlers.**

**Example only. Do not copy. Implement exactly per docs/ specs.**

```typescript
// server/routes/users.routes.ts
import { Router } from 'express';
import { UsersService } from '../services/users.service';

const router = Router();
const usersService = new UsersService();

router.get('/api/users', async (req, res) => {
  // Implementation based on service contract
  const users = await usersService.listUsers();
  res.json(users);
});

// If endpoint.authentication is "required", add authenticate middleware and derive principal context per contract

// Additional routes based on service contracts
export default router;
```

#### Server Entry Point
Generate `server/index.ts` with Express app setup, middleware registration, and graceful shutdown:

```typescript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './lib/env';
import usersRoutes from './routes/users.routes';
// Additional route imports based on service contracts

const app = express();

// Middleware stack
app.use(helmet());
app.use(cors({ origin: env.APP_URL }));
app.use(express.json());

// Routes
app.use(usersRoutes);
// Additional route registrations

// Health endpoint (always included)
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Error handling
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
const port = env.PORT ?? 5000;
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('SIGTERM', () => server.close());
```

### Step 2.4: Frontend Implementation

#### API Client
Generate `client/src/lib/api.ts` with type-safe API client based on service contracts:

**Example only. Do not copy. Implement exactly per docs/ specs.**

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

// Only add token injection if auth exists in specs.
// If auth exists: api.interceptors.request.use((config) => { ... })

// Type-safe API methods based on service contracts
export const usersApi = {
  list: () => api.get<User[]>('/users'),
  getById: (id: string) => api.get<User>(`/users/${id}`),
  create: (data: CreateUserRequest) => api.post<User>('/users', data),
  update: (id: string, data: UpdateUserRequest) => api.patch<User>(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
};
```

#### Page Components
For each page in ui-api-deps.json, generate React component:

```tsx
// client/src/pages/UsersPage.tsx
import React, { useState, useEffect } from 'react';
import { usersApi } from '../lib/api';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const response = await usersApi.list();
      setUsers(response.data);
    } catch (error) {
      console.error('Failed to load users:', error);
    } finally {
      setLoading(false);
    }
  };

  // Component implementation based on UI specification
  return (
    <div>
      <h1>Users</h1>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <div>
          {/* User list implementation */}
        </div>
      )}
    </div>
  );
}
```

#### Routing Setup
Generate `client/src/App.tsx` with React Router configuration based on ui-api-deps.json:

```tsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import UsersPage from './pages/UsersPage';
// Additional page imports

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/users" element={<UsersPage />} />
        {/* Additional routes based on UI specification */}
      </Routes>
    </Router>
  );
}
```

### Step 2.5: Quality Gates and QA Scripts

**Goal**: Materialise runnable scripts under scripts/ from the two reference documents generated in Phase 1, plus generate orchestration runners.

**Important**: docs/gate-splitter.sh extracts gate scripts from docs/gate-scripts-reference.md. docs/qa-splitter.sh extracts QA scripts from docs/qa-scripts-reference.md. These are separate splitters for their respective reference documents. Do not cross-use them.

#### 2.5.1 Extract Gate Scripts

Run the standalone gate splitter that was generated by the specification phase:

```bash
bash docs/gate-splitter.sh
```

The gate splitter (docs/gate-splitter.sh) is generated by the spec-generator as artifact #7. It:

- Parses `#===== FILE: scripts/<n>.sh =====#` blocks from docs/gate-scripts-reference.md
- Writes each block to `scripts/<n>.sh`
- Enforces the deterministic script count declared in `Total Scripts: N`
- Sets executable permissions on all extracted scripts
- Fails fast if extraction count does not match declared total
- Creates scripts/ output directory if missing
- Overwrites existing scripts (generated artifacts are source of truth)
- Uses atomic write (temp file then move) to prevent half-written scripts on failure

#### 2.5.2 Extract QA Scripts (using qa-splitter)

Run the standalone QA splitter:

```bash
bash docs/qa-splitter.sh
```

The QA splitter must:
- Extraction output directory must be scripts/ and must be created if missing
- If a target script already exists, overwrite it (generated artifacts are source of truth)
- Extractor must write to a temp file and then move into place (atomic write). If extraction fails, do not leave half-written scripts

#### 2.5.3 Generate Orchestration Runners

Claude Code MUST generate these two runner scripts. The splitters extract individual scripts; the runners execute them all and aggregate results.

**scripts/run-all-gates.sh** - Gate orchestration runner:
- Discover all `scripts/verify-*.sh` files
- Run each script in sequence
- Capture exit code from each gate
- Track pass/fail/warning/info counts
- Write `build-gate-results.json` with summary (total, passed, failed, warnings) and per-gate results (name, status, exitCode, output)
- Exit 0 only if zero BLOCKING failures; exit 1 if any gate exits 1

**scripts/run-all-qa-tests.sh** - QA test orchestration runner:
- Discover all `scripts/qa-*.sh` files
- Run each test in sequence
- Capture exit code and output from each test
- Report pass/fail summary
- Exit 0 only if all tests pass; exit 1 if any test fails

Both runners MUST:
- Use `#!/usr/bin/env bash` and `set -euo pipefail`
- Be executable (`chmod +x`)
- Handle missing scripts gracefully (error if scripts/ directory empty)
- Print summary line showing total/passed/failed counts

#### 2.5.4 Validation

```bash
bash docs/gate-splitter.sh
bash docs/qa-splitter.sh
bash scripts/run-all-gates.sh
bash scripts/run-all-qa-tests.sh
```

#### Documentation
Generate comprehensive README.md with:
- Application overview from scope-manifest.json
- Setup instructions based on env-manifest.json
- Development workflow
- Deployment guide
- API documentation from service contracts

---

## OPTIONAL: POST-BUILD QUALITY REVIEW (QUALITY_CHECKER_ENABLED)

**Note**: This section describes the conceptual workflow when quality checking is enabled. The Quality Checker is a separate GPT prompt (quality-checker-gpt.md) that would be invoked after Phase 2 implementation completes. This is instructional - it explains what quality checking provides, not literal code that Claude Code will generate.

Execute Quality Checker review only if `QUALITY_CHECKER_ENABLED: true`:

```typescript
// Conceptual quality review configuration structure
interface QualityReviewConfig {
  enabled: boolean;
  categories: {
    security: boolean;
    performance: boolean;
    maintainability: boolean;
    testing: boolean;
    documentation: boolean;
  };
  autoFix: boolean;
  revalidate: boolean;
}

const defaultConfig: QualityReviewConfig = {
  enabled: false, // Default disabled
  categories: {
    security: true,
    performance: true,
    maintainability: true,
    testing: true,
    documentation: true,
  },
  autoFix: true,
  revalidate: true,
};
```

When enabled, the Quality Checker GPT performs comprehensive post-build review covering:
- Security vulnerability analysis and hardening
- Performance optimisation opportunities
- Code maintainability and technical debt assessment
- Test coverage and quality evaluation
- Documentation completeness verification
- Accessibility compliance checking (for UI-heavy applications)

The Quality Checker validates implementation against all specification artifacts in docs/ and can automatically apply fixes while respecting specification contracts.

---

## VALIDATION AND DEPLOYMENT

### Build Validation
```bash
# Install dependencies
npm install

# Generate database migrations
npm run db:generate

# Run type checking
npx tsc --noEmit

# Run quality gates
npm run test:gates

# Run QA tests  
npm run test:qa

# Build application
npm run build
```

### Deployment Readiness
Verify all required files are generated:
- [ ] All specification artifacts in docs/
- [ ] Complete source code in server/ and client/
- [ ] Configuration files (.env.example, package.json, tsconfig.json, vite.config.ts, drizzle.config.ts)
- [ ] Database migrations and schema
- [ ] Quality gates and QA scripts
- [ ] Documentation (README.md)

---

## SUCCESS CRITERIA

**Build succeeds when:**
- [ ] All 10 specification artifacts generated with valid schemas
- [ ] Complete, type-safe application code generated
- [ ] All quality gates pass
- [ ] Application builds without errors
- [ ] Health endpoint responds successfully
- [ ] Database connections work in both local and production modes
- [ ] Authentication and RBAC implemented correctly
- [ ] UI pages load and connect to API endpoints

**Final Test**: Deploy to Replit and verify functionality. This specification set is designed so that Claude Code can generate a working application on first build with minimal manual fixes.

---

## PROMPT HYGIENE GATE

- [OK] Version Reference block present with unified pipeline approach
- [OK] Constitutional enforcement framework integrated
- [OK] Quality Checker optional and disabled by default
- [OK] Australian English throughout
- [OK] No non-ASCII characters
- [OK] Prevention-first specification design

**Status:** Production Ready - Unified Pipeline
