import { describe, it, expect, vi } from 'vitest';
import { setOrgAndSubaccountGUC } from '../orgScoping.js';

// Minimal tx stub that tracks execute calls
function makeTxStub() {
  const calls: unknown[] = [];
  const tx = {
    execute: vi.fn(async (sqlExpr: unknown) => {
      calls.push(sqlExpr);
      return { rows: [] };
    }),
  };
  return { tx, calls };
}

describe('setOrgAndSubaccountGUC', () => {
  it('calls tx.execute twice — once for organisation_id and once for subaccount_id', async () => {
    const { tx } = makeTxStub();
    await setOrgAndSubaccountGUC(tx as never, 'org-123', 'sub-456');
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it('the first call sets app.organisation_id', async () => {
    const { tx } = makeTxStub();
    await setOrgAndSubaccountGUC(tx as never, 'org-abc', 'sub-xyz');
    const firstArg = JSON.stringify(tx.execute.mock.calls[0][0]);
    expect(firstArg).toContain('organisation_id');
  });

  it('the second call sets app.subaccount_id', async () => {
    const { tx } = makeTxStub();
    await setOrgAndSubaccountGUC(tx as never, 'org-abc', 'sub-xyz');
    const secondArg = JSON.stringify(tx.execute.mock.calls[1][0]);
    expect(secondArg).toContain('subaccount_id');
  });

  it('rejects an empty orgId', async () => {
    const { tx } = makeTxStub();
    await expect(setOrgAndSubaccountGUC(tx as never, '', 'sub-456')).rejects.toThrow(
      'orgId required',
    );
  });

  it('rejects an empty subaccountId', async () => {
    const { tx } = makeTxStub();
    await expect(setOrgAndSubaccountGUC(tx as never, 'org-123', '')).rejects.toThrow(
      'subaccountId required',
    );
  });

  it('rejects both empty', async () => {
    const { tx } = makeTxStub();
    await expect(setOrgAndSubaccountGUC(tx as never, '', '')).rejects.toThrow();
  });

  it('does not call execute when orgId is empty (fails fast)', async () => {
    const { tx } = makeTxStub();
    try {
      await setOrgAndSubaccountGUC(tx as never, '', 'sub-456');
    } catch {
      // expected
    }
    expect(tx.execute).not.toHaveBeenCalled();
  });
});
