import { createEmptyVectorScene } from "./emptyVectorScene";
import { prepareVectorStrokeLodData } from "./vectorStrokeLodCore";
import { setStrokePaintGroups, setStrokePaintOrigins } from "./vectorStrokePaintOrder";
import { buildTextLodAsync } from "./textGreekLod";
import type { LodWorkerRequest, LodWorkerResponse } from "./lodWorkerClient";

interface LodWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<LodWorkerRequest>) => void): void;
  postMessage(response: LodWorkerResponse, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as LodWorkerScope;
scope.addEventListener("message", async (event) => {
  try {
    const request = event.data;
    const scene = { ...createEmptyVectorScene(), ...request.scene };
    const onProgress = ({ value, message }: { value: number; message: string }): void => {
      scope.postMessage({ type: "progress", value, message });
    };
    let response: LodWorkerResponse;
    if (request.type === "vector") {
      setStrokePaintOrigins(scene, request.origins);
      setStrokePaintGroups(scene, request.paintGroups);
      response = { type: "vector",
        result: await prepareVectorStrokeLodData(scene, request.stored, request.overviewAllowed, { onProgress }) };
    } else response = { type: "text", result: await buildTextLodAsync(scene, { onProgress }) };
    const buffers = new Set<ArrayBuffer>();
    const collect = (value: unknown): void => {
      if (ArrayBuffer.isView(value)) {
        if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
      } else if (value && typeof value === "object") {
        for (const child of Object.values(value)) collect(child);
      }
    };
    collect(response);
    scope.postMessage(response, [...buffers]);
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
});
