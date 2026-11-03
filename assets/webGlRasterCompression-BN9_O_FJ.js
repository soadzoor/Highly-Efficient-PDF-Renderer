import{i as e}from"./nativeTypes-BQHnFu7D.js";import{f as t,l as n,u as r}from"./rasterMemoryBudget-DeP7mAKz.js";var i=String.raw`#version 300 es
// BC7 (BPTC) mode-6 / mode-4 fragment-shader encoder — WebGL2 port of
// bc7.wgsl.
//
// One fragment per 4×4 block → 16-byte block as 4 × u32 in outColor. Per
// block the covariance picks mode 6 (one RGBA line, 16 levels) or mode 4
// (one channel split off into its own scalar plane, the other three on a
// line; 2-bit + 3-bit index sets), both then encoded by the same extents +
// stored-projection index passes. Gray + opaque blocks take an integer 1-D
// tail: lossless for spans ≤ 15 with odd endpoints (alpha exactly 255),
// alpha-aware scalar LSQ refit above. See bc7_fast_f16.wgsl for the design,
// the mode-decision model, the bit layouts and the measurements.
//
// Same arithmetic, in the same order, as bc7.wgsl — the two produce the
// same blocks.

precision highp float;
precision highp int;

uniform sampler2D uSrc;
uniform ivec2 uSrcSize;
uniform int uFlipY;

layout(location = 0) out uvec4 outColor;

// Mode-4 endpoint-precision charge (8-bit² covariance units).
const float N4 = 38.1;

// Per-invocation scratch (mirrors the WGSL function-scope arrays).
vec4 gPixels[16];
float gT[16];

// Nibble-slot compaction for the mode-4 index fields.
uint compact2(uint x) {
  uint y = (x | (x >> 2u)) & 0x0F0F0F0Fu;
  y = (y | (y >> 4u)) & 0x00FF00FFu;
  return (y | (y >> 8u)) & 0x0000FFFFu;
}
uint compact3(uint x) {
  uint y = (x & 0x07070707u) | ((x >> 1u) & 0x38383838u);
  y = (y & 0x003F003Fu) | ((y >> 2u) & 0x0FC00FC0u);
  return (y & 0x00000FFFu) | ((y >> 4u) & 0x00FFF000u);
}

// Gray + opaque block (every texel R == G == B, A == 255) from gPixels[].x,
// packed straight into the 4 block words. 8-bit endpoints E = 2q + p; RGB
// share q, alpha is 254 + p.
uvec4 encodeGray(float vmin, float vmax) {
  float e0 = vmin;
  float e1 = vmax;
  if (vmax - vmin <= 15.0) {
    // LOSSLESS: integer endpoints ≤ 15 apart cover every integer between
    // them and round(15·(v − e0)/d) selects it; even endpoints step outward
    // while the span stays ≤ 15 so both p-bits are 1 (alpha 255).
    if (fract(e0 * 0.5) == 0.0 && e0 > 0.0 && e1 - e0 < 15.0) { e0 -= 1.0; }
    if (fract(e1 * 0.5) == 0.0 && e1 < 255.0 && e1 - e0 < 15.0) { e1 += 1.0; }
  } else {
    // Moment-form scalar LSQ refit on the seed levels, all four p-bit
    // combinations priced including the alpha term, accept-if-better.
    float k1 = 15.0 / (vmax - vmin);
    float k0 = 0.5 - vmin * k1;
    float sL = 0.0;
    float sLL = 0.0;
    float sv = 0.0;
    float sLv = 0.0;
    for (int k = 0; k < 16; k++) {
      float v = gPixels[k].x;
      float L = floor(v * k1 + k0);
      sL += L;
      sLL += L * L;
      sv += v;
      sLv += L * v;
    }
    float C = sLL * (1.0 / 225.0);
    float B = sL * (1.0 / 15.0) - C;
    float A = 16.0 - sL * (2.0 / 15.0) + C;
    float Y = sLv * (1.0 / 15.0);
    float X = sv - Y;
    float det = A * C - B * B;
    if (det > 1e-3) {
      float s0 = clamp((C * X - B * Y) / det, 0.0, 255.0);
      float s1 = clamp((A * Y - B * X) / det, 0.0, 255.0);
      // price(e0, e1, p0, p1) up to the block constant: RGB ×3 + alpha.
      float ps0 = vmin - 2.0 * floor(vmin * 0.5);
      float ps1 = vmax - 2.0 * floor(vmax * 0.5);
      float best = 3.0 * (A * vmin * vmin + 2.0 * B * vmin * vmax + C * vmax * vmax - 2.0 * (X * vmin + Y * vmax))
        + A * (1.0 - ps0) + 2.0 * B * (1.0 - ps0) * (1.0 - ps1) + C * (1.0 - ps1);
      for (int pc = 0; pc < 4; pc++) {
        float p0 = float(pc & 1);
        float p1 = float(pc >> 1);
        float c0 = 2.0 * clamp(floor((s0 - p0) * 0.5 + 0.5), 0.0, 127.0) + p0;
        float c1 = 2.0 * clamp(floor((s1 - p1) * 0.5 + 0.5), 0.0, 127.0) + p1;
        float pr = 3.0 * (A * c0 * c0 + 2.0 * B * c0 * c1 + C * c1 * c1 - 2.0 * (X * c0 + Y * c1))
          + A * (1.0 - p0) + 2.0 * B * (1.0 - p0) * (1.0 - p1) + C * (1.0 - p1);
        if (pr < best) {
          best = pr;
          e0 = c0;
          e1 = c1;
        }
      }
    }
  }
  uint glo = 0u;
  uint ghi = 0u;
  if (e1 != e0) {
    float k1 = 15.0 / (e1 - e0);
    float k0 = 0.5 - e0 * k1;
    for (int k = 0; k < 8; k++) {
      float sg = clamp(floor(gPixels[k].x * k1 + k0), 0.0, 15.0);
      glo |= uint(sg) << uint(k * 4);
    }
    for (int k = 8; k < 16; k++) {
      float sg = clamp(floor(gPixels[k].x * k1 + k0), 0.0, 15.0);
      ghi |= uint(sg) << uint((k - 8) * 4);
    }
  }
  uint u0 = uint(e0);
  uint u1 = uint(e1);
  // Anchor rule: pixel 0's index MSB must be 0 — swap + reflect (bitwise NOT).
  if ((glo & 0x8u) != 0u) {
    uint t = u0; u0 = u1; u1 = t;
    glo = ~glo; ghi = ~ghi;
  }
  uint q0 = u0 >> 1u;
  uint q1 = u1 >> 1u;
  return uvec4(
    0x40u | (q0 << 7u) | (q1 << 14u) | (q0 << 21u) | (q1 << 28u),
    (q1 >> 4u) | (q0 << 3u) | (q1 << 10u) | (127u << 17u) | (127u << 24u) | ((u0 & 1u) << 31u),
    (u1 & 1u) | ((glo & 0x7u) << 1u) | (glo & 0xFFFFFFF0u),
    ghi
  );
}

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 4;
  ivec2 mx = uSrcSize - ivec2(1);

  // Load pass: texels (8-bit integer domain), bbox and the gray test.
  vec4 lo = vec4(255.0);
  vec4 hi = vec4(0.0);
  float gd = 0.0;
  ivec4 xs = min(ivec4(base.x) + ivec4(0, 1, 2, 3), ivec4(mx.x));
  ivec4 ys = min(ivec4(base.y) + ivec4(0, 1, 2, 3), ivec4(mx.y));
  for (int i = 0; i < 16; i++) {
    int py = ys[i >> 2];
    int sy = (uFlipY != 0) ? (uSrcSize.y - 1 - py) : py;
    vec4 px = clamp(floor(texelFetch(uSrc, ivec2(xs[i & 3], sy), 0) * 255.0 + 0.5), vec4(0.0), vec4(255.0));
    gPixels[i] = px;
    lo = min(lo, px);
    hi = max(hi, px);
    gd = max(gd, max(abs(px.x - px.y), abs(px.x - px.z)));
  }

  if (lo.w == 255.0 && gd == 0.0) {
    outColor = encodeGray(lo.x, hi.x);
    return;
  }

  // Covariance (10 symmetric products) over d = px − p0, stored back into
  // gPixels: every later pass works block-relative.
  vec4 p0v = gPixels[0];
  gPixels[0] = vec4(0.0);
  vec4 sd = vec4(0.0);
  vec4 cx = vec4(0.0);
  vec3 cy = vec3(0.0);
  vec2 cz = vec2(0.0);
  float cw = 0.0;
  for (int i = 1; i < 16; i++) {
    vec4 d = gPixels[i] - p0v;
    gPixels[i] = d;
    sd = sd + d;
    cx = cx + d.x * d;
    cy = cy + d.y * d.yzw;
    cz = cz + d.z * d.zw;
    cw = cw + d.w * d.w;
  }
  vec4 md = sd * (1.0 / 16.0);
  vec4 sd4 = sd * 0.25;
  cx = cx - sd4.x * sd4;
  cy = cy - sd4.y * sd4.yzw;
  cz = cz - sd4.z * sd4.zw;
  cw = cw - sd4.w * sd4.w;
  vec4 diag = vec4(cx.x, cy.x, cz.x, cw);
  float trace = diag.x + diag.y + diag.z + diag.w;

  // Mode decision + fit axis. Flat blocks keep axis 0.
  bool use4 = false;
  bool idx1 = false;
  uint ch = 0u;
  vec4 cmask = vec4(1.0);
  vec4 axisF = vec4(0.0);
  if (trace > 0.254) {
    float s = 1.0 / trace;
    vec4 m0 = cx * s;
    vec4 m1 = vec4(cx.y, cy) * s;
    vec4 m2 = vec4(cx.z, cy.y, cz) * s;
    vec4 m3 = vec4(cx.w, cy.z, cz.y, cw) * s;
    vec4 axis = m0;
    float dm = diag.x;
    if (diag.y > dm) { axis = m1; dm = diag.y; }
    if (diag.z > dm) { axis = m2; dm = diag.z; }
    if (diag.w > dm) { axis = m3; }
    axis = axis * inversesqrt(dot(axis, axis));
    axis = vec4(dot(m0, axis), dot(m1, axis), dot(m2, axis), dot(m3, axis));
    axis = vec4(dot(m0, axis), dot(m1, axis), dot(m2, axis), dot(m3, axis));
    float a4 = max(dot(axis, axis), 1e-12);
    axis = axis * inversesqrt(a4);
    float lamn = sqrt(sqrt(a4));
    float lam = lamn * trace;

    // λ3 for all four scalar-channel candidates at once (lane c).
    vec4 a2 = axis * axis;
    vec4 nn = vec4(0.0);
    { vec4 wr = lamn * axis.x - axis * m0; nn = nn + wr * wr * vec4(0.0, 1.0, 1.0, 1.0); }
    { vec4 wr = lamn * axis.y - axis * m1; nn = nn + wr * wr * vec4(1.0, 0.0, 1.0, 1.0); }
    { vec4 wr = lamn * axis.z - axis * m2; nn = nn + wr * wr * vec4(1.0, 1.0, 0.0, 1.0); }
    { vec4 wr = lamn * axis.w - axis * m3; nn = nn + wr * wr * vec4(1.0, 1.0, 1.0, 0.0); }
    vec4 l3v = sqrt(nn / max(vec4(1.0) - a2, vec4(1e-3))) * trace;
    float d1 = max(max(diag.x, diag.y), max(diag.z, diag.w));
    bvec4 oh1 = equal(diag, vec4(d1));
    vec4 dr = mix(diag, vec4(-1.0), oh1);
    float d2 = max(max(dr.x, dr.y), max(dr.z, dr.w));
    l3v = clamp(l3v, mix(vec4(d1), vec4(d2), oh1), vec4(trace) - diag);

    vec4 sb = max(l3v, diag) * (48.0 / 49.0) + min(l3v, diag) * (8.0 / 9.0);
    float smax = max(max(sb.x, sb.y), max(sb.z, sb.w));
    use4 = smax - N4 > lam * (224.0 / 225.0);
    if (sb.y == smax) { ch = 1u; }
    if (sb.z == smax) { ch = 2u; }
    if (sb.w == smax) { ch = 3u; }
    vec4 ohc = mix(vec4(0.0), vec4(1.0), equal(uvec4(ch), uvec4(0u, 1u, 2u, 3u)));
    idx1 = dot(l3v - diag, ohc) > 0.0;

    vec4 col = ch == 3u ? m3 : (ch == 2u ? m2 : (ch == 1u ? m1 : m0));
    cmask = use4 ? vec4(1.0) - ohc : vec4(1.0);
    vec4 v = use4 ? (lamn * axis - dot(axis, ohc) * col) * cmask + (hi - lo) * cmask * (1e-3 / 255.0) : axis;
    v = v * inversesqrt(max(dot(v, v), 1e-12));
    v = vec4(dot(m0, v), dot(m1, v), dot(m2, v), dot(m3, v)) * cmask;
    float vv = dot(v, v);
    axisF = vv > 1e-6 ? v * inversesqrt(max(vv, 1e-12)) : vec4(0.0);
  }

  // Mode-4 scalar plane: 6-bit codes at the channel's exact extremes, index
  // map v = ⌊d·ks + os⌋. chs = 0 leaves ks = 0 for mode 6.
  vec4 chs = vec4(1.0) - cmask;
  float Ls = idx1 ? 3.0 : 7.0;
  uint A0 = uint(floor(dot(lo, chs) * (63.0 / 255.0) + 0.5));
  uint A1 = uint(floor(dot(hi, chs) * (63.0 / 255.0) + 0.5));
  vec4 ks = vec4(0.0);
  float os = 0.0;
  {
    float d0a = float((A0 << 2u) | (A0 >> 4u));
    float d1a = float((A1 << 2u) | (A1 >> 4u));
    float aspan = d1a - d0a;
    if (aspan > 0.0) {
      float sca = Ls / aspan;
      ks = chs * sca;
      os = (dot(p0v, chs) - d0a) * sca + 0.5;
    }
    // Anchor rule up front: pixel 0 (the d-space origin) indexes at ⌊os⌋.
    if (floor(os) >= (Ls + 1.0) * 0.5) {
      uint t = A0; A0 = A1; A1 = t;
      ks = -ks;
      os = Ls + 1.0 - os;
    }
  }

  // ONE extents pass along the fit axis: projections kept for the colour
  // indices, scalar-plane indices ride along as float nibble fields.
  float tMin = 1e30;
  float tMax = -1e30;
  float ga = 0.0;
  float gb = 0.0;
  float gc = 0.0;
  float w3 = 1.0;
  for (int k = 0; k < 16; k++) {
    float t = dot(gPixels[k], axisF);
    gT[k] = t;
    tMin = min(tMin, t);
    tMax = max(tMax, t);
    float v = clamp(floor(dot(gPixels[k], ks) + os), 0.0, Ls);
    if (k == 0) { v = min(v, floor(Ls * 0.5)); }
    if (k < 6) { ga = ga + v * w3; } else if (k < 12) { gb = gb + v * w3; } else { gc = gc + v * w3; }
    w3 = (k == 5 || k == 11) ? 1.0 : w3 * 16.0;
  }
  float tm = dot(md, axisF);
  vec4 mean = p0v + md;
  vec4 seedLo = clamp(mean + (tMin - tm) * axisF, vec4(0.0), vec4(255.0));
  vec4 seedHi = clamp(mean + (tMax - tm) * axisF, vec4(0.0), vec4(255.0));

  // Endpoint codes, one quantiser for both modes: mode 6 = 7-bit + p-bit,
  // mode 4 colour = 5-bit.
  float sc = use4 ? 31.0 / 255.0 : 0.5;
  float cmax = use4 ? 31.0 : 127.0;
  vec4 y0 = seedLo * sc;
  vec4 y1 = seedHi * sc;
  vec4 r0 = min(floor(y0 + 0.5), vec4(cmax));
  vec4 r1 = min(floor(y1 + 0.5), vec4(cmax));
  vec4 f0 = min(floor(y0), vec4(cmax));
  vec4 f1 = min(floor(y1), vec4(cmax));
  vec4 e0r = r0 - y0;
  vec4 e0f = f0 + 0.5 - y0;
  vec4 e1r = r1 - y1;
  vec4 e1f = f1 + 0.5 - y1;
  bool pp0 = !use4 && dot(e0f, e0f) < dot(e0r, e0r);
  bool pp1 = !use4 && dot(e1f, e1f) < dot(e1r, e1r);
  vec4 g0 = pp0 ? f0 : r0;
  vec4 g1 = pp1 ? f1 : r1;
  uvec4 q0c = uvec4(g0);
  uvec4 q1c = uvec4(g1);
  uint P0 = uint(pp0);
  uint P1 = uint(pp1);
  // Decoded 8-bit endpoints: mode 6 2q + p, mode 4 q << 3 | q >> 2.
  vec4 d0 = use4 ? g0 * 8.0 + floor(g0 * 0.25) : g0 * 2.0 + float(P0);
  vec4 d1 = use4 ? g1 * 8.0 + floor(g1 * 0.25) : g1 * 2.0 + float(P1);
  float Lc = use4 ? (idx1 ? 7.0 : 3.0) : 15.0;

  float tau0 = dot(d0 - p0v, axisF);
  float tau1 = dot(d1 - p0v, axisF);
  float span = tau1 - tau0;
  float kc = 0.0;
  float oc = 0.0;
  if (abs(span) > 0.25) {
    kc = Lc / span;
    oc = 0.5 - tau0 * kc;
  }
  // Anchor rule up front (pixel 0 projects to t = 0, index ⌊oc⌋).
  if (min(floor(oc), Lc) >= (Lc + 1.0) * 0.5) {
    uvec4 tq = q0c; q0c = q1c; q1c = tq;
    uint tp = P0; P0 = P1; P1 = tp;
    oc = 0.5 + tau1 * kc;
    kc = -kc;
  }
  float fa = 0.0;
  float fb = 0.0;
  float fc = 0.0;
  float w = 1.0;
  for (int k = 0; k < 16; k++) {
    float sg = clamp(floor(gT[k] * kc + oc), 0.0, Lc);
    if (k == 0) { sg = min(sg, floor(Lc * 0.5)); }
    if (k < 6) { fa = fa + sg * w; } else if (k < 12) { fb = fb + sg * w; } else { fc = fc + sg * w; }
    w = (k == 5 || k == 11) ? 1.0 : w * 16.0;
  }
  uint ub = uint(fb);
  uint ilo = uint(fa) | (ub << 24u);
  uint ihi = (ub >> 8u) | (uint(fc) << 16u);

  if (!use4) {
    outColor = uvec4(
      0x40u | (q0c.x << 7u) | (q1c.x << 14u) | (q0c.y << 21u) | (q1c.y << 28u),
      (q1c.y >> 4u) | (q0c.z << 3u) | (q1c.z << 10u) | (q0c.w << 17u) | (q1c.w << 24u) | (P0 << 31u),
      P1 | ((ilo & 0x7u) << 1u) | (ilo & 0xFFFFFFF0u),
      ihi
    );
  } else {
    uint vb = uint(gb);
    uint slo = uint(ga) | (vb << 24u);
    uint shi = (vb >> 8u) | (uint(gc) << 16u);
    uint c2 = compact2(idx1 ? slo : ilo) | (compact2(idx1 ? shi : ihi) << 16u);
    uint iA = compact3(idx1 ? ilo : slo);
    uint iB = compact3(idx1 ? ihi : shi);
    uint R0 = ch == 0u ? q0c.w : q0c.x;
    uint G0 = ch == 1u ? q0c.w : q0c.y;
    uint B0 = ch == 2u ? q0c.w : q0c.z;
    uint R1 = ch == 0u ? q1c.w : q1c.x;
    uint G1 = ch == 1u ? q1c.w : q1c.y;
    uint B1 = ch == 2u ? q1c.w : q1c.z;
    uint rot = (ch + 1u) & 3u;
    uint field2 = (c2 & 1u) | ((c2 >> 2u) << 1u);
    uint fLo = (iA & 3u) | ((iA >> 3u) << 2u) | (iB << 23u);
    uint fHi = iB >> 9u;
    outColor = uvec4(
      0x10u | (rot << 5u) | (uint(idx1) << 7u) | (R0 << 8u) | (R1 << 13u) | (G0 << 18u) | (G1 << 23u) | (B0 << 28u),
      (B0 >> 4u) | (B1 << 1u) | (A0 << 6u) | (A1 << 12u) | ((field2 & 0x3FFFu) << 18u),
      (field2 >> 14u) | (fLo << 17u),
      (fLo >> 15u) | (fHi << 17u)
    );
  }
}
`,a=String.raw`#version 300 es
// ASTC 4×4 LDR fragment-shader encoder — WebGL2 port of astc4x4.wgsl.
//
// One fragment per 4×4 block → 16-byte block as 4 × u32 in outColor.
// Restricted subset: single partition, no dual-plane, with the block class
// picked per block from the content (see astc4x4_ref.ts for layouts, block
// modes, the QUANT_192 trit ISE and the weight-stream bit order):
//   gray + opaque → CEM 0  (luminance), 5-bit weights, mode 0x253
//   opaque        → CEM 8  (RGB), 3-channel PCA extents, two bit budgets:
//                   span > 12 → QUANT_192 endpoints (trit ISE) + 4-bit
//                   weights, mode 0x242; span ≤ 12 → 8-bit endpoints +
//                   3-bit weights, mode 0x053
//   translucent   → CEM 12 (RGBA), 2-bit weights, mode 0x042 — PCA seed →
//                   fused projection + least-squares refit, the fit pass's
//                   weights shipped
// Same algorithm and arithmetic as astc4x4.wgsl (roundEven == WGSL round());
// see astc4x4_fast_f16.wgsl for the design measurements.

precision highp float;
precision highp int;

uniform sampler2D uSrc;
uniform ivec2 uSrcSize;
uniform int uFlipY;

layout(location = 0) out uvec4 outColor;

ivec4 gPixels[16];

ivec4 to8(vec4 v) {
  return ivec4(clamp(floor(v * 255.0 + 0.5), vec4(0.0), vec4(255.0)));
}

// GLSL ES 3.00 has no bitfieldReverse; classic 5-step swap. Weight-stream
// bit q lives at block bit 127 − q, so a stream word assembled LSB-first
// maps onto a block word with one reversal (see astc4x4.wgsl).
uint rev32(uint x) {
  uint v = x;
  v = ((v & 0x55555555u) << 1) | ((v >> 1) & 0x55555555u);
  v = ((v & 0x33333333u) << 2) | ((v >> 2) & 0x33333333u);
  v = ((v & 0x0F0F0F0Fu) << 4) | ((v >> 4) & 0x0F0F0F0Fu);
  v = ((v & 0x00FF00FFu) << 8) | ((v >> 8) & 0x00FF00FFu);
  return (v << 16) | (v >> 16);
}

// Principal colour axis via covariance power-iteration (RGBA, 8-bit integer
// pixel domain), seeded with the bbox diagonal. Returns a unit axis, or
// vec4(0.0) for a degenerate (constant) block. The bbox diagonal alone is
// sign-blind and points across anti-correlated data (normal maps, hue
// edges) instead of along it.
vec4 principalAxis4(vec4 mean, vec4 seed, int iters) {
  vec4 c0v = vec4(0.0);
  vec4 c1v = vec4(0.0);
  vec4 c2v = vec4(0.0);
  vec4 c3v = vec4(0.0);
  for (int k = 0; k < 16; k++) {
    vec4 d = vec4(gPixels[k]) - mean;
    c0v += d.x * d;
    c1v += d.y * d;
    c2v += d.z * d;
    c3v += d.w * d;
  }
  vec4 v = seed;
  float len = length(v);
  if (len < 1e-9) { return vec4(0.0); }
  v = v / len;
  for (int it = 0; it < iters; it++) {
    vec4 nv = vec4(dot(c0v, v), dot(c1v, v), dot(c2v, v), dot(c3v, v));
    len = length(nv);
    if (len < 1e-12) { return vec4(0.0); }
    v = nv / len;
  }
  return v;
}

// Principal RGB axis for opaque blocks (alpha is constant there, so the
// 4th covariance lane is dead weight). Same iteration as principalAxis4.
vec3 principalAxis3(vec3 mean, vec3 seed) {
  vec3 c0v = vec3(0.0);
  vec3 c1v = vec3(0.0);
  vec3 c2v = vec3(0.0);
  for (int k = 0; k < 16; k++) {
    vec3 d = vec3(gPixels[k].xyz) - mean;
    c0v += d.x * d;
    c1v += d.y * d;
    c2v += d.z * d;
  }
  vec3 v = seed;
  float len = length(v);
  if (len < 1e-9) { return vec3(0.0); }
  v = v / len;
  for (int it = 0; it < 8; it++) {
    vec3 nv = vec3(dot(c0v, v), dot(c1v, v), dot(c2v, v));
    len = length(nv);
    if (len < 1e-12) { return vec3(0.0); }
    v = nv / len;
  }
  return v;
}

// One pass over the block: project every pixel onto the e0→e1 line (4
// colinear levels, so the nearest entry is the rounded projection), pack
// the 2-bit weights, and solve the least-squares refit from the
// normal-equation sums accumulated in the same pass.
struct Fit { ivec4 e0; ivec4 e1; bool valid; uint wstream; };
Fit projFit(ivec4 e0, ivec4 e1) {
  Fit r;
  r.e0 = ivec4(0);
  r.e1 = ivec4(0);
  r.valid = false;
  r.wstream = 0u;
  vec4 dir = vec4(e1 - e0);
  float dd = dot(dir, dir);
  if (dd == 0.0) { return r; }
  vec4 e0f = vec4(e0);
  float inv = 3.0 / dd;
  float sAA = 0.0;
  float sBB = 0.0;
  float sAB = 0.0;
  vec4 sAV = vec4(0.0);
  vec4 sBV = vec4(0.0);
  float sMin = 3.0;
  float sMax = 0.0;
  for (int k = 0; k < 16; k++) {
    vec4 v = vec4(gPixels[k]);
    float s = clamp(floor(dot(v - e0f, dir) * inv + 0.5), 0.0, 3.0);
    r.wstream |= uint(s) << (2u * uint(k));
    sMin = min(sMin, s);
    sMax = max(sMax, s);
    float b = s * (1.0 / 3.0);
    float a = 1.0 - b;
    sAA += a * a; sBB += b * b; sAB += a * b;
    sAV += a * v; sBV += b * v;
  }
  // Rank-1 guard: one level ⇒ singular system (the solve would be noise).
  if (sMin == sMax) { return r; }
  float det = sAA * sBB - sAB * sAB;
  if (abs(det) < 1e-3) { return r; }
  r.e0 = ivec4(clamp(roundEven((sBB * sAV - sAB * sBV) / det), vec4(0.0), vec4(255.0)));
  r.e1 = ivec4(clamp(roundEven((sAA * sBV - sAB * sAV) / det), vec4(0.0), vec4(255.0)));
  r.valid = true;
  return r;
}

// ISE trit-block encoder: 5 trits → the 8-bit T field (the inverse of the
// spec's trit-block decode; see astc4x4_ref.ts).
uint tritEnc(uint t0, uint t1, uint t2, uint t3, uint t4) {
  uint c = (t2 == 2u && t1 == 2u) ? (12u | t0)
    : (t2 == 2u ? ((t1 << 4u) | (t0 << 2u) | 3u) : ((t2 << 4u) | (t1 << 2u) | t0));
  return (t3 == 2u && t4 == 2u) ? (((c >> 2u) << 5u) | 28u | (c & 3u))
    : (t4 == 2u ? ((t3 << 7u) | 96u | c) : ((t4 << 7u) | (t3 << 5u) | c));
}

// Nearest QUANT_192 endpoint to x ∈ [0,255]; returns (ISE value =
// trit·64 + bits, unquantised level). See astc4x4_fast_f16.wgsl.
uvec2 q192(float x) {
  uint v = uint(clamp(floor(x + 0.5), 0.0, 255.0));
  bool up = v > 127u;
  uint u = up ? 255u - v : v;
  if ((u & 3u) == 3u) {
    float xu = up ? 255.0 - x : x;
    u = (xu > float(u) && u < 127u) ? u + 1u : u - 1u;
  }
  return uvec2(((u & 3u) << 6u) | ((u >> 2u) << 1u) | (up ? 1u : 0u), up ? 255u - u : u);
}

void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * 4;
  ivec2 maxXY = uSrcSize - ivec2(1);

  ivec4 lo = ivec4(255);
  ivec4 hi = ivec4(0);
  ivec4 isum = ivec4(0);
  int gd = 0; // max |R−G|, |R−B| over the block; 0 ⇔ exactly grayscale
  for (int i = 0; i < 16; i++) {
    ivec2 p = clamp(base + ivec2(i & 3, i >> 2), ivec2(0), maxXY);
    int sy = (uFlipY != 0) ? (uSrcSize.y - 1 - p.y) : p.y;
    ivec4 px = to8(texelFetch(uSrc, ivec2(p.x, sy), 0));
    gPixels[i] = px;
    lo = min(lo, px);
    hi = max(hi, px);
    isum += px;
    gd = max(gd, max(abs(px.x - px.y), abs(px.x - px.z)));
  }
  bool opaque = lo.w == 255;

  uint w0 = 0u; uint w1 = 0u; uint w2 = 0u; uint w3 = 0u;

  if (opaque && gd == 0) {
    // ---------------- Luminance path: CEM 0, 5-bit weights ----------------
    // Endpoints at the exact extremes; 32 palette levels make an LSQ refit
    // unnecessary.
    uint L0 = uint(lo.x);
    uint L1 = uint(hi.x);
    uint s0 = 0u; uint s1 = 0u; uint s2 = 0u;
    if (L1 > L0) {
      float sc = 64.0 / float(hi.x - lo.x);
      // Exact nearest entry of the QUANT_32 grid: unq = 2w for w ≤ 15,
      // 2w + 2 for w ≥ 16 (4-wide gap at the middle, so uniform rounding
      // is wrong there). Best candidate of each half, keep the closer.
      for (int k = 0; k < 16; k++) {
        float u = clamp(float(gPixels[k].x - lo.x) * sc, 0.0, 64.0);
        float wlo = clamp(floor(u * 0.5 + 0.5), 0.0, 15.0);
        float whi = clamp(floor((u - 2.0) * 0.5 + 0.5), 16.0, 31.0);
        bool pick = abs(u - wlo * 2.0) <= abs(u - (whi * 2.0 + 2.0));
        uint w = uint(pick ? wlo : whi);
        // Stream bit q = 5k + j; straddles handled with constant shifts.
        uint off = 5u * uint(k);
        if (off < 28u) { s0 |= (w << off); }
        else if (off == 30u) { s0 |= (w << 30u); s1 |= (w >> 2u); }
        else if (off < 60u) { s1 |= (w << (off - 32u)); }
        else if (off == 60u) { s1 |= (w << 28u); s2 |= (w >> 4u); }
        else { s2 |= (w << (off - 64u)); }
      }
    }
    // Mode 0x253, partitions−1 = 0, CEM 0, L0 @17, L1 @25 (top bit spills
    // into word 1 bit 0); stream words map onto block words via rev32.
    w0 = 0x253u | (L0 << 17u) | (L1 << 25u);
    w1 = (L1 >> 7u) | rev32(s2);
    w2 = rev32(s1);
    w3 = rev32(s0);
  } else if (opaque) {
    // ------------- Opaque colour: CEM 8, two bit budgets -------------------
    // span > 12 → QUANT_192 endpoints + 4-bit weights (mode 0x242), else
    // exact 8-bit endpoints + 3-bit weights (mode 0x053); endpoints are the
    // bbox-clamped PCA extents.
    vec3 mean3 = vec3(isum.xyz) * (1.0 / 16.0);
    vec3 lo3 = vec3(lo.xyz);
    vec3 hi3 = vec3(hi.xyz);
    vec3 x0 = lo3;
    vec3 x1 = hi3;
    vec3 axis = principalAxis3(mean3, hi3 - lo3);
    if (dot(axis, axis) > 0.0) {
      float tMin = 1e30;
      float tMax = -1e30;
      for (int k = 0; k < 16; k++) {
        float t = dot(vec3(gPixels[k].xyz) - mean3, axis);
        tMin = min(tMin, t);
        tMax = max(tMax, t);
      }
      x0 = clamp(mean3 + tMin * axis, lo3, hi3);
      x1 = clamp(mean3 + tMax * axis, lo3, hi3);
    }
    ivec3 span3 = hi.xyz - lo.xyz;
    bool small = max(max(span3.x, span3.y), span3.z) <= 12;
    uvec2 r0; uvec2 g0; uvec2 b0;
    uvec2 r1; uvec2 g1; uvec2 b1;
    if (small) {
      uvec3 q0 = uvec3(clamp(floor(x0 + 0.5), vec3(0.0), vec3(255.0)));
      uvec3 q1 = uvec3(clamp(floor(x1 + 0.5), vec3(0.0), vec3(255.0)));
      r0 = uvec2(q0.x); g0 = uvec2(q0.y); b0 = uvec2(q0.z);
      r1 = uvec2(q1.x); g1 = uvec2(q1.y); b1 = uvec2(q1.z);
    } else {
      r0 = q192(x0.x); g0 = q192(x0.y); b0 = q192(x0.z);
      r1 = q192(x1.x); g1 = q192(x1.y); b1 = q192(x1.z);
    }
    // Blue-contraction ordering on the unquantised levels.
    if (r0.y + g0.y + b0.y > r1.y + g1.y + b1.y) {
      uvec2 tr = r0; r0 = r1; r1 = tr;
      uvec2 tg = g0; g0 = g1; g1 = tg;
      uvec2 tb = b0; b0 = b1; b1 = tb;
    }
    vec3 d0 = vec3(uvec3(r0.y, g0.y, b0.y));
    vec3 d1 = vec3(uvec3(r1.y, g1.y, b1.y));
    // One weight loop for both budgets; weights as 4-bit nibbles.
    float lmax = small ? 7.0 : 15.0;
    vec3 dir = d1 - d0;
    float dd = dot(dir, dir);
    uint s0 = 0u;
    uint s1 = 0u;
    if (dd > 0.0) {
      float inv = lmax / dd;
      for (int k = 0; k < 8; k++) {
        uint w = uint(clamp(floor(dot(vec3(gPixels[k].xyz) - d0, dir) * inv + 0.5), 0.0, lmax));
        s0 |= w << (4u * uint(k));
      }
      for (int k = 8; k < 16; k++) {
        uint w = uint(clamp(floor(dot(vec3(gPixels[k].xyz) - d0, dir) * inv + 0.5), 0.0, lmax));
        s1 |= w << (4u * uint(k - 8));
      }
    }
    if (small) {
      // Mode 0x053: plain 8-bit endpoints; the 3-bit weight stream is the
      // nibbles compacted (8 nibbles → 24 bits).
      uint c0 = (s0 & 0x07070707u) | ((s0 & 0x70707070u) >> 1u);
      c0 = (c0 & 0x003F003Fu) | ((c0 & 0x3F003F00u) >> 2u);
      c0 = (c0 & 0x00000FFFu) | ((c0 & 0x0FFF0000u) >> 4u);
      uint c1 = (s1 & 0x07070707u) | ((s1 & 0x70707070u) >> 1u);
      c1 = (c1 & 0x003F003Fu) | ((c1 & 0x3F003F00u) >> 2u);
      c1 = (c1 & 0x00000FFFu) | ((c1 & 0x0FFF0000u) >> 4u);
      w0 = 0x053u | (8u << 13u) | (r0.x << 17u) | (r1.x << 25u);
      w1 = (r1.x >> 7u) | (g0.x << 1u) | (g1.x << 9u) | (b0.x << 17u) | (b1.x << 25u);
      w2 = (b1.x >> 7u) | rev32(c1 >> 8u);
      w3 = rev32(c0 | (c1 << 24u));
    } else {
      // Mode 0x242: trit-ISE QUANT_192 endpoints (v0..v5 = R0 R1 G0 G1 B0
      // B1, 46 bits from bit 17: group 1 = v0..v4 with trit field T, group
      // 2 = v5 with its lone trit as 2 bits), 4-bit weights.
      uint tg = tritEnc(r0.x >> 6u, r1.x >> 6u, g0.x >> 6u, g1.x >> 6u, b0.x >> 6u);
      w0 = 0x242u | (8u << 13u) | ((r0.x & 63u) << 17u) | ((tg & 3u) << 23u) | ((r1.x & 63u) << 25u) | (((tg >> 2u) & 1u) << 31u);
      w1 = ((tg >> 3u) & 1u) | ((g0.x & 63u) << 1u) | (((tg >> 4u) & 1u) << 7u) | ((g1.x & 63u) << 8u)
        | (((tg >> 5u) & 3u) << 14u) | ((b0.x & 63u) << 16u) | ((tg >> 7u) << 22u) | ((b1.x & 63u) << 23u)
        | ((b1.x >> 6u) << 29u);
      w2 = rev32(s1);
      w3 = rev32(s0);
    }
  } else {
    // ------------- Translucent: CEM 12, 2-bit weights, PCA seed + refit ----
    vec4 mean = vec4(isum) * (1.0 / 16.0);
    // Fused LSQ fit seeded from the block's principal RGBA axis (4 power
    // iterations — the refit absorbs residual axis error) at the exact
    // projection extents, clamped to the block bbox (the unconstrained solve
    // extrapolates outside multi-cluster blocks and would bend the hue).
    ivec4 seed0 = lo;
    ivec4 seed1 = hi;
    vec4 axis = principalAxis4(mean, vec4(hi - lo), 4);
    if (dot(axis, axis) > 0.0) {
      float tMin = 1e30;
      float tMax = -1e30;
      for (int k = 0; k < 16; k++) {
        float t = dot(vec4(gPixels[k]) - mean, axis);
        tMin = min(tMin, t);
        tMax = max(tMax, t);
      }
      seed0 = ivec4(clamp(roundEven(mean + tMin * axis), vec4(0.0), vec4(255.0)));
      seed1 = ivec4(clamp(roundEven(mean + tMax * axis), vec4(0.0), vec4(255.0)));
    }
    ivec4 e0 = lo;
    ivec4 e1 = hi;
    uint fitStream = 0u;
    bool haveFitWeights = false;
    Fit r = projFit(seed0, seed1);
    if (r.valid) {
      e0 = clamp(r.e0, lo, hi);
      e1 = clamp(r.e1, lo, hi);
      fitStream = r.wstream;
      haveFitWeights = true;
    }
    bool swapped = false;
    if (e0.x + e0.y + e0.z > e1.x + e1.y + e1.z) {
      ivec4 t = e0; e0 = e1; e1 = t;
      swapped = true;
    }
    uvec4 E0 = uvec4(e0);
    uvec4 E1 = uvec4(e1);
    // Valid fits ship the fit-pass weights; the blue-contraction swap is a
    // full reflection w → 3−w = bitwise NOT of the packed stream.
    uint s0 = 0u;
    if (haveFitWeights) {
      s0 = swapped ? ~fitStream : fitStream;
    } else {
      vec4 dir = vec4(e1 - e0);
      float dd = dot(dir, dir);
      vec4 e0f = vec4(e0);
      if (dd > 0.0) {
        float inv = 3.0 / dd;
        for (int k = 0; k < 16; k++) {
          uint w = uint(clamp(floor(dot(vec4(gPixels[k]) - e0f, dir) * inv + 0.5), 0.0, 3.0));
          s0 |= w << (2u * uint(k));
        }
      }
    }
    // Mode 0x042, CEM 12 @13, endpoints R0 R1 G0 G1 B0 B1 A0 A1 from 17.
    w0 = 0x042u | (12u << 13u) | (E0.x << 17u) | (E1.x << 25u);
    w1 = (E1.x >> 7u) | (E0.y << 1u) | (E1.y << 9u) | (E0.z << 17u) | (E1.z << 25u);
    w2 = (E1.z >> 7u) | (E0.w << 1u) | (E1.w << 9u);
    w3 = rev32(s0);
  }

  outColor = uvec4(w0, w1, w2, w3);
}
`,o=String.raw`#version 300 es
// Fullscreen-triangle vertex shader for the WebGL block encoders.
//
// Draws a single oversized triangle covering the viewport from gl_VertexID
// alone — no vertex buffers / attributes needed (drawArrays(TRIANGLES, 0, 3)).
// The encoder sets the viewport to (blocks_x × blocks_y), so each rasterised
// fragment corresponds to exactly one 4×4 output block.
//
//   id 0 -> (-1,-1)   id 1 -> ( 3,-1)   id 2 -> (-1, 3)

void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`,s=4194304;function c(e){try{if(new Uint8Array(Uint32Array.of(16909060).buffer)[0]!==4||typeof e.getExtension!=`function`||typeof e.texStorage2D!=`function`||typeof e.readPixels!=`function`||typeof e.compressedTexSubImage2D!=`function`)return{bc7:!1,astc4x4:!1};let t=e.getExtension(`EXT_texture_compression_bptc`),n=e.getExtension(`WEBGL_compressed_texture_astc`);return{bc7:typeof t?.COMPRESSED_RGBA_BPTC_UNORM_EXT==`number`,astc4x4:typeof n?.COMPRESSED_RGBA_ASTC_4x4_KHR==`number`&&(!n.getSupportedProfiles||n.getSupportedProfiles().includes(`ldr`))}}catch{return{bc7:!1,astc4x4:!1}}}var l=class{gl;programs=new Map;failed=new Set;available;workspace=null;wasContextLost=!1;onContextLost=()=>{this.wasContextLost=!0,this.releaseWorkspace(),this.releasePrograms()};constructor(e){this.gl=e,this.available=c(e),e.canvas?.addEventListener?.(`webglcontextlost`,this.onContextLost)}get capabilities(){return this.refreshContext()?{bc7:this.available.bc7&&!this.failed.has(`bc7`),astc4x4:this.available.astc4x4&&!this.failed.has(`astc-4x4`)}:{bc7:!1,astc4x4:!1}}get workspaceBytes(){return this.workspace?.bytes??0}encode(r,i,a,o,c=s,l){e(l);let u=this.capabilities;if(!(o===`bc7`?u.bc7:u.astc4x4)||typeof this.gl.getBufferSubData!=`function`)throw Error(`WebGL ${o} block readback is unavailable.`);let f=this.gl,g=p(f);try{let s=t(i,a,o);if(s[0].width>Number(f.getParameter(f.MAX_TEXTURE_SIZE))||s[0].height>Number(f.getParameter(f.MAX_TEXTURE_SIZE)))throw Error(`Block-aligned raster exceeds this context's texture dimension limit.`);let u=new Uint8Array(s.reduce((e,t)=>e+t.byteLength,0)),p=this.getProgram(o);m(f);let h=this.getWorkspace(c);f.bindFramebuffer(f.FRAMEBUFFER,h.framebuffer),f.readBuffer(f.COLOR_ATTACHMENT0),f.useProgram(p.program),f.bindVertexArray(h.vao),f.uniform1i(p.source,0),f.uniform1i(p.flip,0);let g=0;for(let t of n(r,i,a,l)){let n=Math.ceil(t.width/4);for(let r=0;r<t.height;r+=h.blockRows*4){e(l);let i=Math.min(h.blockRows*4,t.height-r),a=Math.ceil(i/4),c=n*a*16;f.bindTexture(f.TEXTURE_2D,h.source),f.texSubImage2D(f.TEXTURE_2D,0,0,0,t.width,i,f.RGBA,f.UNSIGNED_BYTE,t.data.subarray(r*t.width*4,(r+i)*t.width*4)),f.uniform2i(p.size,t.width,i),f.viewport(0,0,n,a),f.drawArrays(f.TRIANGLES,0,3),f.bindBuffer(f.PIXEL_PACK_BUFFER,h.buffer),f.readPixels(0,0,n,a,f.RGBA_INTEGER,f.UNSIGNED_INT,0);let m=s[g].byteOffset+r/4*n*16;f.getBufferSubData(f.PIXEL_PACK_BUFFER,0,u.subarray(m,m+c)),d(f,`${o} mip ${g} band readback`)}g++}return e(l),u}catch(e){throw l?.aborted||this.failed.add(o),this.releaseWorkspace(),e}finally{h(f,g)}}uploadEncoded(e,n,r,i){let a=t(n,r,i),o=a.reduce((e,t)=>e+t.byteLength,0);if(!(e instanceof Uint8Array)||e.length!==o)throw RangeError(`Incorrect encoded raster mip byte length.`);let s=this.capabilities;if(!(i===`bc7`?s.bc7:s.astc4x4))throw Error(`WebGL ${i} compression is unavailable.`);let c=this.gl,l=p(c),f=a[0],g=null;try{if(f.width>Number(c.getParameter(c.MAX_TEXTURE_SIZE))||f.height>Number(c.getParameter(c.MAX_TEXTURE_SIZE)))throw Error(`Block-aligned raster exceeds this context's texture dimension limit.`);m(c),g=u(c.createTexture(),`compressed texture`),c.bindTexture(c.TEXTURE_2D,g);let t=i===`bc7`?36492:37808;c.texStorage2D(c.TEXTURE_2D,a.length,t,f.width,f.height),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_MIN_FILTER,c.LINEAR_MIPMAP_LINEAR),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_MAG_FILTER,c.LINEAR),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_WRAP_S,c.CLAMP_TO_EDGE),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_WRAP_T,c.CLAMP_TO_EDGE),c.texParameteri(c.TEXTURE_2D,c.TEXTURE_MAX_LEVEL,a.length-1),d(c,`compressed texture allocation`);for(let[n,r]of a.entries())c.compressedTexSubImage2D(c.TEXTURE_2D,n,0,0,r.width,r.height,t,e.subarray(r.byteOffset,r.byteOffset+r.byteLength)),d(c,`${i} encoded mip ${n} upload`);return{texture:g,estimatedBytes:o,uvScale:[n/f.width,r/f.height]}}catch(e){throw g&&c.deleteTexture(g),this.failed.add(i),this.releaseWorkspace(),e}finally{h(c,l)}}upload(e,i,a,o,c=s){let l=this.capabilities;if(!(o===`bc7`?l.bc7:l.astc4x4))throw Error(`WebGL ${o} compression is unavailable.`);let f=this.gl,g=p(f),_=null;try{let s=t(i,a,o),l=s[0];if(l.width>Number(f.getParameter(f.MAX_TEXTURE_SIZE))||l.height>Number(f.getParameter(f.MAX_TEXTURE_SIZE)))throw Error(`Block-aligned raster exceeds this context's texture dimension limit.`);let p=this.getProgram(o);m(f);let h=this.getWorkspace(c);_=u(f.createTexture(),`compressed texture`),f.bindTexture(f.TEXTURE_2D,_);let g=o===`bc7`?36492:37808;f.texStorage2D(f.TEXTURE_2D,s.length,g,l.width,l.height),f.texParameteri(f.TEXTURE_2D,f.TEXTURE_MIN_FILTER,f.LINEAR_MIPMAP_LINEAR),f.texParameteri(f.TEXTURE_2D,f.TEXTURE_MAG_FILTER,f.LINEAR),f.texParameteri(f.TEXTURE_2D,f.TEXTURE_WRAP_S,f.CLAMP_TO_EDGE),f.texParameteri(f.TEXTURE_2D,f.TEXTURE_WRAP_T,f.CLAMP_TO_EDGE),f.texParameteri(f.TEXTURE_2D,f.TEXTURE_MAX_LEVEL,s.length-1),d(f,`compressed texture allocation`),f.bindFramebuffer(f.FRAMEBUFFER,h.framebuffer),f.readBuffer(f.COLOR_ATTACHMENT0),f.useProgram(p.program),f.bindVertexArray(h.vao),f.uniform1i(p.source,0),f.uniform1i(p.flip,0);let v=0;for(let t of n(e,i,a)){let e=Math.ceil(t.width/4);for(let n=0;n<t.height;n+=h.blockRows*4){let r=Math.min(h.blockRows*4,t.height-n),i=Math.ceil(r/4),a=e*i*16;f.bindBuffer(f.PIXEL_UNPACK_BUFFER,null),f.bindTexture(f.TEXTURE_2D,h.source),f.texSubImage2D(f.TEXTURE_2D,0,0,0,t.width,r,f.RGBA,f.UNSIGNED_BYTE,t.data.subarray(n*t.width*4,(n+r)*t.width*4)),f.uniform2i(p.size,t.width,r),f.viewport(0,0,e,i),f.drawArrays(f.TRIANGLES,0,3),f.bindBuffer(f.PIXEL_PACK_BUFFER,h.buffer),f.readPixels(0,0,e,i,f.RGBA_INTEGER,f.UNSIGNED_INT,0),f.bindBuffer(f.PIXEL_UNPACK_BUFFER,h.buffer),f.bindTexture(f.TEXTURE_2D,_),f.compressedTexSubImage2D(f.TEXTURE_2D,v,0,n,t.width,r,g,a,0),d(f,`${o} mip ${v} band upload`)}v++}return{texture:_,estimatedBytes:r(i,a,o),uvScale:[i/l.width,a/l.height]}}catch(e){throw _&&f.deleteTexture(_),this.failed.add(o),this.releaseWorkspace(),e}finally{h(f,g)}}releaseWorkspace(){let e=this.workspace;if(this.workspace=null,!e)return;let t=this.gl;t.deleteTexture(e.source),t.deleteTexture(e.output),t.deleteFramebuffer(e.framebuffer),t.deleteBuffer(e.buffer),t.deleteVertexArray(e.vao)}dispose(){this.releaseWorkspace(),this.releasePrograms(),this.gl.canvas?.removeEventListener?.(`webglcontextlost`,this.onContextLost)}releasePrograms(){for(let e of this.programs.values())this.gl.deleteProgram(e.program);this.programs.clear()}refreshContext(){return this.gl.isContextLost?.()?(this.onContextLost(),!1):(this.wasContextLost&&(this.wasContextLost=!1,this.failed.clear(),this.available=c(this.gl)),!0)}getProgram(e){let t=this.programs.get(e);if(t)return t;let n=this.gl,r=[],s=null;try{for(let[t,s]of[[n.VERTEX_SHADER,o],[n.FRAGMENT_SHADER,e===`bc7`?i:a]]){let e=u(n.createShader(t),`encoder shader`);if(r.push(e),n.shaderSource(e,s),n.compileShader(e),!n.getShaderParameter(e,n.COMPILE_STATUS))throw Error(n.getShaderInfoLog(e)??`Encoder shader compilation failed.`)}s=u(n.createProgram(),`encoder program`);for(let e of r)n.attachShader(s,e);if(n.linkProgram(s),!n.getProgramParameter(s,n.LINK_STATUS))throw Error(n.getProgramInfoLog(s)??`Encoder program linking failed.`);let t={program:s,source:u(n.getUniformLocation(s,`uSrc`),`source uniform`),size:u(n.getUniformLocation(s,`uSrcSize`),`size uniform`),flip:u(n.getUniformLocation(s,`uFlipY`),`flip uniform`)};return this.programs.set(e,t),t}catch(e){throw s&&n.deleteProgram(s),e}finally{for(let e of r)n.deleteShader(e)}}getWorkspace(e){let t=Math.min(s,Math.max(0,Math.floor(e)));if(this.workspace&&this.workspace.bytes<=t)return this.workspace;this.releaseWorkspace();let n=this.gl,r=Math.floor(Number(n.getParameter(n.MAX_TEXTURE_SIZE))/4)*4,i=r/4,a=r*4*4+i*16*2,o=Math.min(Math.floor(Number(n.getParameter(n.MAX_TEXTURE_SIZE))/4),Math.floor(t/a));if(o<1)throw Error(`Insufficient bounded workspace for one compressed block row.`);let c=null,l=null,f=null,p=null,m=null;try{if(c=u(n.createTexture(),`encoder source texture`),l=u(n.createTexture(),`encoder output texture`),f=u(n.createFramebuffer(),`encoder framebuffer`),p=u(n.createBuffer(),`encoder pixel buffer`),m=u(n.createVertexArray(),`encoder vertex array`),n.bindTexture(n.TEXTURE_2D,c),n.texStorage2D(n.TEXTURE_2D,1,n.RGBA8,r,o*4),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE),n.bindTexture(n.TEXTURE_2D,l),n.texStorage2D(n.TEXTURE_2D,1,n.RGBA32UI,i,o),n.bindFramebuffer(n.FRAMEBUFFER,f),n.framebufferTexture2D(n.FRAMEBUFFER,n.COLOR_ATTACHMENT0,n.TEXTURE_2D,l,0),n.drawBuffers([n.COLOR_ATTACHMENT0]),n.checkFramebufferStatus(n.FRAMEBUFFER)!==n.FRAMEBUFFER_COMPLETE)throw Error(`Integer encoder framebuffer is incomplete.`);return n.bindBuffer(n.PIXEL_PACK_BUFFER,p),n.bufferData(n.PIXEL_PACK_BUFFER,i*o*16,n.STREAM_COPY),d(n,`encoder workspace allocation`),this.workspace={source:c,output:l,framebuffer:f,buffer:p,vao:m,width:r,blockRows:o,bytes:a*o}}catch(e){throw n.deleteTexture(c),n.deleteTexture(l),n.deleteFramebuffer(f),n.deleteBuffer(p),n.deleteVertexArray(m),e}}};function u(e,t){if(e==null)throw Error(`Unable to allocate ${t}.`);return e}function d(e,t){let n=e.getError();if(n!==e.NO_ERROR)throw Error(`${t} failed (WebGL error ${n}).`)}function f(e){return[e.PACK_ALIGNMENT,e.PACK_ROW_LENGTH,e.PACK_SKIP_PIXELS,e.PACK_SKIP_ROWS,e.UNPACK_ALIGNMENT,e.UNPACK_ROW_LENGTH,e.UNPACK_IMAGE_HEIGHT,e.UNPACK_SKIP_PIXELS,e.UNPACK_SKIP_ROWS,e.UNPACK_SKIP_IMAGES,e.UNPACK_FLIP_Y_WEBGL,e.UNPACK_PREMULTIPLY_ALPHA_WEBGL,e.UNPACK_COLORSPACE_CONVERSION_WEBGL]}function p(e){let t=e.getParameter(e.ACTIVE_TEXTURE);return e.activeTexture(e.TEXTURE0),{activeTexture:t,texture:e.getParameter(e.TEXTURE_BINDING_2D),toggles:[e.BLEND,e.DEPTH_TEST,e.STENCIL_TEST,e.SCISSOR_TEST,e.CULL_FACE,e.DITHER,e.RASTERIZER_DISCARD].map(t=>[t,e.isEnabled(t)]),viewport:e.getParameter(e.VIEWPORT),colorMask:e.getParameter(e.COLOR_WRITEMASK),program:e.getParameter(e.CURRENT_PROGRAM),sampler:e.getParameter(e.SAMPLER_BINDING),vao:e.getParameter(e.VERTEX_ARRAY_BINDING),drawFramebuffer:e.getParameter(e.DRAW_FRAMEBUFFER_BINDING),readFramebuffer:e.getParameter(e.READ_FRAMEBUFFER_BINDING),pack:e.getParameter(e.PIXEL_PACK_BUFFER_BINDING),unpack:e.getParameter(e.PIXEL_UNPACK_BUFFER_BINDING),pixels:f(e).map(t=>[t,e.getParameter(t)])}}function m(e){for(let t of[e.BLEND,e.DEPTH_TEST,e.STENCIL_TEST,e.SCISSOR_TEST,e.CULL_FACE,e.DITHER,e.RASTERIZER_DISCARD])e.disable(t);e.colorMask(!0,!0,!0,!0),e.bindSampler(0,null),e.bindBuffer(e.PIXEL_UNPACK_BUFFER,null);for(let t of f(e))e.pixelStorei(t,t===e.PACK_ALIGNMENT||t===e.UNPACK_ALIGNMENT?1:t===e.UNPACK_COLORSPACE_CONVERSION_WEBGL?e.NONE:0)}function h(e,t){e.bindFramebuffer(e.DRAW_FRAMEBUFFER,t.drawFramebuffer),e.bindFramebuffer(e.READ_FRAMEBUFFER,t.readFramebuffer),e.bindBuffer(e.PIXEL_PACK_BUFFER,t.pack),e.bindBuffer(e.PIXEL_UNPACK_BUFFER,t.unpack);for(let[n,r]of t.pixels)e.pixelStorei(n,r);for(let[n,r]of t.toggles)r?e.enable(n):e.disable(n);e.viewport(t.viewport[0],t.viewport[1],t.viewport[2],t.viewport[3]),e.colorMask(t.colorMask[0],t.colorMask[1],t.colorMask[2],t.colorMask[3]),e.useProgram(t.program),e.bindVertexArray(t.vao),e.bindSampler(0,t.sampler),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,t.texture),e.activeTexture(t.activeTexture)}export{l as n,s as t};