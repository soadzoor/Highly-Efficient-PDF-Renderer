import type { NativeGlyphPathCommand, NativeGlyphPostScriptClip, NativeGlyphPostScriptPaint,
  NativeGlyphPostScriptFinalState, NativeGlyphPostScriptStrokeField } from "./nativeFont";
import { nativeFontPostScriptIdentityMatrix, nativeFontPostScriptTransform,
  nativeFontPostScriptConcatMatrices } from "./nativeFontPostScriptMatrix";
import type { NativeFontPostScriptMatrix } from "./nativeFontPostScriptMatrix";
import { PdfError, throwIfAborted } from "./nativeTypes";
import type { PdfDiagnostic } from "./nativeTypes";

type Point = readonly [number, number];
type Rectangle = readonly [number, number, number, number];
type Stroke = NonNullable<NativeGlyphPostScriptPaint["stroke"]>;
type Color = NativeGlyphPostScriptPaint["color"];
type SourceColor = { readonly space: "DeviceGray" | "DeviceRGB" | "DeviceCMYK"; readonly values: readonly number[]; readonly hsb?: readonly [number, number, number] };
export interface NativeFontPostScriptGraphicsState {
  readonly commands: readonly NativeGlyphPathCommand[];
  readonly currentPoint: Point | null;
  readonly startPoint: Point | null;
  readonly pathOpen: boolean;
  readonly clips: readonly NativeGlyphPostScriptClip[];
  readonly stroke: Stroke;
  readonly color: Color;
  readonly sourceColor: SourceColor | null;
  readonly changedStrokeFields: readonly NativeGlyphPostScriptStrokeField[];
  /** Present on VM save snapshots; ordinary gsave records omit this stack. */
  readonly savedStates?: readonly NativeFontPostScriptGraphicsState[];
}
export interface NativeFontPostScriptGlyphMetrics {
  readonly width: Point;
  readonly bbox?: Rectangle;
}
export interface NativeFontPostScriptGraphicsOptions {
  readonly signal?: AbortSignal;
  readonly maxPathCommands?: number;
}
export interface NativeFontPostScriptImageOptions {
  readonly width: number;
  readonly height: number;
  readonly bitsPerComponent: 1 | 2 | 4 | 8 | 12;
  readonly components: 1 | 3 | 4;
  readonly data: Uint8Array;
  readonly decode?: readonly number[];
  readonly imageMatrix: NativeFontPostScriptMatrix;
  readonly ctm: NativeFontPostScriptMatrix;
  readonly mask?: boolean;
  readonly polarity?: boolean;
  readonly interpolate?: boolean;
}

/** Glyph-local PostScript graphics (PLRM chapters 4 and 8). Path coordinates
 * are retained in the glyph's canonical space, independent of later CTMs.
 * Explicit paints remain ordered records: clipping, even-odd winding, color
 * changes and device hairlines cannot be represented by one filled outline.
 */
export class NativeFontPostScriptGlyphContext {
  private readonly options: NativeFontPostScriptGraphicsOptions;
  private commands: NativeGlyphPathCommand[] = [];
  private point: Point | null = null;
  private start: Point | null = null;
  private open = false;
  private clips: readonly NativeGlyphPostScriptClip[] = Object.freeze([]);
  private stroke: Stroke = Object.freeze({ width: 1, lineCap: 0, lineJoin: 0, miterLimit: 10,
    dashArray: Object.freeze([]), dashPhase: 0, transform: nativeFontPostScriptIdentityMatrix() });
  private paintColor: Color = null;
  private sourceColor: SourceColor | null = null;
  private changedStrokeFields = new Set<NativeGlyphPostScriptStrokeField>();
  private readonly paints: NativeGlyphPostScriptPaint[] = [];
  private retainedCommands = 0;
  private readonly states: NativeFontPostScriptGraphicsState[] = [];
  private readonly notices: PdfDiagnostic[] = [];
  private readonly noticeCodes = new Set<string>();
  private glyphMetrics: NativeFontPostScriptGlyphMetrics | undefined;

