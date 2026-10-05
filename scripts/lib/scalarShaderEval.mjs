// Evaluate shipped GLSL/WGSL helper functions in JS. The sources must use
// scalar arithmetic on vector components only; vectors are plain {x, y}
// containers, so a small syntax translation is exact.
const helpers = {
  clamp: (value, low, high) => Math.min(Math.max(value, low), high),
  min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, ceil: Math.ceil, floor: Math.floor,
  log2: Math.log2, exp2: value => 2 ** value,
  vec2: (x, y) => ({ x, y }),
  vec4: (x, y, z, w) => ({ x, y, z, w }),
  // WGSL integer coordinates: i32 division truncates.
  vec2i: (x, y) => ({ x: Math.trunc(x), y: Math.trunc(y) }),
  toFloat: value => value,
  toInt: value => Math.trunc(value),
  select: (whenFalse, whenTrue, condition) => condition ? whenTrue : whenFalse
};

// `extra` supplies functions the source calls but defines elsewhere, such as
// texture fetches, as plain JS.
function compile(source, extra = {}) {
  const names = [...source.matchAll(/\bfunction\s+(hepr\w+)\s*\(/g)].map(match => match[1]);
  const body = `${source}\nreturn { ${names.join(", ")} };`;
  const all = { ...helpers, ...extra };
  return new Function(...Object.keys(all), body)(...Object.values(all));
}

export function evaluateGlsl(source, extra) {
  return compile(source
    .replace(/\b(?:float|vec2|vec4|int|bool)\s+(hepr\w+)\s*\(([^)]*)\)\s*\{/g, (_, name, params) =>
      `function ${name}(${params.split(",").map(param => param.trim().split(/\s+/).pop()).join(", ")}) {`)
    .replace(/\b(?:float|vec2|vec4|int|bool)\s+(\w+)\s*=/g, "let $1 =")
    .replace(/\bfloat\(/g, "toFloat(")
    .replace(/\bint\(/g, "toInt("), extra);
}

// `extra` supplies what the source does not define, such as textureLoad and
// textureDimensions over plain JS textures.
export function evaluateWgsl(source, extra) {
  return compile(source
    .replace(/\bfn\s+(hepr\w+)\s*\(([^)]*)\)\s*->\s*[\w<>]+\s*\{/g, (_, name, params) =>
      `function ${name}(${params.split(",").map(param => param.split(":")[0].trim()).join(", ")}) {`)
    .replace(/\bvar\s+/g, "let ")
    .replace(/\bvec2<f32>\(/g, "vec2(")
    .replace(/\bvec4<f32>\(/g, "vec4(")
    .replace(/\bvec2<i32>\(/g, "vec2i(")
    .replace(/\bf32\(/g, "toFloat(")
    .replace(/\bi32\(/g, "toInt("), extra);
}
