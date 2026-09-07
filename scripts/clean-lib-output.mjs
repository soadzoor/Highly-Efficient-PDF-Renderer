import { rm } from "node:fs/promises";

// These are generated package artifacts only. Keeping the targets explicit
// prevents a renamed/missing environment variable from widening the delete.
const generatedTargets = [
  new URL("../dist/lib/", import.meta.url),
  new URL("../dist/types/", import.meta.url)
];

for (const target of generatedTargets) {
  await rm(target, { recursive: true, force: true });
}
