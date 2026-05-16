import { createHash } from 'crypto';

export const PARSER_VERSION = '1.0.0' as const;

export function computeManifestHash(manifest: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
