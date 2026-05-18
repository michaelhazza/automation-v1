import { describe, it, expect, beforeEach } from 'vitest';
import {
  addFiles,
  transitionRow,
  summariseRows,
  type AttachmentRowState,
} from '../TaskAttachmentDropZonePure.js';

function makeFile(name = 'test.txt'): File {
  return new File(['content'], name, { type: 'text/plain' });
}

function makeController(): AbortController {
  return new AbortController();
}

describe('addFiles', () => {
  it('appends pending rows for each file', () => {
    const result = addFiles([], [makeFile('a.txt'), makeFile('b.txt')]);
    expect(result).toHaveLength(2);
    expect(result[0].state).toBe('pending');
    expect(result[1].state).toBe('pending');
  });

  it('preserves existing rows', () => {
    const existing: AttachmentRowState[] = [
      { state: 'succeeded', localId: 'x1', attachmentId: 'att1', filename: 'prior.txt' },
    ];
    const result = addFiles(existing, [makeFile('new.txt')]);
    expect(result).toHaveLength(2);
    expect(result[0].state).toBe('succeeded');
    expect(result[1].state).toBe('pending');
  });

  it('assigns unique localIds across multiple calls', () => {
    const first = addFiles([], [makeFile()]);
    const second = addFiles([], [makeFile()]);
    expect(first[0].localId).not.toBe(second[0].localId);
  });

  it('returns unchanged array when files list is empty', () => {
    const rows: AttachmentRowState[] = [];
    const result = addFiles(rows, []);
    expect(result).toHaveLength(0);
  });
});

describe('transitionRow — allowed transitions', () => {
  it('transitions pending → uploading', () => {
    const file = makeFile();
    const rows: AttachmentRowState[] = [{ state: 'pending', localId: 'id1', file }];
    const newState: AttachmentRowState = {
      state: 'uploading',
      localId: 'id1',
      file,
      idempotencyKey: 'ik1',
      controller: makeController(),
    };
    const result = transitionRow(rows, 'id1', newState);
    expect(result[0].state).toBe('uploading');
  });

  it('transitions uploading → succeeded', () => {
    const file = makeFile();
    const rows: AttachmentRowState[] = [
      { state: 'uploading', localId: 'id1', file, idempotencyKey: 'ik1', controller: makeController() },
    ];
    const newState: AttachmentRowState = {
      state: 'succeeded',
      localId: 'id1',
      attachmentId: 'att1',
      filename: 'file.txt',
    };
    const result = transitionRow(rows, 'id1', newState);
    expect(result[0].state).toBe('succeeded');
  });

  it('transitions uploading → failed_recoverable', () => {
    const file = makeFile();
    const rows: AttachmentRowState[] = [
      { state: 'uploading', localId: 'id1', file, idempotencyKey: 'ik1', controller: makeController() },
    ];
    const newState: AttachmentRowState = {
      state: 'failed_recoverable',
      localId: 'id1',
      file,
      idempotencyKey: 'ik1',
      error: 'network error',
    };
    const result = transitionRow(rows, 'id1', newState);
    expect(result[0].state).toBe('failed_recoverable');
  });

  it('transitions uploading → failed_unrecoverable', () => {
    const file = makeFile();
    const rows: AttachmentRowState[] = [
      { state: 'uploading', localId: 'id1', file, idempotencyKey: 'ik1', controller: makeController() },
    ];
    const newState: AttachmentRowState = {
      state: 'failed_unrecoverable',
      localId: 'id1',
      filename: 'file.txt',
      error: 'bad file',
    };
    const result = transitionRow(rows, 'id1', newState);
    expect(result[0].state).toBe('failed_unrecoverable');
  });

  it('transitions failed_recoverable → uploading (retry)', () => {
    const file = makeFile();
    const rows: AttachmentRowState[] = [
      { state: 'failed_recoverable', localId: 'id1', file, idempotencyKey: 'ik1', error: 'err' },
    ];
    const newState: AttachmentRowState = {
      state: 'uploading',
      localId: 'id1',
      file,
      idempotencyKey: 'ik2',
      controller: makeController(),
    };
    const result = transitionRow(rows, 'id1', newState);
    expect(result[0].state).toBe('uploading');
  });

  it('transitions pending → cancelled', () => {
    const file = makeFile();
    const rows: AttachmentRowState[] = [{ state: 'pending', localId: 'id1', file }];
    const newState: AttachmentRowState = {
      state: 'cancelled',
      localId: 'id1',
      filename: 'file.txt',
    };
    const result = transitionRow(rows, 'id1', newState);
    expect(result[0].state).toBe('cancelled');
  });

  it('returns rows unchanged when localId not found', () => {
    const file = makeFile();
    const rows: AttachmentRowState[] = [{ state: 'pending', localId: 'id1', file }];
    const newState: AttachmentRowState = {
      state: 'cancelled',
      localId: 'no-such-id',
      filename: 'file.txt',
    };
    const result = transitionRow(rows, 'no-such-id', newState);
    expect(result).toEqual(rows);
  });

  it('does not mutate other rows when transitioning one', () => {
    const file = makeFile();
    const rows: AttachmentRowState[] = [
      { state: 'pending', localId: 'id1', file },
      { state: 'succeeded', localId: 'id2', attachmentId: 'att2', filename: 'other.txt' },
    ];
    const result = transitionRow(rows, 'id1', { state: 'cancelled', localId: 'id1', filename: 'file.txt' });
    expect(result[1].state).toBe('succeeded');
  });
});

