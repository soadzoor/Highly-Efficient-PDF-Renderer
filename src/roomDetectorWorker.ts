import { detectRooms } from "./roomDetector";
import type { RoomDetectionRequest, RoomDetectionResponse } from "./roomDetectorClient";

interface RoomDetectorWorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<RoomDetectionRequest>) => void): void;
  postMessage(response: RoomDetectionResponse): void;
}

const scope = globalThis as unknown as RoomDetectorWorkerScope;
scope.addEventListener("message", (event) => {
  try {
    const result = detectRooms(event.data.scene, event.data.options);
    scope.postMessage({ type: "result", result });
  } catch (error) {
    scope.postMessage({
      type: "error",
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
