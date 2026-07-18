#!/usr/bin/env node

import { homedir } from "node:os";
import { readdir, readFile, realpath, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArguments(argv) {
  const options = {
    output: path.join(ROOT, "artifacts/licenses"),
    gradleDependencies: path.join(ROOT, "artifacts/licenses/gradle-dependencies.txt")
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output" || argument === "--gradle-dependencies") {
      if (!argv[index + 1]) throw new Error(`${argument} requires a value`);
      const key = argument === "--output" ? "output" : "gradleDependencies";
      options[key] = path.resolve(ROOT, argv[index + 1]);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function normalizeLicense(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const values = value.map(normalizeLicense).filter((license) => license !== "UNKNOWN");
    return values.length > 0 ? values.join(" OR ") : "UNKNOWN";
  }
  if (value && typeof value === "object") return normalizeLicense(value.type ?? value.name);
  return "UNKNOWN";
}

function repositoryUrl(value) {
  if (typeof value === "string") return value;
  return value?.url ?? "";
}

async function npmPackages(nodeModules) {
  const packages = new Map();
  const visited = new Set();

  async function scan(directory) {
    let realDirectory;
    try {
      realDirectory = await realpath(directory);
    } catch {
      return;
    }
    if (visited.has(realDirectory)) return;
    visited.add(realDirectory);

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".bin" || entry.name === ".cache") continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        await scan(entryPath);
        continue;
      }
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      try {
        const manifest = JSON.parse(await readFile(path.join(entryPath, "package.json"), "utf8"));
        if (manifest.name && manifest.version) {
          const key = `npm:${manifest.name}@${manifest.version}`;
          packages.set(key, {
            ecosystem: "npm",
            name: manifest.name,
            version: manifest.version,
            license: normalizeLicense(manifest.license ?? manifest.licenses),
            repository: repositoryUrl(manifest.repository)
          });
        }
      } catch {
        // A directory in node_modules is not necessarily a package root.
      }
      await scan(path.join(entryPath, "node_modules"));
    }
  }

  await scan(nodeModules);
  return [...packages.values()];
}

function decodeXml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .trim();
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, "")) : "";
}

async function findPom(group, artifact, version) {
  const directory = path.join(
    homedir(), ".gradle/caches/modules-2/files-2.1", group, artifact, version
  );
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(candidate);
      else if (entry.name.endsWith(".pom")) return candidate;
    }
  }
  return undefined;
}

async function gradlePackages(dependencyFile) {
  let output;
  try {
    output = await readFile(dependencyFile, "utf8");
  } catch {
    return [];
  }

  const coordinates = new Map();
  for (const line of output.split("\n")) {
    const match = line.match(/---\s+([^:\s]+):([^:\s]+):([^\s(]+)/);
    if (!match || match[3] === "unspecified") continue;
    let version = match[3];
    const arrowIndex = line.indexOf(" -> ");
    if (arrowIndex >= 0) version = line.slice(arrowIndex + 4).trim().split(/\s/)[0];
    version = version.replace(/[},]$/, "");
    coordinates.set(`${match[1]}:${match[2]}:${version}`, {
      group: match[1], artifact: match[2], version
    });
  }

  const packages = [];
  for (const coordinate of coordinates.values()) {
    const pomPath = await findPom(coordinate.group, coordinate.artifact, coordinate.version);
    let license = "UNKNOWN";
    let repository = "";
    if (pomPath) {
      const pom = await readFile(pomPath, "utf8");
      const licenseBlock = pom.match(/<licenses(?:\s[^>]*)?>([\s\S]*?)<\/licenses>/i)?.[1] ?? "";
      const names = [...licenseBlock.matchAll(/<license(?:\s[^>]*)?>([\s\S]*?)<\/license>/gi)]
        .map((match) => tagValue(match[1], "name"))
        .filter(Boolean);
      if (names.length > 0) license = [...new Set(names)].join(" OR ");
      repository = tagValue(licenseBlock, "url") || tagValue(pom, "url");
    }
    packages.push({
      ecosystem: "gradle",
      name: `${coordinate.group}:${coordinate.artifact}`,
      version: coordinate.version,
      license,
      repository
    });
  }
  return packages;
}

function escapeMarkdown(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [npm, gradle] = await Promise.all([
    npmPackages(path.join(ROOT, "node_modules")),
    gradlePackages(options.gradleDependencies)
  ]);
  const dependencies = [...npm, ...gradle].sort((left, right) =>
    left.ecosystem.localeCompare(right.ecosystem)
      || left.name.localeCompare(right.name)
      || left.version.localeCompare(right.version)
  );
  if (dependencies.length === 0) {
    throw new Error("No installed npm or resolved Gradle dependencies were found");
  }

  const unknown = dependencies.filter((dependency) => dependency.license === "UNKNOWN");
  const generatedAt = new Date().toISOString();
  const json = {
    schemaVersion: 1,
    generatedAt,
    dependencyCount: dependencies.length,
    unknownLicenseCount: unknown.length,
    dependencies
  };
  const markdown = [
    "# Third-party dependency licenses",
    "",
    `Generated: ${generatedAt}`,
    "",
    `Dependencies: **${dependencies.length}** · Unknown licenses: **${unknown.length}**`,
    "",
    "| Ecosystem | Package | Version | License | Repository |",
    "| --- | --- | --- | --- | --- |",
    ...dependencies.map((dependency) =>
      `| ${escapeMarkdown(dependency.ecosystem)} | ${escapeMarkdown(dependency.name)} | `
      + `${escapeMarkdown(dependency.version)} | ${escapeMarkdown(dependency.license)} | `
      + `${escapeMarkdown(dependency.repository)} |`
    ),
    ""
  ].join("\n");
  const csv = [
    ["ecosystem", "package", "version", "license", "repository"].map(csvCell).join(","),
    ...dependencies.map((dependency) => [
      dependency.ecosystem, dependency.name, dependency.version, dependency.license, dependency.repository
    ].map(csvCell).join(",")),
    ""
  ].join("\n");

  await mkdir(options.output, { recursive: true });
  await Promise.all([
    writeFile(path.join(options.output, "dependencies.json"), `${JSON.stringify(json, null, 2)}\n`, "utf8"),
    writeFile(path.join(options.output, "THIRD_PARTY_LICENSES.md"), markdown, "utf8"),
    writeFile(path.join(options.output, "dependencies.csv"), csv, "utf8")
  ]);
  console.log(`Wrote ${dependencies.length} dependency licenses (${unknown.length} unknown) to ${path.relative(ROOT, options.output)}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await writeFile(process.env.GITHUB_STEP_SUMMARY, [
      "## Dependency license report", "", `- Dependencies: ${dependencies.length}`,
      `- Unknown licenses: ${unknown.length}`, ""
    ].join("\n"), { flag: "a" });
  }
}

main().catch((error) => {
  console.error(`License report error: ${error.message}`);
  process.exitCode = 1;
});
