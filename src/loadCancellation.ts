/** Wait for non-cancellable host work while observing (and draining) its result. */
export function waitForLoad<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(signal.aborted ? signal.reason : error);
      }
    );
    if (signal.aborted) onAbort();
  });
}

/** Yield before GPU allocation; cancellation also works in a background tab. */
export async function yieldForLoad(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  let cancel: () => void = () => {};
  const frame = new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      const id = requestAnimationFrame(() => resolve());
      cancel = () => cancelAnimationFrame(id);
    } else {
      const id = setTimeout(resolve, 0);
      cancel = () => clearTimeout(id);
    }
  });
  try {
    await waitForLoad(frame, signal);
  } finally {
    cancel();
  }
}
