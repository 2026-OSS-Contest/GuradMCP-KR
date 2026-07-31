// Filesystem scanning only (GMCP-14, FR-POL-02 §1) — no parsing/validation.
//
// A pack directory is `policy-packs/<pack-id>/`. It may carry a manifest
// (`pack.yaml` or `pack.meta.yaml`) that lists its policy files explicitly
// (the real `policy-packs/*` layout: `policies: [policies/foo.yaml, ...]`);
// when there is no manifest, or the manifest omits `policies`, every
// top-level `*.yaml`/`*.yml` file in the directory (other than the manifest
// itself) is treated as one policy (task spec §1's flat-directory case).

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface PackDirectoryEntry {
  packId: string;
  packDir: string;
}

const MANIFEST_NAMES = ["pack.yaml", "pack.meta.yaml"];

export async function scanPackDirectories(rootDir: string): Promise<PackDirectoryEntry[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ packId: entry.name, packDir: join(rootDir, entry.name) }))
    .sort((left, right) => left.packId.localeCompare(right.packId));
}

export async function findManifestPath(packDir: string): Promise<string | undefined> {
  for (const name of MANIFEST_NAMES) {
    const candidate = join(packDir, name);
    if (await isFile(candidate)) return candidate;
  }
  return undefined;
}

/** Fallback file listing used when a pack has no manifest-declared list. */
export async function listYamlFilesFlat(packDir: string): Promise<string[]> {
  const entries = await readdir(packDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name) && !MANIFEST_NAMES.includes(entry.name))
    .map((entry) => join(packDir, entry.name))
    .sort();
}

async function isFile(path: string): Promise<boolean> {
  return stat(path)
    .then((info) => info.isFile())
    .catch(() => false);
}
