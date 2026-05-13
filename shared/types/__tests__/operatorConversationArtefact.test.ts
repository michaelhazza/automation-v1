import { describe, it, expect } from 'vitest';
import {
  OPERATOR_CONVERSATION_LINK_MIME,
  OperatorConversationLinkArtefactSchema,
} from '../operatorConversationArtefact.js';

const CANONICAL_ARTEFACT = {
  mime: OPERATOR_CONVERSATION_LINK_MIME,
  chain_link_id: 'c5d1e0aa-0000-0000-0000-000000000001',
  chain_seq: 3,
  attempt_number: 1,
  conversation_ref: 'conv-ref-opaque-key',
  captured_at: '2026-05-12T16:01:41.000Z',
};

describe('OPERATOR_CONVERSATION_LINK_MIME', () => {
  it('has the expected MIME type string', () => {
    expect(OPERATOR_CONVERSATION_LINK_MIME).toBe(
      'application/vnd.synthetos.operator-conversation-link+json;version=1',
    );
  });
});

describe('OperatorConversationLinkArtefactSchema', () => {
  it('validates a canonical artefact', () => {
    const result = OperatorConversationLinkArtefactSchema.safeParse(CANONICAL_ARTEFACT);
    expect(result.success).toBe(true);
  });

  it('rejects a wrong MIME type', () => {
    const wrong = { ...CANONICAL_ARTEFACT, mime: 'application/json' };
    const result = OperatorConversationLinkArtefactSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  it('rejects a non-UUID chain_link_id', () => {
    const wrong = { ...CANONICAL_ARTEFACT, chain_link_id: 'not-a-uuid' };
    const result = OperatorConversationLinkArtefactSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  it('rejects chain_seq of 0 (must be positive)', () => {
    const wrong = { ...CANONICAL_ARTEFACT, chain_seq: 0 };
    const result = OperatorConversationLinkArtefactSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });

  it('rejects attempt_number of 0 (must be positive)', () => {
    const wrong = { ...CANONICAL_ARTEFACT, attempt_number: 0 };
    const result = OperatorConversationLinkArtefactSchema.safeParse(wrong);
    expect(result.success).toBe(false);
  });
});
