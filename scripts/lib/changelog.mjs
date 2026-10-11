const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/;
const linkDefinition = /^\[([^\]]+)\]:\s+(\S+)\s*$/;

function versionParts(version) {
  const match = typeof version === "string" && version.match(versionPattern);
  if (!match || match[4]?.split(".").some(part => /^0\d+$/.test(part))) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  return { numbers: match.slice(1, 4).map(BigInt), prerelease: match[4]?.split(".") };
}

function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let index = 0; index < 3; index++) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (!a.prerelease || !b.prerelease) return a.prerelease ? -1 : b.prerelease ? 1 : 0;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const x = a.prerelease[index], y = b.prerelease[index];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const numericX = /^\d+$/.test(x), numericY = /^\d+$/.test(y);
    if (numericX && numericY) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (numericX !== numericY) return numericX ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function validateDate(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid release date: ${date}; use a real YYYY-MM-DD date.`);
  }
}

// Heading-like text inside fenced examples must not become release sections.
function markdownLines(source) {
  let offset = 0, fence;
  return source.split("\n").map(text => {
    const marker = text.match(/^ {0,3}(`{3,}|~{3,})/);
    const code = Boolean(fence || marker);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && text.slice(marker[0].length).trim() === "") fence = undefined;
    }
    const line = { text, offset, code };
    offset += text.length + 1;
    return line;
  });
}

