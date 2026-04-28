export interface CursorPosition {
  ts: string;
  msgId: string;
}

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify(position)).toString('base64url');
}

export function decodeCursor(encoded: string): CursorPosition | null {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).ts === 'string' &&
      typeof (parsed as Record<string, unknown>).msgId === 'string'
    ) {
      return parsed as CursorPosition;
    }
    return null;
  } catch {
    return null;
  }
}

export function isValidCursor(encoded: unknown): boolean {
  if (typeof encoded !== 'string') return false;
  return decodeCursor(encoded) !== null;
}
