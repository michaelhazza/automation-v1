// Pure helpers for GHL agency OAuth flow.
// No DB access, no HTTP — testable without infrastructure.

export interface AgencyTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  userType: string;
  companyId: string;
  userId?: string;
  locationId?: string | null;
}

export interface GhlLocation {
  id: string;
  name: string;
  businessId?: string | null;
  companyId: string;
  address?: string | null;
  timezone?: string | null;
}

/** Compute expires_at from when the token was claimed. */
export function computeAgencyTokenExpiresAt(claimedAt: Date, expiresInSeconds: number): Date {
  return new Date(claimedAt.getTime() + expiresInSeconds * 1000);
}

/** True if token expires within 5 minutes (refresh window). */
export function isAgencyTokenExpiringSoon(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() < 5 * 60 * 1000;
}

/** Validate that the GHL token exchange returned a Company-type agency token. */
export function validateAgencyTokenResponse(payload: AgencyTokenResponse): void {
  if (payload.userType !== 'Company') {
    throw Object.assign(
      new Error(`GHL token validation failed: expected userType 'Company', got '${payload.userType}'`),
      { code: 'AGENCY_TOKEN_WRONG_USER_TYPE' },
    );
  }
  if (!payload.companyId) {
    throw Object.assign(
      new Error('GHL token validation failed: companyId is missing or empty'),
      { code: 'AGENCY_TOKEN_MISSING_COMPANY_ID' },
    );
  }
  if (!payload.access_token || !payload.refresh_token) {
    throw Object.assign(
      new Error('GHL token validation failed: access_token or refresh_token missing'),
      { code: 'AGENCY_TOKEN_MISSING_TOKENS' },
    );
  }
}

/** Parse scope string from GHL into an array. */
export function parseGhlScope(scopeStr: string): string[] {
  return scopeStr.split(/\s+/).filter(Boolean);
}

/** Build the GHL token-exchange POST body for initial code exchange. */
export function buildTokenExchangeBody(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    user_type: 'Company',
  });
}

/** Build the GHL refresh token POST body. */
export function buildRefreshTokenBody(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
}

export const GHL_PAGINATION_LIMIT = 100;
export const GHL_LOCATION_CAP = 1000;

/** Compute the pagination skip offsets for a known total (used for testing the loop logic). */
export function computePaginationPages(total: number): Array<{ skip: number; limit: number }> {
  if (total === 0) return [];
  const pages: Array<{ skip: number; limit: number }> = [];
  for (let skip = 0; skip < total; skip += GHL_PAGINATION_LIMIT) {
    pages.push({ skip, limit: GHL_PAGINATION_LIMIT });
  }
  return pages;
}

/** True if the enumeration cap was reached (caller should fire notify_operator). */
export function checkTruncation(totalReturned: number): boolean {
  return totalReturned >= GHL_LOCATION_CAP;
}

/** Deterministic upsert key for (connectorConfig, GHL location) pair. */
export function buildSubaccountUpsertKey(connectorConfigId: string, locationId: string): string {
  return `${connectorConfigId}:${locationId}`;
}

/** Generate a URL-safe slug for a subaccount from a GHL location name. */
export function generateSubaccountSlug(name: string, locationId: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return base || locationId.slice(-12);
}
