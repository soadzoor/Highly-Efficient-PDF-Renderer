/** Keep ordinary raster sampling and clipping; only the placement becomes an instance attribute. */
export function rasterRepeatVertexGlsl(source: string): string {
  return source.replace("uniform vec4 uRasterMatrixABCD;", "layout(location = 1) in vec4 aRasterRepeatABCD;")
    .replace("uniform vec2 uRasterMatrixEF;", "layout(location = 2) in vec2 aRasterRepeatEF;")
    .replace(/\buRasterMatrixABCD\b/g, "aRasterRepeatABCD")
    .replace(/\buRasterMatrixEF\b/g, "aRasterRepeatEF");
}
