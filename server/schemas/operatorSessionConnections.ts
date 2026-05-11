/**
 * Zod validation schemas for operator session connection routes.
 *
 * operator-session-identity chunk 5.
 */

import { z } from 'zod';

export const connectBodySchema = z.object({
  provider: z.string().min(1).max(64),
  label: z.string().min(1).max(64),
  disclosureAcceptance: z
    .object({
      disclosureVersion: z.number().int().min(1),
      consentText: z.string().min(1).max(10000),
      acceptanceTier: z.enum(['pro', 'team', 'enterprise', 'plus', 'unknown']),
    })
    .optional(),
});

export const reacceptBodySchema = z.object({
  disclosureAcceptance: z.object({
    disclosureVersion: z.number().int().min(1),
    consentText: z.string().min(1).max(10000),
    acceptanceTier: z.string().min(1).max(64),
  }),
});

export const updateLabelBodySchema = z.object({
  label: z.string().min(1).max(64),
});

export const editAvailabilityBodySchema = z
  .object({
    availabilityScope: z.enum(['all_agents', 'specific_agents']),
    allowedAgentIds: z.array(z.string().uuid()).nullable().optional(),
  })
  .refine(
    (data) =>
      data.availabilityScope === 'all_agents' ||
      (Array.isArray(data.allowedAgentIds) && data.allowedAgentIds.length > 0),
    {
      message:
        'allowedAgentIds must be a non-empty array when availabilityScope is specific_agents',
      path: ['allowedAgentIds'],
    },
  );

export const makeDefaultBodySchema = z.object({});

export const reauthBodySchema = z.object({});
