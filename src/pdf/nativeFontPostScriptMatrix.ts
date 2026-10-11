import { PdfError } from "./nativeTypes";

export type NativeFontPostScriptMatrix = readonly [number, number, number, number, number, number];

/** Pure affine arithmetic for PLRM section 4.3.3 and the matrix operators in
 * chapter 8. The VM owns operand access, destination aliasing and graphics state.
 * https://www.adobe.com/jp/print/postscript/pdfs/PLRM.pdf
 */
export function nativeFontPostScriptIdentityMatrix(): NativeFontPostScriptMatrix {
  return Object.freeze([1, 0, 0, 1, 0, 0]);
}

/** PostScript uses row vectors: the result applies first, then second. */
export function nativeFontPostScriptConcatMatrices(
  first: ArrayLike<number>, second: ArrayLike<number>
): NativeFontPostScriptMatrix {
  const a = matrix(first, "concatmatrix"), b = matrix(second, "concatmatrix");
  return checked([
    a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]
  ], "concatmatrix");
}

export function nativeFontPostScriptInvertMatrix(source: ArrayLike<number>): NativeFontPostScriptMatrix {
  const value = matrix(source, "invertmatrix");
  const inverse = inverseLinear(value, "invertmatrix");
  return checked([inverse[0], inverse[1], inverse[2], inverse[3],
    -(inverse[0] * value[4] + inverse[2] * value[5]),
    -(inverse[1] * value[4] + inverse[3] * value[5])], "invertmatrix");
}

export function nativeFontPostScriptTranslation(x: number, y: number): NativeFontPostScriptMatrix {
  return checked([1, 0, 0, 1, x, y], "translate");
}

export function nativeFontPostScriptScaling(x: number, y: number): NativeFontPostScriptMatrix {
  return checked([x, 0, 0, y, 0, 0], "scale");
}

export function nativeFontPostScriptRotation(degrees: number): NativeFontPostScriptMatrix {
  number(degrees, "rotate");
  // Reducing before converting to radians avoids overflow and makes exact
  // quadrant rotations exact, including negative and multiple-turn angles.
  const angle = degrees % 360;
  if (angle === 0) return nativeFontPostScriptIdentityMatrix();
  if (angle === 90 || angle === -270) return Object.freeze([0, 1, -1, 0, 0, 0]);
  if (angle === 180 || angle === -180) return Object.freeze([-1, 0, 0, -1, 0, 0]);
  if (angle === 270 || angle === -90) return Object.freeze([0, -1, 1, 0, 0, 0]);
  const radians = angle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
  return Object.freeze([cosine, sine, -sine, cosine, 0, 0]);
}

/** The four transform operators share the same affine convention. Inverse
 * distances use only the linear part; even very large translations are ignored.
 */
export function nativeFontPostScriptTransform(
  x: number, y: number, source: ArrayLike<number>, distance = false, inverse = false
): readonly [number, number] {
  const operator = inverse ? distance ? "idtransform" : "itransform" : distance ? "dtransform" : "transform";
  number(x, operator); number(y, operator);
  const value = matrix(source, operator);
  let resultX: number, resultY: number;
  if (inverse) {
    const linear = inverseLinear(value, operator);
    const localX = distance ? x : x - value[4], localY = distance ? y : y - value[5];
    resultX = linear[0] * localX + linear[2] * localY;
    resultY = linear[1] * localX + linear[3] * localY;
  } else {
    resultX = value[0] * x + value[2] * y + (distance ? 0 : value[4]);
    resultY = value[1] * x + value[3] * y + (distance ? 0 : value[5]);
  }
  return Object.freeze([number(resultX, operator), number(resultY, operator)]);
}

function matrix(value: ArrayLike<number>, operator: string): NativeFontPostScriptMatrix {
  if (!value || value.length !== 6) throw unsupported("A PostScript matrix must contain exactly six numbers.", operator);
  return [number(value[0], operator), number(value[1], operator), number(value[2], operator),
    number(value[3], operator), number(value[4], operator), number(value[5], operator)];
}

function inverseLinear(value: NativeFontPostScriptMatrix, operator: string): readonly [number, number, number, number] {
  // Normalize each output row independently. This avoids overflowing a*d or
  // underflowing their determinant for ordinary large/small affine scales.
  const scaleX = Math.max(Math.abs(value[0]), Math.abs(value[2]));
  const scaleY = Math.max(Math.abs(value[1]), Math.abs(value[3]));
  if (scaleX === 0 || scaleY === 0) throw unsupported("A singular PostScript matrix has no inverse.", operator);
  const a = value[0] / scaleX, c = value[2] / scaleX;
  const b = value[1] / scaleY, d = value[3] / scaleY;
  const determinant = a * d - b * c;
  if (determinant === 0) throw unsupported("A singular PostScript matrix has no inverse.", operator);
  return [inverseComponent(d, determinant, scaleX, operator), inverseComponent(-b, determinant, scaleX, operator),
    inverseComponent(-c, determinant, scaleY, operator), inverseComponent(a, determinant, scaleY, operator)];
}

function inverseComponent(value: number, determinant: number, scale: number, operator: string): number {
  const unscaled = value / determinant;
  // The final component can be finite even if division by a tiny normalized
  // determinant overflows. Apply the row scale first in that case.
  return number(Number.isFinite(unscaled) ? unscaled / scale : (value / scale) / determinant, operator);
}

function checked(value: [number, number, number, number, number, number], operator: string): NativeFontPostScriptMatrix {
  for (let i = 0; i < value.length; i++) value[i] = number(value[i], operator);
  return Object.freeze(value);
}

function number(value: number, operator: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw unsupported("PostScript matrix arithmetic requires finite numbers.", operator);
  return value === 0 ? 0 : value;
}

function unsupported(message: string, operator: string): PdfError {
  return new PdfError("unsupported-font", message, { details: { reason: "font-postscript-unsupported", operator } });
}
