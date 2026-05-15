import type { BaselineArtefactsStatus } from '../../../../shared/schemas/subaccount';

export interface OnboardingStatus {
  // Session 1 (spec §7.4): sole gate for "should the wizard auto-open?".
  // Orthogonal to the three derivation fields below.
  needsOnboarding: boolean;
  ghlConnected: boolean;
  agentsProvisioned: boolean;
  firstRunComplete: boolean;
}

export interface GhlLocation {
  id: string;
  name: string;
  city?: string;
  contactCount?: number;
}

export interface SyncAccountStatus {
  accountId: string;
  displayName: string;
  status: 'pending' | 'syncing' | 'complete' | 'error';
  error?: string;
  preview?: {
    contactCount: number;
    opportunityCount: number;
    revenueTotal?: number;
  };
}

export interface SyncStatus {
  phase: 'idle' | 'syncing' | 'complete' | 'error';
  totalAccounts: number;
  completedAccounts: number;
  accounts: SyncAccountStatus[];
}

export interface SubaccountRow {
  id: string;
  name: string;
}

export interface SubaccountBaselineState {
  subaccountId: string;
  name: string;
  artefactStatus: BaselineArtefactsStatus | null;
  runId: string | null;
  loading: boolean;
}
