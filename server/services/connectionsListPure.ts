export type ContractAuthMethod = 'oauth' | 'api_key' | 'web_login' | 'mcp' | 'cookie' | 'ai_subscription';
export type ContractStatus = 'connected' | 'expired' | 'failed' | 'pending';

export class UnknownEnumValueError extends Error {
  constructor(public readonly enumName: string, public readonly value: string) {
    super(`Unknown ${enumName} value: ${value}`);
    this.name = 'UnknownEnumValueError';
  }
}

export function dbAuthTypeToContract(dbAuthType: string): ContractAuthMethod {
  switch (dbAuthType) {
    case 'oauth2':         return 'oauth';
    case 'api_key':        return 'api_key';
    case 'service_account':
    case 'web_login':      return 'web_login';
    case 'github_app':     return 'oauth';
    default:
      throw new UnknownEnumValueError('integration_connections.auth_type', dbAuthType);
  }
}

export function mcpAuthMethod(): ContractAuthMethod {
  return 'mcp';
}

export function dbConnectionStatusToContract(status: string, oauthStatus?: string | null): ContractStatus {
  if (oauthStatus) {
    switch (oauthStatus) {
      case 'active':       return 'connected';
      case 'expired':      return 'expired';
      case 'error':        return 'failed';
      case 'disconnected': return 'failed';
      default:
        throw new UnknownEnumValueError('integration_connections.oauth_status', oauthStatus);
    }
  }
  switch (status) {
    case 'active':  return 'connected';
    case 'revoked': return 'failed';
    case 'error':   return 'failed';
    default:
      throw new UnknownEnumValueError('integration_connections.connection_status', status);
  }
}

export interface CursorPayload { primary: string; id: string; }

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(input: string): CursorPayload | null {
  try {
    const json = Buffer.from(input, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === 'object' && parsed !== null &&
      'primary' in parsed && 'id' in parsed &&
      typeof (parsed as CursorPayload).primary === 'string' &&
      typeof (parsed as CursorPayload).id === 'string'
    ) return parsed as CursorPayload;
    return null;
  } catch { return null; }
}
