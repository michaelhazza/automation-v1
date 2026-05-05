export function logAndSwallow(context: string): (err: unknown) => void {
  return (err: unknown) => {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[silent-catch] ${context}:`, err);
    }
  };
}

export function surfaceAndRethrow(toast: (msg: string) => void, message: string): (err: unknown) => never {
  return (err: unknown) => {
    toast(message);
    throw err;
  };
}
