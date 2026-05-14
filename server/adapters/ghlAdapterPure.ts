export type WithLocationTokenOptions = {
  getToken: () => Promise<string>;
  handle401: () => Promise<string>;
};

export async function withLocationTokenRetry<T>(
  fn: (token: string) => Promise<T>,
  { getToken, handle401 }: WithLocationTokenOptions,
): Promise<T> {
  const token = await getToken();
  try {
    return await fn(token);
  } catch (err) {
    const e = err as { response?: { status?: number }; status?: number; statusCode?: number };
    const status = e.response?.status ?? e.status ?? e.statusCode;
    if (status === 401) {
      const freshToken = await handle401();
      return fn(freshToken);
    }
    throw err;
  }
}
