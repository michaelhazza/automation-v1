import { z } from 'zod';

const providerTypes = ['gmail', 'github', 'hubspot', 'slack', 'ghl', 'stripe', 'teamwork', 'custom'] as const;
const authTypes = ['oauth2', 'api_key', 'service_account', 'github_app'] as const;
const connectionStatuses = ['active', 'revoked', 'error'] as const;

export const createConnectionBody = z.object({
  providerType: z.enum(providerTypes),
  authType: z.enum(authTypes),
  label: z.string().max(100).optional(),
  displayName: z.string().max(200).optional(),
  configJson: z.record(z.unknown()).optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  tokenExpiresAt: z.string().datetime().optional(),
  secretsRef: z.string().optional(),
});

export const updateConnectionBody = z.object({
  label: z.string().max(100).optional(),
  displayName: z.string().max(200).optional(),
  connectionStatus: z.enum(connectionStatuses).optional(),
  configJson: z.record(z.unknown()).optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  tokenExpiresAt: z.string().datetime().optional(),
  secretsRef: z.string().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' });
