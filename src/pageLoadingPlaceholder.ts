import type { VectorScene } from "./pdfVectorExtractor";
import type { RasterResolutionView } from "./rasterResolution";

export function pagePlaceholderAnimationEnabled(): boolean {
  try { return !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches; }
  catch { return true; }
}

/** Keep shader time small and use a fixed highlight when reduced motion is requested. */
export function pagePlaceholderTime(timestamp = performance.now()): number {
  return pagePlaceholderAnimationEnabled() ? (timestamp / 1000) % 2.4 : 1.2;
}

/** Pending pages outside the camera do not keep an otherwise idle viewer rendering. */
export function hasVisiblePagePlaceholders(scene: Pick<VectorScene, "pageRects" | "pendingPagePreviews">,
  view: RasterResolutionView & { clipDepth?: number }): boolean {
  if (!scene.pendingPagePreviews || !(view.width > 0 && view.height > 0 && view.zoom > 0)) return false;
  const rects = scene.pageRects;
  for (let page = 0; page < scene.pendingPagePreviews.length; page++) {
    if (!scene.pendingPagePreviews[page]) continue;
    const i = page * 4, m = view.projection ? view.projection(page) : view.localToClip;
    if (m === null) continue;
    if (!m) {
      const halfWidth = view.width / view.zoom / 2, halfHeight = view.height / view.zoom / 2;
      if (Math.max(rects[i], rects[i+2]) >= view.cameraCenterX - halfWidth &&
          Math.min(rects[i], rects[i+2]) <= view.cameraCenterX + halfWidth &&
          Math.max(rects[i+1], rects[i+3]) >= view.cameraCenterY - halfHeight &&
          Math.min(rects[i+1], rects[i+3]) <= view.cameraCenterY + halfHeight) return true;
      continue;
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity, front = 0;
    for (const [x,y] of [[rects[i],rects[i+1]], [rects[i+2],rects[i+1]],
      [rects[i],rects[i+3]], [rects[i+2],rects[i+3]]]) {
      const w = m[3]*x + m[7]*y + m[15];
      if (!(w > 1e-8)) continue;
      front++;
      const cx = (m[0]*x + m[4]*y + m[12])/w, cy = (m[1]*x + m[5]*y + m[13])/w;
      const cz = (m[2]*x + m[6]*y + m[14])/w;
      minX = Math.min(minX,cx); maxX = Math.max(maxX,cx);
      minY = Math.min(minY,cy); maxY = Math.max(maxY,cy);
      minZ = Math.min(minZ,cz); maxZ = Math.max(maxZ,cz);
    }
    if (front && (front < 4 || (maxX >= -1 && minX <= 1 && maxY >= -1 && minY <= 1 &&
      maxZ >= (view.clipDepth ?? -1) && minZ <= 1))) return true;
  }
  return false;
}

// Analytic rounded bars in page coordinates: no pixel texture or document primitives.
export const PAGE_PLACEHOLDER_GLSL = `
float heprPlaceholderBar(vec2 uv, vec2 center, vec2 halfSize) {
  vec2 d = abs(uv - center) - halfSize + vec2(0.003);
  return length(max(d, vec2(0.0))) + min(max(d.x,d.y),0.0) - 0.003;
}
vec4 heprPagePlaceholder(vec4 paper, vec2 uv, float pending, float time) {
  float aa = max(max(length(vec2(dFdx(uv.x),dFdy(uv.x))),
    length(vec2(dFdx(uv.y),dFdy(uv.y)))), 1e-6);
  if (pending < 0.5) return paper;
  float distance = min(heprPlaceholderBar(uv,vec2(0.35,0.14),vec2(0.23,0.009)),
    heprPlaceholderBar(uv,vec2(0.27,0.185),vec2(0.15,0.004)));
  float row = floor((uv.y - 0.27)/0.028);
  if (row >= 0.0 && row < 18.0 && mod(row,6.0) < 5.0) {
    float end = mod(row,6.0) > 3.5 ? 0.64 : 0.88 - mod(row,3.0)*0.055;
    distance = min(distance,heprPlaceholderBar(uv,vec2((0.12+end)*0.5,0.27+(row+0.5)*0.028),
      vec2((end-0.12)*0.5,0.004)));
  }
  distance = min(distance,heprPlaceholderBar(uv,vec2(0.5,0.915),vec2(0.025,0.003)));
  float mask = 1.0 - smoothstep(-aa,aa,distance);
  float highlight = 1.0 - smoothstep(0.0,0.22,abs(uv.x+uv.y*0.25-(time/2.4*1.8-0.4)));
  float luminance = dot(paper.rgb,vec3(0.2126,0.7152,0.0722));
  vec3 ink = vec3(luminance < paper.a*0.4 ? paper.a : 0.0);
  return vec4(mix(paper.rgb,ink,mask*mix(0.16,0.065,highlight)),paper.a);
}`;

export const PAGE_PLACEHOLDER_BAR_WGSL = `
fn heprPlaceholderBar(uv: vec2f, center: vec2f, halfSize: vec2f) -> f32 {
  let d = abs(uv - center) - halfSize + vec2f(0.003);
  return length(max(d,vec2f(0.0))) + min(max(d.x,d.y),0.0) - 0.003;
}`;
export const PAGE_PLACEHOLDER_COLOR_WGSL = `
fn heprPagePlaceholder(paper: vec4f, uv: vec2f, pending: f32, time: f32) -> vec4f {
  let aa = max(max(length(vec2f(dpdx(uv.x),dpdy(uv.x))),
    length(vec2f(dpdx(uv.y),dpdy(uv.y)))),1e-6);
  if (pending < 0.5) { return paper; }
  var distance = min(heprPlaceholderBar(uv,vec2f(0.35,0.14),vec2f(0.23,0.009)),
    heprPlaceholderBar(uv,vec2f(0.27,0.185),vec2f(0.15,0.004)));
  let row = floor((uv.y - 0.27)/0.028);
  if (row >= 0.0 && row < 18.0 && row % 6.0 < 5.0) {
    let end = select(0.88 - (row % 3.0)*0.055,0.64,row % 6.0 > 3.5);
    distance = min(distance,heprPlaceholderBar(uv,vec2f((0.12+end)*0.5,0.27+(row+0.5)*0.028),
      vec2f((end-0.12)*0.5,0.004)));
  }
  distance = min(distance,heprPlaceholderBar(uv,vec2f(0.5,0.915),vec2f(0.025,0.003)));
  let mask = 1.0 - smoothstep(-aa,aa,distance);
  let highlight = 1.0 - smoothstep(0.0,0.22,abs(uv.x+uv.y*0.25-(time/2.4*1.8-0.4)));
  let luminance = dot(paper.rgb,vec3f(0.2126,0.7152,0.0722));
  let ink = vec3f(select(0.0,paper.a,luminance < paper.a*0.4));
  return vec4f(mix(paper.rgb,ink,mask*mix(0.16,0.065,highlight)),paper.a);
}`;
export const PAGE_PLACEHOLDER_WGSL = PAGE_PLACEHOLDER_BAR_WGSL + PAGE_PLACEHOLDER_COLOR_WGSL;

export function pagePlaceholderVertexGlsl(source: string): string {
  return source.replace("layout(location = 1) in vec4 aPageRect;",
    "layout(location = 1) in vec4 aPageRect;\nlayout(location = 4) in float aPageLoading;\nflat out float vPageLoading;")
    .replace("vec2 world = aPageRect.xy + aPageRect.zw * localTopDown;",
      "vec2 world = aPageRect.xy + aPageRect.zw * localTopDown;\n  vPageLoading = aPageLoading;");
}

export function pagePlaceholderFragmentGlsl(source: string): string {
  return source.replace("void main() {",
    `uniform float uPagePlaceholderTime;\nflat in float vPageLoading;\n${PAGE_PLACEHOLDER_GLSL}\nvoid main() {`)
    .replace("if (color.a <= 0.001)", "color = heprPagePlaceholder(color,vUv,vPageLoading,uPagePlaceholderTime);\n  if (color.a <= 0.001)");
}