  constructor(options: NativeFontPostScriptGraphicsOptions = {}) {
    this.options = options;
    if (options.maxPathCommands !== undefined && (!Number.isSafeInteger(options.maxPathCommands) || options.maxPathCommands < 0)) {
      throw new RangeError("PostScript graphics maxPathCommands must be a nonnegative safe integer.");
    }
  }
  get pathCommands(): readonly NativeGlyphPathCommand[] { return Object.freeze([...this.commands]); }
  get rawCurrentPoint(): Point | null { return this.point; }
  get pathOpen(): boolean { return this.open; }
  get paintRecords(): readonly NativeGlyphPostScriptPaint[] { return Object.freeze([...this.paints]); }
  get diagnostics(): readonly PdfDiagnostic[] { return Object.freeze([...this.notices]); }
  get metrics(): NativeFontPostScriptGlyphMetrics | undefined { return this.glyphMetrics; }
  get strokeStyle(): Stroke { return this.stroke; }
  get color(): Color { return this.paintColor; }
  get finalState(): NativeGlyphPostScriptFinalState | undefined {
    const transformed = this.stroke.transform.some((value, index) => value !== (index === 0 || index === 3 ? 1 : 0));
    if (!this.clips.length && this.paintColor === null && !this.changedStrokeFields.size && !transformed) return undefined;
    return Object.freeze({ clips: this.clips, color: this.paintColor,
      ...(this.changedStrokeFields.size || transformed ? { stroke: this.stroke,
        changedStrokeFields: Object.freeze([...this.changedStrokeFields]) } : {}) });
  }
  setCurrentMatrix(matrix: NativeFontPostScriptMatrix): void {
    matrix.forEach(finite);
    this.stroke = Object.freeze({ ...this.stroke, transform: Object.freeze([...matrix]) });
  }
  noteCharStringPath(): void {
    if (this.stroke.transform.some((value, index) => value !== (index === 0 || index === 3 ? 1 : 0))) {
      this.notice("font.postscript-charstring-ctm-approximated", "A font-local PostScript matrix change remains active before further Type1 path operators; the native charstring coordinates retain their original glyph space.");
    }
  }
  get sourceColorSpace(): SourceColor["space"] | null { return this.sourceColor?.space ?? null; }
  get sourceColorValues(): readonly number[] | null { return this.sourceColor?.values ?? null; }
  get currentRGB(): readonly [number, number, number] {
    if (!this.paintColor) throw unsupported("The enclosing PDF glyph color is unavailable during cached font execution.", "currentrgbcolor");
    return Object.freeze([this.paintColor[0], this.paintColor[1], this.paintColor[2]]);
  }
  get currentGray(): number { if (this.sourceColor?.space === "DeviceGray") return this.sourceColor.values[0]; const [r, g, b] = this.currentRGB; return 0.3 * r + 0.59 * g + 0.11 * b; }
  get currentCMYK(): readonly [number, number, number, number] {
    if (this.sourceColor?.space === "DeviceCMYK") return this.sourceColor.values as readonly [number, number, number, number];
    const [r, g, b] = this.currentRGB, c = 1 - r, m = 1 - g, y = 1 - b, k = Math.min(c, m, y);
    return Object.freeze([c - k, m - k, y - k, k]);
  }
  get currentHSB(): readonly [number, number, number] {
    if (this.sourceColor?.hsb) return this.sourceColor.hsb;
    const [r, g, b] = this.currentRGB, high = Math.max(r, g, b), low = Math.min(r, g, b), delta = high - low;
    const hue = delta === 0 ? 0 : high === r ? ((g - b) / delta + 6) % 6 : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return Object.freeze([hue / 6, high === 0 ? 0 : delta / high, high]);
  }

