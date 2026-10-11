import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractReleaseNotes, finalizeChangelog, validateChangelog } from "./lib/changelog.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = `Usage:
  node scripts/changelog.mjs check [--unreleased | --released] [--tag vX.Y.Z]
  node scripts/changelog.mjs preview
  node scripts/changelog.mjs finalize
  node scripts/changelog.mjs notes [--tag vX.Y.Z] [--output path]

check, preview and notes never change the changelog or package version.
finalize is used by npm's version hook after bumping the package version.`;

function parseArgs(args) {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") return { help: true };
  if (!["check", "preview", "finalize", "notes"].includes(command)) throw new Error(`Unknown changelog command: ${command}\n${usage}`);
  const options = { command };
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index];
    if ((flag === "--unreleased" || flag === "--released") && command === "check") {
      if (options.requireUnreleased || options.requireReleased) throw new Error("Choose only one of --unreleased or --released.");
      options[flag === "--unreleased" ? "requireUnreleased" : "requireReleased"] = true;
    } else if ((flag === "--tag" && ["check", "notes"].includes(command)) || (flag === "--output" && command === "notes")) {
      const value = rest[++index];
      if (!value || value.startsWith("--") || options[flag.slice(2)] !== undefined) throw new Error(`${flag} requires one value.`);
      options[flag.slice(2)] = value;
    } else throw new Error(`Unexpected argument: ${flag}\n${usage}`);
  }
  if (options.requireUnreleased && options.tag) throw new Error("--tag validates a released version, not Unreleased notes.");
  return options;
}

export async function runChangelog(args, {
  root = repoRoot, now = new Date(), stdout = text => process.stdout.write(text)
} = {}) {
  const options = parseArgs(args);
  if (options.help) { stdout(usage + "\n"); return usage + "\n"; }
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const changelogPath = resolve(root, "CHANGELOG.md");
  const source = await readFile(changelogPath, "utf8");
  const repository = typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url;
  const repositoryUrl = repository?.replace(/^git\+/, "").replace(/\.git\/?$/, "");
  const validation = { packageVersion: packageJson.version, repositoryUrl, ...options };
  let output;
  switch (options.command) {
    case "check":
      validateChangelog(source, validation);
      output = `Changelog valid for ${packageJson.version}${options.requireUnreleased ? " with pending release notes" : options.requireReleased || options.tag ? " with finalized release notes" : ""}.\n`;
      break;
    case "preview": {
      const document = validateChangelog(source, { ...validation, requireUnreleased: true });
      output = document.sections[0].body + "\n";
      break;
    }
    case "finalize": {
      const finalized = finalizeChangelog(source, {
        version: packageJson.version, repositoryUrl, date: now.toISOString().slice(0, 10)
      });
      await writeFile(changelogPath, finalized);
      output = `Finalized changelog for ${packageJson.version}.\n`;
      break;
    }
    case "notes":
      validateChangelog(source, { ...validation, requireReleased: true });
      output = extractReleaseNotes(source, { version: packageJson.version, repositoryUrl });
      if (options.output) {
        const destination = resolve(root, options.output);
        if (destination === changelogPath || destination === resolve(root, "package.json")) throw new Error("Release notes output must not overwrite CHANGELOG.md or package.json.");
        await writeFile(destination, output);
        return output;
      }
      break;
  }
  stdout(output);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await runChangelog(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
