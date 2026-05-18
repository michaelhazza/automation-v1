/**
 * visionGroundingService.config.test.ts — Vitest tests for the pure config
 * helpers in visionGroundingService.
 *
 * Covers:
 *   - parseVisionEndpointHostPort (pure helper consumed by _ieeShared.ts
 *     for sandbox network-allowlist construction)
 *   - resolveEndpointConfig (env-var-reading helper called inline at IEE
 *     dispatch; HTTPS-only enforcement is the load-bearing security check)
 *
 * Both targets are pure / I/O-free apart from process.env reads in
 * resolveEndpointConfig. process.env is mutated in beforeEach/afterEach so
 * the suite is hermetic.
 *
 * Spec sections: §8.6 (config contract), §8.7 (allowlist host/port parsing).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseVisionEndpointHostPort, resolveEndpointConfig } from '../visionGroundingService.js';
import { FailureError } from '../../../shared/iee/failure.js';

describe('parseVisionEndpointHostPort', () => {
  it('returns default port 443 when URL has no explicit port', () => {
    const result = parseVisionEndpointHostPort('https://vllm.example.com/');
    expect(result).toEqual({ host: 'vllm.example.com', port: 443 });
  });

  it('returns explicit non-default port when URL specifies it', () => {
    const result = parseVisionEndpointHostPort('https://vllm.internal:8443/v1');
    expect(result).toEqual({ host: 'vllm.internal', port: 8443 });
  });

  it('strips default port 443 to bare host:443 when URL is "https://...:443/"', () => {
    // WHATWG URL strips default port for HTTPS scheme → url.port === ''
    const result = parseVisionEndpointHostPort('https://vllm.internal:443/');
    expect(result).toEqual({ host: 'vllm.internal', port: 443 });
  });

  it('parses path-only URLs without altering host:port', () => {
    const result = parseVisionEndpointHostPort('https://vllm.internal/v1/chat/completions');
    expect(result).toEqual({ host: 'vllm.internal', port: 443 });
  });

  it('throws on http:// URL (HTTPS-only contract per spec §8.6)', () => {
    expect(() => parseVisionEndpointHostPort('http://vllm.example.com/'))
      .toThrow('VISION_INFERENCE_ENDPOINT_URL must be HTTPS');
  });

  it('throws on a URL with no scheme', () => {
    expect(() => parseVisionEndpointHostPort('vllm.example.com:8443'))
      .toThrow('VISION_INFERENCE_ENDPOINT_URL must be HTTPS');
  });

  it('throws on a malformed URL (URL constructor)', () => {
    // Starts with https:// so passes the prefix check, but the URL constructor rejects.
    expect(() => parseVisionEndpointHostPort('https://')).toThrow();
  });
});

describe('resolveEndpointConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.VISION_INFERENCE_ENDPOINT_URL;
    delete process.env.VISION_INFERENCE_API_KEY;
    delete process.env.VISION_INFERENCE_MODEL_ID;
  });

  afterEach(() => {
    // Restore exactly the keys we touched.
    delete process.env.VISION_INFERENCE_ENDPOINT_URL;
    delete process.env.VISION_INFERENCE_API_KEY;
    delete process.env.VISION_INFERENCE_MODEL_ID;
    for (const key of ['VISION_INFERENCE_ENDPOINT_URL', 'VISION_INFERENCE_API_KEY', 'VISION_INFERENCE_MODEL_ID']) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('throws FailureError(vision_inference_not_configured) when URL is absent', () => {
    expect(() => resolveEndpointConfig()).toThrow(FailureError);
    try {
      resolveEndpointConfig();
    } catch (err) {
      expect(err).toBeInstanceOf(FailureError);
      expect((err as FailureError).failure.failureReason).toBe('vision_inference_not_configured');
    }
  });

  it('throws FailureError(vision_inference_not_configured) when URL is http://', () => {
    process.env.VISION_INFERENCE_ENDPOINT_URL = 'http://vllm.example.com/';
    expect(() => resolveEndpointConfig()).toThrow(FailureError);
    try {
      resolveEndpointConfig();
    } catch (err) {
      expect((err as FailureError).failure.failureReason).toBe('vision_inference_not_configured');
    }
  });

  it('throws FailureError(vision_inference_not_configured) when URL is an empty string', () => {
    process.env.VISION_INFERENCE_ENDPOINT_URL = '';
    expect(() => resolveEndpointConfig()).toThrow(FailureError);
  });

  it('returns config with default modelId "ui-tars-7b" when only URL is set', () => {
    process.env.VISION_INFERENCE_ENDPOINT_URL = 'https://vllm.example.com/v1';
    expect(resolveEndpointConfig()).toEqual({
      endpointUrl: 'https://vllm.example.com/v1',
      apiKey: null,
      modelId: 'ui-tars-7b',
    });
  });

  it('returns config with apiKey when VISION_INFERENCE_API_KEY is set', () => {
    process.env.VISION_INFERENCE_ENDPOINT_URL = 'https://vllm.example.com/v1';
    process.env.VISION_INFERENCE_API_KEY = 'sk-abc123';
    expect(resolveEndpointConfig()).toEqual({
      endpointUrl: 'https://vllm.example.com/v1',
      apiKey: 'sk-abc123',
      modelId: 'ui-tars-7b',
    });
  });

  it('returns config with override modelId when VISION_INFERENCE_MODEL_ID is set', () => {
    process.env.VISION_INFERENCE_ENDPOINT_URL = 'https://vllm.example.com/v1';
    process.env.VISION_INFERENCE_MODEL_ID = 'ui-tars-72b';
    expect(resolveEndpointConfig()).toEqual({
      endpointUrl: 'https://vllm.example.com/v1',
      apiKey: null,
      modelId: 'ui-tars-72b',
    });
  });

  it('returns all three values when all three env vars are set', () => {
    process.env.VISION_INFERENCE_ENDPOINT_URL = 'https://vllm.internal:8443/v1';
    process.env.VISION_INFERENCE_API_KEY = 'sk-xyz';
    process.env.VISION_INFERENCE_MODEL_ID = 'ui-tars-7b';
    expect(resolveEndpointConfig()).toEqual({
      endpointUrl: 'https://vllm.internal:8443/v1',
      apiKey: 'sk-xyz',
      modelId: 'ui-tars-7b',
    });
  });
});
