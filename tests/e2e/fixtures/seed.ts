/**
 * E2E test data seeding — creates a known org + user for Playwright tests.
 *
 * Uses direct DB access (same as scripts/seed-local.ts pattern).
 * Call seedE2E() in Playwright globalSetup, cleanupE2E() in globalTeardown.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from 'dotenv';
import { resolve } from 'path';
import bcrypt from 'bcryptjs';
import * as schema from '../../../server/db/schema/index.js';

config({ path: resolve(process.cwd(), '.env.test') });

const E2E_ADMIN_EMAIL = 'e2e-admin@test.com';
const E2E_ADMIN_PASSWORD = 'TestPassword123!';

export async function seedE2E() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client, { schema });

  const passwordHash = await bcrypt.hash(E2E_ADMIN_PASSWORD, 10);

  // Create org
  const [org] = await db.insert(schema.organisations).values({
    name: 'E2E Test Organisation',
    slug: 'e2e-test-org',
    plan: 'pro',
    status: 'active',
  }).returning();

  // Create admin user
  const [user] = await db.insert(schema.users).values({
    organisationId: org.id,
    email: E2E_ADMIN_EMAIL,
    passwordHash,
    firstName: 'E2E',
    lastName: 'Admin',
    role: 'org_admin',
    status: 'active',
  }).returning();

  // Create subaccount
  const [subaccount] = await db.insert(schema.subaccounts).values({
    organisationId: org.id,
    name: 'E2E Test Subaccount',
    slug: 'e2e-test-sa',
    status: 'active',
  }).returning();

  await client.end();

  return {
    adminEmail: E2E_ADMIN_EMAIL,
    adminPassword: E2E_ADMIN_PASSWORD,
    orgId: org.id,
    userId: user.id,
    subaccountId: subaccount.id,
  };
}

export async function cleanupE2E() {
  const client = postgres(process.env.DATABASE_URL!, { max: 1 });
  const db = drizzle(client, { schema });

  // Clean up E2E data by slug
  await db.delete(schema.subaccounts).where(
    schema.subaccounts.slug.eq?.('e2e-test-sa') as any
  ).catch(() => {});
  await db.delete(schema.users).where(
    schema.users.email.eq?.('e2e-admin@test.com') as any
  ).catch(() => {});
  await db.delete(schema.organisations).where(
    schema.organisations.slug.eq?.('e2e-test-org') as any
  ).catch(() => {});

  await client.end();
}
