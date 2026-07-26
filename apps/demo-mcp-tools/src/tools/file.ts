import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { sandboxRoot } from "../lib/fixtures-root.js";
import { text, ToolError, type ToolDefinition } from "../types.js";

/**
 * Resolves a caller-supplied path against the sandbox root and rejects any
 * escape attempt (`..`, absolute paths, symlink-style tricks land outside the
 * root after resolution). This is the only thing standing between `read_file`
 * and the host filesystem, so it fails closed on anything ambiguous.
 */
function resolveSandboxPath(requested: string): string {
  if (path.isAbsolute(requested)) throw new ToolError("Absolute paths are not allowed", 403);
  const resolved = path.resolve(sandboxRoot, requested);
  if (resolved !== sandboxRoot && !resolved.startsWith(sandboxRoot + path.sep)) {
    throw new ToolError("Path escapes the sandbox root", 403);
  }
  return resolved;
}

function listDirectory(relativePath: string): string[] {
  const target = resolveSandboxPath(relativePath);
  const entries = readdirSync(target, { withFileTypes: true });
  return entries.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name)).sort();
}

export const fileTools: ToolDefinition[] = [
  {
    name: "list_files",
    description: "List files and directories under the sandbox root.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Directory path relative to the sandbox root; defaults to the root." } }
    },
    handler: (args) => {
      const relativePath = typeof args.path === "string" ? args.path : ".";
      return text(JSON.stringify(listDirectory(relativePath)));
    }
  },
  {
    name: "read_file",
    description: "Read a file's contents by path relative to the sandbox root.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "File path relative to the sandbox root." } },
      required: ["path"]
    },
    handler: (args) => {
      if (typeof args.path !== "string" || args.path.length === 0) throw new ToolError("path is required");
      const resolved = resolveSandboxPath(args.path);
      if (!statSync(resolved, { throwIfNoEntry: false })?.isFile()) throw new ToolError("File not found", 404);
      return text(readFileSync(resolved, "utf8"));
    }
  },
  {
    name: "read_readme",
    description: "Read the project README at the sandbox root.",
    inputSchema: { type: "object", properties: {} },
    handler: () => text(readFileSync(path.join(sandboxRoot, "README.md"), "utf8"))
  }
];
