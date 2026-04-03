/**
 * Auth helpers for tests — JWT generation and authenticated supertest agents.
 */
import jwt from 'jsonwebtoken';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.test') });

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-that-is-at-least-32-chars-long';

export interface TestTokenPayload {
  id: string;
  organisationId: string;
  role?: string;
  email?: string;
}

/**
 * Generate a valid JWT for test requests.
 */
export function createTestToken(payload: TestTokenPayload): string {
  return jwt.sign(
    {
      id: payload.id,
      organisationId: payload.organisationId,
      role: payload.role ?? 'org_admin',
      email: payload.email ?? 'test@test.com',
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

/**
 * Returns an Authorization header value for use with supertest.
 */
export function authHeader(token: string): string {
  return `Bearer ${token}`;
}
