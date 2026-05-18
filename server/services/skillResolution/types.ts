import type { AmendmentKind } from '../../../shared/types/skillAmendments.js';

export const RESOLVER_VERSION = '1.0.0';

export interface AmendmentSnapshotRow {
  id: string;
  kind: AmendmentKind;
  body: string;
  versionNumber: number;
  subaccountId: string | null;
  activatedAt: Date;
  systemSkillId: string | null;
  orgSkillId: string | null;
}

export interface ComposeAmendmentsInput {
  baseRow: { tier: 'system' | 'org'; body: string; skillId: string; isCustom: boolean };
  amendments: ReadonlyArray<AmendmentSnapshotRow>;
  activeFreeze: { id: string; freezeType: 'amendment_activation' } | null;
}

export interface ComposeAmendmentsResult {
  composedBody: string;
  includedAmendmentIds: string[];
  excludedAmendmentIds: string[];
  composedSizeChars: number;
  truncated: boolean;
  reviewRequiredReason: 'composition_size_exceeded' | null;
  amendmentVersionSetHash: string;
}

export type ResolverError =
  | {
      kind: 'composition.divergence';
      runId: string;
      orgId: string;
      skillId: string;
      existingResolverVersion: string;
      currentResolverVersion: string;
      existingHash: string;
      currentHash: string;
      includedDiff: { added: string[]; removed: string[] };
      excludedDiff: { added: string[]; removed: string[] };
      truncatedDiff: { existing: boolean; current: boolean };
    }
  | {
      kind: 'composition.snapshot_write_failed';
      runId: string;
      orgId: string;
      skillId: string;
      dbErrorCode: string;
      attemptCount: number;
    };
