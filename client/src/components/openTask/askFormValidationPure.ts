// Re-export from the shared module so the client and server use one source of
// truth. See `shared/types/askFormValidationPure.ts` for the implementation.
export { validateAskForm, type ValidationResult } from '../../../../shared/types/askFormValidationPure';
