// Preserve direct callers of the original fast-suite entry point.
import { main } from "./run-tests.mjs";

await main(["fast", ...process.argv.slice(2)]);
