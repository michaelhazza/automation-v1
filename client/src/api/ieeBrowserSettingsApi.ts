import api from '../lib/api';
import type { ApiResult } from './operatorBackendApi';

// ── IEE Browser Settings ──────────────────────────────────────────────────────

export interface IeeBrowserSettings {
  subaccountId: string;
  organisationId: string;
  status: 'on' | 'off';
  rolloutApproved: boolean;
  browserProfileRetentionDays: number;
  perTaskCostCeilingCents: number;
  perSubaccountDailyCostCeilingCents: number;
  settingsVersion: number;
  updatedAt: string | null;
  updatedByUserId: string | null;
}

export interface IeeBrowserSettingsPatch {
  status?: 'on' | 'off';
  browserProfileRetentionDays?: number;
  perTaskCostCeilingCents?: number;
  perSubaccountDailyCostCeilingCents?: number;
  expectedSettingsVersion: number;
}

function extractError(err: unknown): { code: string; status: number; body?: unknown } {
  const e = err as { response?: { status?: number; data?: unknown } };
  const status = e.response?.status ?? 0;
  const body = e.response?.data;
  const code =
    typeof body === 'object' && body !== null && 'errorCode' in body
      ? String((body as { errorCode: unknown }).errorCode)
      : 'REQUEST_FAILED';
  return { code, status, body };
}

/**
 * GET /api/subaccounts/:subaccountId/iee-browser-settings
 *
 * Returns the IEE browser settings for a subaccount, or synthesised defaults
 * with settingsVersion: 0 when no row exists.
 */
export async function getIeeBrowserSettings(
  subaccountId: string,
): Promise<ApiResult<IeeBrowserSettings>> {
  try {
    const r = await api.get<IeeBrowserSettings>(
      `/api/subaccounts/${encodeURIComponent(subaccountId)}/iee-browser-settings`,
    );
    return { ok: true, data: r.data };
  } catch (err) {
    return { ok: false, error: extractError(err) };
  }
}

/**
 * PATCH /api/subaccounts/:subaccountId/iee-browser-settings
 *
 * Applies a partial update to the IEE browser settings.
 * expectedSettingsVersion is the ETag check (use 0 for first-write lazy-create).
 */
export async function updateIeeBrowserSettings(
  subaccountId: string,
  patch: IeeBrowserSettingsPatch,
): Promise<ApiResult<IeeBrowserSettings>> {
  try {
    const r = await api.patch<IeeBrowserSettings>(
      `/api/subaccounts/${encodeURIComponent(subaccountId)}/iee-browser-settings`,
      patch,
    );
    return { ok: true, data: r.data };
  } catch (err) {
    return { ok: false, error: extractError(err) };
  }
}
