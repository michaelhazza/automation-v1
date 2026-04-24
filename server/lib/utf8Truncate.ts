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
// Strategy: encode once, then find the largest `end <= maxBytes` such that
// `bytes[end]` is NOT a continuation byte (0b10xxxxxx). That boundary is
// always safe because the byte at `end-1` either completed a sequence or
// was pure ASCII. The loop runs at most 3 iterations (max UTF-8 sequence
// length is 4 bytes, so at most 3 continuation bytes precede any start).
//
// UTF-8 byte classification:
//   0xxxxxxx  — ASCII / final byte of a sequence (valid boundary AFTER it)
//   10xxxxxx  — continuation byte (NOT a valid byte to land on)
//   11xxxxxx  — start of a 2/3/4-byte sequence (valid boundary BEFORE it)
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

export function truncateUtf8Safe(input: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const bytes = encoder.encode(input);
  if (bytes.length <= maxBytes) return input;

  // Start at the hard budget, then back up until we land on a position
  // that is NOT a continuation byte. That position is always a valid
  // boundary — either ASCII / end-of-sequence (preceded by start byte
  // and its continuations, all complete) or the start of a new sequence
  // (in which case slicing before it leaves the previous sequence intact).
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
    end--;
  }

  return decoder.decode(bytes.slice(0, end));
}
