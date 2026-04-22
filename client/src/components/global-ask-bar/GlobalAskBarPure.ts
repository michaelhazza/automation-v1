/** Returns true when the text is long enough and not a slash command. */
export function isValidBriefText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length >= 3 && !trimmed.startsWith('/');
}

/** Detects a /remember prefix, returning the rest of the text as a rule candidate. */
export function parseSlashRemember(text: string): { isRemember: boolean; ruleText: string } {
  const trimmed = text.trim();
  if (trimmed.toLowerCase().startsWith('/remember ')) {
    return { isRemember: true, ruleText: trimmed.slice('/remember '.length).trim() };
  }
  return { isRemember: false, ruleText: '' };
}
