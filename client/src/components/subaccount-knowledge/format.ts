/**
 * Extract a plain-text title from Tiptap HTML / plain text. Used for table
 * previews and the "Rename" affordance (first non-empty line = title).
 */
export function referenceTitle(content: string): string {
  const stripped = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!stripped) return 'Untitled';
  const firstLine = stripped.split('\n')[0];
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

export function referencePreview(content: string): string {
  const stripped = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (stripped.length <= 200) return stripped;
  return `${stripped.slice(0, 200)}…`;
}

/**
 * Rename a Reference by replacing its first <h1> (or falling back to
 * prepending one) with the new title. Used by the Rename modal so the
 * first-line-as-title convention stays consistent across the UI.
 */
export function renameReferenceHtml(currentHtml: string, newTitle: string): string {
  const safe = newTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
  if (!safe) return currentHtml;
  const match = currentHtml.match(/^<h1[^>]*>.*?<\/h1>/i);
  if (match) {
    return currentHtml.replace(match[0], `<h1>${safe}</h1>`);
  }
  return `<h1>${safe}</h1>${currentHtml}`;
}
