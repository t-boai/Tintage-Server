const inflightRequests = new Map<string, Promise<any>>();

export const runWithSingleflight = async <T>(
  key: string,
  fn: () => Promise<T>,
  timeoutMs: number = 4000,
): Promise<T> => {
  if (inflightRequests.has(key)) {
    return inflightRequests.get(key) as Promise<T>;
  }

  const executionPromise = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      inflightRequests.delete(key);
      reject(
        new Error(
          `Singleflight quá thời hạn Key: ${key} vượt quá ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    fn()
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      })
      .finally(() => {
        inflightRequests.delete(key);
      });
  });

  inflightRequests.set(key, executionPromise);
  return executionPromise;
};
