import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";

// Exercise demo orchestration with deterministic host fakes, without loading
// its DOM entry point or starting Vite. Functions retain their production body.
export function sourceFunction(source, name) {
  const start = source.search(new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, "m"));
  assert(start >= 0, `missing ${name}()`);
  const end = source.indexOf("\n}", start);
  assert(end > start, `missing top-level closing brace for ${name}()`);
  return stripTypeScriptTypes(source.slice(start, end + 2).replace(/^export /, ""));
}