  replacePath(commands: readonly NativeGlyphPathCommand[], currentPoint?: Point | null): void {
    this.commands = []; this.point = this.start = null; this.open = false;
    for (const command of commands) {
      this.append(command);
      if (command.kind === "move") { this.start = this.point = point(command.x, command.y); this.open = true; }
      else if (command.kind === "close") { this.point = this.start; this.open = false; }
      else this.point = point(command.x, command.y);
    }
    if (currentPoint !== undefined) this.point = currentPoint === null ? null : point(...currentPoint);
  }
  currentPoint(matrix: NativeFontPostScriptMatrix): Point {
    if (!this.point) throw unsupported("PostScript currentpoint requires a current point.", "nocurrentpoint");
    return nativeFontPostScriptTransform(...this.point, matrix, false, true);
  }
  moveTo(x: number, y: number, matrix: NativeFontPostScriptMatrix, relative = false): void {
    const destination = this.destination(x, y, matrix, relative);
    this.append({ kind: "move", x: destination[0], y: destination[1] });
    this.start = this.point = destination; this.open = true;
  }
  lineTo(x: number, y: number, matrix: NativeFontPostScriptMatrix, relative = false): void {
    if (!this.point) throw unsupported("PostScript lineto requires a current point.", "nocurrentpoint");
    const destination = this.destination(x, y, matrix, relative);
    this.ensureOpen(); this.append({ kind: "line", x: destination[0], y: destination[1] }); this.point = destination;
  }
  curveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number,
    matrix: NativeFontPostScriptMatrix, relative = false): void {
    if (!this.point) throw unsupported("PostScript curveto requires a current point.", "nocurrentpoint");
    const c1 = this.destination(c1x, c1y, matrix, relative), c2 = this.destination(c2x, c2y, matrix, relative);
    const destination = this.destination(x, y, matrix, relative);
    this.ensureOpen(); this.append({ kind: "cubic", control1X: c1[0], control1Y: c1[1],
      control2X: c2[0], control2Y: c2[1], x: destination[0], y: destination[1] }); this.point = destination;
  }
  closePath(): void {
    if (!this.point || !this.start) return;
    if (this.open) this.append({ kind: "close" });
    this.point = this.start; this.open = false;
  }
  newPath(): void { this.commands = []; this.point = this.start = null; this.open = false; }

  arc(cx: number, cy: number, radius: number, start: number, end: number,
    matrix: NativeFontPostScriptMatrix, clockwise = false): void {
    finite(cx); finite(cy); finite(radius); finite(start); finite(end);
    if (radius < 0) throw unsupported("A PostScript arc radius cannot be negative.", "rangecheck");
    let sweep = end - start;
    if (!Number.isFinite(sweep)) throw unsupported("PostScript arc angles exceed representable precision.", "rangecheck");
    if (clockwise) { if (sweep > 0) sweep = sweep % 360 === 0 ? 0 : sweep % 360 - 360; sweep = Math.max(sweep, -360); }
    else { if (sweep < 0) sweep = (sweep % 360 + 360) % 360; sweep = Math.min(sweep, 360); }
    const radians = (start % 360) * Math.PI / 180;
    const sx = cx + radius * Math.cos(radians), sy = cy + radius * Math.sin(radians);
    if (this.point) this.lineTo(sx, sy, matrix); else this.moveTo(sx, sy, matrix);
    if (sweep === 0 || radius === 0) return;
    // Cubic arc segments follow the usual tangent construction. Bound the
    // geometric approximation in raw glyph space; no segment-count ceiling.
    const scale = Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3]));
    const angleLimit = Math.min(Math.PI / 2, (0.01 / Math.max(radius * scale, Number.MIN_VALUE)) ** (1 / 6));
    const pieces = Math.max(1, Math.ceil(Math.abs(sweep) * Math.PI / 180 / angleLimit));
    if (!Number.isSafeInteger(pieces)) throw new PdfError("resource-limit", "PostScript arc subdivision count is not representable.");
    const delta = sweep * Math.PI / 180 / pieces;
    for (let index = 0; index < pieces; index++) {
      throwIfAborted(this.options.signal);
      const a = radians + index * delta, b = a + delta, k = 4 / 3 * Math.tan(delta / 4);
      this.curveTo(cx + radius * (Math.cos(a) - k * Math.sin(a)), cy + radius * (Math.sin(a) + k * Math.cos(a)),
        cx + radius * (Math.cos(b) + k * Math.sin(b)), cy + radius * (Math.sin(b) - k * Math.cos(b)),
        cx + radius * Math.cos(b), cy + radius * Math.sin(b), matrix);
    }
    this.notice("font.postscript-arc-approximation", "PostScript circular arcs use cubic vector curves with at most 0.01 glyph-space units of geometric approximation.");
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number,
    matrix: NativeFontPostScriptMatrix): readonly [number, number, number, number] {
    const [x0, y0] = this.currentPoint(matrix); finite(x1); finite(y1); finite(x2); finite(y2); finite(radius);
    if (radius < 0) throw unsupported("A PostScript arcto radius cannot be negative.", "rangecheck");
    const a = Math.hypot(x0 - x1, y0 - y1), b = Math.hypot(x2 - x1, y2 - y1);
    if (a === 0 || b === 0) throw unsupported("PostScript arcto has coincident defining points.", "undefinedresult");
    const ux = (x0 - x1) / a, uy = (y0 - y1) / a, vx = (x2 - x1) / b, vy = (y2 - y1) / b;
    const cross = ux * vy - uy * vx, dot = Math.max(-1, Math.min(1, ux * vx + uy * vy));
    if (cross === 0 || radius === 0) { this.lineTo(x1, y1, matrix); return Object.freeze([x1, y1, x1, y1]); }
    const distance = radius / Math.tan(Math.acos(dot) / 2);
    const ax = x1 + distance * ux, ay = y1 + distance * uy, bx = x1 + distance * vx, by = y1 + distance * vy;
    const direction = cross < 0 ? 1 : -1;
    const cx = ax + direction * uy * radius, cy = ay - direction * ux * radius;
    this.lineTo(ax, ay, matrix);
    this.arc(cx, cy, radius, Math.atan2(ay - cy, ax - cx) * 180 / Math.PI,
      Math.atan2(by - cy, bx - cx) * 180 / Math.PI, matrix, direction < 0);
    return Object.freeze([finite(ax), finite(ay), finite(bx), finite(by)]);
  }

  pathElements(matrix: NativeFontPostScriptMatrix): readonly NativeGlyphPathCommand[] {
    return transformCommands(this.commands, inverse(matrix));
  }
  pathBBox(matrix: NativeFontPostScriptMatrix): Rectangle {
    if (!this.commands.length) throw unsupported("PostScript pathbbox requires a current path.", "nocurrentpoint");
    const commands = this.pathElements(matrix); let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    for (const command of commands) if (command.kind !== "close") {
      include(command.x, command.y);
      // PLRM pathbbox permits the control-point hull, unlike ink bounds.
      if (command.kind === "quadratic") include(command.controlX, command.controlY);
      else if (command.kind === "cubic") { include(command.control1X, command.control1Y); include(command.control2X, command.control2Y); }
    }
    return Object.freeze([minX, minY, maxX, maxY]);
  }
  flattenPath(): void {
    const output: NativeGlyphPathCommand[] = []; let current: Point | null = null;
    const append = (command: NativeGlyphPathCommand) => { this.checkCount(output.length + 1); output.push(Object.freeze(command)); };
    for (const command of this.commands) {
      throwIfAborted(this.options.signal);
      if (command.kind === "move" || command.kind === "line") { append(command); current = point(command.x, command.y); }
      else if (command.kind === "close") append(command);
      else {
        if (!current) throw unsupported("A PostScript curve has no current point.", "nocurrentpoint");
        const controls: Point[] = command.kind === "quadratic" ? [current, point(command.controlX, command.controlY), point(command.x, command.y)]
          : [current, point(command.control1X, command.control1Y), point(command.control2X, command.control2Y), point(command.x, command.y)];
        const pending = [controls];
        while (pending.length) {
          throwIfAborted(this.options.signal);
          const curve = pending.pop()!, first = curve[0], last = curve[curve.length - 1];
          if (curve.slice(1, -1).every(control => distanceToLine(control, first, last) <= 0.01)) {
            append({ kind: "line", x: last[0], y: last[1] }); continue;
          }
          const left = [first], right = [last]; let row = curve;
          while (row.length > 1) { row = row.slice(1).map((item, index) => point((row[index][0] + item[0]) / 2, (row[index][1] + item[1]) / 2)); left.push(row[0]); right.push(row[row.length - 1]); }
          right.reverse();
          if (left.every((item, i) => item[0] === curve[i][0] && item[1] === curve[i][1]) || right.every((item, i) => item[0] === curve[i][0] && item[1] === curve[i][1])) {
            append({ kind: "line", x: last[0], y: last[1] }); continue;
          }
          pending.push(right, left);
        }
        current = point(command.x, command.y);
      }
    }
    this.commands = output;
    this.notice("font.postscript-flattenpath-approximation", "PostScript flattenpath uses vector lines within 0.01 glyph-space units of the source curve.");
  }
  reversePath(): void {
    const output: NativeGlyphPathCommand[] = [];
    let contour: { command: NativeGlyphPathCommand; from: Point }[] = [], first: Point | null = null, current: Point | null = null;
    const finish = (closed: boolean) => {
      if (!first) return;
      const last = current ?? first; output.push(Object.freeze({ kind: "move", x: last[0], y: last[1] }));
      for (let i = contour.length - 1; i >= 0; i--) {
        const { command, from } = contour[i];
        if (command.kind === "cubic") output.push(Object.freeze({ kind: "cubic", control1X: command.control2X, control1Y: command.control2Y,
          control2X: command.control1X, control2Y: command.control1Y, x: from[0], y: from[1] }));
        else if (command.kind === "quadratic") output.push(Object.freeze({ kind: "quadratic", controlX: command.controlX, controlY: command.controlY, x: from[0], y: from[1] }));
        else output.push(Object.freeze({ kind: "line", x: from[0], y: from[1] }));
      }
      if (closed) output.push(Object.freeze({ kind: "close" }));
      contour = []; first = current = null;
    };
    for (const command of this.commands) {
      throwIfAborted(this.options.signal);
      if (command.kind === "move") { finish(false); first = current = point(command.x, command.y); }
      else if (command.kind === "close") finish(true);
      else { if (!current) throw unsupported("A PostScript segment has no current point.", "nocurrentpoint"); contour.push({ command, from: current }); current = point(command.x, command.y); }
    }
    finish(false); this.replacePath(output);
  }

  setLineWidth(width: number): void { this.stroke = Object.freeze({ ...this.stroke, width: Math.abs(finite(width)) }); this.changedStrokeFields.add("width"); }
  setLineCap(lineCap: number): void { if (lineCap !== 0 && lineCap !== 1 && lineCap !== 2) throw unsupported("Invalid PostScript line cap.", "rangecheck"); this.stroke = Object.freeze({ ...this.stroke, lineCap }); this.changedStrokeFields.add("lineCap"); }
  setLineJoin(lineJoin: number): void { if (lineJoin !== 0 && lineJoin !== 1 && lineJoin !== 2) throw unsupported("Invalid PostScript line join.", "rangecheck"); this.stroke = Object.freeze({ ...this.stroke, lineJoin }); this.changedStrokeFields.add("lineJoin"); }
  setMiterLimit(miterLimit: number): void { if (finite(miterLimit) < 1) throw unsupported("Invalid PostScript miter limit.", "rangecheck"); this.stroke = Object.freeze({ ...this.stroke, miterLimit }); this.changedStrokeFields.add("miterLimit"); }
  setDash(dashArray: readonly number[], dashPhase: number): void {
    finite(dashPhase); for (const value of dashArray) if (finite(value) < 0) throw unsupported("Negative PostScript dash length.", "rangecheck");
    if (dashArray.length && !dashArray.some(value => value > 0)) throw unsupported("PostScript dash array cannot be all zero.", "rangecheck");
    this.stroke = Object.freeze({ ...this.stroke, dashArray: Object.freeze([...dashArray]), dashPhase });
    this.changedStrokeFields.add("dashArray"); this.changedStrokeFields.add("dashPhase");
  }
  setColorRGB(r: number, g: number, b: number): void {
    const values = Object.freeze([unit(r), unit(g), unit(b)]); this.paintColor = Object.freeze([...values, 1]) as NonNullable<Color>;
    this.sourceColor = Object.freeze({ space: "DeviceRGB", values });
  }
  setColorGray(gray: number): void {
    gray = unit(gray); this.paintColor = Object.freeze([gray, gray, gray, 1]);
    this.sourceColor = Object.freeze({ space: "DeviceGray", values: Object.freeze([gray]) });
  }
  setColorCMYK(c: number, m: number, y: number, k: number): void {
    c = unit(c); m = unit(m); y = unit(y); k = unit(k);
    this.paintColor = Object.freeze([1 - Math.min(1, c + k), 1 - Math.min(1, m + k), 1 - Math.min(1, y + k), 1]);
    this.sourceColor = Object.freeze({ space: "DeviceCMYK", values: Object.freeze([c, m, y, k]) });
  }
  setColorHSB(h: number, s: number, b: number): void {
    h = unit(h); s = unit(s); b = unit(b); const sector = h * 6, index = Math.floor(sector) % 6, fraction = sector - Math.floor(sector);
    const p = b * (1 - s), q = b * (1 - s * fraction), t = b * (1 - s * (1 - fraction));
    const rgb = [[b, t, p], [q, b, p], [p, b, t], [p, q, b], [t, p, b], [b, p, q]][index];
    this.paintColor = Object.freeze([rgb[0], rgb[1], rgb[2], 1]);
    const hsb: readonly [number, number, number] = Object.freeze([h, s, b]);
    this.sourceColor = Object.freeze({ space: "DeviceRGB", values: Object.freeze(rgb), hsb });
  }
  paint(kind: "fill" | "eofill" | "stroke", matrix: NativeFontPostScriptMatrix): void {
    throwIfAborted(this.options.signal);
    if (this.commands.some(command => command.kind !== "move" && command.kind !== "close")) this.paints.push(Object.freeze({
      kind: kind === "stroke" ? "stroke" : "fill", commands: this.pathCommands, fillRule: kind === "eofill" ? 1 : 0,
      clips: this.clips, color: this.paintColor,
      ...(kind === "stroke" ? { stroke: Object.freeze({ ...this.stroke, transform: Object.freeze([...matrix]) }),
        changedStrokeFields: Object.freeze([...this.changedStrokeFields]) } : {})
    }));
    if (this.commands.some(command => command.kind !== "move" && command.kind !== "close")) this.retainedCommands += this.commands.length;
    this.newPath();
  }
  clip(fillRule: 0 | 1): void {
    this.checkCount(this.commands.length * 2);
    this.clips = Object.freeze([...this.clips, Object.freeze({ commands: this.pathCommands, fillRule })]);
    this.retainedCommands += this.commands.length;
  }
  /** Sampled glyph images lower to exact pixel rectangles, coalescing equal
   * horizontal runs across adjacent rows. Stencils inherit the current paint.
   * Image operators do not consume or otherwise change the current path.
   */
  image(options: NativeFontPostScriptImageOptions): void {
    const { width, height, bitsPerComponent: bits, components, data } = options;
    if (!Number.isSafeInteger(width) || width < 0 || !Number.isSafeInteger(height) || height < 0 ||
      ![1, 2, 4, 8, 12].includes(bits) || ![1, 3, 4].includes(components) || !(data instanceof Uint8Array) ||
      (options.mask && (bits !== 1 || components !== 1))) throw unsupported("Invalid PostScript glyph image dimensions or samples.", "rangecheck");
    if (width === 0 || height === 0) return;
    const rowBytes = Math.ceil(width * components * bits / 8), needed = rowBytes * height;
    if (!Number.isSafeInteger(needed)) throw new PdfError("resource-limit", "PostScript glyph image byte count is not representable.");
    const decode = options.decode ?? Array.from({ length: components * 2 }, (_, index) => index % 2);
    if (decode.length !== components * 2 || decode.some(value => !Number.isFinite(value))) throw unsupported("Invalid PostScript image Decode array.", "rangecheck");
    const transform = nativeFontPostScriptConcatMatrices(inverse(options.imageMatrix), options.ctm);
    const maximum = 2 ** bits - 1;
    type Rect = { left: number; right: number; bottom: number; top: number };
    const groups = new Map<string, { color: Color; rectangles: Rect[] }>();
    let previous = new Map<string, Rect>(), rectangleCount = 0;
    const sample = (bit: number): number | null => {
      if (bit + bits > data.length * 8) return null;
      let value = 0;
      for (let offset = 0; offset < bits; offset++) value = value * 2 + ((data[Math.floor((bit + offset) / 8)] >>> (7 - ((bit + offset) % 8))) & 1);
      return value;
    };
    const pixel = (x: number, y: number): { key: string; color: Color } | null => {
      const values: number[] = [];
      for (let component = 0; component < components; component++) {
        const value = sample(y * rowBytes * 8 + (x * components + component) * bits);
        if (value === null) return null;
        values.push(unit(decode[component * 2] + value / maximum * (decode[component * 2 + 1] - decode[component * 2])));
        if (options.mask) return value === (options.polarity === false ? 0 : 1) ? { key: "mask", color: this.paintColor } : null;
      }
      const rgb = components === 1 ? [values[0], values[0], values[0]] : components === 3 ? values
        : [1 - Math.min(1, values[0] + values[3]), 1 - Math.min(1, values[1] + values[3]), 1 - Math.min(1, values[2] + values[3])];
      return { key: rgb.join(","), color: Object.freeze([rgb[0], rgb[1], rgb[2], 1]) };
    };
    for (let y = 0; y < height && y * rowBytes < data.length; y++) {
      throwIfAborted(this.options.signal); const current = new Map<string, Rect>();
      let run: { key: string; color: Color } | null = null, left = 0, runKey: string | undefined;
      const finish = (right: number) => {
        if (!run) return;
        const key = `${left}:${right}:${run.key}`, existing = previous.get(key);
        if (existing) { existing.top = y + 1; current.set(key, existing); return; }
        this.checkCount(this.commands.length + (rectangleCount + 1) * 5); rectangleCount++;
        const rectangle = { left, right, bottom: y, top: y + 1 }; current.set(key, rectangle);
        let group = groups.get(run.key);
        if (!group) { group = { color: run.color, rectangles: [] }; groups.set(run.key, group); }
        group.rectangles.push(rectangle);
      };
      const availableWidth = Math.min(width, Math.floor((data.length - y * rowBytes) * 8 / (components * bits)));
      for (let x = 0; x <= availableWidth; x++) {
        if ((x & 255) === 0) throwIfAborted(this.options.signal);
        const next = x === availableWidth ? null : pixel(x, y);
        if (next?.key !== runKey) { finish(x); run = next; runKey = next?.key; left = x; }
      }
      previous = current;
    }
    for (const group of groups.values()) {
      const commands: NativeGlyphPathCommand[] = [];
      for (const rect of group.rectangles) {
        throwIfAborted(this.options.signal);
        const a = nativeFontPostScriptTransform(rect.left, rect.bottom, transform), b = nativeFontPostScriptTransform(rect.right, rect.bottom, transform);
        const c = nativeFontPostScriptTransform(rect.right, rect.top, transform), d = nativeFontPostScriptTransform(rect.left, rect.top, transform);
        commands.push(Object.freeze({ kind: "move", x: a[0], y: a[1] }), Object.freeze({ kind: "line", x: b[0], y: b[1] }),
          Object.freeze({ kind: "line", x: c[0], y: c[1] }), Object.freeze({ kind: "line", x: d[0], y: d[1] }), Object.freeze({ kind: "close" }));
      }
      this.paints.push(Object.freeze({ kind: "fill", commands: Object.freeze(commands), fillRule: 0, clips: this.clips, color: group.color }));
    }
    this.retainedCommands += rectangleCount * 5;
    if (!options.mask) this.notice("font.postscript-image-vectorized", "PostScript sampled images use vector pixel rectangles; pixel-edge antialiasing may differ from image rendering and retained output can be larger.");
    if (data.length < needed) this.notice("font.postscript-image-truncated", "PostScript image data ended early; only available samples were painted.");
    if (options.interpolate) this.notice("font.postscript-image-interpolation-approximated", "PostScript image interpolation uses exact sampled pixel rectangles; smooth interpolation is unavailable for the vector glyph image.");
  }
  save(): void { this.states.push(this.localState()); }
  restore(): void { const state = this.states.pop(); if (state) this.restoreState(state); }
  restoreAll(): void { if (this.states.length) this.restoreState(this.states[0]); this.states.length = 0; }
  captureState(): NativeFontPostScriptGraphicsState {
    return Object.freeze({ ...this.localState(), savedStates: Object.freeze([...this.states]) });
  }
  private localState(): NativeFontPostScriptGraphicsState {
    return Object.freeze({ commands: this.pathCommands, currentPoint: this.point, startPoint: this.start,
      pathOpen: this.open, clips: this.clips, stroke: this.stroke, color: this.paintColor, sourceColor: this.sourceColor,
      changedStrokeFields: Object.freeze([...this.changedStrokeFields]) });
  }
  restoreState(state: NativeFontPostScriptGraphicsState): void {
    this.commands = [...state.commands]; this.point = state.currentPoint; this.start = state.startPoint;
    this.open = state.pathOpen; this.clips = state.clips; this.stroke = state.stroke; this.paintColor = state.color; this.sourceColor = state.sourceColor;
    this.changedStrokeFields = new Set(state.changedStrokeFields);
    if (state.savedStates) { this.states.length = 0; for (const saved of state.savedStates) this.states.push(saved); }
  }
  setMetrics(wx: number, wy: number, bbox?: Rectangle): void {
    if (bbox) bbox.forEach(finite);
    this.glyphMetrics = Object.freeze({ width: point(wx, wy), ...(bbox ? { bbox: Object.freeze([...bbox]) as Rectangle } : {}) });
  }
  private destination(x: number, y: number, matrix: NativeFontPostScriptMatrix, relative: boolean): Point {
    const transformed = nativeFontPostScriptTransform(x, y, matrix, relative);
    if (!relative) return transformed;
    if (!this.point) throw unsupported("A relative PostScript path operator requires a current point.", "nocurrentpoint");
    return point(this.point[0] + transformed[0], this.point[1] + transformed[1]);
  }
  private ensureOpen(): void { if (!this.open && this.point) { this.append({ kind: "move", x: this.point[0], y: this.point[1] }); this.start = this.point; this.open = true; } }
  private append(command: NativeGlyphPathCommand): void {
    throwIfAborted(this.options.signal); this.checkCount(this.commands.length + 1);
    if (command.kind !== "close") {
      finite(command.x); finite(command.y);
      if (command.kind === "cubic") { finite(command.control1X); finite(command.control1Y); finite(command.control2X); finite(command.control2Y); }
      else if (command.kind === "quadratic") { finite(command.controlX); finite(command.controlY); }
    }
    this.commands.push(Object.freeze({ ...command }));
  }
  private checkCount(count: number): void {
    if (count + this.retainedCommands > (this.options.maxPathCommands ?? Number.MAX_SAFE_INTEGER)) throw new PdfError("resource-limit", "PostScript glyph exceeds its configured path command limit.", { details: { reason: "font-postscript-path-command-limit" } });
  }
  private notice(code: string, message: string): void {
    if (this.noticeCodes.has(code)) return; this.noticeCodes.add(code);
    this.notices.push(Object.freeze({ code, severity: "warning", message, details: Object.freeze({ approximate: true }) }));
  }
}

