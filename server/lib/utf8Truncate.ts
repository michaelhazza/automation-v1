// ---------------------------------------------------------------------------
// utf8Truncate — safely truncate a string to at most `maxBytes` bytes of its
// UTF-8 encoding without producing invalid multi-byte residue.
//
// Used by the parse-failure excerpt capture (spec §6.4) to bound the size of
// `parseFailureRawExcerpt` on `llm_requests` to 2 KB. Naive `.slice(0, N)`
// works on code points, not bytes — a string of emoji gets 4× the expected
// storage. Naive byte truncation (`Buffer.from(s).slice(0, N).toString()`)
// produces the U+FFFD replacement character at the cut point if we sliced
// through a multi-byte sequence.
//
// Strategy: encode once, check the last byte. If it's the start of a
// multi-byte sequence that wasn't completed, back up to the last valid
// boundary. UTF-8 byte classification:
//   0xxxxxxx  — ASCII / final byte of a sequence (always a valid boundary)
//   10xxxxxx  — continuation byte (never a valid boundary as byte-0)
//   11xxxxxx  — start of a 2/3/4-byte sequence
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

export function truncateUtf8Safe(input: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const bytes = encoder.encode(input);
  if (bytes.length <= maxBytes) return input;

  // Back up while the byte at `end` is a continuation byte (10xxxxxx),
  // or while the byte at `end - 1` started a multi-byte sequence that
  // would not fit. The loop runs at most 3 iterations (max UTF-8
  // sequence length is 4 bytes).
  let end = maxBytes;
  while (end > 0) {
    const b = bytes[end];
    // If byte[end] is a continuation byte, we're mid-sequence — back up.
    if ((b & 0xc0) === 0x80) {
      end--;
      continue;
    }
    // byte[end] is now either ASCII or the start of a new sequence.
    // Check that byte[end-1] isn't the start of a multi-byte sequence that
    // extends past our cut point.
    const prev = bytes[end - 1];
    if ((prev & 0x80) === 0) break;                // prev is ASCII — safe
    if ((prev & 0xe0) === 0xc0) { end -= 1; break; }  // prev started a 2-byte seq
    if ((prev & 0xf0) === 0xe0) { end -= 1; break; }  // prev started a 3-byte seq
    if ((prev & 0xf8) === 0xf0) { end -= 1; break; }  // prev started a 4-byte seq
    // prev is a continuation byte — keep backing up
    end--;
  }

  return decoder.decode(bytes.slice(0, end));
}
