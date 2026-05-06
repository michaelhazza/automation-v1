/**
 * F1 -> F2 contract. Voice/tone artefact, parsed from memory_blocks.content
 * where name = 'baseline.voice_tone' AND status = 'active'.
 * Returned by memoryBlockService.getBaselineVoiceTone(orgId, subaccountId).
 * Returns null when the artefact's wizard status is not 'completed'.
 * See docs/sub-account-baseline-artefacts-spec.md §6b.
 */
export interface BaselineVoiceTone {
  descriptors: string[];
  example_sentences: string[];
  prohibited_phrases: string[];
  formality_level: 'casual' | 'neutral' | 'formal';
  captured_at: Date;
}
