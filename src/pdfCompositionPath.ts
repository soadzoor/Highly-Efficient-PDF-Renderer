import { pdfNumber } from "./editorPdfBytes";

/** Absolute path coordinates, in the caller's chosen coordinate system. */
export type PdfPathCommand = readonly ["M", number, number] | readonly ["L", number, number]
  | readonly ["Q", number, number, number, number]
  | readonly ["C", number, number, number, number, number, number] | readonly ["Z"];

function finite(values: readonly number[]): void {
  if (!values.every(Number.isFinite)) throw new RangeError("Path coordinates must be finite numbers.");
}

/** Compile vector paths without flattening curves or changing their coordinates. */
export function pdfPathOperators(commands: readonly PdfPathCommand[]): string {
  const output: string[] = [];
  let x = 0, y = 0, startX = 0, startY = 0, moved = false;
  for (const command of commands) {
    if (!Array.isArray(command)) throw new TypeError("A path command must be a tuple.");
    const kind = command[0], count = kind === "Z" ? 1 : kind === "Q" ? 5 : kind === "C" ? 7 : kind === "M" || kind === "L" ? 3 : 0;
    if (!count || command.length !== count) throw new TypeError("Invalid path command.");
    const values = command.slice(1) as number[]; finite(values);
    if (!moved && kind !== "M") throw new TypeError("A path must begin with a move command.");
    if (kind === "Z") { output.push("h"); x = startX; y = startY; }
    else if (kind === "Q") {
      const [cx, cy, endX, endY] = values;
      // A quadratic Bezier has an exact cubic representation.
      const cubic = [x / 3 + cx * (2 / 3), y / 3 + cy * (2 / 3), endX / 3 + cx * (2 / 3), endY / 3 + cy * (2 / 3), endX, endY];
      finite(cubic); output.push(`${cubic.map(pdfNumber).join(" ")} c`); x = endX; y = endY;
    } else {
      output.push(`${values.map(pdfNumber).join(" ")} ${kind === "M" ? "m" : kind === "L" ? "l" : "c"}`);
      x = values.at(-2)!; y = values.at(-1)!;
      if (kind === "M") { startX = x; startY = y; moved = true; }
    }
  }
  return output.length ? `${output.join("\n")}\n` : "";
}

/** A closed rectangle, with x/y identifying one corner. */
export function pdfRectanglePath(x: number, y: number, width: number, height: number): PdfPathCommand[] {
  finite([x, y, width, height, x + width, y + height]);
  if (width < 0 || height < 0) throw new RangeError("Path dimensions must be nonnegative.");
  return [["M", x, y], ["L", x + width, y], ["L", x + width, y + height], ["L", x, y + height], ["Z"]];
}

/** An ellipse inscribed in the bounds, using the standard four cubic segments. */
export function pdfEllipsePath(x: number, y: number, width: number, height: number): PdfPathCommand[] {
  finite([x, y, width, height, x + width, y + height]);
  if (width < 0 || height < 0) throw new RangeError("Path dimensions must be nonnegative.");
  const rx = width / 2, ry = height / 2, cx = x + rx, cy = y + ry, k = 4 / 3 * Math.tan(Math.PI / 8);
  return [["M", x + width, cy],
    ["C", x + width, cy + k * ry, cx + k * rx, y + height, cx, y + height],
    ["C", cx - k * rx, y + height, x, cy + k * ry, x, cy],
    ["C", x, cy - k * ry, cx - k * rx, y, cx, y],
    ["C", cx + k * rx, y, x + width, cy - k * ry, x + width, cy], ["Z"]];
}

