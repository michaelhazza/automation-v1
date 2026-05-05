export function logAndSwallow(context: string): (err: unknown) => void {
  return (err: unknown) => {
    // Always emit at console.debug regardless of NODE_ENV so production browsers
    // can still surface swallowed errors when the console is opened. Swallow
    // semantics are unchanged — visibility is the only delta. ChatGPT-Round-1
    // Finding 5.
    console.debug(`[silent-catch] ${context}:`, err);
  };
}

export function surfaceAndRethrow(toast: (msg: string) => void, message: string): (err: unknown) => never {
  return (err: unknown) => {
    toast(message);
    throw err;
  };
}
