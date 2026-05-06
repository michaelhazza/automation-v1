/**
 * Boot-time validation for TOKEN_ENCRYPTION_KEY.
 * Extracted to a separate module so it can be tested without triggering
 * the env schema parse (which requires DATABASE_URL and other env vars).
 */

const TOKEN_ENCRYPTION_KEY_LENGTH = 32;

export function validateEncryptionKeyOrThrow(): void {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: TOKEN_ENCRYPTION_KEY is required in production. Refusing to start.');
    }
    console.warn('[connectionTokenService] TOKEN_ENCRYPTION_KEY not set — connection tokens cannot be encrypted/decrypted');
    return;
  }
  let decoded: Buffer;
  try {
    decoded = key.length === 64 ? Buffer.from(key, 'hex') : Buffer.from(key, 'base64');
  } catch {
    throw new Error('FATAL: TOKEN_ENCRYPTION_KEY must be hex or base64 encoded.');
  }
  if (decoded.length !== TOKEN_ENCRYPTION_KEY_LENGTH) {
    throw new Error(`FATAL: TOKEN_ENCRYPTION_KEY must decode to ${TOKEN_ENCRYPTION_KEY_LENGTH} bytes (got ${decoded.length}).`);
  }
}
