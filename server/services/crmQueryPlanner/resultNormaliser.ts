// Result normaliser — impure entry point (spec §15.1)
// Resolves context from DB then delegates to pure functions.

export {
  normaliseToArtefacts,
  buildStructuredResult,
  generateApprovalCards,
  generateSuggestions,
  FALLBACK_SUGGESTIONS,
} from './resultNormaliserPure.js';
export type { NormaliserContext } from './resultNormaliserPure.js';
