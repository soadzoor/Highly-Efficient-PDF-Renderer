import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distDir = path.join(repoRoot, "dist");
const deployDir = path.resolve(repoRoot, "../Highly-Efficient-PDF-Renderer_deploy");

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    const stdout = result.stdout.trim();
    const details = stderr || stdout || `exit code ${result.status ?? "unknown"}`;
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${details}`);
  }

  return result.stdout.trim();
}

async function ensureDirectoryExists(directoryPath, label) {
  let stat;
  try {
    stat = await fs.stat(directoryPath);
  } catch {
    throw new Error(`${label} does not exist: ${directoryPath}`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${directoryPath}`);
  }
}

async function clearNonHiddenRootEntries(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) =>
        fs.rm(path.join(directoryPath, entry.name), {
          recursive: true,
          force: true
        })
      )
  );
}

async function copyDirectoryContents(sourceDir, targetDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const fromPath = path.join(sourceDir, entry.name);
    const toPath = path.join(targetDir, entry.name);
    await fs.cp(fromPath, toPath, {
      recursive: true
    });
  }
}

function hasStagedChanges(directoryPath) {
  const result = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: directoryPath,
    encoding: "utf8"
  });

  if (result.status === 0) {
    return false;
  }
  if (result.status === 1) {
    return true;
  }

  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  const details = stderr || stdout || `exit code ${result.status ?? "unknown"}`;
  throw new Error(`git diff --cached --quiet failed in ${directoryPath}: ${details}`);
}

function gitSucceeds(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });
  return result.status === 0;
}

function synchronizeDeployBranch(deployBranch) {
  const status = runGit(["status", "--porcelain"], deployDir);
  if (status) {
    throw new Error(
      `Deploy checkout has uncommitted changes: ${deployDir}. ` +
        "Commit or discard them before deploying."
    );
  }

  runGit(["fetch", "origin", deployBranch], deployDir);

  const remoteRef = `refs/remotes/origin/${deployBranch}`;
  const localHead = runGit(["rev-parse", "HEAD"], deployDir);
  const remoteHead = runGit(["rev-parse", "--verify", remoteRef], deployDir);

  if (localHead === remoteHead) {
    return;
  }

  if (gitSucceeds(["merge-base", "--is-ancestor", localHead, remoteHead], deployDir)) {
    runGit(["merge", "--ff-only", remoteRef], deployDir);
    return;
  }

  if (!gitSucceeds(["merge-base", "--is-ancestor", remoteHead, localHead], deployDir)) {
    throw new Error(
      `Deploy branch "${deployBranch}" has diverged from origin/${deployBranch} in ` +
        `${deployDir}. Reconcile the deploy checkout manually before deploying.`
    );
  }
}

function resolveMainRef() {
  const result = spawnSync("git", ["show-ref", "--verify", "--quiet", "refs/heads/main"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return result.status === 0 ? "main" : "HEAD";
}

function resolveLastDeployedSourceRevision(deployHead, mainRef) {
  const recordedRevision = runGit(
    ["log", "-1", "--format=%(trailers:key=Source-Revision,valueonly)", deployHead],
    deployDir
  ).trim();

  if (
    recordedRevision &&
    gitSucceeds(["merge-base", "--is-ancestor", recordedRevision, mainRef], repoRoot)
  ) {
    return recordedRevision;
  }

  // Older deploy commits did not record the source revision. Their timestamp is
  // the best available boundary, because deploy commits are created after builds.
  const deployedAt = runGit(["show", "-s", "--format=%cI", deployHead], deployDir);
  return runGit(["rev-list", "-1", `--before=${deployedAt}`, mainRef], repoRoot);
}

function commitSubjectsSince(baseRevision, fromRevision) {
  const revisionRange = baseRevision ? `${baseRevision}..${fromRevision}` : fromRevision;
  const output = runGit(["log", "--format=%s", revisionRange], repoRoot);
  if (output === "") {
    return [];
  }
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function main() {
  await ensureDirectoryExists(distDir, "Build output directory");
  await ensureDirectoryExists(deployDir, "Deploy directory");
  const deployBranch = runGit(["branch", "--show-current"], deployDir);
  if (!deployBranch) {
    throw new Error(`Deploy worktree is not on a branch: ${deployDir}`);
  }

  synchronizeDeployBranch(deployBranch);

  const deployHead = runGit(["rev-parse", "HEAD"], deployDir);
  const mainRef = resolveMainRef();
  const sourceRevision = runGit(["rev-parse", mainRef], repoRoot);
  const previousSourceRevision = resolveLastDeployedSourceRevision(deployHead, mainRef);
  const subjects = commitSubjectsSince(previousSourceRevision, mainRef);

  await clearNonHiddenRootEntries(deployDir);
  await copyDirectoryContents(distDir, deployDir);

  runGit(["add", "-A"], deployDir);

  if (!hasStagedChanges(deployDir)) {
    console.log("No deploy changes to commit.");
  } else {
    const title =
      subjects.length > 0
        ? `Deploy main (${subjects.length} commit${subjects.length === 1 ? "" : "s"})`
        : "Deploy main";
    const body =
      subjects.length > 0
        ? subjects.map((subject) => `- ${subject}`).join("\n")
        : "- No new main commits since the previous deployment.";

    runGit(
      ["commit", "-m", title, "-m", body, "-m", `Source-Revision: ${sourceRevision}`],
      deployDir
    );
    console.log(`Committed deploy artifacts to ${deployDir}`);
  }

  runGit(["push", "origin", deployBranch], deployDir);
  console.log(`Pushed deploy branch \"${deployBranch}\" to origin.`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`deploy failed: ${message}`);
  process.exitCode = 1;
});
