import { describe, it, expect } from 'vitest';
import { composeAmendmentsPure } from '../composeAmendmentsPure.js';
import type { AmendmentSnapshotRow, ComposeAmendmentsInput } from '../types.js';

function makeRow(overrides: Partial<AmendmentSnapshotRow> & { id: string }): AmendmentSnapshotRow {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'instruction_extension',
    body: overrides.body ?? `body-${overrides.id}`,
    versionNumber: overrides.versionNumber ?? 1,
    subaccountId: overrides.subaccountId ?? null,
    activatedAt: overrides.activatedAt ?? new Date('2024-01-01T00:00:00Z'),
    systemSkillId: overrides.systemSkillId ?? 'sys-1',
    orgSkillId: overrides.orgSkillId ?? null,
  };
}

const BASE_ROW: ComposeAmendmentsInput['baseRow'] = {
  tier: 'system',
  body: 'base-body',
  skillId: 'skill-1',
  isCustom: false,
};

describe('composeAmendmentsPure', () => {
  describe('bucket ordering', () => {
    it('orders org-tier before subaccount-tier, and within tier by kind order', () => {
      const t = new Date('2024-01-01T00:00:00Z');
      const amendments: AmendmentSnapshotRow[] = [
        makeRow({ id: 'f', kind: 'exception',             subaccountId: null,   activatedAt: t }),
        makeRow({ id: 'g', kind: 'guardrail',             subaccountId: 'sub',  activatedAt: t }),
        makeRow({ id: 'a', kind: 'guardrail',             subaccountId: null,   activatedAt: t }),
        makeRow({ id: 'e', kind: 'context_fact',          subaccountId: null,   activatedAt: t }),
        makeRow({ id: 'h', kind: 'instruction_extension', subaccountId: 'sub',  activatedAt: t }),
        makeRow({ id: 'b', kind: 'instruction_extension', subaccountId: null,   activatedAt: t }),
        makeRow({ id: 'i', kind: 'example',               subaccountId: 'sub',  activatedAt: t }),
        makeRow({ id: 'c', kind: 'example',               subaccountId: null,   activatedAt: t }),
        makeRow({ id: 'j', kind: 'context_fact',          subaccountId: 'sub',  activatedAt: t }),
        makeRow({ id: 'd', kind: 'instruction_extension', subaccountId: null,   activatedAt: t }),
        makeRow({ id: 'k', kind: 'exception',             subaccountId: 'sub',  activatedAt: t }),
      ];
      const result = composeAmendmentsPure({ baseRow: BASE_ROW, amendments, activeFreeze: null });

      // Expected order (within same kind+tier: by id asc):
      // org guardrail(a), org instruction_extension(b,d), org example(c), org context_fact(e), org exception(f),
      // sub guardrail(g), sub instruction_extension(h), sub example(i), sub context_fact(j), sub exception(k)
      expect(result.includedAmendmentIds).toEqual(['a', 'b', 'd', 'c', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);
    });
  });

  describe('stable tiebreaker', () => {
    it('sorts by id ascending when activatedAt is identical — stable across 3+ permutations', () => {
      const t = new Date('2024-06-01T12:00:00Z');
      const rows: AmendmentSnapshotRow[] = [
        makeRow({ id: 'ccc', kind: 'guardrail', activatedAt: t }),
        makeRow({ id: 'aaa', kind: 'guardrail', activatedAt: t }),
        makeRow({ id: 'bbb', kind: 'guardrail', activatedAt: t }),
      ];

      // All 6 permutations of a 3-element array
      const permutations: AmendmentSnapshotRow[][] = [
        [rows[0], rows[1], rows[2]],
        [rows[0], rows[2], rows[1]],
        [rows[1], rows[0], rows[2]],
        [rows[1], rows[2], rows[0]],
        [rows[2], rows[0], rows[1]],
        [rows[2], rows[1], rows[0]],
      ];

      for (const perm of permutations) {
        const result = composeAmendmentsPure({ baseRow: BASE_ROW, amendments: perm, activeFreeze: null });
        expect(result.includedAmendmentIds).toEqual(['aaa', 'bbb', 'ccc']);
      }
    });
  });

  describe('fail-closed truncation', () => {
    it('returns base body alone with all ids excluded when total exceeds 12000 chars', () => {
      const body60 = 'x'.repeat(60);
      const amendments: AmendmentSnapshotRow[] = Array.from({ length: 201 }, (_, i) =>
        makeRow({ id: `id-${String(i).padStart(4, '0')}`, body: body60 }),
      );
      const result = composeAmendmentsPure({ baseRow: BASE_ROW, amendments, activeFreeze: null });

      expect(result.truncated).toBe(true);
      expect(result.composedBody).toBe(BASE_ROW.body);
      expect(result.includedAmendmentIds).toEqual([]);
      expect(result.excludedAmendmentIds.length).toBe(201);
      expect(result.reviewRequiredReason).toBe('composition_size_exceeded');
    });
  });

  describe('active freeze', () => {
    it('returns base body alone with empty included and excluded sets when freeze is set', () => {
      const amendments: AmendmentSnapshotRow[] = [
        makeRow({ id: 'x1', kind: 'guardrail' }),
        makeRow({ id: 'x2', kind: 'example' }),
      ];
      const result = composeAmendmentsPure({
        baseRow: BASE_ROW,
        amendments,
        activeFreeze: { id: 'freeze-1', freezeType: 'amendment_activation' },
      });

      expect(result.composedBody).toBe(BASE_ROW.body);
      expect(result.includedAmendmentIds).toEqual([]);
      expect(result.excludedAmendmentIds).toEqual([]);
      expect(result.truncated).toBe(false);
    });
  });

  describe('hash determinism', () => {
    it('produces same amendmentVersionSetHash regardless of input array order', () => {
      const t = new Date('2024-01-01T00:00:00Z');
      const rows: AmendmentSnapshotRow[] = [
        makeRow({ id: 'id-a', versionNumber: 2, activatedAt: t }),
        makeRow({ id: 'id-b', versionNumber: 1, activatedAt: t }),
        makeRow({ id: 'id-c', versionNumber: 3, activatedAt: t }),
      ];

      const r1 = composeAmendmentsPure({ baseRow: BASE_ROW, amendments: [rows[0], rows[1], rows[2]], activeFreeze: null });
      const r2 = composeAmendmentsPure({ baseRow: BASE_ROW, amendments: [rows[2], rows[0], rows[1]], activeFreeze: null });
      const r3 = composeAmendmentsPure({ baseRow: BASE_ROW, amendments: [rows[1], rows[2], rows[0]], activeFreeze: null });

      expect(r1.amendmentVersionSetHash).toBe(r2.amendmentVersionSetHash);
      expect(r2.amendmentVersionSetHash).toBe(r3.amendmentVersionSetHash);
    });
  });

  describe('custom skill guard', () => {
    it('throws when baseRow.isCustom is true', () => {
      expect(() =>
        composeAmendmentsPure({
          baseRow: { ...BASE_ROW, isCustom: true },
          amendments: [],
          activeFreeze: null,
        }),
      ).toThrow('composeAmendmentsPure: custom skills must be filtered upstream');
    });
  });

  describe('empty amendments', () => {
    it('returns base body unchanged with empty included ids and truncated=false', () => {
      const result = composeAmendmentsPure({ baseRow: BASE_ROW, amendments: [], activeFreeze: null });

      expect(result.composedBody).toBe(BASE_ROW.body);
      expect(result.includedAmendmentIds).toEqual([]);
      expect(result.excludedAmendmentIds).toEqual([]);
      expect(result.truncated).toBe(false);
      expect(result.composedSizeChars).toBe(BASE_ROW.body.length);
    });
  });
});
