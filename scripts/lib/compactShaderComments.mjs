import { parseAst } from "vite";

// Keep code whitespace intact: HEPR assembles several shader variants using
// exact source replacements. Only comments are removed from emitted JS strings;
// the readable TypeScript sources and their comments are never rewritten.
const shaderSyntax = /#version\s+300\s+es|\bprecision\s+(?:highp|mediump|lowp)\s+(?:float|int)\s*;|\bfn\s+\w+\s*\(|\b(?:float|vec[234]|void)\s+(?:hepr\w+|main)\s*\(/;

export function compactShaderComments(code) {
  const edits = [];
  walk(parseAst(code), node => {
    if (node.type === "TaggedTemplateExpression") return false;
    if (node.type === "Literal" && typeof node.value === "string" && shaderSyntax.test(node.value)) {
      const value = stripShaderComments(node.value);
      if (value !== null && value !== node.value) {
        edits.push({ start: node.start, end: node.end, value: JSON.stringify(value) });
      }
    }
    if (node.type !== "TemplateLiteral" ||
        !shaderSyntax.test(node.quasis.map(part => part.value.cooked ?? "").join("\n"))) return;
    const parts = node.quasis.map(part => typeof part.value.cooked === "string"
      ? stripShaderComments(part.value.cooked, part.tail) : null);
    // An interpolation inside a comment could become executable shader text
    // after removing the surrounding comment. Leave that template untouched.
    if (parts.some(part => part === null)) return;
    node.quasis.forEach((part, index) => {
      if (parts[index] !== part.value.cooked) {
        edits.push({ start: part.start, end: part.end, value: escapeTemplate(parts[index]) });
      }
    });
  });
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    code = code.slice(0, edit.start) + edit.value + code.slice(edit.end);
  }
  return code;
}

export function stripShaderComments(source, tail = true) {
  // GLSL joins escaped newlines before recognizing comments. Leave this rare
  // form intact rather than changing which subsequent line belongs to a comment.
  if (/\/\/[^\r\n]*\\(?:\r\n|\r|\n)/.test(source)) return null;
  let result = "";
  for (let index = 0; index < source.length;) {
    // Preserve quoted preprocessor paths, including comment-like characters.
    if (source[index] === '"' || source[index] === "'") {
      const quote = source[index];
      result += source[index++];
      while (index < source.length) {
        const character = source[index++];
        result += character;
        if (character === "\\" && index < source.length) result += source[index++];
        else if (character === quote) break;
      }
    } else if (source.startsWith("//", index)) {
      const lineEnd = source.slice(index + 2).search(/[\r\n]/);
      const end = lineEnd < 0 ? -1 : index + 2 + lineEnd;
      if (end < 0 && !tail) return null;
      index = end < 0 ? source.length : end;
    } else if (source.startsWith("/*", index)) {
      let depth = 1;
      let newlines = "";
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) { depth++; index += 2; }
        else if (source.startsWith("*/", index)) { depth--; index += 2; }
        else {
          if (source[index] === "\n" || source[index] === "\r") newlines += source[index];
          index++;
        }
      }
      if (depth > 0) return null;
      // A block comment is a token separator, even without surrounding spaces.
      result += newlines || (/\s/.test(result.at(-1) ?? "") || /\s/.test(source[index] ?? "") ? "" : " ");
    } else result += source[index++];
  }
  return result;
}

function escapeTemplate(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("\r", "\\r")
    .replaceAll("`", "\\`").replaceAll("${", "\\${");
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string" && visit(node) === false) return;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === "object") walk(value, visit);
  }
}

export function shaderCommentCompactionPlugin(sourceDir) {
  let enabled = true;
  return {
    name: "hepr-shader-comment-compaction",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      // Keep Vite's original mappings when an integration requests source maps.
      enabled = !config.build.sourcemap;
    },
    transform(code, id) {
      if (!enabled || !id.startsWith(sourceDir) || !/\.[jt]s$/.test(id)) return;
      const output = compactShaderComments(code);
      if (output !== code) return { code: output, map: null };
    }
  };
}
