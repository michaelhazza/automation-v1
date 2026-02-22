# Automation OS

## Overview
Automation OS is a multi-tenant workflow automation platform. It provides task management, execution tracking, permission groups, file handling, and user authentication for organizations.

## Project Architecture
- **Frontend**: React 18 + Vite, located in `client/`
- **Backend**: Express.js + TypeScript, located in `server/`
- **Database**: PostgreSQL with Drizzle ORM
- **Build System**: TypeScript compiled via `tsc` (server) and Vite (client)

## Key Technologies
- React Router v6 for client routing
- Drizzle ORM for database access
- JWT-based authentication (bcryptjs for password hashing)
- Zod for validation
- pg-boss for background job queues
- Multer for file uploads
- SendGrid / SMTP for email

## Project Structure
```
client/           - React frontend
  src/
    components/   - Reusable UI components
    pages/        - Page-level components
    lib/          - Utilities (api, auth helpers)
server/           - Express backend
  db/schema/      - Drizzle ORM schema definitions
  routes/         - Express route handlers
  services/       - Business logic services
  middleware/     - Auth and validation middleware
  lib/            - Environment config
docs/             - Architecture and reference docs
scripts/          - Verification and QA scripts
```

## Development Setup
- Frontend runs on port 5000 (Vite dev server, proxies /api to backend)
- Backend runs on port 3000 (Express)
- Single workflow `npm run dev` runs both via concurrently

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string (auto-provided)
- `JWT_SECRET` - Secret for JWT token signing (min 32 chars)
- `EMAIL_FROM` - Sender email address
- `PORT` - Backend port (default 3000)
- `NODE_ENV` - development/production

## Database
- Uses Replit's built-in PostgreSQL
- Schema managed via Drizzle ORM (`server/db/schema/`)
- Run `npx drizzle-kit push` to sync schema to database
- Run `npx drizzle-kit generate` to generate migrations

## Deployment
- Build: `npm run build` (compiles server TS + builds Vite client)
- Production: `NODE_ENV=production node dist/server/index.js`
- In production, Express serves static client files from `dist/client/`
