import type { PdfMessageEndpoint } from "./rangeTransport";
import {
  attachPdfWorkerRuntime,
  type PdfWorkerRuntime
} from "./workerRuntime";
import type {
  PdfWorkerHostToWorkerMessage,
  PdfWorkerWorkerToHostMessage
} from "./workerProtocol";

interface BrowserWorkerScope {
  readonly document?: never;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<PdfWorkerHostToWorkerMessage>) => void
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<PdfWorkerHostToWorkerMessage>) => void
  ): void;
  postMessage(message: PdfWorkerWorkerToHostMessage, transfer?: Transferable[]): void;
}

interface NodeParentPort {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  on(type: "message", listener: (message: unknown) => void): void;
  off(type: "message", listener: (message: unknown) => void): void;
  once(type: "close", listener: () => void): void;
}

const candidate = globalThis as unknown as Partial<BrowserWorkerScope>;
if (
  typeof candidate.addEventListener === "function" &&
  typeof candidate.postMessage === "function" &&
  !("document" in candidate)
) {
  attachPdfWorkerRuntime(candidate as BrowserWorkerScope);
} else {
  void attachNodeRuntime();
}

async function attachNodeRuntime(): Promise<void> {
  const nodeProcess = (globalThis as {
    readonly process?: { readonly versions?: { readonly node?: string } };
  }).process;
  if (!nodeProcess?.versions?.node) return;
  const moduleName = "node:worker_threads";
  const module = await import(/* @vite-ignore */ moduleName) as unknown as {
    readonly parentPort: NodeParentPort | null;
  };
  if (!module.parentPort) return;
  const endpoint = adaptNodeParentPort(module.parentPort);
  const runtime: PdfWorkerRuntime = attachPdfWorkerRuntime(endpoint);
  module.parentPort.once("close", () => { void runtime.close(); });
}

function adaptNodeParentPort(parentPort: NodeParentPort): PdfMessageEndpoint<
  PdfWorkerHostToWorkerMessage,
  PdfWorkerWorkerToHostMessage
> {
  const wrappers = new Map<
    (event: MessageEvent<PdfWorkerHostToWorkerMessage>) => void,
    (message: unknown) => void
  >();
  return {
    addEventListener(_type, listener) {
      const wrapper = (message: unknown): void => listener({ data: message } as MessageEvent<PdfWorkerHostToWorkerMessage>);
      wrappers.set(listener, wrapper);
      parentPort.on("message", wrapper);
    },
    removeEventListener(_type, listener) {
      const wrapper = wrappers.get(listener);
      if (!wrapper) return;
      wrappers.delete(listener);
      parentPort.off("message", wrapper);
    },
    postMessage(message, transfer) {
      parentPort.postMessage(message, transfer);
    }
  };
}
