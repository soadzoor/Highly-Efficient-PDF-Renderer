/** One equation source for native GL, native GPU, and Three compositor passes. */
export function pdfCompositeFunctions(language: "glsl" | "wgsl"): string {
  const gpu = language === "wgsl";
  const type = (name: string): string => ({ F: "f32", I: "i32", V3: "vec3f", V4: "vec4f" }[name] ?? name);
  const convert = (body: string): string => gpu
    ? body.replace(/\b(F|I|V3|V4)\b/g, type)
    : body.replace(/\bF\b/g, "float").replace(/\bI\b/g, "int").replace(/\bV3\b/g, "vec3").replace(/\bV4\b/g, "vec4");
  const fn = (name: string, args: string, result: string, body: string): string => {
    const params = args.split(",").map(arg => arg.trim().split(" "));
    return convert(gpu ? `fn ${name}(${params.map(([t, n]) => `${n}: ${t}`).join(", ")}) -> ${result} {${body}}`
      : `${result} ${name}(${args}) {${body}}`);
  };
  const v = (t: string, name: string, value: string): string => gpu ? `var ${name}: ${t} = ${value};` : `${t} ${name} = ${value};`;
  return [
    fn("pdfLum", "V3 c", "F", "return dot(c, V3(0.3, 0.59, 0.11));"),
    fn("pdfSat", "V3 c", "F", "return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);"),
    fn("pdfSetSat", "V3 c, F s", "V3", `${v("F", "n", "min(min(c.r,c.g),c.b)")}${v("F", "d", "pdfSat(c)")}
      if (d <= 0.0) { return V3(0.0); } return (c - V3(n)) * s / d;`),
    fn("pdfSetLum", "V3 c, F l", "V3", `${v("V3", "r", "c + V3(l - pdfLum(c))")}
      ${v("F", "n", "min(min(r.r,r.g),r.b)")}${v("F", "x", "max(max(r.r,r.g),r.b)")}
      if (n < 0.0) { r = V3(l) + (r-V3(l))*l/(l-n); }
      if (x > 1.0) { r = V3(l) + (r-V3(l))*(1.0-l)/(x-l); } return r;`),
    fn("pdfBlendChannel", "F b, F s, I mode", "F", `
      if (mode == 1) { return b*s; }
      if (mode == 2) { return b+s-b*s; }
      if (mode == 3) { if (b <= 0.5) { return 2.0*b*s; } return 1.0-2.0*(1.0-b)*(1.0-s); }
      if (mode == 4) { return min(b,s); }
      if (mode == 5) { return max(b,s); }
      if (mode == 6) { if (b <= 0.0) { return 0.0; } if (s >= 1.0) { return 1.0; } return min(1.0,b/(1.0-s)); }
      if (mode == 7) { if (b >= 1.0) { return 1.0; } if (s <= 0.0) { return 0.0; } return 1.0-min(1.0,(1.0-b)/s); }
      if (mode == 8) { if (s <= 0.5) { return 2.0*b*s; } return 1.0-2.0*(1.0-b)*(1.0-s); }
      if (mode == 9) { if (s <= 0.5) { return b-(1.0-2.0*s)*b*(1.0-b); }
        ${v("F", "d", "sqrt(b)")} if (b <= 0.25) { d=((16.0*b-12.0)*b+4.0)*b; } return b+(2.0*s-1.0)*(d-b); }
      if (mode == 10) { return abs(b-s); }
      if (mode == 11) { return b+s-2.0*b*s; } return s;`),
    fn("pdfBlend", "V3 b, V3 s, I mode", "V3", `
      if (mode == 12) { return pdfSetLum(pdfSetSat(s,pdfSat(b)),pdfLum(b)); }
      if (mode == 13) { return pdfSetLum(pdfSetSat(b,pdfSat(s)),pdfLum(b)); }
      if (mode == 14) { return pdfSetLum(s,pdfLum(b)); }
      if (mode == 15) { return pdfSetLum(b,pdfLum(s)); }
      return V3(pdfBlendChannel(b.r,s.r,mode),pdfBlendChannel(b.g,s.g,mode),pdfBlendChannel(b.b,s.b,mode));`),
    fn("pdfOver", "V4 b, V4 s, I mode", "V4", `
      ${v("V3", "cb", "b.rgb / max(b.a, 0.0000001)")}${v("V3", "cs", "s.rgb / max(s.a, 0.0000001)")}
      return V4((1.0-s.a)*b.rgb+(1.0-b.a)*s.rgb+b.a*s.a*pdfBlend(cb,cs,mode),s.a+b.a*(1.0-s.a));`),
    fn("pdfCompositePass", "V4 source, V4 shape, V4 current, V4 stats, V4 initial, V4 mask, V4 p, V4 q", "V4", `
      ${v("I", "operation", "I(p.x)")}
      // A group accumulated into a single isolated surface is already its own
      // extracted layer, so its opacity and soft mask are a uniform scale of
      // premultiplied color. Applying it here, where the layer is read anyway,
      // spares that group an extraction pass and a surface of its own.
      ${v("V4", "src", "source")} if (q.w > 0.5) { src=source*(p.w*mask.r); }
      // Operation 6 emits the layer itself, for a destination whose blender
      // performs the source-over that operation 0 would compute here.
      // One exit: D3D's FXC (under ANGLE) cannot prove that early returns
      // here cover every path and warns X4000 about the result.
      ${v("V4", "result", "src")}
      if (operation == 0) {
        ${v("V4", "backdrop", "current")} if (p.z > 0.5) { backdrop=initial; }
        result=pdfOver(backdrop,src,I(p.y));
        if (p.z > 0.5) { result=result+(1.0-shape.a)*(current-initial); }
        result=clamp(result,V4(0.0),V4(1.0));
      } else if (operation == 1) {
        ${v("F", "previousWeight", "1.0-src.a")} if (p.z > 0.5) { previousWeight=1.0-shape.a; }
        result=V4(src.a+previousWeight*stats.r,shape.a+(1.0-shape.a)*stats.g,0.0,1.0);
      } else if (operation == 2) {
        ${v("F", "opacity", "p.w*mask.r")}
        result=V4(clamp(current.rgb-initial.rgb*(1.0-stats.r),V3(0.0),V3(1.0))*opacity,stats.r*opacity);
      } else if (operation == 3) {
        ${v("F", "coverage", "stats.g")} if (q.x > 0.5) { coverage=coverage*p.w*mask.r; }
        result=V4(coverage);
      }
      return result;
    `)
  ].join("\n");
}