export function transformNativeGlyphPostScriptPaints(records: readonly NativeGlyphPostScriptPaint[],
  matrix: NativeFontPostScriptMatrix): readonly NativeGlyphPostScriptPaint[] {
  return Object.freeze(records.map(record => Object.freeze({ ...record,
    commands: transformCommands(record.commands, matrix),
    clips: Object.freeze(record.clips.map(clip => Object.freeze({ ...clip, commands: transformCommands(clip.commands, matrix) }))),
    ...(record.stroke ? { stroke: Object.freeze({ ...record.stroke,
      transform: nativeFontPostScriptConcatMatrices(record.stroke.transform, matrix) }) } : {})
  })));
}
export function transformNativeGlyphPostScriptFinalState(state: NativeGlyphPostScriptFinalState,
  matrix: NativeFontPostScriptMatrix): NativeGlyphPostScriptFinalState {
  return Object.freeze({ ...state,
    clips: Object.freeze(state.clips.map(clip => Object.freeze({ ...clip, commands: transformCommands(clip.commands, matrix) }))),
    ...(state.stroke ? { stroke: Object.freeze({ ...state.stroke,
      transform: nativeFontPostScriptConcatMatrices(state.stroke.transform, matrix) }) } : {})
  });
}
/** Conservative paint bounds include control hulls and the complete transformed
 * stroke pen. Clip intersections can tighten these later in retained lowering.
 */