export function parseChangelog(input) {
  const source = input.replace(/\r\n/g, "\n");
  const sections = [], links = new Map();
  const lines = markdownLines(source);
  let footerStart = source.length;
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (line.code || (line.text.trim() && !linkDefinition.test(line.text))) break;
    if (linkDefinition.test(line.text)) footerStart = line.offset;
  }
  for (const line of lines) {
    if (line.code) continue;
    const heading = line.text.match(/^##\s+(.+)$/);
    if (heading) {
      const match = heading[1].match(/^\[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?$/);
      if (!match) throw new Error(`Malformed changelog version heading: ${line.text}`);
      const [, version, date] = match;
      if (version === "Unreleased") {
        if (date) throw new Error("Unreleased must not have a release date.");
      } else {
        versionParts(version);
        if (!date) throw new Error(`Release ${version} requires a YYYY-MM-DD date.`);
        validateDate(date);
      }
      sections.push({ version, date: date ?? null, start: line.offset, bodyStart: line.offset + line.text.length + 1 });
    }
    const link = line.text.match(linkDefinition);
    if (link) {
      const key = link[1].toLowerCase();
      if (links.has(key)) throw new Error(`Duplicate changelog link definition: ${link[1]}`);
      links.set(key, link[2]);
    }
  }
  if (sections[0]?.version !== "Unreleased") throw new Error("The first changelog section must be ## [Unreleased].");
  const seen = new Set();
  sections.forEach((section, index) => {
    if (seen.has(section.version)) throw new Error(`Duplicate changelog version: ${section.version}`);
    seen.add(section.version);
    section.end = sections[index + 1]?.start ?? footerStart;
    section.body = withoutLinkDefinitions(source.slice(section.bodyStart, section.end)).trim();
    if (!links.has(section.version.toLowerCase())) throw new Error(`Missing comparison link for changelog version ${section.version}.`);
    if (index > 1 && compareVersions(sections[index - 1].version, section.version) <= 0) {
      throw new Error("Changelog release versions must be ordered newest first.");
    }
  });
  return { source, sections, links, footerStart };
}

function withoutLinkDefinitions(source) {
  return markdownLines(source).filter(line => line.code || !linkDefinition.test(line.text)).map(line => line.text).join("\n");
}

function hasNotes(body) {
  return markdownLines(body).some(({ text, code }) => {
    if (code || !/^\s*[-*+]\s+\S/.test(text)) return false;
    const entry = text.replace(/^\s*[-*+]\s+/, "").replace(/[*_`]/g, "").trim();
    return !/^(?:tbd|todo|n\/?a|none|no changes(?: yet)?|\.\.\.|…)[.!\s]*$/i.test(entry);
  });
}

function requireNotes(section) {
  if (!section || !hasNotes(section.body)) throw new Error(`${section?.version ?? "Release"} needs nonempty release notes; headings and placeholders do not count.`);
}

function normalizeRepository(repositoryUrl) {
  if (typeof repositoryUrl !== "string" || !/^https:\/\/github\.com\/[^/]+\/[^/?#]+\/?$/.test(repositoryUrl)) {
    throw new Error("Release notes require a GitHub HTTPS repository URL.");
  }
  return repositoryUrl.replace(/\/$/, "");
}

function baselineVersion(document, repositoryUrl) {
  const link = document.links.get("unreleased");
  const prefix = `${repositoryUrl}/compare/v`, suffix = "...HEAD";
  if (!link?.startsWith(prefix) || !link.endsWith(suffix)) throw new Error("Unreleased comparison link must point from the current version tag to HEAD.");
  const version = decodeURIComponent(link.slice(prefix.length, -suffix.length));
  versionParts(version);
  return version;
}

function checkReleaseLinks(document, repositoryUrl) {
  for (let index = 1; index < document.sections.length; index++) {
    const section = document.sections[index], link = document.links.get(section.version.toLowerCase());
    const target = encodeURIComponent(`v${section.version}`);
    const previous = document.sections[index + 1];
    const prefix = previous
      ? `${repositoryUrl}/compare/${encodeURIComponent(`v${previous.version}`)}...`
      : `${repositoryUrl}/compare/v`;
    if (link !== `${repositoryUrl}/releases/tag/${target}` && !(link.startsWith(prefix) && link.endsWith(`...${target}`))) {
      throw new Error(`Invalid release comparison link for ${section.version}.`);
    }
  }
}

export function validateChangelog(source, {
  packageVersion, repositoryUrl, requireUnreleased = false, requireReleased = false, tag
}) {
  versionParts(packageVersion);
  const repository = normalizeRepository(repositoryUrl), document = parseChangelog(source);
  const baseline = baselineVersion(document, repository), latest = document.sections[1];
  if (baseline !== packageVersion || (latest && latest.version !== packageVersion)) {
    throw new Error(`Package version ${packageVersion}, latest changelog version and Unreleased comparison link must agree.`);
  }
  checkReleaseLinks(document, repository);
  for (const section of document.sections.slice(1)) requireNotes(section);
  if (requireUnreleased) requireNotes(document.sections[0]);
  if (tag !== undefined && tag !== `v${packageVersion}`) throw new Error(`Release tag ${tag} must match package version v${packageVersion}.`);
  if (requireReleased || tag !== undefined) {
    if (!latest || latest.version !== packageVersion) throw new Error(`Missing released changelog section for package version ${packageVersion}.`);
    requireNotes(latest);
    if (document.sections[0].body) throw new Error("Released tags must leave Unreleased empty; pending notes have not been finalized.");
  }
  return document;
}

export function finalizeChangelog(source, { version, repositoryUrl, date }) {
  versionParts(version);
  validateDate(date);
  const repository = normalizeRepository(repositoryUrl), document = parseChangelog(source);
  const previous = baselineVersion(document, repository);
  validateChangelog(source, { packageVersion: previous, repositoryUrl: repository, requireUnreleased: true });
  if (compareVersions(version, previous) <= 0 || document.sections.some(section => section.version === version)) {
    throw new Error(`New version ${version} must be greater than previous version ${previous}; a release cannot be finalized twice.`);
  }
  const pending = document.sections[0];
  const links = new Map(document.links);
  links.set("unreleased", `${repository}/compare/${encodeURIComponent(`v${version}`)}...HEAD`);
  links.set(version.toLowerCase(), `${repository}/compare/${encodeURIComponent(`v${previous}`)}...${encodeURIComponent(`v${version}`)}`);
  const older = document.sections.slice(1).map(section => `## [${section.version}] - ${section.date}\n\n${section.body}`).join("\n\n");
  const definitions = [...links].map(([key, url]) => `[${key === "unreleased" ? "Unreleased" : key}]: ${url}`).join("\n");
  const result = withoutLinkDefinitions(document.source.slice(0, pending.start)) +
    `## [Unreleased]\n\n## [${version}] - ${date}\n\n${pending.body}\n\n` +
    (older ? older + "\n\n" : "") + definitions + "\n";
  validateChangelog(result, { packageVersion: version, repositoryUrl: repository, requireReleased: true });
  return result;
}

export function extractReleaseNotes(source, { version, repositoryUrl }) {
  versionParts(version);
  const repository = normalizeRepository(repositoryUrl), document = parseChangelog(source);
  const section = document.sections.find(entry => entry.version === version);
  requireNotes(section);
  const resolveLink = target => {
    const angle = target.startsWith("<"), value = angle ? target.slice(1, -1) : target;
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(value)) return target;
    const url = new URL(value.replace(/^\//, ""), `${repository}/blob/${encodeURIComponent(`v${version}`)}/`).href;
    return angle ? `<${url}>` : url;
  };
  const used = new Set();
  const body = markdownLines(section.body).map(({ text, code }) => {
    if (code) return text;
    for (const match of text.matchAll(/!?\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
      if (text[match.index + match[0].length] === "(") continue;
      const id = (match[2] || match[1]).toLowerCase();
      if (document.links.has(id)) used.add(id);
    }
    return text.replace(/(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^\s)]+)([^\n)]*\))/g,
      (_, before, target, after) => before + resolveLink(target) + after);
  }).join("\n");
  const definitions = [...used].map(key => `[${key}]: ${resolveLink(document.links.get(key))}`).join("\n");
  return body + (definitions ? "\n\n" + definitions : "") + "\n";
}
