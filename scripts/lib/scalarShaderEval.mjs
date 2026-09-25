// Evaluate shipped GLSL/WGSL helper functions in JS. The sources must use
// scalar arithmetic on vector components only; vectors are plain {x, y}
// containers, so a small syntax translation is exact.
const helpers = {
  clamp: (value, low, high) => Math.min(Math.max(value, low), high),
  min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, ceil: Math.ceil, floor: Math.floor,
  vec2: (x, y) => ({ x, y }),
  toFloat: value => value,
  toInt: value => Math.trunc(value),
  select: (whenFalse, whenTrue, condition) => condition ? whenTrue : whenFalse
};

function compile(source) {
  const names = [...source.matchAll(/\bfunction\s+(hepr\w+)\s*\(/g)].map(match => match[1]);
  const body = `${source}\nreturn { ${names.join(", ")} };`;
  return new Function(...Object.keys(helpers), body)(...Object.values(helpers));
}

export function evaluateGlsl(source) {
  return compile(source
    .replace(/\b(?:float|vec2|int|bool)\s+(hepr\w+)\s*\(([^)]*)\)\s*\{/g, (_, name, params) =>
      `function ${name}(${params.split(",").map(param => param.trim().split(/\s+/).pop()).join(", ")}) {`)
    .replace(/\b(?:float|vec2|vec4|int|bool)\s+(\w+)\s*=/g, "let $1 =")
    .replace(/\bfloat\(/g, "toFloat(")
    .replace(/\bint\(/g, "toInt("));
}

export function evaluateWgsl(source) {
  return compile(source
    .replace(/\bfn\s+(hepr\w+)\s*\(([^)]*)\)\s*->\s*[\w<>]+\s*\{/g, (_, name, params) =>
      `function ${name}(${params.split(",").map(param => param.split(":")[0].trim()).join(", ")}) {`)
    .replace(/\bvar\s+/g, "let ")
    .replace(/\bvec2<f32>\(/g, "vec2(")
    .replace(/\bf32\(/g, "toFloat(")
    .replace(/\bi32\(/g, "toInt("));
}
