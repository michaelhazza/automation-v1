import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './server/db/schema/*',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:Tyeahzilly!32@localhost:5432/automation_os_test',
  },
});
