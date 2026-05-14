// client/src/lib/runTraceEmbeddedPure.ts
//
// Pure utility — no React, no side effects, no imports from other modules.
//
// parseEmbeddedFlag reads the `embedded` query parameter from a URL search
// string and returns true when the value is "1" or "true".
//
// Truthy:   ?embedded=1    ?embedded=true
// Falsy:    (absent)       ?embedded=0    ?embedded=false    ?embedded=   (empty)
//
// When the key appears more than once (e.g. ?embedded=1&embedded=0), the
// URLSearchParams.get() contract returns the FIRST value. Spec allows this
// because only the producing code (RunTraceModal) ever writes the param and
// it always emits a single key.

export function parseEmbeddedFlag(search: string): boolean {
  const params = new URLSearchParams(search);
  const value = params.get('embedded');
  return value === '1' || value === 'true';
}
