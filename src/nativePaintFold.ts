/**
 * The texture unit native WebGL paint programs read a folded paint's soft mask
 * from: above the paint units (0-18) and the compositor's (19-25).
 */
export const PAINT_FOLD_MASK_UNIT = 27;

/**
 * Lets a native paint program draw a leaf that its group chain was folded
 * onto (see `ScenePaintCompositorAdapter.drawFolded`). `uPaintFold.x` is the
 * chain's opacity; when `uPaintFold.y` is set, the mask surface's red channel
 * at this pixel scales it too. Straight-alpha paints scale their alpha only,
 * premultiplied ones every channel, so either composites exactly as the
 * group's surface would have. Programs start at (1, 0), which changes nothing.
 */
export function paintFoldFragmentGlsl(source: string, premultiplied: boolean): string {
  const signature = /void\s+main\s*\(\s*\)/;
  if (!signature.test(source)) throw new Error("Folded paint shader has no main function.");
  return source.replace(signature, "void heprUnfoldedPaint()") + `
uniform vec2 uPaintFold;
uniform highp sampler2D uPaintMask;
void main() {
  heprUnfoldedPaint();
  float fold = uPaintFold.x;
  if (uPaintFold.y > 0.5) fold *= texelFetch(uPaintMask, ivec2(gl_FragCoord.xy), 0).r;
  ${premultiplied ? "outColor *= fold;" : "outColor.a *= fold;"}
}
`;
}
