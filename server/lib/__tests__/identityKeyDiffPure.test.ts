/**
 * Pure-function tests for identityKeyDiff.ts — diffByIdentityKey.
 */

import { describe, it, expect } from 'vitest';
import { diffByIdentityKey } from '../identityKeyDiff.js';

interface Item {
  id: string;
  name: string;
}

const getKey = (item: Item) => item.id;

describe('diffByIdentityKey', () => {
  it('all added: empty existing + non-empty incoming', () => {
    const existing: Item[] = [];
    const incoming = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const result = diffByIdentityKey(existing, incoming, getKey);
    expect(result.added).toHaveLength(2);
    expect(result.updated).toHaveLength(0);
    expect(result.silentlyRemoved).toHaveLength(0);
  });

  it('all silentlyRemoved: non-empty existing + empty incoming', () => {
    const existing = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const incoming: Item[] = [];
    const result = diffByIdentityKey(existing, incoming, getKey);
    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.silentlyRemoved).toHaveLength(2);
  });

  it('all updated: same keys in both sets', () => {
    const existing = [{ id: 'a', name: 'A' }];
    const incoming = [{ id: 'a', name: 'A-updated' }];
    const result = diffByIdentityKey(existing, incoming, getKey);
    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].name).toBe('A-updated');
    expect(result.silentlyRemoved).toHaveLength(0);
  });

  it('mixed: add + update + remove', () => {
    const existing = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    const incoming = [
      { id: 'a', name: 'A-new' }, // updated
      { id: 'c', name: 'C' },     // added
    ];
    // 'b' is not in incoming → silentlyRemoved
    const result = diffByIdentityKey(existing, incoming, getKey);
    expect(result.added).toHaveLength(1);
    expect(result.added[0].id).toBe('c');
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].id).toBe('a');
    expect(result.silentlyRemoved).toHaveLength(1);
    expect(result.silentlyRemoved[0].id).toBe('b');
  });

  it('empty both sides → all arrays empty', () => {
    const result = diffByIdentityKey<Item>([], [], getKey);
    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.silentlyRemoved).toHaveLength(0);
  });

  it('silentlyRemoved items are the existing items (not incoming)', () => {
    const existing = [{ id: 'x', name: 'old-X' }];
    const incoming: Item[] = [];
    const result = diffByIdentityKey(existing, incoming, getKey);
    expect(result.silentlyRemoved[0]).toStrictEqual({ id: 'x', name: 'old-X' });
  });

  it('updated items come from incoming array (new values)', () => {
    const existing = [{ id: 'a', name: 'old' }];
    const incoming = [{ id: 'a', name: 'new' }];
    const result = diffByIdentityKey(existing, incoming, getKey);
    expect(result.updated[0].name).toBe('new');
  });

  it('throws on duplicate incoming keys (Q6 invariant)', () => {
    const existing: Item[] = [];
    const incoming = [{ id: 'a', name: 'first' }, { id: 'a', name: 'second' }];
    expect(() => diffByIdentityKey(existing, incoming, getKey)).toThrow(
      /duplicate incoming keys.*a/,
    );
  });

  it('key extraction function is used correctly for string identity', () => {
    interface SkillItem { slug: string; enabled: boolean }
    const getSlug = (s: SkillItem) => s.slug;
    const existing: SkillItem[] = [{ slug: 'web-search', enabled: true }];
    const incoming: SkillItem[] = [
      { slug: 'web-search', enabled: false }, // updated
      { slug: 'send-email', enabled: true },  // added
    ];
    const result = diffByIdentityKey(existing, incoming, getSlug);
    expect(result.added.map(s => s.slug)).toEqual(['send-email']);
    expect(result.updated.map(s => s.slug)).toEqual(['web-search']);
    expect(result.silentlyRemoved).toHaveLength(0);
  });

  it('all three categories simultaneously populated', () => {
    const existing = [
      { id: '1', name: 'keep-and-update' },
      { id: '2', name: 'will-be-removed' },
      { id: '3', name: 'also-removed' },
    ];
    const incoming = [
      { id: '1', name: 'updated-name' },
      { id: '4', name: 'brand-new' },
    ];
    const result = diffByIdentityKey(existing, incoming, getKey);
    expect(result.added.map(i => i.id)).toEqual(['4']);
    expect(result.updated.map(i => i.id)).toEqual(['1']);
    expect(result.silentlyRemoved.map(i => i.id).sort()).toEqual(['2', '3']);
  });
});
