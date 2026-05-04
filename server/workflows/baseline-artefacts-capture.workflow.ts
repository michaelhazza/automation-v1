/**
 * Baseline Artefacts Capture — six-step onboarding workflow (spec §5, §6).
 *
 * Captures six tiered artefacts at sub-account onboarding via sequential
 * user_input steps. Tier 1+2 artefacts (brand_identity → audience_icp) are
 * written to Memory Blocks via knowledgeBindings. Tier 3 artefacts
 * (operating_constraints, proof_library) are written to workspace_memory_entries
 * via markArtefactCaptured in the Chunk 3B completion hook — they do not use
 * knowledgeBindings.
 *
 * Step DAG (linear):
 *   brand_identity
 *     └─► voice_tone
 *           └─► offer_positioning
 *                 └─► audience_icp
 *                       └─► operating_constraints
 *                             └─► proof_library
 */

import { z } from 'zod';
import { defineWorkflow } from '../lib/workflow/defineWorkflow.js';

export default defineWorkflow({
  slug: 'baseline-artefacts-capture',
  name: 'Capture Baseline Artefacts',
  description:
    'Collects the six foundational artefacts needed to personalise agent behaviour for this sub-account: ' +
    'brand identity, voice and tone, offer positioning, audience ICP, operating constraints, and proof library.',
  version: 1,

  autoStartOnOnboarding: true,

  knowledgeBindings: [
    // Tier-3 artefacts write to workspace_memory_entries via markArtefactCaptured,
    // not to memory_blocks via knowledgeBindings. See docs/sub-account-baseline-artefacts-spec.md §5.
    { stepId: 'brand_identity',    outputPath: '$', blockLabel: 'baseline.brand_identity',    mergeStrategy: 'replace', firstRunOnly: false },
    { stepId: 'voice_tone',        outputPath: '$', blockLabel: 'baseline.voice_tone',        mergeStrategy: 'replace', firstRunOnly: false },
    { stepId: 'offer_positioning', outputPath: '$', blockLabel: 'baseline.offer_positioning', mergeStrategy: 'replace', firstRunOnly: false },
    { stepId: 'audience_icp',      outputPath: '$', blockLabel: 'baseline.audience_icp',      mergeStrategy: 'replace', firstRunOnly: false },
  ],

  initialInputSchema: z.object({
    prefillFromSubaccount: z.boolean().default(true),
  }),

  steps: [
    // ── 1. Brand Identity ────────────────────────────────────────────────────
    {
      id: 'brand_identity',
      name: 'Brand Identity',
      type: 'user_input',
      dependsOn: [],
      sideEffectType: 'none',
      formSchema: z.object({
        name:           z.string().max(120),
        oneLiner:       z.string().max(160),
        industry:       z.string(),
        targetCustomer: z.string(),
        geography:      z.string(),
        stage:          z.string(),
      }),
      outputSchema: z.object({
        name:           z.string(),
        oneLiner:       z.string(),
        industry:       z.string(),
        targetCustomer: z.string(),
        geography:      z.string(),
        stage:          z.string(),
      }),
    },

    // ── 2. Voice & Tone ──────────────────────────────────────────────────────
    {
      id: 'voice_tone',
      name: 'Voice & Tone',
      type: 'user_input',
      dependsOn: ['brand_identity'],
      sideEffectType: 'none',
      formSchema: z.object({
        descriptors:       z.array(z.string()).min(3).max(5),
        example_sentences: z.array(z.string()).min(2).max(3),
        prohibited_phrases: z.array(z.string()),
        formality_level:   z.enum(['casual', 'neutral', 'formal']),
      }),
      outputSchema: z.object({
        descriptors:       z.array(z.string()),
        example_sentences: z.array(z.string()),
        prohibited_phrases: z.array(z.string()),
        formality_level:   z.enum(['casual', 'neutral', 'formal']),
      }),
    },

    // ── 3. Offer Positioning ─────────────────────────────────────────────────
    {
      id: 'offer_positioning',
      name: 'Offer Positioning',
      type: 'user_input',
      dependsOn: ['voice_tone'],
      sideEffectType: 'none',
      formSchema: z.object({
        services:       z.array(z.string()),
        value_prop:     z.string(),
        differentiators: z.array(z.string()),
        pricing_tiers:  z.array(z.object({ name: z.string(), description: z.string() })),
      }),
      outputSchema: z.object({
        services:       z.array(z.string()),
        value_prop:     z.string(),
        differentiators: z.array(z.string()),
        pricing_tiers:  z.array(z.object({ name: z.string(), description: z.string() })),
      }),
    },

    // ── 4. Audience / ICP ────────────────────────────────────────────────────
    {
      id: 'audience_icp',
      name: 'Audience / ICP',
      type: 'user_input',
      dependsOn: ['offer_positioning'],
      sideEffectType: 'none',
      formSchema: z.object({
        primary_buyer:    z.string(),
        pain_points:      z.array(z.string()),
        objections:       z.array(z.string()),
        success_criteria: z.array(z.string()),
      }),
      outputSchema: z.object({
        primary_buyer:    z.string(),
        pain_points:      z.array(z.string()),
        objections:       z.array(z.string()),
        success_criteria: z.array(z.string()),
      }),
    },

    // ── 5. Operating Constraints (Tier 3) ────────────────────────────────────
    // Tier-3 artefact: written to workspace_memory_entries via markArtefactCaptured,
    // not to memory_blocks via knowledgeBindings. See docs/sub-account-baseline-artefacts-spec.md §5.
    {
      id: 'operating_constraints',
      name: 'Operating Constraints',
      type: 'user_input',
      dependsOn: ['audience_icp'],
      sideEffectType: 'none',
      formSchema: z.object({
        hours:                      z.string(),
        response_time_commitments:  z.string(),
        escalation_paths:           z.array(z.string()),
        compliance:                 z.array(z.string()),
        languages:                  z.array(z.string()),
      }),
      outputSchema: z.object({
        hours:                      z.string(),
        response_time_commitments:  z.string(),
        escalation_paths:           z.array(z.string()),
        compliance:                 z.array(z.string()),
        languages:                  z.array(z.string()),
      }),
    },

    // ── 6. Proof Library (Tier 3) ────────────────────────────────────────────
    // Tier-3 artefact: written to workspace_memory_entries via markArtefactCaptured,
    // not to memory_blocks via knowledgeBindings. See docs/sub-account-baseline-artefacts-spec.md §5.
    {
      id: 'proof_library',
      name: 'Proof Library',
      type: 'user_input',
      dependsOn: ['operating_constraints'],
      sideEffectType: 'none',
      formSchema: z.object({
        uploads: z.array(
          z.object({
            referenceDocumentId: z.string().uuid(),
            tags:                z.array(z.string()),
          }),
        ),
      }),
      outputSchema: z.object({
        uploads: z.array(
          z.object({
            referenceDocumentId: z.string(),
            tags:                z.array(z.string()),
          }),
        ),
      }),
    },
  ],
});
