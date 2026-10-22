import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  extractReleaseNotes,
  finalizeChangelog,
  parseChangelog,
  validateChangelog
} from "./lib/changelog.mjs";
import { runChangelog } from "./changelog.mjs";

const repositoryUrl = "https://github.com/soadzoor/Highly-Efficient-PDF-Renderer";
const previousVersion = "0.1.56";
const nextVersion = "0.1.57";
const date = "2026-10-11";
const pendingNotes = "### Added\n\n- Render embedded Type1 outlines accurately.";
const previousNotes = "### Fixed\n\n- Preserve earlier release notes.";

function changelog({ pending = pendingNotes, releases = [[previousVersion, "2026-10-10", previousNotes]], baseline = previousVersion } = {}) {
  return `# Changelog

All notable changes are documented here.

## [Unreleased]

${pending}

${releases.map(([version, releaseDate, notes]) => `## [${version}] - ${releaseDate}\n\n${notes}\n`).join("\n")}
[Unreleased]: ${repositoryUrl}/compare/v${baseline}...HEAD
${releases.map(([version]) => `[${version}]: ${repositoryUrl}/releases/tag/v${version}`).join("\n")}
`;
}

function validate(source, options = {}) {
  return validateChangelog(source, { packageVersion: previousVersion, repositoryUrl, ...options });
}

function finalize(source, options = {}) {
  return finalizeChangelog(source, { version: nextVersion, repositoryUrl, date, ...options });
}

async function fixture(t, source = changelog(), version = previousVersion) {
  const root = await mkdtemp(join(tmpdir(), "hep-changelog-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageSource = `${JSON.stringify({
    name: "test-release-package",
    version,
    repository: { type: "git", url: `${repositoryUrl}.git` }
  }, null, 2)}\n`;
  await writeFile(join(root, "package.json"), packageSource);
  await writeFile(join(root, "CHANGELOG.md"), source);
  const output = [];
  return {
    root,
    packageSource,
    source,
    output,
    run: args => runChangelog(args, {
      root,
      now: new Date(`${date}T23:59:59.000Z`),
      stdout: text => output.push(text)
    })
  };
}

test("changelog parsing preserves release bodies and comparison references", () => {
  const doc = parseChangelog(changelog());
  assert.deepEqual(doc.sections.map(section => [section.version, section.date]), [
    ["Unreleased", null], [previousVersion, "2026-10-10"]
  ]);
  assert.equal(doc.sections[0].body, pendingNotes);
  assert.equal(doc.sections[1].body, previousNotes);
  assert.equal(doc.links.get("unreleased"), `${repositoryUrl}/compare/v${previousVersion}...HEAD`);
});

test("release preparation requires actual Unreleased notes", () => {
  for (const pending of ["", "### Added\n\n### Fixed", "- TBD", "- TODO", "- No changes yet."]) {
    assert.throws(() => validate(changelog({ pending }), { requireUnreleased: true }),
      /unreleased|notes|placeholder|empty/i, `must reject non-notes: ${JSON.stringify(pending)}`);
  }
  assert.doesNotThrow(() => validate(changelog(), { requireUnreleased: true }));
});

test("first changelog can start with Unreleased without inventing past releases", () => {
  const source = changelog({ releases: [] });
  assert.doesNotThrow(() => validate(source, { requireUnreleased: true }));
  assert.throws(() => validate(source, { requireReleased: true }), /release|version|notes/i);
  const finalized = finalize(source);
  assert.deepEqual(parseChangelog(finalized).sections.map(section => section.version), ["Unreleased", nextVersion]);
  assert.match(finalized, /compare\/v0\.1\.56\.\.\.v0\.1\.57/);
});

test("validation rejects ambiguous version history and invalid calendar dates", () => {
  const invalidSources = [
    changelog({ releases: [[previousVersion, "2026-10-10", previousNotes], [previousVersion, "2026-10-09", previousNotes]] }),
    changelog({ releases: [["0.1.55", "2026-10-09", previousNotes], [previousVersion, "2026-10-10", previousNotes]] }),
    changelog().replace("2026-10-10", "2026-02-30"),
    changelog().replace("2026-10-10", "2026-13-01"),
    changelog().replace("## [0.1.56]", "## [0.1]"),
    changelog().replace("## [0.1.56]", "## [Unreleased]"),
    changelog().replace("## [Unreleased]", "## [Unreleased]\n\n## [Unreleased]")
  ];
  for (const source of invalidSources) {
    assert.throws(() => validate(source), /version|release|date|duplicate|order|heading/i);
  }
  assert.doesNotThrow(() => validate(changelog({ releases: [[previousVersion, "2024-02-29", previousNotes]] })));
});

test("package, baseline, latest release and tag must agree exactly", () => {
  assert.throws(() => validate(changelog({ baseline: "0.1.55" })), /version|baseline|compare/i);
  assert.throws(() => validate(changelog({ releases: [["0.1.55", "2026-10-09", previousNotes]] })), /version|release/i);
  const source = finalize(changelog());
  assert.doesNotThrow(() => validate(source, { packageVersion: nextVersion, requireReleased: true, tag: `v${nextVersion}` }));
  assert.throws(() => validate(source, { packageVersion: previousVersion, requireReleased: true }), /version|release|baseline/i);
  assert.throws(() => validate(source, { packageVersion: nextVersion, requireReleased: true, tag: `v${previousVersion}` }), /tag|version/i);
  assert.throws(() => validate(source.replace(pendingNotes, ""), { packageVersion: nextVersion, requireReleased: true }), /notes|empty|release/i);
  assert.throws(() => validate(source.replace("## [Unreleased]", "## [Unreleased]\n\n### Fixed\n\n- Another pending change."), {
    packageVersion: nextVersion,
    requireReleased: true
  }), /unreleased|pending|notes/i);
});

test("finalization moves notes once, preserves history and updates comparison links", () => {
  const source = finalize(changelog());
  const doc = parseChangelog(source);
  assert.deepEqual(doc.sections.map(section => [section.version, section.date]), [
    ["Unreleased", null], [nextVersion, date], [previousVersion, "2026-10-10"]
  ]);
  assert.equal(doc.sections[0].body, "");
  assert.equal(doc.sections[1].body, pendingNotes);
  assert.equal(doc.sections[2].body, previousNotes);
  assert.equal(source.split("Render embedded Type1 outlines accurately.").length - 1, 1);
  assert.equal(doc.links.get("unreleased"), `${repositoryUrl}/compare/v${nextVersion}...HEAD`);
  assert.equal(doc.links.get(nextVersion), `${repositoryUrl}/compare/v${previousVersion}...v${nextVersion}`);
  assert.equal(doc.links.get(previousVersion), `${repositoryUrl}/releases/tag/v${previousVersion}`);
  assert.throws(() => finalize(source), /version|release|notes|empty/i);
  for (const version of [previousVersion, "0.1.55", "not-a-version"]) {
    assert.throws(() => finalize(changelog(), { version }), /version|release/i);
  }
  assert.throws(() => finalize(changelog({ pending: "" })), /unreleased|notes|empty/i);
});

test("extracted notes are self-contained outside the repository", () => {
  const pending = `### Changed

- Follow the [upgrade instructions](docs/development.md#font-conversion).
- See [font details][font-support] and [upstream guidance](https://example.com/fonts).
- Preserve code containing \`docs/development.md\`.

[font-support]: docs/reference.md#fonts
[unused]: https://example.com/unused`;
  const source = finalize(changelog({ pending }));
  const notes = extractReleaseNotes(source, { version: nextVersion, repositoryUrl });
  assert.match(notes, new RegExp(`${repositoryUrl}/blob/v0\\.1\\.57/docs/development\\.md#font-conversion`));
  assert.match(notes, new RegExp(`\\[font-support\\]: ${repositoryUrl}/blob/v0\\.1\\.57/docs/reference\\.md#fonts`));
  assert.match(notes, /\[upstream guidance\]\(https:\/\/example\.com\/fonts\)/);
  assert.match(notes, /`docs\/development\.md`/);
  assert.doesNotMatch(notes, /example\.com\/unused|Preserve earlier release notes|## \[Unreleased\]/);
  assert.throws(() => extractReleaseNotes(source, { version: "0.1.99", repositoryUrl }), /release|version|notes/i);
});

test("CLI checks and previews are read-only, including with no Git repository", async t => {
  const f = await fixture(t);
  await f.run(["check", "--unreleased"]);
  assert.equal(await f.run(["preview"]), `${pendingNotes}\n`);
  assert.equal(f.output.at(-1), `${pendingNotes}\n`);
  assert.equal(await readFile(join(f.root, "CHANGELOG.md"), "utf8"), f.source);
  assert.equal(await readFile(join(f.root, "package.json"), "utf8"), f.packageSource);
  assert.deepEqual((await readdir(f.root)).sort(), ["CHANGELOG.md", "package.json"]);
  await assert.rejects(() => f.run(["check", "--released", "--tag", `v${previousVersion}`]), /unreleased|pending|release/i);
});

test("CLI finalize changes only changelog and uses the injected UTC date", async t => {
  const f = await fixture(t, changelog(), nextVersion);
  await f.run(["finalize"]);
  assert.equal(await readFile(join(f.root, "CHANGELOG.md"), "utf8"), finalize(f.source));
  assert.equal(await readFile(join(f.root, "package.json"), "utf8"), f.packageSource);
  assert.deepEqual((await readdir(f.root)).sort(), ["CHANGELOG.md", "package.json"]);
  await f.run(["check", "--released", "--tag", `v${nextVersion}`]);
  await assert.rejects(() => f.run(["finalize"]), /version|release|notes|empty/i);
});

test("CLI release notes validate the tag before writing the requested artifact", async t => {
  const f = await fixture(t, finalize(changelog()), nextVersion);
  const outputPath = join(f.root, "release-notes.md");
  await assert.rejects(() => f.run(["notes", "--tag", `v${previousVersion}`, "--output", outputPath]), /tag|version/i);
  assert.deepEqual((await readdir(f.root)).sort(), ["CHANGELOG.md", "package.json"]);
  await f.run(["notes", "--tag", `v${nextVersion}`, "--output", outputPath]);
  assert.equal(await readFile(outputPath, "utf8"), extractReleaseNotes(f.source, { version: nextVersion, repositoryUrl }));
  assert.equal(await readFile(join(f.root, "CHANGELOG.md"), "utf8"), f.source);
  assert.equal(await readFile(join(f.root, "package.json"), "utf8"), f.packageSource);
});

async function workflowHarness(index, { status = 404, version = nextVersion, published, tag = `v${version}` } = {}) {
  const source = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
  const scripts = [...source.matchAll(/^([ \t]*)node --input-type=module <<'NODE'\r?\n([\s\S]*?)^\1NODE[ \t]*$/gm)];
  assert.equal(scripts.length, 2, "the workflow has one registry probe and one release update script");
  const script = scripts[index][2].split("\n").filter(line => !/^\s*import .+;\s*$/.test(line)).join("\n");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const execute = new AsyncFunction("fetch", "execFileSync", "readFileSync", "appendFileSync", "process", "AbortSignal", "console", script);
  const pkg = { name: "@hepr/release-fixture", version };
  const commands = [];
  const requests = [];
  const writes = [];
  const commit = "f00dbabe1234567890";
  const env = {
    GITHUB_OUTPUT: "/fake/actions-output",
    GITHUB_REF_NAME: tag,
    GITHUB_REPOSITORY: "fixture/hepr",
    GITHUB_API_URL: "https://api.github.example",
    GH_TOKEN: "fixture-token",
    RELEASE_NOTES_FILE: "/fake/release-notes.md"
  };
  return {
    commands,
    requests,
    env,
    pkg,
    commit,
    outputs: () => Object.fromEntries(writes.join("").trim().split("\n").filter(Boolean).map(line => line.split("="))),
    run: () => execute(
      async (url, options) => {
        requests.push({ url, options });
        return { status, ok: status >= 200 && status < 300, json: async () => published ?? { ...pkg, gitHead: commit } };
      },
      (command, args, options) => {
        commands.push({ command, args, options });
        if (command === "git") {
          assert.deepEqual(args, ["rev-parse", "HEAD"]);
          return `${commit}\n`;
        }
        assert.equal(command, "gh", "all external commands must be intercepted");
        return "";
      },
      (path, encoding) => {
        assert.equal(path, "package.json");
        assert.equal(encoding, "utf8");
        return JSON.stringify(pkg);
      },
      (path, data) => {
        assert.equal(path, env.GITHUB_OUTPUT);
        writes.push(data);
      },
      { env },
      { timeout: () => "fake-abort-signal" },
      { log() {} }
    )
  };
}

test("publish workflow treats only registry 404 as unpublished and selects stable/prerelease dist-tags", async () => {
  for (const [version, npmTag] of [[nextVersion, "latest"], [`${nextVersion}-rc.1`, "next"], [`${nextVersion}+build-2`, "latest"]]) {
    const h = await workflowHarness(0, { version });
    await h.run();
    assert.deepEqual(h.outputs(), { "npm-tag": npmTag, "already-published": "false" });
    assert.equal(h.requests[0].url, `https://registry.npmjs.org/${encodeURIComponent(h.pkg.name)}/${encodeURIComponent(version)}`);
    assert.equal(h.commands.length, 0, "a new version must not invoke Git or gh during the registry probe");
  }
});

test("publish workflow can retry release notes after this exact commit was published", async () => {
  const h = await workflowHarness(0, { status: 200 });
  await h.run();
  assert.deepEqual(h.outputs(), { "npm-tag": "latest", "already-published": "true" });
  assert.equal(h.commands.length, 1);
  assert.equal(h.commands[0].command, "git");
});

test("publish workflow refuses to skip npm publication for mismatched package identity or commit", async () => {
  for (const mismatch of [{ gitHead: "other-commit" }, { name: "different-package" }, { version: "0.1.55" }]) {
    const h = await workflowHarness(0, {
      status: 200,
      published: { name: "@hepr/release-fixture", version: nextVersion, gitHead: "f00dbabe1234567890", ...mismatch }
    });
    await assert.rejects(() => h.run(), /already exists|release commit|refusing/i);
    assert.equal(h.outputs()["already-published"], undefined);
    assert.equal(h.commands.length, 1);
    assert.equal(h.commands[0].command, "git");
  }
});

test("publish workflow does not publish on a registry service failure", async () => {
  const h = await workflowHarness(0, { status: 500 });
  await assert.rejects(() => h.run(), /registry.*500/i);
  assert.equal(h.outputs()["already-published"], undefined);
  assert.equal(h.commands.length, 0);
});

test("publish workflow creates missing GitHub Releases with verified tags and prepared notes", async () => {
  for (const version of [nextVersion, `${nextVersion}-rc.1`]) {
    const h = await workflowHarness(1, { version });
    await h.run();
    const prerelease = version.includes("-") ? ["--prerelease"] : [];
    assert.deepEqual(h.commands, [{
      command: "gh",
      args: ["release", "create", `v${version}`, "--verify-tag", "--title", `v${version}`, ...prerelease,
        "--repo", h.env.GITHUB_REPOSITORY, "--notes-file", h.env.RELEASE_NOTES_FILE],
      options: { stdio: "inherit" }
    }]);
    assert.equal(h.requests[0].url, `${h.env.GITHUB_API_URL}/repos/${h.env.GITHUB_REPOSITORY}/releases/tags/${encodeURIComponent(`v${version}`)}`);
  }
});

test("publish workflow retries update only GitHub Release notes", async () => {
  const h = await workflowHarness(1, { status: 200, version: `${nextVersion}-rc.1` });
  await h.run();
  assert.deepEqual(h.commands, [{
    command: "gh",
    args: ["release", "edit", `v${nextVersion}-rc.1`, "--repo", h.env.GITHUB_REPOSITORY, "--notes-file", h.env.RELEASE_NOTES_FILE],
    options: { stdio: "inherit" }
  }]);
});

test("publish workflow stops on GitHub authorization or service errors without creating a release", async () => {
  for (const status of [403, 500]) {
    const h = await workflowHarness(1, { status });
    await assert.rejects(() => h.run(), new RegExp(`GitHub Release lookup.*${status}`, "i"));
    assert.equal(h.commands.length, 0);
  }
});

async function publishHarness(t, failures = [], npmTag = "latest") {
  const source = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
  const step = source.match(/      - name: Publish package\n([\s\S]*?)(?=\n      - name:)/)?.[1];
  assert.match(step, /^        shell: bash$/m, "explicit Bash enables pipefail for the npm/tee pipeline");
  const script = step.match(/        run: \|\n([\s\S]*)/)[1].replace(/^          /gm, "");
  const root = await mkdtemp(join(tmpdir(), "hep-publish-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const commandsPath = join(root, "commands.json");
  const delaysPath = join(root, "delays.json");
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await writeFile(commandsPath, "[]");
  await writeFile(delaysPath, "[]");
  await writeFile(join(root, "npm"), `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const commands = JSON.parse(readFileSync(process.env.HEPR_PUBLISH_COMMANDS, "utf8"));
commands.push(process.argv.slice(2));
writeFileSync(process.env.HEPR_PUBLISH_COMMANDS, JSON.stringify(commands));
const failure = JSON.parse(process.env.HEPR_PUBLISH_FAILURES)[commands.length - 1];
if (failure) {
  console.error(failure);
  process.exit(1);
}
console.log("Published fixture package.");
`, { mode: 0o755 });
  await writeFile(join(root, "sleep"), `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const delays = JSON.parse(readFileSync(process.env.HEPR_PUBLISH_DELAYS, "utf8"));
delays.push(process.argv[2]);
writeFileSync(process.env.HEPR_PUBLISH_DELAYS, JSON.stringify(delays));
`, { mode: 0o755 });
  const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${root}:${process.env.PATH}`,
      RUNNER_TEMP: root,
      NPM_DIST_TAG: npmTag,
      HEPR_PUBLISH_COMMANDS: commandsPath,
      HEPR_PUBLISH_DELAYS: delaysPath,
      HEPR_PUBLISH_FAILURES: JSON.stringify(failures)
    }
  });
  assert.ifError(result.error);
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    commands: JSON.parse(await readFile(commandsPath, "utf8")),
    delays: JSON.parse(await readFile(delaysPath, "utf8"))
  };
}

const duplicateProvenanceError = "npm error code TLOG_CREATE_ENTRY_ERROR\n" +
  "npm error error creating tlog entry - (409) an equivalent entry already exists in the transparency log with UUID fixture";

test("npm publishing succeeds immediately for stable and prerelease dist-tags", async t => {
  for (const npmTag of ["latest", "next"]) {
    const h = await publishHarness(t, [], npmTag);
    assert.equal(h.status, 0, h.output);
    assert.deepEqual(h.commands, [["publish", "--access", "public", "--tag", npmTag]]);
    assert.deepEqual(h.delays, []);
    assert.doesNotMatch(h.output, /::warning::|::error::/);
  }
});

test("npm publishing retries duplicate Sigstore entries with provenance still enabled", async t => {
  const h = await publishHarness(t, [duplicateProvenanceError, duplicateProvenanceError]);
  assert.equal(h.status, 0, h.output);
  assert.equal(h.commands.length, 3);
  for (const command of h.commands) {
    assert.deepEqual(command, ["publish", "--access", "public", "--tag", "latest"]);
  }
  assert.deepEqual(h.delays, ["10", "20"]);
  assert.match(h.output, /::warning::Sigstore/);
  assert.doesNotMatch(h.output, /::error::/);
});

test("npm publishing fails after three duplicate Sigstore errors", async t => {
  const h = await publishHarness(t, Array(3).fill(duplicateProvenanceError));
  assert.equal(h.status, 1, h.output);
  assert.equal(h.commands.length, 3);
  assert.deepEqual(h.delays, ["10", "20"]);
  assert.match(h.output, /::error::npm publication failed.*do not bump the version/);
});

test("npm publishing does not retry authentication, version conflicts or other provenance errors", async t => {
  for (const failure of [
    "npm error code E401\nnpm error Unauthorized",
    "npm error code E403\nnpm error You cannot publish over the previously published versions",
    "npm error code TLOG_CREATE_ENTRY_ERROR\nnpm error unexpected provenance failure",
    "npm error equivalent entry already exists in the transparency log"
  ]) {
    const h = await publishHarness(t, [failure]);
    assert.equal(h.status, 1, h.output);
    assert.equal(h.commands.length, 1);
    assert.deepEqual(h.delays, []);
  }
  const h = await publishHarness(t, [duplicateProvenanceError, "npm error code E401"]);
  assert.equal(h.status, 1, h.output);
  assert.equal(h.commands.length, 2);
  assert.deepEqual(h.delays, ["10"]);
});
