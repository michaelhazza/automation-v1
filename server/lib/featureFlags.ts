const readBool = (name: string, fallback: boolean): boolean => {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === '1' || v.toLowerCase() === 'true';
};

export const externalDocFlags = {
  systemDisabled:          readBool('EXTERNAL_DOC_SYSTEM_DISABLED',          false),
  attachEnabled:           readBool('EXTERNAL_DOC_ATTACH_ENABLED',           false),
  resolutionEnabled:       readBool('EXTERNAL_DOC_RESOLUTION_ENABLED',       false),
  failurePoliciesEnabled:  readBool('EXTERNAL_DOC_FAILURE_POLICIES_ENABLED', false),
} as const;