export function nativeGlyphPostScriptPaintBounds(records: readonly NativeGlyphPostScriptPaint[]): Rectangle | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const record of records) {
    let left = Infinity, bottom = Infinity, right = -Infinity, top = -Infinity;
    const include = (x: number, y: number) => { left = Math.min(left, x); bottom = Math.min(bottom, y); right = Math.max(right, x); top = Math.max(top, y); };
    for (const command of record.commands) if (command.kind !== "close") {
      include(command.x, command.y);
      if (command.kind === "quadratic") include(command.controlX, command.controlY);
      else if (command.kind === "cubic") { include(command.control1X, command.control1Y); include(command.control2X, command.control2Y); }
    }
    const stroke = record.stroke;
    const radius = stroke ? Math.abs(stroke.width) / 2 * Math.max(stroke.lineCap === 2 ? Math.SQRT2 : 1,
      stroke.lineJoin === 0 ? stroke.miterLimit : 1) : 0;
    const padX = stroke ? radius * Math.hypot(stroke.transform[0], stroke.transform[2]) : 0;
    const padY = stroke ? radius * Math.hypot(stroke.transform[1], stroke.transform[3]) : 0;
    minX = Math.min(minX, left - padX); minY = Math.min(minY, bottom - padY);
    maxX = Math.max(maxX, right + padX); maxY = Math.max(maxY, top + padY);
  }
  return Number.isFinite(minX) ? Object.freeze([finite(minX), finite(minY), finite(maxX), finite(maxY)]) : null;
}
export function nativeGlyphPostScriptCommandCount(records: readonly NativeGlyphPostScriptPaint[],
  finalState?: NativeGlyphPostScriptFinalState): number {
  let count = 0; const clips = new Set<NativeGlyphPostScriptClip>();
  for (const record of records) {
    count += record.commands.length;
    for (const clip of record.clips) if (!clips.has(clip)) { clips.add(clip); count += clip.commands.length; }
  }
  for (const clip of finalState?.clips ?? []) if (!clips.has(clip)) { clips.add(clip); count += clip.commands.length; }
  return count;
}
function transformCommands(commands: readonly NativeGlyphPathCommand[], matrix: NativeFontPostScriptMatrix): readonly NativeGlyphPathCommand[] {
  return Object.freeze(commands.map(command => {
    if (command.kind === "close") return command;
    const [x, y] = nativeFontPostScriptTransform(command.x, command.y, matrix);
    if (command.kind === "cubic") {
      const [control1X, control1Y] = nativeFontPostScriptTransform(command.control1X, command.control1Y, matrix);
      const [control2X, control2Y] = nativeFontPostScriptTransform(command.control2X, command.control2Y, matrix);
      return Object.freeze({ kind: "cubic" as const, x, y, control1X, control1Y, control2X, control2Y });
    }
    if (command.kind === "quadratic") {
      const [controlX, controlY] = nativeFontPostScriptTransform(command.controlX, command.controlY, matrix);
      return Object.freeze({ kind: "quadratic" as const, x, y, controlX, controlY });
    }
    return Object.freeze({ kind: command.kind, x, y });
  }));
}
function inverse(matrix: NativeFontPostScriptMatrix): NativeFontPostScriptMatrix {
  const origin = nativeFontPostScriptTransform(0, 0, matrix, false, true);
  const x = nativeFontPostScriptTransform(1, 0, matrix, true, true), y = nativeFontPostScriptTransform(0, 1, matrix, true, true);
  return [x[0], x[1], y[0], y[1], origin[0], origin[1]];
}
function point(x: number, y: number): Point { return Object.freeze([finite(x), finite(y)]); }
function finite(value: number): number { if (!Number.isFinite(value)) throw unsupported("PostScript glyph graphics requires finite coordinates.", "undefinedresult"); return value; }
function unit(value: number): number { return Math.max(0, Math.min(1, finite(value))); }
function distanceToLine(point: Point, first: Point, last: Point): number {
  const dx = last[0] - first[0], dy = last[1] - first[1], denominator = Math.hypot(dx, dy);
  return denominator === 0 ? Math.hypot(point[0] - first[0], point[1] - first[1]) : Math.abs((point[0] - first[0]) * dy - (point[1] - first[1]) * dx) / denominator;
}
function unsupported(message: string, operator: string): PdfError {
  return new PdfError("unsupported-font", message, { details: { reason: "font-postscript-unsupported", operator } });
}
