// @principal-context-import-only — reason: registry references canonicalDataService only in handler-classification documentation; future handlers that invoke it must pass fromOrgId(organisationId, subaccountId).
// Registry now lives in ./actionRegistry/ — this file is a re-export shim.
export * from './actionRegistry/index.js';
