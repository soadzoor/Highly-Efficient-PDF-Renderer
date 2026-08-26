import { Buffer } from "node:buffer";
import { register } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) {
  throw new Error("The PDF-to-HEP dense worker must run inside a Node worker thread.");
}

const moduleUrl = new URL(workerData?.moduleUrl);
if (moduleUrl.protocol !== "file:") {
  throw new TypeError(`The dense PDF worker module must use a file URL: ${moduleUrl.href}`);
}

// Match the small compatibility layer installed by PDFtoHEP.js. Worker
// isolates have their own globals, so the shims must be installed here too.
Promise.try ??= (callback, ...args) => Promise.resolve().then(() => callback(...args));
Uint8Array.prototype.toHex ??= function toHex() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("hex");
};
Uint8Array.prototype.toBase64 ??= function toBase64() {
  return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString("base64");
};
Uint8Array.fromHex ??= (value) => new Uint8Array(Buffer.from(value, "hex"));
Uint8Array.fromBase64 ??= (value) => new Uint8Array(Buffer.from(value, "base64"));

// The existing dense worker is deliberately host-neutral apart from the small
// Web Worker messaging surface. Bridge that surface to Node's parentPort so the
// browser and server paths execute the exact same worker entry and protocol.
Object.defineProperty(globalThis, "self", {
  configurable: true,
  value: {
    addEventListener(type, listener) {
      if (type === "message") {
        parentPort.on("message", (data) => listener({ data }));
      }
    },
    postMessage(message, transfer = []) {
      parentPort.postMessage(message, transfer);
    }
  }
});

// Node 22 can strip TypeScript, but its standard resolver does not add .ts to
// this browser-oriented source graph's extensionless relative imports.
register("./pdf-to-hep-typescript-loader.mjs", import.meta.url, {
  data: { sourceRootUrl: new URL("./", moduleUrl).href }
});

await import(moduleUrl.href);
