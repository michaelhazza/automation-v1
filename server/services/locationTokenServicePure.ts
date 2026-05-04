// Pure helpers for GHL location token management.

export interface LocationTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  userType: string;
  companyId: string;
  locationId: string;
}

/** True if token expires within 5 minutes. Same window as agency tokens. */
export function isLocationTokenExpiringSoon(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() < 5 * 60 * 1000;
}

/** Compute expires_at for a freshly minted or refreshed location token. */
export function computeLocationTokenExpiresAt(claimedAt: Date, expiresInSeconds: number): Date {
  return new Date(claimedAt.getTime() + expiresInSeconds * 1000);
}

/**
 * Validate that the mint/refresh response matches the expected (companyId, locationId) pair.
 * Throws LOCATION_TOKEN_MISMATCH if either assertion fails — do not persist the token.
 */
export function validateLocationTokenResponse(
  response: LocationTokenResponse,
  expectedCompanyId: string,
  expectedLocationId: string,
): void {
  if (response.companyId !== expectedCompanyId || response.locationId !== expectedLocationId) {
    throw Object.assign(
      new Error(
        `LOCATION_TOKEN_MISMATCH: expected companyId=${expectedCompanyId} locationId=${expectedLocationId}, got companyId=${response.companyId} locationId=${response.locationId}`,
      ),
      {
        code: 'LOCATION_TOKEN_MISMATCH',
        requestedLocationId: expectedLocationId,
        returnedLocationId: response.locationId,
        requestedCompanyId: expectedCompanyId,
        returnedCompanyId: response.companyId,
      },
    );
  }
}

/** Build the body for the GHL /oauth/locationToken POST. */
export function buildLocationTokenBody(params: {
  companyId: string;
  locationId: string;
}): Record<string, string> {
  return { companyId: params.companyId, locationId: params.locationId };
}

/** Build the body for a location token refresh POST. */
export function buildLocationRefreshBody(params: {
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
