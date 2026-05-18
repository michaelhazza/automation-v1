import { eq, and, isNull, isNotNull } from 'drizzle-orm';
import type { OrgScopedTx } from '../../db/index.js';
import { skillAmendments, skillAmendmentFreezes } from '../../db/schema/index.js';
import { composeAmendmentsPure } from './composeAmendmentsPure.js';
import type { AmendmentSnapshotRow, ComposeAmendmentsResult } from './types.js';

export interface ComposeWithAmendmentsInput {
  tx: OrgScopedTx;
  baseRow: { tier: 'system' | 'org'; body: string; skillId: string; isCustom: boolean };
  systemSkillId: string | null;
  orgSkillId: string | null;
  orgId: string;
  subaccountId: string | null;
}

export interface ComposeWithAmendmentsOutput {
  result: ComposeAmendmentsResult;
  amendmentRows: AmendmentSnapshotRow[];
}

export async function composeWithAmendments(
  input: ComposeWithAmendmentsInput,
): Promise<ComposeWithAmendmentsOutput> {
  const { tx, baseRow, systemSkillId, orgSkillId, orgId, subaccountId } = input;

  // Fetch accepted amendments for the skill, ordered for stable composition.
  // Only amendments with status='accepted' and activatedAt set participate.
  const skillFilter = systemSkillId !== null
    ? eq(skillAmendments.systemSkillId, systemSkillId)
    : eq(skillAmendments.orgSkillId, orgSkillId!);

  const subaccountFilter = subaccountId !== null
    ? eq(skillAmendments.subaccountId, subaccountId)
    : undefined;

  const filters = [
    eq(skillAmendments.orgId, orgId),
    skillFilter,
    eq(skillAmendments.status, 'accepted'),
    isNotNull(skillAmendments.activatedAt),
  ];
  if (subaccountFilter) filters.push(subaccountFilter);

  const rawAmendments = await tx
    .select({
      id: skillAmendments.id,
      kind: skillAmendments.kind,
      body: skillAmendments.body,
      versionNumber: skillAmendments.versionNumber,
      subaccountId: skillAmendments.subaccountId,
      activatedAt: skillAmendments.activatedAt,
      systemSkillId: skillAmendments.systemSkillId,
      orgSkillId: skillAmendments.orgSkillId,
    })
    .from(skillAmendments)
    .where(and(...filters))
    .orderBy(skillAmendments.activatedAt, skillAmendments.id);

  const amendmentRows: AmendmentSnapshotRow[] = rawAmendments.map(row => ({
    id: row.id,
    kind: row.kind,
    body: row.body,
    versionNumber: row.versionNumber,
    subaccountId: row.subaccountId,
    activatedAt: row.activatedAt!,
    systemSkillId: row.systemSkillId,
    orgSkillId: row.orgSkillId,
  }));

  // Fetch the active amendment_activation freeze for this skill, if any.
  const freezeFilters = [
    eq(skillAmendmentFreezes.orgId, orgId),
    eq(skillAmendmentFreezes.freezeType, 'amendment_activation'),
    isNull(skillAmendmentFreezes.thawedAt),
  ];

  const [freeze] = await tx
    .select({ id: skillAmendmentFreezes.id, freezeType: skillAmendmentFreezes.freezeType })
    .from(skillAmendmentFreezes)
    .where(and(...freezeFilters))
    .limit(1);

  const activeFreeze = freeze
    ? { id: freeze.id, freezeType: freeze.freezeType as 'amendment_activation' }
    : null;

  const result = composeAmendmentsPure({
    baseRow,
    amendments: amendmentRows,
    activeFreeze,
  });

  return { result, amendmentRows };
}
