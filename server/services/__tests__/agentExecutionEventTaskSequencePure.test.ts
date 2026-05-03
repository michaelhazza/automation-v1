import { describe, it, expect } from 'vitest';
import { allocateTaskSequence } from '../agentExecutionEventTaskSequencePure.js';

describe('allocateTaskSequence', () => {
  it('allocates sequence 1 from counter 0 (initial state)', () => {
    const result = allocateTaskSequence(0);
    expect(result).toEqual({ allocated: 1, newNextSeq: 1 });
  });

  it('allocates sequence 6 from counter 5', () => {
    const result = allocateTaskSequence(5);
    expect(result).toEqual({ allocated: 6, newNextSeq: 6 });
  });

  it('sequences are monotonically increasing across successive calls', () => {
    const seqs: number[] = [];
    let counter = 0;
    for (let i = 0; i < 5; i++) {
      const { allocated, newNextSeq } = allocateTaskSequence(counter);
      seqs.push(allocated);
      counter = newNextSeq;
    }
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
    }
  });

  it('produces no duplicate sequence numbers across successive calls', () => {
    const seqs: number[] = [];
    let counter = 0;
    for (let i = 0; i < 10; i++) {
      const { allocated, newNextSeq } = allocateTaskSequence(counter);
      seqs.push(allocated);
      counter = newNextSeq;
    }
    const unique = new Set(seqs);
    expect(unique.size).toBe(seqs.length);
  });

  it('newNextSeq equals allocated (counter advances by exactly 1)', () => {
    for (let start = 0; start <= 100; start += 10) {
      const { allocated, newNextSeq } = allocateTaskSequence(start);
      expect(newNextSeq).toBe(allocated);
      expect(allocated).toBe(start + 1);
    }
  });
});
