/**
 * csvParser.ts — minimal RFC 4180 CSV parser for diff mode selection.
 *
 * Returns a 2D string array. Rows are split on newlines; fields on commas.
 * Handles double-quoted fields (including embedded quotes and newlines).
 *
 * Intended for small files (task deliverable text). Not optimised for
 * streaming or multi-MB files.
 */

/**
 * Parse a CSV string into a 2D array of string cells.
 *
 * Empty input returns an empty array.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuote = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Escaped double-quote inside a quoted field.
          cell += '"';
          i += 2;
        } else {
          // End of quoted field.
          inQuote = false;
          i++;
        }
      } else {
        cell += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
        i++;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
        i++;
      } else if (ch === '\r') {
        // CR LF or standalone CR
        row.push(cell);
        cell = '';
        rows.push(row);
        row = [];
        i++;
        if (text[i] === '\n') i++;
      } else if (ch === '\n') {
        row.push(cell);
        cell = '';
        rows.push(row);
        row = [];
        i++;
      } else {
        cell += ch;
        i++;
      }
    }
  }

  // Flush the last cell and row.
  if (cell || row.length > 0) {
    row.push(cell);
  }
  if (row.length > 0) {
    rows.push(row);
  }

  // Remove trailing empty row that results from a trailing newline.
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') {
      rows.pop();
    }
  }

  return rows;
}
