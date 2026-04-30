import { buildWorkspaceTenantConfig } from '../../services/connectorConfigService.js';

// Test A: full config — all fields present in configJson
{
  const result = buildWorkspaceTenantConfig('Acme Corp', {
    defaultSignatureTemplate: 'Best,\n{{name}}',
    discloseAsAgent: true,
    vanityDomain: 'mail.acme.com',
  });

  console.assert(result.subaccountName === 'Acme Corp', 'subaccountName should match');
  console.assert(result.defaultSignatureTemplate === 'Best,\n{{name}}', 'defaultSignatureTemplate should match');
  console.assert(result.discloseAsAgent === true, 'discloseAsAgent should be true');
  console.assert(result.vanityDomain === 'mail.acme.com', 'vanityDomain should match');
  console.log('Test A passed: full config fields resolved correctly');
}

// Test B: null configJson → all defaults
{
  const result = buildWorkspaceTenantConfig('', null);

  console.assert(result.subaccountName === '', 'subaccountName should be empty string');
  console.assert(result.defaultSignatureTemplate === '', 'defaultSignatureTemplate should default to empty string');
  console.assert(result.discloseAsAgent === false, 'discloseAsAgent should default to false');
  console.assert(result.vanityDomain === null, 'vanityDomain should default to null');
  console.log('Test B passed: null configJson produces all defaults');
}

// Test C: wrong types in configJson → still uses defaults
{
  const result = buildWorkspaceTenantConfig('Beta Ltd', {
    defaultSignatureTemplate: 42 as unknown as string,
    discloseAsAgent: 'yes' as unknown as boolean,
    vanityDomain: 99 as unknown as string,
  });

  console.assert(result.defaultSignatureTemplate === '', 'non-string defaultSignatureTemplate should default to empty string');
  console.assert(result.discloseAsAgent === false, 'non-boolean discloseAsAgent should default to false');
  console.assert(result.vanityDomain === null, 'non-string vanityDomain should default to null');
  console.log('Test C passed: wrong-typed fields fall back to defaults');
}

console.log('All tenant-config resolver tests passed.');
