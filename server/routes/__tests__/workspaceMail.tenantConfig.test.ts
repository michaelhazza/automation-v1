import { describe, test, expect } from 'vitest';
import { buildWorkspaceTenantConfig } from '../../services/connectorConfigService.js';

describe('buildWorkspaceTenantConfig', () => {
  test('full config — all fields present in configJson, with a known connector', () => {
    const result = buildWorkspaceTenantConfig('Acme Corp', {
      id: 'cc_acme_001',
      connectorType: 'google_workspace',
      configJson: {
        domain: 'acme.com',
        defaultSignatureTemplate: 'Best,\n{{name}}',
        discloseAsAgent: true,
        vanityDomain: 'mail.acme.com',
      },
    });

    expect(result.subaccountName).toBe('Acme Corp');
    expect(result.backend).toBe('google_workspace');
    expect(result.connectorConfigId).toBe('cc_acme_001');
    expect(result.domain).toBe('acme.com');
    expect(result.defaultSignatureTemplate).toBe('Best,\n{{name}}');
    expect(result.discloseAsAgent).toBe(true);
    expect(result.vanityDomain).toBe('mail.acme.com');
  });

  test('null connector config → all defaults, backend null, domain falls back to env (or null)', () => {
    const result = buildWorkspaceTenantConfig('', null);

    expect(result.subaccountName).toBe('');
    expect(result.backend).toBeNull();
    expect(result.connectorConfigId).toBeNull();
    expect(result.defaultSignatureTemplate).toBe('');
    expect(result.discloseAsAgent).toBe(false);
    expect(result.vanityDomain).toBeNull();
  });

  test('wrong types in configJson → still uses defaults', () => {
    const result = buildWorkspaceTenantConfig('Beta Ltd', {
      id: 'cc_beta_001',
      connectorType: 'synthetos_native',
      configJson: {
        defaultSignatureTemplate: 42 as unknown as string,
        discloseAsAgent: 'yes' as unknown as boolean,
        vanityDomain: 99 as unknown as string,
        domain: 0 as unknown as string,
      },
    });

    expect(result.backend).toBe('synthetos_native');
    expect(result.connectorConfigId).toBe('cc_beta_001');
    expect(result.defaultSignatureTemplate).toBe('');
    expect(result.discloseAsAgent).toBe(false);
    expect(result.vanityDomain).toBeNull();
  });

  test('unknown connectorType → backend null (defensive against future schema additions)', () => {
    const result = buildWorkspaceTenantConfig('Gamma Inc', {
      id: 'cc_gamma_001',
      connectorType: 'crm',
      configJson: { domain: 'gamma.io' },
    });

    expect(result.backend).toBeNull();
    expect(result.connectorConfigId).toBe('cc_gamma_001');
    expect(result.domain).toBe('gamma.io');
  });
});
