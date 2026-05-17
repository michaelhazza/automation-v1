import { describe, it, expect } from 'vitest';
import { referenceTitle, referencePreview, renameReferenceHtml } from '../format';

describe('referenceTitle', () => {
  it('returns Untitled for empty string', () => {
    expect(referenceTitle('')).toBe('Untitled');
  });

  it('returns Untitled for whitespace-only string', () => {
    expect(referenceTitle('   ')).toBe('Untitled');
  });

  it('returns plain text under 80 chars trimmed', () => {
    expect(referenceTitle('  hello world  ')).toBe('hello world');
  });

  it('strips HTML tags and collapses whitespace', () => {
    expect(referenceTitle('<h1>My Title</h1><p>body</p>')).toBe('My Title body');
  });

  it('collapses newlines to spaces (whitespace-collapse runs before line split)', () => {
    // The strip+collapse step turns \n to ' ', so split('\n')[0] returns the full collapsed string.
    expect(referenceTitle('First line\nSecond line')).toBe('First line Second line');
  });

  it('returns first line exactly 80 chars without ellipsis', () => {
    const s = 'a'.repeat(80);
    expect(referenceTitle(s)).toBe(s);
  });

  it('truncates first line of 81 chars with ellipsis character U+2026', () => {
    const s = 'a'.repeat(81);
    expect(referenceTitle(s)).toBe('a'.repeat(80) + '…');
  });
});

describe('referencePreview', () => {
  it('returns empty string for empty input', () => {
    expect(referencePreview('')).toBe('');
  });

  it('strips HTML tags and collapses whitespace', () => {
    expect(referencePreview('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  it('returns content <= 200 chars trimmed', () => {
    const s = 'x'.repeat(200);
    expect(referencePreview(s)).toBe(s);
  });

  it('truncates content of 201 chars with ellipsis', () => {
    const s = 'x'.repeat(201);
    expect(referencePreview(s)).toBe('x'.repeat(200) + '…');
  });
});

describe('renameReferenceHtml', () => {
  it('returns currentHtml unchanged when new title is empty after trim', () => {
    const html = '<h1>Old Title</h1><p>body</p>';
    expect(renameReferenceHtml(html, '   ')).toBe(html);
  });

  it('returns currentHtml unchanged when new title is empty string', () => {
    const html = '<h1>Old</h1>';
    expect(renameReferenceHtml(html, '')).toBe(html);
  });

  it('replaces existing h1 with new title', () => {
    const html = '<h1>Old Title</h1><p>some body</p>';
    expect(renameReferenceHtml(html, 'New Title')).toBe('<h1>New Title</h1><p>some body</p>');
  });

  it('replaces h1 with attributes', () => {
    const html = '<h1 class="foo">Old</h1><p>body</p>';
    expect(renameReferenceHtml(html, 'New')).toBe('<h1>New</h1><p>body</p>');
  });

  it('prepends h1 when no h1 exists', () => {
    const html = '<p>some content</p>';
    expect(renameReferenceHtml(html, 'My Title')).toBe('<h1>My Title</h1><p>some content</p>');
  });

  it('escapes < and > in title', () => {
    const html = '<h1>Old</h1>';
    expect(renameReferenceHtml(html, 'A<B>C')).toBe('<h1>A&lt;B&gt;C</h1>');
  });
});