// SVG endpoint-to-center conversion: https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes
function arcPath(x1: number, y1: number, rx: number, ry: number, degrees: number, large: number, sweep: number, x2: number, y2: number): PdfPathCommand[] {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry) return [["L", x2, y2]];
  const phi = degrees % 360 * Math.PI / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = x1 / 2 - x2 / 2, dy = y1 / 2 - y2 / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  let u = xp / rx, v = yp / ry, length = Math.hypot(u, v);
  if (length > 1) { rx *= length; ry *= length; u = xp / rx; v = yp / ry; length = Math.hypot(u, v); }
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, 1 - length * length));
  const cxp = factor * rx * (v / length), cyp = -factor * ry * (u / length);
  const cx = cos * cxp - sin * cyp + x1 / 2 + x2 / 2, cy = sin * cxp + cos * cyp + y1 / 2 + y2 / 2;
  const ax = (xp - cxp) / rx, ay = (yp - cyp) / ry, bx = (-xp - cxp) / rx, by = (-yp - cyp) / ry;
  const angle = Math.atan2(ay, ax);
  let delta = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  finite([rx, ry, cx, cy, angle, delta]);
  // Avoid splitting a quarter turn twice because atan2 rounded it a few ulps up.
  const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 8 * Number.EPSILON)), step = delta / count, output: PdfPathCommand[] = [];
  const point = (a: number): [number, number] => [cx + rx * cos * Math.cos(a) - ry * sin * Math.sin(a), cy + rx * sin * Math.cos(a) + ry * cos * Math.sin(a)];
  const tangent = (a: number): [number, number] => [-rx * cos * Math.sin(a) - ry * sin * Math.cos(a), -rx * sin * Math.sin(a) + ry * cos * Math.cos(a)];
  for (let i = 0; i < count; i++) {
    const a = angle + i * step, b = a + step, p = point(a), q = i === count - 1 ? [x2, y2] : point(b), ta = tangent(a), tb = tangent(b), k = 4 / 3 * Math.tan(step / 4);
    const values = [p[0] + k * ta[0], p[1] + k * ta[1], q[0] - k * tb[0], q[1] - k * tb[1], q[0], q[1]];
    finite(values); output.push(["C", values[0], values[1], values[2], values[3], values[4], values[5]]);
  }
  return output;
}

/**
 * Parse SVG path data into absolute commands. SVG coordinates remain Y-down;
 * callers choose their own placement transform. Arcs become cubic segments.
 */
export function parseSvgPath(d: string): PdfPathCommand[] {
  if (typeof d !== "string") throw new TypeError("SVG path data must be a string.");
  let index = 0, previousNumber = false;
  const whitespace = () => { while (index < d.length && /[\t\n\r\f ]/.test(d[index])) index++; };
  const fail = (): never => { throw new SyntaxError(`Invalid SVG path data at offset ${index}.`); };
  const number = (flag = false): number => {
    whitespace();
    if (d[index] === ",") { if (!previousNumber) fail(); index++; whitespace(); }
    const match = flag ? /^[01]/.exec(d.slice(index)) : /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(index));
    const text = match?.[0] ?? fail();
    index += text.length; previousNumber = true;
    const value = Number(text); finite([value]); return value;
  };
  const output: PdfPathCommand[] = [];
  let command = "", previous = "", x = 0, y = 0, startX = 0, startY = 0, controlX = 0, controlY = 0;
  const append = (value: PdfPathCommand) => { finite(value.slice(1) as number[]); output.push(value); };
  while (true) {
    whitespace(); if (index === d.length) break;
    if (/[a-zA-Z]/.test(d[index])) { command = d[index++]; previousNumber = false; }
    else if (!command) fail();
    const kind = command.toUpperCase(), relative = command !== kind, baseX = relative ? x : 0, baseY = relative ? y : 0;
    if (!output.length && kind !== "M") fail();
    if (kind === "Z") { append(["Z"]); x = startX; y = startY; previous = "Z"; command = ""; continue; }
    if (kind === "M" || kind === "L" || kind === "T") {
      const endX = number() + baseX, endY = number() + baseY;
      if (kind === "T") {
        const reflected = previous === "Q" || previous === "T";
        controlX = reflected ? x + (x - controlX) : x; controlY = reflected ? y + (y - controlY) : y;
        append(["Q", controlX, controlY, endX, endY]);
      } else append([kind, endX, endY]);
      x = endX; y = endY;
      if (kind === "M") { startX = x; startY = y; command = relative ? "l" : "L"; }
    } else if (kind === "H") { x = number() + baseX; append(["L", x, y]); }
    else if (kind === "V") { y = number() + baseY; append(["L", x, y]); }
    else if (kind === "Q") {
      controlX = number() + baseX; controlY = number() + baseY;
      const endX = number() + baseX, endY = number() + baseY;
      append(["Q", controlX, controlY, endX, endY]); x = endX; y = endY;
    } else if (kind === "C" || kind === "S") {
      const reflected = previous === "C" || previous === "S";
      const c1x = kind === "C" ? number() + baseX : reflected ? x + (x - controlX) : x;
      const c1y = kind === "C" ? number() + baseY : reflected ? y + (y - controlY) : y;
      controlX = number() + baseX; controlY = number() + baseY;
      const endX = number() + baseX, endY = number() + baseY;
      append(["C", c1x, c1y, controlX, controlY, endX, endY]); x = endX; y = endY;
    } else if (kind === "A") {
      const rx = number(), ry = number(), rotation = number(), large = number(true), sweep = number(true), endX = number() + baseX, endY = number() + baseY;
      finite([endX, endY]); output.push(...arcPath(x, y, rx, ry, rotation, large, sweep, endX, endY)); x = endX; y = endY;
    } else fail();
    previous = kind;
  }
  return output;
}
