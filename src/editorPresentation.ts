export interface EditorScenePresentationOptions {
  signal: AbortSignal;
  /** Subscribe after installing the scene; notify only after a draw/submission. */
  subscribe: (notify: () => void) => () => void;
  /** The renderer and installed scene/object must still match this publication. */
  isCurrent: () => boolean;
  /** Runs in the matching frame callback, before the returned promise resolves. */
  onPresented: () => void;
}

/** One transient frame acknowledgement; idle viewers retain no editor listener. */
export async function waitForEditorScenePresentation(options: EditorScenePresentationOptions): Promise<void> {
  options.signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    let settled = false, unsubscribe: (() => void) | undefined;
    const cleanup = () => { options.signal.removeEventListener("abort", onAbort); const release = unsubscribe; unsubscribe = undefined; release?.(); };
    const fail = (error: unknown) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const onAbort = () => fail(options.signal.reason);
    options.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const release = options.subscribe(() => {
        if (settled) return;
        if (options.signal.aborted) { fail(options.signal.reason); return; }
        try {
          if (!options.isCurrent()) throw new DOMException("The displayed document changed before its frame was presented.", "AbortError");
          settled = true; cleanup(); options.onPresented(); resolve();
        } catch (error) { if (!settled) fail(error); else reject(error); }
      });
      if (settled) release(); else unsubscribe = release;
      if (options.signal.aborted) onAbort();
    } catch (error) { fail(error); }
  });
}
