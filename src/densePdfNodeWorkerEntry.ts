import type {
  DensePdfFastWorkerRequest,
  DensePdfFastWorkerResponse
} from "./densePdfFastWorkerClient";

interface NodeParentPort {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  on(type: "message", listener: (message: unknown) => void): void;
}

interface DensePdfNodeWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<DensePdfFastWorkerRequest>) => void
  ): void;
  postMessage(message: DensePdfFastWorkerResponse, transfer?: Transferable[]): void;
}

const nodeProcess = (globalThis as {
  readonly process?: { readonly versions?: { readonly node?: string } };
}).process;
if (!nodeProcess?.versions?.node) {
  throw new Error("The dense PDF Node worker entry requires Node.js.");
}

const moduleName = "node:worker_threads";
const module = await import(/* @vite-ignore */ moduleName) as unknown as {
  readonly parentPort: NodeParentPort | null;
};
if (!module.parentPort) {
  throw new Error("The dense PDF Node worker entry requires a worker_threads parent port.");
}

const parentPort = module.parentPort;
const workerScope: DensePdfNodeWorkerScope = {
  addEventListener(_type, listener) {
    parentPort.on("message", (data) => {
      listener({ data } as MessageEvent<DensePdfFastWorkerRequest>);
    });
  },
  postMessage(message, transfer) {
    parentPort.postMessage(message, transfer);
  }
};

Object.defineProperty(globalThis, "self", {
  configurable: true,
  value: workerScope
});

await import("./densePdfFastWorker");