describe('transitionRow — disallowed transitions (must throw)', () => {
  it('throws on succeeded → pending', () => {
    const rows: AttachmentRowState[] = [
      { state: 'succeeded', localId: 'id1', attachmentId: 'att1', filename: 'f.txt' },
    ];
    const file = makeFile();
    expect(() =>
      transitionRow(rows, 'id1', { state: 'pending', localId: 'id1', file }),
    ).toThrow();
  });

  it('throws on succeeded → uploading', () => {
    const rows: AttachmentRowState[] = [
      { state: 'succeeded', localId: 'id1', attachmentId: 'att1', filename: 'f.txt' },
    ];
    const file = makeFile();
    expect(() =>
      transitionRow(rows, 'id1', {
        state: 'uploading',
        localId: 'id1',
        file,
        idempotencyKey: 'ik',
        controller: makeController(),
      }),
    ).toThrow();
  });

  it('throws on succeeded → failed_recoverable', () => {
    const rows: AttachmentRowState[] = [
      { state: 'succeeded', localId: 'id1', attachmentId: 'att1', filename: 'f.txt' },
    ];
    const file = makeFile();
    expect(() =>
      transitionRow(rows, 'id1', {
        state: 'failed_recoverable',
        localId: 'id1',
        file,
        idempotencyKey: 'ik',
        error: 'err',
      }),
    ).toThrow();
  });

  it('throws on succeeded → failed_unrecoverable', () => {
    const rows: AttachmentRowState[] = [
      { state: 'succeeded', localId: 'id1', attachmentId: 'att1', filename: 'f.txt' },
    ];
    expect(() =>
      transitionRow(rows, 'id1', {
        state: 'failed_unrecoverable',
        localId: 'id1',
        filename: 'f.txt',
        error: 'err',
      }),
    ).toThrow();
  });

  it('throws on cancelled → any state', () => {
    const rows: AttachmentRowState[] = [
      { state: 'cancelled', localId: 'id1', filename: 'f.txt' },
    ];
    const file = makeFile();
    expect(() =>
      transitionRow(rows, 'id1', { state: 'pending', localId: 'id1', file }),
    ).toThrow();
    expect(() =>
      transitionRow(rows, 'id1', { state: 'cancelled', localId: 'id1', filename: 'f2.txt' }),
    ).toThrow();
  });

  it('throws on failed_unrecoverable → uploading', () => {
    const rows: AttachmentRowState[] = [
      { state: 'failed_unrecoverable', localId: 'id1', filename: 'f.txt', error: 'bad' },
    ];
    const file = makeFile();
    expect(() =>
      transitionRow(rows, 'id1', {
        state: 'uploading',
        localId: 'id1',
        file,
        idempotencyKey: 'ik',
        controller: makeController(),
      }),
    ).toThrow();
  });
});

describe('summariseRows', () => {
  it('counts each state correctly', () => {
    const file = makeFile();
    const rows: AttachmentRowState[] = [
      { state: 'pending', localId: 'a', file },
      { state: 'uploading', localId: 'b', file, idempotencyKey: 'ik', controller: makeController() },
      { state: 'succeeded', localId: 'c', attachmentId: 'att', filename: 'c.txt' },
      { state: 'failed_recoverable', localId: 'd', file, idempotencyKey: 'ik', error: 'e' },
      { state: 'failed_unrecoverable', localId: 'e', filename: 'e.txt', error: 'e' },
      { state: 'cancelled', localId: 'f', filename: 'f.txt' },
    ];
    const result = summariseRows(rows);
    expect(result.pending).toBe(1);
    expect(result.uploading).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(2);
  });

  it('cancelled rows count in no bucket', () => {
    const rows: AttachmentRowState[] = [
      { state: 'cancelled', localId: 'a', filename: 'a.txt' },
      { state: 'cancelled', localId: 'b', filename: 'b.txt' },
    ];
    const result = summariseRows(rows);
    expect(result.pending + result.uploading + result.succeeded + result.failed).toBe(0);
  });

  it('returns all zeros for empty array', () => {
    const result = summariseRows([]);
    expect(result).toEqual({ pending: 0, uploading: 0, succeeded: 0, failed: 0 });
  });
});
