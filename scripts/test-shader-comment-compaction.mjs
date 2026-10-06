import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { compactShaderComments, shaderCommentCompactionPlugin, stripShaderComments } from "./lib/compactShaderComments.mjs";

const shader = `#version 300 es
precision highp float;
// A readable source comment.
void main() {
  float/**/coverage = 1.0; /* another comment */
  /* Multiple lines
     stay separated. */
  outColor = vec4(coverage);
}`;
const expected = `#version 300 es
precision highp float;

void main() {
  float coverage = 1.0; 
  

  outColor = vec4(coverage);
}`;
assert.equal(stripShaderComments(shader), expected);
assert.equal(stripShaderComments("fn value() -> f32 { /* outer /* inner */ comment */ return 1.0; }"),
  "fn value() -> f32 {  return 1.0; }");
assert.equal(stripShaderComments('#include "https://example.test/a/*b*/"\n// comment\nvoid main() {}'),
  '#include "https://example.test/a/*b*/"\n\nvoid main() {}');

const evaluate = code => runInNewContext(`${code}\nresult`, {});
for (const literal of [JSON.stringify(shader), `\`${shader}\``]) {
  const code = `const result = ${literal};`;
  assert.equal(evaluate(compactShaderComments(code)), expected);
  assert.equal(compactShaderComments(compactShaderComments(code)), compactShaderComments(code),
    "compaction must be idempotent");
}
const interpolated = 'const value = "1.0"; const result = `fn value() -> f32 { // comment\n return ${value}; /* comment */ }`;';
assert.equal(evaluate(compactShaderComments(interpolated)), "fn value() -> f32 { \n return 1.0;  }");
for (const comment of ['// interpolation: ${"text"}', '/* interpolation: ${"text"} */']) {
  const code = `const result = \`fn value() { ${comment}\n}\`;`;
  assert.equal(compactShaderComments(code), code, "comment-spanning interpolations remain intact");
}
const ordinary = 'const result = "https://example.test/path/*literal*/ // ordinary text";';
assert.equal(compactShaderComments(ordinary), ordinary);
const raw = 'const result = String.raw`fn value() { // comment\\n return 1.0; }`;';
assert.equal(compactShaderComments(raw), raw, "tagged templates retain their raw-string semantics");
assert.equal(stripShaderComments("void main() { // comment\r  return; }"), "void main() { \r  return; }");
assert.equal(stripShaderComments("void main() { // continued \\\n  comment\n}"), null);
const mapped = shaderCommentCompactionPlugin("/src/");
mapped.configResolved({ build: { sourcemap: true } });
assert.equal(mapped.transform(`const result = ${JSON.stringify(shader)};`, "/src/shader.ts"), undefined,
  "source-map builds retain Vite's original mappings");
const escapes = 'const result = `fn value() { // comment\n  /* comment */ }\\n\\\\\\`\\${literal}`;';
assert.equal(evaluate(compactShaderComments(escapes)), stripShaderComments(evaluate(escapes)),
  "template escaping must preserve backslashes, backticks and literal interpolation markers");

// Exact multi-line patching is used by gradient materials. Keep its code
// whitespace intact while removing a neighboring comment from built output.
const patch = `  vec2 margin = heprCoverageMargin();\n  vec2 world = mix(low, high, corner);`;
const patched = `const base = ${JSON.stringify(`void main() {\n// comment\n${patch}\n}`)};
  const result = base.replace(${JSON.stringify(patch)}, "  vec2 world = aMeshPosition;");`;
assert.equal(evaluate(compactShaderComments(patched)), "void main() {\n\n  vec2 world = aMeshPosition;\n}");

const source = await readFile(new URL("../src/coreWgslShaders.ts", import.meta.url), "utf8");
assert.match(source, /\/\* wgsl \*\//, "source retains shader annotations");
assert.match(source, /\n  /, "source retains indentation");
console.log("Build-only shader compaction: comments removed, shader patches/escaping/interpolations preserved.");
