/** Drain the same row-wise algorithm synchronously in workers, cooperatively on the UI thread. */
export function finishRasterSteps<T>(steps: Generator<void, T>): T {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export async function finishRasterStepsAsync<T>(steps: Generator<void, T>): Promise<T> {
  let started = performance.now(), step = steps.next();
  while (!step.done) {
    if (performance.now() - started >= 4) {
      await new Promise<void>(resolve => setTimeout(resolve, 0)); started = performance.now();
    }
    step = steps.next();
  }
  return step.value;
}