export const PDF_COMPOSITE_VERTEX_GLSL = `#version 300 es
precision highp float;
void main() {
  vec2 p=vec2(float((gl_VertexID << 1) & 2),float(gl_VertexID & 2));
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`;
export const PDF_COMPOSITE_FRAGMENT_GLSL = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uSource;
uniform sampler2D uShape;
uniform sampler2D uCurrent;
uniform sampler2D uStats;
uniform sampler2D uInitial;
uniform sampler2D uMask;
uniform sampler2D uTransfer;
uniform vec4 uParams;
uniform vec4 uExtra;
uniform vec3 uMaskBackdrop;
out vec4 outColor;
${pdfCompositeFunctions("glsl")}
// Pass inputs may be 1x1 neutral textures. Integer texel loads do not apply
// sampler wrap modes, so bound each read to that input's actual dimensions.
vec4 pdfCompositeLoad(sampler2D inputTexture, ivec2 point) {
  return texelFetch(inputTexture,clamp(point,ivec2(0),textureSize(inputTexture,0)-ivec2(1)),0);
}
float pdfTransferSample(int index) {
  int width=textureSize(uTransfer,0).x;
  return texelFetch(uTransfer,ivec2(index%width,index/width),0).r;
}
void main() {
  ivec2 p=ivec2(gl_FragCoord.xy);
  vec4 source=pdfCompositeLoad(uSource,p);
  if (uParams.x==4.0) {
    float value=source.a;
    if (uExtra.y>0.5) value=pdfLum(source.rgb+(1.0-source.a)*uMaskBackdrop);
    value=clamp(value,0.0,1.0);
    if (uExtra.z>1.0) {
      float at=value*(uExtra.z-1.0); int first=int(floor(at));
      value=mix(pdfTransferSample(first),pdfTransferSample(min(first+1,int(uExtra.z)-1)),fract(at));
    }
    outColor=vec4(value); return;
  }
  outColor=pdfCompositePass(source,pdfCompositeLoad(uShape,p),pdfCompositeLoad(uCurrent,p),pdfCompositeLoad(uStats,p),
    pdfCompositeLoad(uInitial,p),pdfCompositeLoad(uMask,p),uParams,uExtra);
}`;

export const PDF_COMPOSITE_WGSL = `
struct Params { p:vec4f, q:vec4f, backdrop:vec4f }
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var sourceTex:texture_2d<f32>;
@group(0) @binding(2) var shapeTex:texture_2d<f32>;
@group(0) @binding(3) var currentTex:texture_2d<f32>;
@group(0) @binding(4) var statsTex:texture_2d<f32>;
@group(0) @binding(5) var initialTex:texture_2d<f32>;
@group(0) @binding(6) var maskTex:texture_2d<f32>;
@group(0) @binding(7) var transferTex:texture_2d<f32>;
${pdfCompositeFunctions("wgsl")}
// Neutral pass inputs are 1x1, unlike the viewport-sized color surfaces.
fn pdfCompositeLoad(inputTexture:texture_2d<f32>, point:vec2i)->vec4f {
  return textureLoad(inputTexture,clamp(point,vec2i(0),vec2i(textureDimensions(inputTexture))-vec2i(1)),0);
}
fn pdfTransferSample(index:i32)->f32 {
  let width=i32(textureDimensions(transferTex).x);
  return textureLoad(transferTex,vec2i(index%width,index/width),0).r;
}
@vertex fn vs(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {
  let p=vec2f(f32((index << 1u) & 2u),f32(index & 2u));
  return vec4f(p*2.0-vec2f(1.0),0.0,1.0);
}
@fragment fn fs(@builtin(position) position:vec4f)->@location(0) vec4f {
  if (params.p.x==5.0) {
    let dimensions=vec2i(textureDimensions(sourceTex));
    let point=position.xy/max(params.backdrop.xy,vec2f(1.0))*vec2f(dimensions)-vec2f(0.5);
    let low=vec2i(floor(point)); let fraction=fract(point);
    let a=textureLoad(sourceTex,clamp(low,vec2i(0),dimensions-vec2i(1)),0);
    let b=textureLoad(sourceTex,clamp(low+vec2i(1,0),vec2i(0),dimensions-vec2i(1)),0);
    let c=textureLoad(sourceTex,clamp(low+vec2i(0,1),vec2i(0),dimensions-vec2i(1)),0);
    let d=textureLoad(sourceTex,clamp(low+vec2i(1,1),vec2i(0),dimensions-vec2i(1)),0);
    return mix(mix(a,b,fraction.x),mix(c,d,fraction.x),fraction.y);
  }
  let p=vec2i(position.xy); let source=pdfCompositeLoad(sourceTex,p);
  if (params.p.x==4.0) {
    var value=source.a;
    if (params.q.y>0.5) { value=pdfLum(source.rgb+(1.0-source.a)*params.backdrop.rgb); }
    value=clamp(value,0.0,1.0);
    if (params.q.z>1.0) {
      let at=value*(params.q.z-1.0); let first=i32(floor(at));
      value=mix(pdfTransferSample(first),pdfTransferSample(min(first+1,i32(params.q.z)-1)),fract(at));
    }
    return vec4f(value);
  }
  return pdfCompositePass(source,pdfCompositeLoad(shapeTex,p),pdfCompositeLoad(currentTex,p),pdfCompositeLoad(statsTex,p),
    pdfCompositeLoad(initialTex,p),pdfCompositeLoad(maskTex,p),params.p,params.q);
}`;
