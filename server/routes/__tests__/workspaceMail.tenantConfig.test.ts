import { buildWorkspaceTenantConfig } from '../../services/connectorConfigService.js';

// Test A: full config — all fields present in configJson, with a known connector
{
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

  console.assert(result.subaccountName === 'Acme Corp', 'subaccountName should match');
  console.assert(result.backend === 'google_workspace', 'backend should match connectorType');
  console.assert(result.connectorConfigId === 'cc_acme_001', 'connectorConfigId should match');
  console.assert(result.domain === 'acme.com', 'domain should resolve from configJson.domain');
  console.assert(result.defaultSignatureTemplate === 'Best,\n{{name}}', 'defaultSignatureTemplate should match');
  console.assert(result.discloseAsAgent === true, 'discloseAsAgent should be true');
  console.assert(result.vanityDomain === 'mail.acme.com', 'vanityDomain should match');
  console.log('Test A passed: full config fields resolved correctly');
}

// Test B: null connector config → all defaults, backend null, domain falls back to env (or null)
{
  const result = buildWorkspaceTenantConfig('', null);

  console.assert(result.subaccountName === '', 'subaccountName should be empty string');
  console.assert(result.backend === null, 'backend should be null when no connector configured');
  console.assert(result.connectorConfigId === null, 'connectorConfigId should be null');
  // domain may be null OR the env NATIVE_EMAIL_DOMAIN — both are valid for "no override"
  console.assert(result.defaultSignatureTemplate === '', 'defaultSignatureTemplate should default to empty string');
  console.assert(result.discloseAsAgent === false, 'discloseAsAgent should default to false');
  console.assert(result.vanityDomain === null, 'vanityDomain should default to null');
  console.log('Test B passed: null connector config produces all defaults');
}

// Test C: wrong types in configJson → still uses defaults
{
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

  console.assert(result.backend === 'synthetos_native', 'backend should reflect native connectorType');
  console.assert(result.connectorConfigId === 'cc_beta_001', 'connectorConfigId still wired through');
  console.assert(result.defaultSignatureTemplate === '', 'non-string defaultSignatureTemplate should default to empty string');
  console.assert(result.discloseAsAgent === false, 'non-boolean discloseAsAgent should default to false');
  console.assert(result.vanityDomain === null, 'non-string vanityDomain should default to null');
  // domain falls through to env fallback (or null) when configJson.domain is wrong-typed
  console.log('Test C passed: wrong-typed fields fall back to defaults');
}

// Test D: unknown connectorType → backend null (defensive against future schema additions)
{
  const result = buildWorkspaceTenantConfig('Gamma Inc', {
    id: 'cc_gamma_001',
    connectorType: 'crm',
    configJson: { domain: 'gamma.io' },
  });

  console.assert(result.backend === null, 'backend should be null for non-workspace connectorType');
  console.assert(result.connectorConfigId === 'cc_gamma_001', 'connectorConfigId surfaced even for non-workspace types');
  console.assert(result.domain === 'gamma.io', 'domain still resolves from configJson regardless of connectorType');
  console.log('Test D passed: unknown connectorType yields null backend');
}

console.log('All tenant-config resolver tests passed.');
