/**
 * agentRunPayloadEncryptionService
 *
 * App-level AES-256-GCM encryption/decryption for operator_runs.checkpoint_payload
 * and similar JSONB columns that must be encrypted at rest.
 *
 * Wraps the same key management and envelope format used by
 * connectionTokenService. Same TOKEN_ENCRYPTION_KEY environment variable.
 *
 * Spec: docs/superpowers/specs/2026-05-12-operator-backend-spec.md §3.14 item 10, §4.6
 */

import crypto from 'crypto';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const CURRENT_KEY_VERSION = 'k1';

// ---------------------------------------------------------------------------
// Key registry — populated once at module load from TOKEN_ENCRYPTION_KEY.
// Reuses the same key as connectionTokenService; both are app-level secrets.
// ---------------------------------------------------------------------------

const KEY_REGISTRY: Record<string, Buffer> = {};
if (!env.TOKEN_ENCRYPTION_KEY) {
  logger.warn('agentRunPayloadEncryptionService.token_encryption_key_missing', {
    message: 'TOKEN_ENCRYPTION_KEY is not set — encryption/decryption will fail at runtime',
  });
} else {
  KEY_REGISTRY[CURRENT_KEY_VERSION] = Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'hex');
}
if (env.TOKEN_ENCRYPTION_KEY_V0) {
  KEY_REGISTRY['k0'] = Buffer.from(env.TOKEN_ENCRYPTION_KEY_V0, 'hex');
}

function getKeyForVersion(version: string): Buffer {
  const key = KEY_REGISTRY[version];
  if (!key) {
    throw new Error(`[agentRunPayloadEncryptionService] Unknown encryption key version: ${version}`);
  }
  return key;
}

/**
 * Encrypted JSON envelope. Stored in a JSONB column as a plain object;
 * the `_encrypted` discriminator lets readers skip re-encryption on read-write
 * round-trips.
 */
export interface EncryptedJson {
  _encrypted: true;
  /** k1:iv:authTag:ciphertext — all hex-encoded, colon-delimited */
  v: string;
}

/**
 * Encrypt any JSON-serialisable value for at-rest storage in a JSONB column.
 * Returns an EncryptedJson envelope.
 *
 * Encryption failures propagate as Error (not typed). An encryption failure is
 * not a recoverable runtime state and crashes the calling chain link.
 */
export function encryptAgentRunPayloadJson(value: unknown): EncryptedJson {
  const key = getKeyForVersion(CURRENT_KEY_VERSION);
  const plaintext = JSON.stringify(value);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    _encrypted: true,
    v: `${CURRENT_KEY_VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`,
  };
}

/**
 * Decrypt an EncryptedJson envelope and return the parsed JSON value.
 *
 * Handles both the versioned format (k1:iv:authTag:ciphertext) and the
 * legacy unversioned format (iv:authTag:ciphertext) for backward compatibility.
 */
export function decryptAgentRunPayloadJson(value: EncryptedJson): unknown {
  if (!value._encrypted || typeof value.v !== 'string') {
    throw new Error('[agentRunPayloadEncryptionService] Invalid EncryptedJson shape');
  }

  const parts = value.v.split(':');
  let version: string;
  let ivHex: string;
  let authTagHex: string;
  let encryptedHex: string;

  if (parts.length === 4 && parts[0].startsWith('k')) {
    [version, ivHex, authTagHex, encryptedHex] = parts;
  } else if (parts.length === 3) {
    version = CURRENT_KEY_VERSION;
    [ivHex, authTagHex, encryptedHex] = parts;
  } else {
    throw new Error('[agentRunPayloadEncryptionService] Invalid encrypted payload format');
  }

  const key = getKeyForVersion(version);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encryptedBuf = Buffer.from(encryptedHex, 'hex');

  if (iv.length !== IV_LENGTH) {
    throw new Error('[agentRunPayloadEncryptionService] Invalid encrypted payload: wrong IV length');
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('[agentRunPayloadEncryptionService] Invalid encrypted payload: wrong auth tag length');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = decipher.update(encryptedBuf) + decipher.final('utf8');
  return JSON.parse(decrypted);
}
