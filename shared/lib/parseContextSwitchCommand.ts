export interface ContextSwitchCommand {
  entityType: 'org' | 'subaccount' | null; // null = ambiguous, let server decide
  entityName: string;
  remainder: string | null;
}

const SWITCH_VERBS = ['change to', 'switch to', 'go to', 'move to'];
// Longest synonyms first — prevents 'org' matching inside 'organisation'
const ORG_SYNONYMS = ['organisation', 'organization', 'org'];
const SUBACCOUNT_SYNONYMS = ['sub-account', 'subaccount', 'client', 'company'];

export function parseContextSwitchCommand(text: string): ContextSwitchCommand | null {
  // Strip trailing politeness and leading filler words so "can you change to Acme please" works
  const trimmed = text.trim()
    .replace(/\s+(please|thanks)\.?$/i, '')
    .replace(/^(can you|please|hey)\s+/i, '');
  const lower = trimmed.toLowerCase();

  for (const verb of SWITCH_VERBS) {
    if (!lower.startsWith(verb)) continue;

    const afterVerb = trimmed.slice(verb.length).trim();
    const afterVerbLower = afterVerb.toLowerCase();

    for (const synonym of ORG_SYNONYMS) {
      if (afterVerbLower.startsWith(synonym)) {
        const afterType = afterVerb.slice(synonym.length).trim();
        return splitEntityAndRemainder(afterType, 'org');
      }
    }

    for (const synonym of SUBACCOUNT_SYNONYMS) {
      if (afterVerbLower.startsWith(synonym)) {
        const afterType = afterVerb.slice(synonym.length).trim();
        return splitEntityAndRemainder(afterType, 'subaccount');
      }
    }

    // No type keyword — entityType null, server searches both
    return splitEntityAndRemainder(afterVerb, null);
  }

  return null;
}

function splitEntityAndRemainder(
  text: string,
  entityType: 'org' | 'subaccount' | null,
): ContextSwitchCommand {
  const commaIdx = text.indexOf(',');
  // Strip "please" from the entity segment only — handles "change to Acme please, do X"
  // where "please" sits between the name and the comma rather than at the end of the string.
  const rawEntity = commaIdx === -1 ? text : text.slice(0, commaIdx);
  const entityName = rawEntity.replace(/\bplease\b/gi, '').trim();
  if (commaIdx === -1) {
    return { entityType, entityName, remainder: null };
  }
  return {
    entityType,
    entityName,
    remainder: text.slice(commaIdx + 1).trim() || null,
  };
}
