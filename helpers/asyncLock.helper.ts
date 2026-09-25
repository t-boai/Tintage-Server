const inflightRequests = new Map<string, Promise<any>>();

export const runWithSingleflight = async <T>(
  key: string,
  fn: () => Promise<T>,
  timeoutMs: number = 5000,
): Promise<T> => {
  if (inflightRequests.has(key)) {
    return inflightRequests.get(key) as Promise<T>;
  }

  const executionPromise = new Promise<T>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = setTimeout(() => {
      inflightRequests.delete(key);
      reject(
        new Error(`Singleflight Timeout Key: ${key} vượt quá ${timeoutMs}ms`),
      );
    }, timeoutMs);

    Promise.resolve()
      .then(() => fn())
      .then((res) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        resolve(res);
      })
      .catch((err) => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        reject(err);
      })
      .finally(() => {
        inflightRequests.delete(key);
      });
  });

  inflightRequests.set(key, executionPromise);
  return executionPromise;
};
