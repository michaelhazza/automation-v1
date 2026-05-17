export function crossReferencesLibrarySkill(
  candidateDescription: string | null,
  libraryName: string,
  librarySlug: string,
): boolean {
  if (!candidateDescription) return false;
  const desc  = candidateDescription.toLowerCase();
  const lName = libraryName.toLowerCase();
  const lSlug = librarySlug.toLowerCase().replace(/_/g, '-');
  // Match "see X", "use X", "refer to X", or "for X" where X contains the library label
  const seeRe = /\b(see|use|refer to|for)\b(.{0,60})/g;
  let m: RegExpExecArray | null;
  while ((m = seeRe.exec(desc)) !== null) {
    const ctx = m[2];
    if (ctx.includes(lName) || ctx.includes(lSlug)) return true;
  }
  return false;
}
