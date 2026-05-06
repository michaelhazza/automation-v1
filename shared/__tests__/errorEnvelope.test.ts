import { describe, it, expect } from 'vitest';
import { isServiceError, toServiceError } from '../errorEnvelope.js';

describe('isServiceError', () => {
  it('returns true for a valid ServiceError shape', () => {
    expect(isServiceError({ statusCode: 404, message: 'not found' })).toBe(true);
  });

  it('returns true with optional fields present', () => {
    expect(isServiceError({ statusCode: 500, message: 'fail', errorCode: 'internal_error', details: {} })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isServiceError(null)).toBe(false);
  });

  it('returns false for a primitive', () => {
    expect(isServiceError('error string')).toBe(false);
    expect(isServiceError(42)).toBe(false);
  });

  it('returns false when statusCode is missing', () => {
    expect(isServiceError({ message: 'missing status' })).toBe(false);
  });

  it('returns false when message is missing', () => {
    expect(isServiceError({ statusCode: 400 })).toBe(false);
  });
});

describe('toServiceError', () => {
  it('passes through an existing ServiceError unchanged', () => {
    const input = { statusCode: 422, message: 'validation failed', errorCode: 'bad_input' };
    expect(toServiceError(input)).toBe(input);
  });

  it('converts an Error instance with fallback status', () => {
    const result = toServiceError(new Error('boom'));
    expect(result.statusCode).toBe(500);
    expect(result.message).toBe('boom');
  });

  it('converts an Error instance with custom fallback status', () => {
    const result = toServiceError(new Error('not found'), 404);
    expect(result.statusCode).toBe(404);
    expect(result.message).toBe('not found');
  });

  it('converts a plain object to string', () => {
    const result = toServiceError({ foo: 'bar' });
    expect(result.statusCode).toBe(500);
    expect(typeof result.message).toBe('string');
  });

  it('converts a string primitive', () => {
    const result = toServiceError('something went wrong');
    expect(result.statusCode).toBe(500);
    expect(result.message).toBe('something went wrong');
  });
});
