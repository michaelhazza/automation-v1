import { z } from 'zod';
import type { BaselineSlug } from '../constants/baselineArtefacts.js';

export const ARTEFACT_FORM_SCHEMAS = {
  'baseline.brand_identity': z.object({
    name: z.string().min(1).max(120),
    oneLiner: z.string().max(160),
    industry: z.string().min(1),
    targetCustomer: z.string().min(1),
    geography: z.string().min(1),
    stage: z.string().min(1),
  }),
  'baseline.voice_tone': z.object({
    descriptors: z.array(z.string()).min(3).max(5),
    example_sentences: z.array(z.string()).min(2).max(3),
    prohibited_phrases: z.array(z.string()),
    formality_level: z.enum(['casual', 'neutral', 'formal']),
  }),
  'baseline.offer_positioning': z.object({
    services: z.array(z.string()),
    value_prop: z.string(),
    differentiators: z.array(z.string()),
    pricing_tiers: z.array(z.object({ name: z.string(), description: z.string() })),
  }),
  'baseline.audience_icp': z.object({
    primary_buyer: z.string(),
    pain_points: z.array(z.string()),
    objections: z.array(z.string()),
    success_criteria: z.array(z.string()),
  }),
  'baseline.operating_constraints': z.object({
    hours: z.string(),
    response_time_commitments: z.string(),
    escalation_paths: z.array(z.string()),
    compliance: z.array(z.string()),
    languages: z.array(z.string()),
  }),
  'baseline.proof_library': z.object({
    uploads: z.array(z.object({
      referenceDocumentId: z.string().uuid(),
      tags: z.array(z.string()),
    })),
  }),
} satisfies Record<BaselineSlug, z.ZodObject<z.ZodRawShape>>;

export type ArtefactFormSchemas = typeof ARTEFACT_FORM_SCHEMAS;
