export interface EditorFieldActivationCandidate {
  id: string;
  sourceScene: object;
  revision: number;
}

/** Pointer data only: SVG replacement, capture and native click targets are irrelevant. */
export interface EditorFieldActivationPointer {
  button: number;
  pointerId: number;
  pointerType: string;
  isPrimary?: boolean;
  clientX: number;
  clientY: number;
  timeStamp: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

interface Click {
  candidate: EditorFieldActivationCandidate;
  pointerType: string;
  x: number;
  y: number;
  time: number;
}
interface Press extends Click { pointerId: number }

const distanceSquared = (left: { x: number; y: number }, right: { x: number; y: number }): number =>
  (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
const sameCandidate = (left: EditorFieldActivationCandidate, right: EditorFieldActivationCandidate): boolean =>
  left.id === right.id && left.sourceScene === right.sourceScene && left.revision === right.revision;

/** Recognize a pair of stationary Select clicks without native dblclick events or timers. */
export function createEditorFieldActivation() {
  let press: Press | null = null, previous: Click | null = null, lastTime: number | undefined;
  function reset(): void { press = previous = null; lastTime = undefined; }
  function valid(event: EditorFieldActivationPointer): boolean {
    if (![event.clientX, event.clientY, event.timeStamp].every(Number.isFinite) || event.timeStamp < 0 ||
        !Number.isSafeInteger(event.pointerId) || !["mouse", "pen", "touch"].includes(event.pointerType) ||
        event.isPrimary === false || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
        lastTime !== undefined && event.timeStamp < lastTime) { reset(); return false; }
    lastTime = event.timeStamp; return true;
  }
  function candidateValid(candidate: EditorFieldActivationCandidate | null): candidate is EditorFieldActivationCandidate {
    return candidate !== null && typeof candidate.id === "string" && candidate.id.length > 0 &&
      candidate.sourceScene !== null && typeof candidate.sourceScene === "object" &&
      Number.isSafeInteger(candidate.revision) && candidate.revision >= 0;
  }
  return {
    pointerDown(event: EditorFieldActivationPointer, candidate: EditorFieldActivationCandidate | null): void {
      if (press) { reset(); return; }
      if (!valid(event)) return;
      if (event.button !== 0 || !candidateValid(candidate)) { reset(); return; }
      if (previous && (!sameCandidate(previous.candidate, candidate) || previous.pointerType !== event.pointerType ||
          event.timeStamp - previous.time > 500)) previous = null;
      press = { candidate: { id: candidate.id, sourceScene: candidate.sourceScene, revision: candidate.revision },
        pointerId: event.pointerId, pointerType: event.pointerType, x: event.clientX, y: event.clientY, time: event.timeStamp };
    },
    pointerMove(event: EditorFieldActivationPointer): void {
      if (!valid(event)) return;
      if (event.button !== -1 && event.button !== 0) { reset(); return; }
      if (press && (press.pointerId !== event.pointerId || press.pointerType !== event.pointerType ||
          distanceSquared(press, { x: event.clientX, y: event.clientY }) > 4)) reset();
    },
    pointerUp(event: EditorFieldActivationPointer): EditorFieldActivationCandidate | null {
      if (!valid(event)) return null;
      const current = press; press = null;
      if (!current || event.button !== 0 || event.pointerId !== current.pointerId || event.pointerType !== current.pointerType ||
          distanceSquared(current, { x: event.clientX, y: event.clientY }) > 4) { reset(); return null; }
      const click: Click = { candidate: current.candidate, pointerType: current.pointerType,
        x: event.clientX, y: event.clientY, time: event.timeStamp };
      if (previous && sameCandidate(previous.candidate, click.candidate) && previous.pointerType === click.pointerType &&
          click.time - previous.time <= 500 && distanceSquared(previous, click) <= 16) {
        reset(); return { ...click.candidate };
      }
      previous = click; return null;
    },
    reset
  };
}
