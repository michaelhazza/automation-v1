import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { parseVisionEndpointHostPort, resolveEndpointConfig } from '../visionGroundingService.js';
import { FailureError } from '../../../shared/iee/failure.js';

describe('parseVisionEndpointHostPort', () => {
  it('returns host and default port 443 for HTTPS URL without explicit port', () => {
    expect(parseVisionEndpointHostPort('https://vllm.example.com')).toEqual({
      host: 'vllm.example.com',
      port: 443,
    });
  });

  it('returns host and explicit port when URL includes one', () => {
    expect(parseVisionEndpointHostPort('https://x.com:8443/v1')).toEqual({
      host: 'x.com',
      port: 8443,
    });
  });

  it('throws on non-HTTPS URL with a message naming the HTTPS requirement', () => {
    expect(() => parseVisionEndpointHostPort('http://x.com')).toThrow(/HTTPS/);
  });
});

describe('resolveEndpointConfig', () => {
  const originalEnv = {
    url: process.env['VISION_INFERENCE_ENDPOINT_URL'],
    key: process.env['VISION_INFERENCE_API_KEY'],
    model: process.env['VISION_INFERENCE_MODEL_ID'],
  };

  beforeEach(() => {
    delete process.env['VISION_INFERENCE_ENDPOINT_URL'];
    delete process.env['VISION_INFERENCE_API_KEY'];
    delete process.env['VISION_INFERENCE_MODEL_ID'];
  });

  afterEach(() => {
    if (originalEnv.url !== undefined) process.env['VISION_INFERENCE_ENDPOINT_URL'] = originalEnv.url;
    if (originalEnv.key !== undefined) process.env['VISION_INFERENCE_API_KEY'] = originalEnv.key;
    if (originalEnv.model !== undefined) process.env['VISION_INFERENCE_MODEL_ID'] = originalEnv.model;
  });

  it('throws FailureError(vision_inference_not_configured) when the URL env var is unset', () => {
    expect(() => resolveEndpointConfig()).toThrow(FailureError);
    try {
      resolveEndpointConfig();
    } catch (err) {
      expect(err).toBeInstanceOf(FailureError);
      expect((err as FailureError).failure.failureReason).toBe('vision_inference_not_configured');
    }
  });

  it('throws FailureError(vision_inference_not_configured) for non-HTTPS URLs', () => {
    process.env['VISION_INFERENCE_ENDPOINT_URL'] = 'http://x';
    expect(() => resolveEndpointConfig()).toThrow(FailureError);
    try {
      resolveEndpointConfig();
    } catch (err) {
      expect(err).toBeInstanceOf(FailureError);
      expect((err as FailureError).failure.failureReason).toBe('vision_inference_not_configured');
    }
  });

  it('defaults modelId to "ui-tars-7b" when the MODEL_ID env var is unset', () => {
    process.env['VISION_INFERENCE_ENDPOINT_URL'] = 'https://vllm.example.com';
    const config = resolveEndpointConfig();
    expect(config.modelId).toBe('ui-tars-7b');
  });

  it('returns apiKey as null when the API_KEY env var is unset', () => {
    process.env['VISION_INFERENCE_ENDPOINT_URL'] = 'https://vllm.example.com';
    const config = resolveEndpointConfig();
    expect(config.apiKey).toBeNull();
  });

  it('returns the explicit modelId when MODEL_ID env var is set', () => {
    process.env['VISION_INFERENCE_ENDPOINT_URL'] = 'https://vllm.example.com';
    process.env['VISION_INFERENCE_MODEL_ID'] = 'ui-tars-72b';
    const config = resolveEndpointConfig();
    expect(config.modelId).toBe('ui-tars-72b');
  });

  it('returns the explicit apiKey when API_KEY env var is set', () => {
    process.env['VISION_INFERENCE_ENDPOINT_URL'] = 'https://vllm.example.com';
    process.env['VISION_INFERENCE_API_KEY'] = 'sk-test-secret';
    const config = resolveEndpointConfig();
    expect(config.apiKey).toBe('sk-test-secret');
  });
});
