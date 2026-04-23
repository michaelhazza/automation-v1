import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Reference Document Service — Pure Functions
// Deterministic, side-effect-free helpers for document hashing + serialization.
// These are the primary test surface (testing_posture: pure_function_only).
//
// serializeDocument produces the byte-identical output that contextAssemblyEngine
// assembles into the cached prefix — Phase 3 imports this function rather than
// re-implementing it to keep one canonical implementation.
// ---------------------------------------------------------------------------

export const DOC_DELIMITER_START = '---DOC_START---';
export const DOC_DELIMITER_END = '---DOC_END---';

/** SHA-256 hash of the raw content bytes. Used for idempotent-write detection. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** SHA-256 hash of the serialized (with delimiters/metadata) document bytes.
 *  This is the hash that feeds prefix_hash_components.documentSerializedBytesHashes.
 *  We hash the serialized form (not raw content) because that is what the provider sees —
 *  byte-identical serialization is the identity that matters for cache hits.
 */
export function hashSerialized(serialized: string): string {
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/** Produces the canonical serialized form of a document for assembly into the cached prefix.
 *
 *  Format:
 *    ---DOC_START---
 *    id: <documentId>
 *    version: <version>
 *    ---
 *    <content>
 *    ---DOC_END---
 *
 *  The delimiter string '---DOC_END---' is reserved. Content containing this
 *  exact string must be rejected at create/update time (CACHED_CONTEXT_DOC_CONTAINS_DELIMITER).
 */
export function serializeDocument(args: {
  documentId: string;
  version: number;
  content: string;
}): string {
  return `${DOC_DELIMITER_START}\nid: ${args.documentId}\nversion: ${args.version}\n---\n${args.content}\n${DOC_DELIMITER_END}\n`;
}
