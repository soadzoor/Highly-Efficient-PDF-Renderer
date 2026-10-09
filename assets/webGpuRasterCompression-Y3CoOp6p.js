import{en as e,nn as t,rn as n,tn as r}from"./drawCallMetrics-DUT2qjFU.js";var i=`






































struct Params {
  blocks_x: u32,
  blocks_y: u32,
  width:    u32,
  height:   u32,
  y0:       u32, 
  row_stride_blocks: u32, 
};

@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;






const MAGIC = 8388608.0;
const MAGIC_BITS = 0x4B000000u;
fn fbits(x: f32, mask: u32) -> u32 {
  return bitcast<u32>(x + MAGIC) & mask;
}
fn fu(x: f32) -> u32 {
  return bitcast<u32>(x + MAGIC) ^ MAGIC_BITS;
}



const N4: f32 = 38.1;


fn compact2(x: u32) -> u32 {
  var y = (x | (x >> 2u)) & 0x0F0F0F0Fu;
  y = (y | (y >> 4u)) & 0x00FF00FFu;
  return (y | (y >> 8u)) & 0x0000FFFFu;
}
fn compact3(x: u32) -> u32 {
  var y = (x & 0x07070707u) | ((x >> 1u) & 0x38383838u);
  y = (y & 0x003F003Fu) | ((y >> 2u) & 0x0FC00FC0u);
  return (y & 0x00000FFFu) | ((y >> 4u) & 0x00FFF000u);
}



@compute @workgroup_size(8, 8, 1)
fn encode(@builtin(global_invocation_id) gid_raw: vec3<u32>) {
  
  let gid = vec3<u32>(gid_raw.x, gid_raw.y + params.y0, gid_raw.z);
  if (gid.x >= params.blocks_x || gid.y >= params.blocks_y) {
    return;
  }
  let block_index = gid.y * params.row_stride_blocks + gid.x;
  let base = vec2<i32>(i32(gid.x) * 4, i32(gid.y) * 4);
  let mx = vec2<i32>(i32(params.width) - 1, i32(params.height) - 1);

  
  
  var pixels: array<vec4<f32>, 16>;
  var lo = vec4<f32>(255.0);
  var hi = vec4<f32>(0.0);
  var gd = 0.0;
  let xs = min(vec4<i32>(base.x) + vec4<i32>(0, 1, 2, 3), vec4<i32>(mx.x));
  let ys = min(vec4<i32>(base.y) + vec4<i32>(0, 1, 2, 3), vec4<i32>(mx.y));
  for (var i: u32 = 0u; i < 16u; i = i + 1u) {
    let px = clamp(floor(textureLoad(src_tex, vec2<i32>(xs[i & 3u], ys[i >> 2u]), 0) * 255.0 + 0.5), vec4<f32>(0.0), vec4<f32>(255.0));
    pixels[i] = px;
    lo = min(lo, px);
    hi = max(hi, px);
    gd = max(gd, max(abs(px.x - px.y), abs(px.x - px.z)));
  }

  
  
  
  if (lo.w == 255.0 && gd == 0.0) {
    let vmin = lo.x;
    let vmax = hi.x;
    var e0 = vmin;
    var e1 = vmax;
    if (vmax - vmin <= 15.0) {
      if (fract(e0 * 0.5) == 0.0 && e0 > 0.0 && e1 - e0 < 15.0) { e0 = e0 - 1.0; }
      if (fract(e1 * 0.5) == 0.0 && e1 < 255.0 && e1 - e0 < 15.0) { e1 = e1 + 1.0; }
    } else {
      let k1 = 15.0 / (vmax - vmin);
      let k0 = 0.5 - vmin * k1;
      var sL = 0.0;
      var sLL = 0.0;
      var sv = 0.0;
      var sLv = 0.0;
      for (var k: u32 = 0u; k < 16u; k = k + 1u) {
        let v = pixels[k].x;
        let L = floor(v * k1 + k0);
        sL = sL + L;
        sLL = sLL + L * L;
        sv = sv + v;
        sLv = sLv + L * v;
      }
      let C = sLL * (1.0 / 225.0);
      let B = sL * (1.0 / 15.0) - C;
      let A = 16.0 - sL * (2.0 / 15.0) + C;
      let Y = sLv * (1.0 / 15.0);
      let X = sv - Y;
      let det = A * C - B * B;
      if (det > 1e-3) {
        let s0 = clamp((C * X - B * Y) / det, 0.0, 255.0);
        let s1 = clamp((A * Y - B * X) / det, 0.0, 255.0);
        
        let ps0 = vmin - 2.0 * floor(vmin * 0.5);
        let ps1 = vmax - 2.0 * floor(vmax * 0.5);
        var best = 3.0 * (A * vmin * vmin + 2.0 * B * vmin * vmax + C * vmax * vmax - 2.0 * (X * vmin + Y * vmax))
          + A * (1.0 - ps0) + 2.0 * B * (1.0 - ps0) * (1.0 - ps1) + C * (1.0 - ps1);
        for (var pc: u32 = 0u; pc < 4u; pc = pc + 1u) {
          let p0 = f32(pc & 1u);
          let p1 = f32(pc >> 1u);
          let c0 = 2.0 * clamp(floor((s0 - p0) * 0.5 + 0.5), 0.0, 127.0) + p0;
          let c1 = 2.0 * clamp(floor((s1 - p1) * 0.5 + 0.5), 0.0, 127.0) + p1;
          let pr = 3.0 * (A * c0 * c0 + 2.0 * B * c0 * c1 + C * c1 * c1 - 2.0 * (X * c0 + Y * c1))
            + A * (1.0 - p0) + 2.0 * B * (1.0 - p0) * (1.0 - p1) + C * (1.0 - p1);
          if (pr < best) {
            best = pr;
            e0 = c0;
            e1 = c1;
          }
        }
      }
    }
    var glo = 0u;
    var ghi = 0u;
    if (e1 != e0) {
      let k1 = 15.0 / (e1 - e0);
      let k0 = 0.5 - e0 * k1;
      for (var k: u32 = 0u; k < 8u; k = k + 1u) {
        let sg = clamp(floor(pixels[k].x * k1 + k0), 0.0, 15.0);
        glo = glo | (fbits(sg, 15u) << (k * 4u));
      }
      for (var k: u32 = 8u; k < 16u; k = k + 1u) {
        let sg = clamp(floor(pixels[k].x * k1 + k0), 0.0, 15.0);
        ghi = ghi | (fbits(sg, 15u) << ((k - 8u) * 4u));
      }
    }
    var u0 = fu(e0);
    var u1 = fu(e1);
    if ((glo & 0x8u) != 0u) {
      let t = u0; u0 = u1; u1 = t;
      glo = ~glo; ghi = ~ghi;
    }
    let q0 = u0 >> 1u;
    let q1 = u1 >> 1u;
    let og = block_index * 4u;
    dst[og] = 0x40u | (q0 << 7u) | (q1 << 14u) | (q0 << 21u) | (q1 << 28u);
    dst[og + 1u] = (q1 >> 4u) | (q0 << 3u) | (q1 << 10u) | (127u << 17u) | (127u << 24u) | ((u0 & 1u) << 31u);
    dst[og + 2u] = (u1 & 1u) | ((glo & 0x7u) << 1u) | (glo & 0xFFFFFFF0u);
    dst[og + 3u] = ghi;
    return;
  }

  
  
  let p0v = pixels[0];
  pixels[0] = vec4<f32>(0.0);
  var sd = vec4<f32>(0.0);
  var cx = vec4<f32>(0.0);
  var cy = vec3<f32>(0.0);
  var cz = vec2<f32>(0.0);
  var cw = 0.0;
  for (var i: u32 = 1u; i < 16u; i = i + 1u) {
    let d = pixels[i] - p0v;
    pixels[i] = d;
    sd = sd + d;
    cx = cx + d.x * d;
    cy = cy + d.y * d.yzw;
    cz = cz + d.z * d.zw;
    cw = cw + d.w * d.w;
  }
  let md = sd * (1.0 / 16.0);
  let sd4 = sd * 0.25;
  cx = cx - sd4.x * sd4;
  cy = cy - sd4.y * sd4.yzw;
  cz = cz - sd4.z * sd4.zw;
  cw = cw - sd4.w * sd4.w;
  let diag = vec4<f32>(cx.x, cy.x, cz.x, cw);
  let trace = diag.x + diag.y + diag.z + diag.w;

  
  
  var use4 = false;
  var idx1 = false;
  var ch = 0u;
  var cmask = vec4<f32>(1.0);
  var axisF = vec4<f32>(0.0);
  if (trace > 0.254) {
    let s = 1.0 / trace;
    let m0 = cx * s;
    let m1 = vec4<f32>(cx.y, cy) * s;
    let m2 = vec4<f32>(cx.z, cy.y, cz) * s;
    let m3 = vec4<f32>(cx.w, cy.z, cz.y, cw) * s;
    var axis = m0;
    var dm = diag.x;
    if (diag.y > dm) { axis = m1; dm = diag.y; }
    if (diag.z > dm) { axis = m2; dm = diag.z; }
    if (diag.w > dm) { axis = m3; }
    axis = axis * inverseSqrt(dot(axis, axis));
    axis = vec4<f32>(dot(m0, axis), dot(m1, axis), dot(m2, axis), dot(m3, axis));
    axis = vec4<f32>(dot(m0, axis), dot(m1, axis), dot(m2, axis), dot(m3, axis));
    let a4 = max(dot(axis, axis), 1e-12);
    axis = axis * inverseSqrt(a4);
    let lamn = sqrt(sqrt(a4));
    let lam = lamn * trace;

    
    let a2 = axis * axis;
    var nn = vec4<f32>(0.0);
    { let wr = lamn * axis.x - axis * m0; nn = nn + wr * wr * vec4<f32>(0.0, 1.0, 1.0, 1.0); }
    { let wr = lamn * axis.y - axis * m1; nn = nn + wr * wr * vec4<f32>(1.0, 0.0, 1.0, 1.0); }
    { let wr = lamn * axis.z - axis * m2; nn = nn + wr * wr * vec4<f32>(1.0, 1.0, 0.0, 1.0); }
    { let wr = lamn * axis.w - axis * m3; nn = nn + wr * wr * vec4<f32>(1.0, 1.0, 1.0, 0.0); }
    var l3v = sqrt(nn / max(vec4<f32>(1.0) - a2, vec4<f32>(1e-3))) * trace;
    let d1 = max(max(diag.x, diag.y), max(diag.z, diag.w));
    let oh1 = diag == vec4<f32>(d1);
    let dr = select(diag, vec4<f32>(-1.0), oh1);
    let d2 = max(max(dr.x, dr.y), max(dr.z, dr.w));
    l3v = clamp(l3v, select(vec4<f32>(d1), vec4<f32>(d2), oh1), vec4<f32>(trace) - diag);

    let sb = max(l3v, diag) * (48.0 / 49.0) + min(l3v, diag) * (8.0 / 9.0);
    let smax = max(max(sb.x, sb.y), max(sb.z, sb.w));
    use4 = smax - N4 > lam * (224.0 / 225.0);
    if (sb.y == smax) { ch = 1u; }
    if (sb.z == smax) { ch = 2u; }
    if (sb.w == smax) { ch = 3u; }
    let ohc = select(vec4<f32>(0.0), vec4<f32>(1.0), vec4<u32>(ch) == vec4<u32>(0u, 1u, 2u, 3u));
    idx1 = dot(l3v - diag, ohc) > 0.0;

    let col = select(select(select(m0, m1, ch == 1u), m2, ch == 2u), m3, ch == 3u);
    cmask = select(vec4<f32>(1.0), vec4<f32>(1.0) - ohc, use4);
    var v = select(axis, (lamn * axis - dot(axis, ohc) * col) * cmask + (hi - lo) * cmask * (1e-3 / 255.0), use4);
    v = v * inverseSqrt(max(dot(v, v), 1e-12));
    v = vec4<f32>(dot(m0, v), dot(m1, v), dot(m2, v), dot(m3, v)) * cmask;
    let vv = dot(v, v);
    axisF = select(vec4<f32>(0.0), v * inverseSqrt(max(vv, 1e-12)), vv > 1e-6);
  }

  
  
  let chs = vec4<f32>(1.0) - cmask;
  let Ls = select(7.0, 3.0, idx1);
  var A0 = u32(floor(dot(lo, chs) * (63.0 / 255.0) + 0.5));
  var A1 = u32(floor(dot(hi, chs) * (63.0 / 255.0) + 0.5));
  var ks = vec4<f32>(0.0);
  var os = 0.0;
  {
    let d0a = f32((A0 << 2u) | (A0 >> 4u));
    let d1a = f32((A1 << 2u) | (A1 >> 4u));
    let aspan = d1a - d0a;
    if (aspan > 0.0) {
      let sca = Ls / aspan;
      ks = chs * sca;
      os = (dot(p0v, chs) - d0a) * sca + 0.5;
    }
    
    if (floor(os) >= (Ls + 1.0) * 0.5) {
      let t = A0; A0 = A1; A1 = t;
      ks = -ks;
      os = Ls + 1.0 - os;
    }
  }

  
  
  var tv: array<f32, 16>;
  var t_min = 1e30;
  var t_max = -1e30;
  var ga = 0.0;
  var gb = 0.0;
  var gc = 0.0;
  var w3 = 1.0;
  for (var k: u32 = 0u; k < 16u; k = k + 1u) {
    let t = dot(pixels[k], axisF);
    tv[k] = t;
    t_min = min(t_min, t);
    t_max = max(t_max, t);
    var v = clamp(floor(dot(pixels[k], ks) + os), 0.0, Ls);
    if (k == 0u) { v = min(v, floor(Ls * 0.5)); }
    if (k < 6u) { ga = ga + v * w3; } else if (k < 12u) { gb = gb + v * w3; } else { gc = gc + v * w3; }
    w3 = select(w3 * 16.0, 1.0, k == 5u || k == 11u);
  }
  let tm = dot(md, axisF);
  let mean = p0v + md;
  let seed_lo = clamp(mean + (t_min - tm) * axisF, vec4<f32>(0.0), vec4<f32>(255.0));
  let seed_hi = clamp(mean + (t_max - tm) * axisF, vec4<f32>(0.0), vec4<f32>(255.0));

  
  
  let sc = select(0.5, 31.0 / 255.0, use4);
  let cmax = select(127.0, 31.0, use4);
  let y0 = seed_lo * sc;
  let y1 = seed_hi * sc;
  let r0 = min(floor(y0 + 0.5), vec4<f32>(cmax));
  let r1 = min(floor(y1 + 0.5), vec4<f32>(cmax));
  let f0 = min(floor(y0), vec4<f32>(cmax));
  let f1 = min(floor(y1), vec4<f32>(cmax));
  let e0r = r0 - y0;
  let e0f = f0 + 0.5 - y0;
  let e1r = r1 - y1;
  let e1f = f1 + 0.5 - y1;
  let pp0 = !use4 && dot(e0f, e0f) < dot(e0r, e0r);
  let pp1 = !use4 && dot(e1f, e1f) < dot(e1r, e1r);
  let g0 = select(r0, f0, pp0);
  let g1 = select(r1, f1, pp1);
  var q0c = vec4<u32>(g0);
  var q1c = vec4<u32>(g1);
  var P0 = u32(pp0);
  var P1 = u32(pp1);
  
  let d0 = select(g0 * 2.0 + f32(P0), g0 * 8.0 + floor(g0 * 0.25), use4);
  let d1 = select(g1 * 2.0 + f32(P1), g1 * 8.0 + floor(g1 * 0.25), use4);
  let Lc = select(15.0, select(3.0, 7.0, idx1), use4);

  let tau0 = dot(d0 - p0v, axisF);
  let tau1 = dot(d1 - p0v, axisF);
  let span = tau1 - tau0;
  var kc = 0.0;
  var oc = 0.0;
  if (abs(span) > 0.25) {
    kc = Lc / span;
    oc = 0.5 - tau0 * kc;
  }
  
  if (min(floor(oc), Lc) >= (Lc + 1.0) * 0.5) {
    let tq = q0c; q0c = q1c; q1c = tq;
    let tp = P0; P0 = P1; P1 = tp;
    oc = 0.5 + tau1 * kc;
    kc = -kc;
  }
  var fa = 0.0;
  var fb = 0.0;
  var fc = 0.0;
  var w = 1.0;
  for (var k: u32 = 0u; k < 16u; k = k + 1u) {
    var sg = clamp(floor(tv[k] * kc + oc), 0.0, Lc);
    if (k == 0u) { sg = min(sg, floor(Lc * 0.5)); }
    if (k < 6u) { fa = fa + sg * w; } else if (k < 12u) { fb = fb + sg * w; } else { fc = fc + sg * w; }
    w = select(w * 16.0, 1.0, k == 5u || k == 11u);
  }
  let ub = u32(fb);
  let ilo = u32(fa) | (ub << 24u);
  let ihi = (ub >> 8u) | (u32(fc) << 16u);

  let o = block_index * 4u;
  if (!use4) {
    dst[o] = 0x40u | (q0c.x << 7u) | (q1c.x << 14u) | (q0c.y << 21u) | (q1c.y << 28u);
    dst[o + 1u] = (q1c.y >> 4u) | (q0c.z << 3u) | (q1c.z << 10u) | (q0c.w << 17u) | (q1c.w << 24u) | (P0 << 31u);
    dst[o + 2u] = P1 | ((ilo & 0x7u) << 1u) | (ilo & 0xFFFFFFF0u);
    dst[o + 3u] = ihi;
  } else {
    let vb = u32(gb);
    let slo = u32(ga) | (vb << 24u);
    let shi = (vb >> 8u) | (u32(gc) << 16u);
    let c2 = compact2(select(ilo, slo, idx1)) | (compact2(select(ihi, shi, idx1)) << 16u);
    let iA = compact3(select(slo, ilo, idx1));
    let iB = compact3(select(shi, ihi, idx1));
    let R0 = select(q0c.x, q0c.w, ch == 0u);
    let G0 = select(q0c.y, q0c.w, ch == 1u);
    let B0 = select(q0c.z, q0c.w, ch == 2u);
    let R1 = select(q1c.x, q1c.w, ch == 0u);
    let G1 = select(q1c.y, q1c.w, ch == 1u);
    let B1 = select(q1c.z, q1c.w, ch == 2u);
    let rot = (ch + 1u) & 3u;
    let field2 = (c2 & 1u) | ((c2 >> 2u) << 1u);
    let f_lo = (iA & 3u) | ((iA >> 3u) << 2u) | (iB << 23u);
    let f_hi = iB >> 9u;
    dst[o] = 0x10u | (rot << 5u) | (u32(idx1) << 7u) | (R0 << 8u) | (R1 << 13u) | (G0 << 18u) | (G1 << 23u) | (B0 << 28u);
    dst[o + 1u] = (B0 >> 4u) | (B1 << 1u) | (A0 << 6u) | (A1 << 12u) | ((field2 & 0x3FFFu) << 18u);
    dst[o + 2u] = (field2 >> 14u) | (f_lo << 17u);
    dst[o + 3u] = (f_lo >> 15u) | (f_hi << 17u);
  }
}
`,a=`




































struct Params {
  blocks_x: u32,
  blocks_y: u32,
  width:    u32,
  height:   u32,
  y0:       u32, 
  row_stride_blocks: u32, 
};

@group(0) @binding(0) var src_tex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;





const MAGIC = 8388608.0;
const MAGIC_BITS = 0x4B000000u;
fn fbits(x: f32, mask: u32) -> u32 {
  return bitcast<u32>(x + MAGIC) & mask;
}
fn fu(x: f32) -> u32 {
  return bitcast<u32>(x + MAGIC) ^ MAGIC_BITS;
}
fn fu3(x: vec3<f32>) -> vec3<u32> {
  return bitcast<vec3<u32>>(x + MAGIC) ^ vec3<u32>(MAGIC_BITS);
}
fn fi4(x: vec4<f32>) -> vec4<i32> {
  return bitcast<vec4<i32>>(bitcast<vec4<u32>>(x + MAGIC) ^ vec4<u32>(MAGIC_BITS));
}

fn to8(v: vec4<f32>) -> vec4<i32> {
  return fi4(clamp(floor(v * 255.0 + 0.5), vec4<f32>(0.0), vec4<f32>(255.0)));
}






struct Fit { e0: vec4<i32>, e1: vec4<i32>, valid: bool, wstream: u32 };
fn proj_fit(pixels: ptr<function, array<vec4<i32>, 16>>, e0: vec4<i32>, e1: vec4<i32>) -> Fit {
  var out: Fit;
  out.valid = false;
  out.wstream = 0u;
  let dir = vec4<f32>(e1 - e0);
  let dd = dot(dir, dir);
  if (dd == 0.0) { return out; }
  let e0f = vec4<f32>(e0);
  let inv = 3.0 / dd;
  var sAA: f32 = 0.0; var sBB: f32 = 0.0; var sAB: f32 = 0.0;
  var sAV: vec4<f32> = vec4<f32>(0.0); var sBV: vec4<f32> = vec4<f32>(0.0);
  var s_min = 3.0; var s_max = 0.0;
  for (var k: u32 = 0u; k < 16u; k = k + 1u) {
    let v = vec4<f32>((*pixels)[k]);
    let s = clamp(floor(dot(v - e0f, dir) * inv + 0.5), 0.0, 3.0);
    out.wstream = out.wstream | (fbits(s, 3u) << (2u * k));
    s_min = min(s_min, s); s_max = max(s_max, s);
    let b = s * (1.0 / 3.0); let a = 1.0 - b;
    sAA = sAA + a * a; sBB = sBB + b * b; sAB = sAB + a * b;
    sAV = sAV + a * v; sBV = sBV + b * v;
  }
  
  
  
  if (s_min == s_max) { return out; }
  let det = sAA * sBB - sAB * sAB;
  if (abs(det) < 1e-3) { return out; }
  out.e0 = fi4(clamp(round((sBB * sAV - sAB * sBV) / det), vec4<f32>(0.0), vec4<f32>(255.0)));
  out.e1 = fi4(clamp(round((sAA * sBV - sAB * sAV) / det), vec4<f32>(0.0), vec4<f32>(255.0)));
  out.valid = true;
  return out;
}






fn principal_axis4(
  pixels: ptr<function, array<vec4<i32>, 16>>,
  mean: vec4<f32>,
  seed: vec4<f32>,
  iters: u32,
) -> vec4<f32> {
  var c0v = vec4<f32>(0.0);
  var c1v = vec4<f32>(0.0);
  var c2v = vec4<f32>(0.0);
  var c3v = vec4<f32>(0.0);
  for (var k: u32 = 0u; k < 16u; k = k + 1u) {
    let d = vec4<f32>((*pixels)[k]) - mean;
    c0v = c0v + d.x * d;
    c1v = c1v + d.y * d;
    c2v = c2v + d.z * d;
    c3v = c3v + d.w * d;
  }
  var v = seed;
  var len = length(v);
  if (len < 1e-9) { return vec4<f32>(0.0); }
  v = v / len;
  for (var iter: u32 = 0u; iter < iters; iter = iter + 1u) {
    let nv = vec4<f32>(dot(c0v, v), dot(c1v, v), dot(c2v, v), dot(c3v, v));
    len = length(nv);
    if (len < 1e-12) { return vec4<f32>(0.0); }
    v = nv / len;
  }
  return v;
}



fn principal_axis3(
  pixels: ptr<function, array<vec4<i32>, 16>>,
  mean: vec3<f32>,
  seed: vec3<f32>,
) -> vec3<f32> {
  var c0v = vec3<f32>(0.0);
  var c1v = vec3<f32>(0.0);
  var c2v = vec3<f32>(0.0);
  for (var k: u32 = 0u; k < 16u; k = k + 1u) {
    let d = vec3<f32>((*pixels)[k].xyz) - mean;
    c0v = c0v + d.x * d;
    c1v = c1v + d.y * d;
    c2v = c2v + d.z * d;
  }
  var v = seed;
  var len = length(v);
  if (len < 1e-9) { return vec3<f32>(0.0); }
  v = v / len;
  for (var iter: u32 = 0u; iter < 8u; iter = iter + 1u) {
    let nv = vec3<f32>(dot(c0v, v), dot(c1v, v), dot(c2v, v));
    len = length(nv);
    if (len < 1e-12) { return vec3<f32>(0.0); }
    v = nv / len;
  }
  return v;
}



fn trit_enc(t0: u32, t1: u32, t2: u32, t3: u32, t4: u32) -> u32 {
  let c = select(select((t2 << 4u) | (t1 << 2u) | t0, (t1 << 4u) | (t0 << 2u) | 3u, t2 == 2u), 12u | t0, t2 == 2u && t1 == 2u);
  return select(select((t4 << 7u) | (t3 << 5u) | c, (t3 << 7u) | 96u | c, t4 == 2u), ((c >> 2u) << 5u) | 28u | (c & 3u), t3 == 2u && t4 == 2u);
}



fn q192(x: f32) -> vec2<u32> {
  let v = fu(clamp(floor(x + 0.5), 0.0, 255.0));
  let up = v > 127u;
  var u = select(v, 255u - v, up);
  if ((u & 3u) == 3u) {
    let xu = select(x, 255.0 - x, up);
    u = select(u - 1u, u + 1u, xu > f32(u) && u < 127u);
  }
  return vec2<u32>(((u & 3u) << 6u) | ((u >> 2u) << 1u) | u32(up), select(u, 255u - u, up));
}



@compute @workgroup_size(8, 8, 1)
fn encode(@builtin(global_invocation_id) gid_raw: vec3<u32>) {
  
  let gid = vec3<u32>(gid_raw.x, gid_raw.y + params.y0, gid_raw.z);
  if (gid.x >= params.blocks_x || gid.y >= params.blocks_y) {
    return;
  }

  let bx = gid.x;
  let by = gid.y;
  let block_index = by * params.row_stride_blocks + bx;

  let base   = vec2<i32>(i32(bx) * 4, i32(by) * 4);
  let max_xy = vec2<i32>(i32(params.width) - 1, i32(params.height) - 1);

  var pixels: array<vec4<i32>, 16>;
  var lo = vec4<i32>(255);
  var hi = vec4<i32>(0);
  var isum = vec4<i32>(0);
  var gd = 0; 
  for (var i: u32 = 0u; i < 16u; i = i + 1u) {
    let p = clamp(base + vec2<i32>(i32(i & 3u), i32(i >> 2u)), vec2<i32>(0, 0), max_xy);
    let px = to8(textureLoad(src_tex, p, 0));
    pixels[i] = px;
    lo = min(lo, px);
    hi = max(hi, px);
    isum = isum + px;
    gd = max(gd, max(abs(px.x - px.y), abs(px.x - px.z)));
  }
  let opaque = lo.w == 255;

  var w0: u32; var w1: u32; var w2: u32; var w3: u32;

  if (opaque && gd == 0) {
    
    
    
    let L0 = u32(lo.x);
    let L1 = u32(hi.x);
    var s0 = 0u; var s1 = 0u; var s2 = 0u;
    if (L1 > L0) {
      let sc = 64.0 / f32(hi.x - lo.x);
      
      
      
      for (var k: u32 = 0u; k < 16u; k = k + 1u) {
        let u = clamp(f32(pixels[k].x - lo.x) * sc, 0.0, 64.0);
        let wlo = clamp(floor(u * 0.5 + 0.5), 0.0, 15.0);
        let whi = clamp(floor((u - 2.0) * 0.5 + 0.5), 16.0, 31.0);
        let pick = abs(u - wlo * 2.0) <= abs(u - (whi * 2.0 + 2.0));
        let w = fbits(select(whi, wlo, pick), 31u);
        
        let off = 5u * k;
        if (off < 28u) { s0 = s0 | (w << off); }
        else if (off == 30u) { s0 = s0 | (w << 30u); s1 = s1 | (w >> 2u); }
        else if (off < 60u) { s1 = s1 | (w << (off - 32u)); }
        else if (off == 60u) { s1 = s1 | (w << 28u); s2 = s2 | (w >> 4u); }
        else { s2 = s2 | (w << (off - 64u)); }
      }
    }
    
    
    w0 = 0x253u | (L0 << 17u) | (L1 << 25u);
    w1 = (L1 >> 7u) | reverseBits(s2);
    w2 = reverseBits(s1);
    w3 = reverseBits(s0);
  } else if (opaque) {
    
    
    
    
    
    let mean3 = vec3<f32>(isum.xyz) * (1.0 / 16.0);
    let lo3 = vec3<f32>(lo.xyz);
    let hi3 = vec3<f32>(hi.xyz);
    var x0 = lo3;
    var x1 = hi3;
    let axis = principal_axis3(&pixels, mean3, hi3 - lo3);
    if (dot(axis, axis) > 0.0) {
      var t_min: f32 = 1e30;
      var t_max: f32 = -1e30;
      for (var k: u32 = 0u; k < 16u; k = k + 1u) {
        let t = dot(vec3<f32>(pixels[k].xyz) - mean3, axis);
        t_min = min(t_min, t);
        t_max = max(t_max, t);
      }
      x0 = clamp(mean3 + t_min * axis, lo3, hi3);
      x1 = clamp(mean3 + t_max * axis, lo3, hi3);
    }
    let span3 = hi.xyz - lo.xyz;
    let small = max(max(span3.x, span3.y), span3.z) <= 12;
    var r0: vec2<u32>; var g0: vec2<u32>; var b0: vec2<u32>;
    var r1: vec2<u32>; var g1: vec2<u32>; var b1: vec2<u32>;
    if (small) {
      let q0 = fu3(clamp(floor(x0 + 0.5), vec3<f32>(0.0), vec3<f32>(255.0)));
      let q1 = fu3(clamp(floor(x1 + 0.5), vec3<f32>(0.0), vec3<f32>(255.0)));
      r0 = vec2<u32>(q0.x); g0 = vec2<u32>(q0.y); b0 = vec2<u32>(q0.z);
      r1 = vec2<u32>(q1.x); g1 = vec2<u32>(q1.y); b1 = vec2<u32>(q1.z);
    } else {
      r0 = q192(x0.x); g0 = q192(x0.y); b0 = q192(x0.z);
      r1 = q192(x1.x); g1 = q192(x1.y); b1 = q192(x1.z);
    }
    
    if (r0.y + g0.y + b0.y > r1.y + g1.y + b1.y) {
      let tr = r0; r0 = r1; r1 = tr;
      let tg = g0; g0 = g1; g1 = tg;
      let tb = b0; b0 = b1; b1 = tb;
    }
    let d0 = vec3<f32>(vec3<u32>(r0.y, g0.y, b0.y));
    let d1 = vec3<f32>(vec3<u32>(r1.y, g1.y, b1.y));
    
    let lmax = select(15.0, 7.0, small);
    let dir = d1 - d0;
    let dd = dot(dir, dir);
    var s0 = 0u; var s1 = 0u;
    if (dd > 0.0) {
      let inv = lmax / dd;
      for (var k: u32 = 0u; k < 8u; k = k + 1u) {
        let w = fbits(clamp(floor(dot(vec3<f32>(pixels[k].xyz) - d0, dir) * inv + 0.5), 0.0, lmax), 15u);
        s0 = s0 | (w << (4u * k));
      }
      for (var k: u32 = 8u; k < 16u; k = k + 1u) {
        let w = fbits(clamp(floor(dot(vec3<f32>(pixels[k].xyz) - d0, dir) * inv + 0.5), 0.0, lmax), 15u);
        s1 = s1 | (w << (4u * (k - 8u)));
      }
    }
    if (small) {
      
      
      var c0 = (s0 & 0x07070707u) | ((s0 & 0x70707070u) >> 1u);
      c0 = (c0 & 0x003F003Fu) | ((c0 & 0x3F003F00u) >> 2u);
      c0 = (c0 & 0x00000FFFu) | ((c0 & 0x0FFF0000u) >> 4u);
      var c1 = (s1 & 0x07070707u) | ((s1 & 0x70707070u) >> 1u);
      c1 = (c1 & 0x003F003Fu) | ((c1 & 0x3F003F00u) >> 2u);
      c1 = (c1 & 0x00000FFFu) | ((c1 & 0x0FFF0000u) >> 4u);
      w0 = 0x053u | (8u << 13u) | (r0.x << 17u) | (r1.x << 25u);
      w1 = (r1.x >> 7u) | (g0.x << 1u) | (g1.x << 9u) | (b0.x << 17u) | (b1.x << 25u);
      w2 = (b1.x >> 7u) | reverseBits(c1 >> 8u);
      w3 = reverseBits(c0 | (c1 << 24u));
    } else {
      
      
      
      let tg = trit_enc(r0.x >> 6u, r1.x >> 6u, g0.x >> 6u, g1.x >> 6u, b0.x >> 6u);
      w0 = 0x242u | (8u << 13u) | ((r0.x & 63u) << 17u) | ((tg & 3u) << 23u) | ((r1.x & 63u) << 25u) | (((tg >> 2u) & 1u) << 31u);
      w1 = ((tg >> 3u) & 1u) | ((g0.x & 63u) << 1u) | (((tg >> 4u) & 1u) << 7u) | ((g1.x & 63u) << 8u)
        | (((tg >> 5u) & 3u) << 14u) | ((b0.x & 63u) << 16u) | ((tg >> 7u) << 22u) | ((b1.x & 63u) << 23u)
        | ((b1.x >> 6u) << 29u);
      w2 = reverseBits(s1);
      w3 = reverseBits(s0);
    }
  } else {
    
    let mean = vec4<f32>(isum) * (1.0 / 16.0);

    
    
    
    
    
    var seed0 = lo;
    var seed1 = hi;
    let axis = principal_axis4(&pixels, mean, vec4<f32>(hi - lo), 4u);
    if (dot(axis, axis) > 0.0) {
      var t_min: f32 = 1e30;
      var t_max: f32 = -1e30;
      for (var k: u32 = 0u; k < 16u; k = k + 1u) {
        let t = dot(vec4<f32>(pixels[k]) - mean, axis);
        t_min = min(t_min, t);
        t_max = max(t_max, t);
      }
      seed0 = fi4(clamp(round(mean + t_min * axis), vec4<f32>(0.0), vec4<f32>(255.0)));
      seed1 = fi4(clamp(round(mean + t_max * axis), vec4<f32>(0.0), vec4<f32>(255.0)));
    }
    var e0 = lo;
    var e1 = hi;
    var fitStream = 0u;
    var haveFitWeights = false;
    let r = proj_fit(&pixels, seed0, seed1);
    if (r.valid) {
      e0 = clamp(r.e0, lo, hi);
      e1 = clamp(r.e1, lo, hi);
      fitStream = r.wstream;
      haveFitWeights = true;
    }
    var swapped = false;
    if (e0.x + e0.y + e0.z > e1.x + e1.y + e1.z) {
      let tmp = e0; e0 = e1; e1 = tmp;
      swapped = true;
    }
    let E0 = vec4<u32>(e0);
    let E1 = vec4<u32>(e1);
    
    
    var s0 = 0u;
    if (haveFitWeights) {
      s0 = select(fitStream, ~fitStream, swapped);
    } else {
      let dir = vec4<f32>(e1 - e0);
      let dd = dot(dir, dir);
      let e0f = vec4<f32>(e0);
      if (dd > 0.0) {
        let inv = 3.0 / dd;
        for (var k: u32 = 0u; k < 16u; k = k + 1u) {
          let w = fbits(clamp(floor(dot(vec4<f32>(pixels[k]) - e0f, dir) * inv + 0.5), 0.0, 3.0), 3u);
          s0 = s0 | (w << (2u * k));
        }
      }
    }
    
    w0 = 0x042u | (12u << 13u) | (E0.x << 17u) | (E1.x << 25u);
    w1 = (E1.x >> 7u) | (E0.y << 1u) | (E1.y << 9u) | (E0.z << 17u) | (E1.z << 25u);
    w2 = (E1.z >> 7u) | (E0.w << 1u) | (E1.w << 9u);
    w3 = reverseBits(s0);
  }

  let out = block_index * 4u;
  dst[out + 0u] = w0;
  dst[out + 1u] = w1;
  dst[out + 2u] = w2;
  dst[out + 3u] = w3;
}
`,o=32,s=4194304,c=class i{format;workspaceBytes;device;pipeline;workspaceWidth;workspaceHeight;outputRowBytes;inputTexture=null;outputBuffer=null;paramsBuffer=null;bindGroup=null;disabled=!1;disposed=!1;failureListener=null;constructor(e,t,n,r){this.device=e,this.pipeline=t,this.format=n,this.workspaceWidth=Math.floor(Number(e.limits?.maxTextureDimension2D??8192)/4)*4,this.outputRowBytes=u(this.workspaceWidth/4*16,256);let i=this.workspaceWidth*16+this.outputRowBytes,a=Math.min(Math.floor(this.workspaceWidth/4),Math.floor((r-o)/i));if(!(a>=1))throw RangeError(`The raster compression workspace cannot hold one block row.`);if(this.workspaceHeight=a*4,this.workspaceBytes=this.workspaceWidth*this.workspaceHeight*4+this.outputRowBytes*a+o,this.outputRowBytes*a>Number(e.limits?.maxStorageBufferBindingSize??134217728))throw RangeError(`The raster compression workspace exceeds the device storage-buffer limit.`);e.lost?.then?.(()=>this.dispose())}static async create(e,t=s){let n=[];e.features?.has?.(`texture-compression-bc`)&&n.push(`bc7`),e.features?.has?.(`texture-compression-astc`)&&n.push(`astc-4x4`);for(let r of n)try{let n=await l(e,r);return new i(e,n,r,Math.min(s,t))}catch(e){console.warn(`[HEPR] WebGPU ${r} raster encoder unavailable; retaining an available raster path.`,e)}return null}get available(){return!this.disabled&&!this.disposed}get residentBytes(){return this.inputTexture?this.workspaceBytes:0}setFailureListener(e){this.failureListener=e}releaseWorkspace(){this.destroyWorkspace()}createTextureFromEncoded(e,r,i){if(!this.available)return null;let a=n(e,r,this.format),o=a.reduce((e,t)=>e+t.byteLength,0);if(!(i instanceof Uint8Array)||i.length!==o)throw RangeError(`Incorrect encoded raster mip byte length.`);let s=a[0];if(s.width>this.workspaceWidth||s.height>this.workspaceWidth)return null;let c=globalThis.GPUTextureUsage,l=null,u=d(this.device);try{l=this.device.createTexture({label:`hepr-raster-${this.format}`,size:{width:s.width,height:s.height,depthOrArrayLayers:1},format:t(this.format).webGpuFormat,mipLevelCount:a.length,usage:c.TEXTURE_BINDING|c.COPY_DST});for(let[e,t]of a.entries())this.device.queue.writeTexture({texture:l,mipLevel:e},i.subarray(t.byteOffset,t.byteOffset+t.byteLength),{bytesPerRow:t.blocksX*16,rowsPerImage:t.blocksY},{width:t.blocksX*4,height:t.blocksY*4,depthOrArrayLayers:1});return{texture:l,estimatedBytes:o,uvScale:[e/s.width,r/s.height]}}catch(e){return l?.destroy(),this.disable(e),null}finally{u&&f(this.device).then(e=>{e&&this.disable(e)},e=>this.disable(e))}}createTexture(n,i,a){if(!this.available)return null;let o=u(n,4),s=u(i,4);if(o>this.workspaceWidth||s>this.workspaceWidth)return null;let c=globalThis.GPUTextureUsage,l=null,p=d(this.device);try{this.ensureWorkspace(),l=this.device.createTexture({label:`hepr-raster-${this.format}`,size:{width:o,height:s,depthOrArrayLayers:1},format:t(this.format).webGpuFormat,mipLevelCount:Math.floor(Math.log2(Math.max(o,s)))+1,usage:c.TEXTURE_BINDING|c.COPY_DST});let u=0;for(let t of e(a,n,i)){let e=Math.ceil(t.width/4),n=Math.ceil(t.height/4);for(let r=0;r<n;r+=this.workspaceHeight/4){let i=Math.min(this.workspaceHeight/4,n-r),a=r*4,o=Math.min(i*4,t.height-a),s=a*t.width*4,c=s+o*t.width*4;this.device.queue.writeTexture({texture:this.inputTexture},t.data.subarray(s,c),{bytesPerRow:t.width*4,rowsPerImage:o},{width:t.width,height:o,depthOrArrayLayers:1}),this.device.queue.writeBuffer(this.paramsBuffer,0,Uint32Array.of(e,i,t.width,o,0,this.outputRowBytes/16,0,0));let d=this.device.createCommandEncoder({label:`hepr-raster-${this.format}-band`}),f=d.beginComputePass();f.setPipeline(this.pipeline),f.setBindGroup(0,this.bindGroup),f.dispatchWorkgroups(Math.ceil(e/8),Math.ceil(i/8),1),f.end(),d.copyBufferToTexture({buffer:this.outputBuffer,bytesPerRow:this.outputRowBytes,rowsPerImage:i},{texture:l,mipLevel:u,origin:{x:0,y:a,z:0}},{width:e*4,height:i*4,depthOrArrayLayers:1}),this.device.queue.submit([d.finish()])}u++}return{texture:l,estimatedBytes:r(n,i,this.format),uvScale:[n/o,i/s]}}catch(e){return l?.destroy(),this.disable(e),null}finally{p&&f(this.device).then(e=>{e&&this.disable(e)},e=>this.disable(e))}}dispose(){this.disposed||(this.disposed=!0,this.failureListener=null,this.destroyWorkspace())}ensureWorkspace(){if(this.inputTexture)return;let e=globalThis.GPUTextureUsage,t=globalThis.GPUBufferUsage;try{this.inputTexture=this.device.createTexture({label:`hepr-raster-compression-input`,size:{width:this.workspaceWidth,height:this.workspaceHeight,depthOrArrayLayers:1},format:`rgba8unorm`,usage:e.TEXTURE_BINDING|e.COPY_DST}),this.outputBuffer=this.device.createBuffer({label:`hepr-raster-compression-blocks`,size:this.outputRowBytes*(this.workspaceHeight/4),usage:t.STORAGE|t.COPY_SRC}),this.paramsBuffer=this.device.createBuffer({label:`hepr-raster-compression-params`,size:o,usage:t.UNIFORM|t.COPY_DST}),this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.inputTexture.createView()},{binding:1,resource:{buffer:this.outputBuffer}},{binding:2,resource:{buffer:this.paramsBuffer,size:o}}]})}catch(e){throw this.destroyWorkspace(),e}}disable(e){if(!this.available)return;this.disabled=!0,this.destroyWorkspace(),console.warn(`[HEPR] WebGPU raster compression failed; rebuilding bounded RGBA raster resources.`,e);let t=this.failureListener;t&&queueMicrotask(()=>{this.disposed||t(e)})}destroyWorkspace(){this.inputTexture?.destroy(),this.inputTexture=null,this.outputBuffer?.destroy(),this.outputBuffer=null,this.paramsBuffer?.destroy(),this.paramsBuffer=null,this.bindGroup=null}};async function l(e,t){let n=d(e),r,o;try{let n=e.createShaderModule({label:`hepr-raster-${t}-encoder`,code:t===`bc7`?i:a}),o={label:`hepr-raster-${t}-encoder`,layout:`auto`,compute:{module:n,entryPoint:`encode`}};r=typeof e.createComputePipelineAsync==`function`?await e.createComputePipelineAsync(o):e.createComputePipeline(o)}catch(e){o=e}let s=n?await f(e):null;if(o||s)throw o??s;return r}function u(e,t){return Math.ceil(e/t)*t}function d(e){return typeof e.pushErrorScope!=`function`||typeof e.popErrorScope!=`function`?!1:(e.pushErrorScope(`out-of-memory`),e.pushErrorScope(`validation`),!0)}async function f(e){return(await Promise.all([e.popErrorScope(),e.popErrorScope()])).find(Boolean)??null}export{c as t};