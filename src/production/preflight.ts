import { lstat, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { z } from "zod";

const exec = promisify(execFile);
export type Availability = "local" | "cloud-placeholder" | "missing" | "unknown";
export interface FileAvailability {
  path: string;
  state: Availability;
  bytes: number | null;
  mtimeMs: number | null;
  reason?: string;
}
/** Metadata only. Never open a dataless file to hash, probe, or decode it. */
export async function inspectAvailability(
  file: string,
  platform = process.platform,
  flags: (p: string) => Promise<string> = async (p) =>
    (await exec("/usr/bin/stat", ["-f", "%Sf", p], { timeout: 5000 })).stdout,
): Promise<FileAvailability> {
  if (!path.isAbsolute(file)) throw new Error("An absolute file path is required");
  const base = { path: file, bytes: null, mtimeMs: null };
  try {
    const st = await lstat(file);
    if (!st.isFile() || st.isSymbolicLink())
      return {
        ...base,
        state: "unknown",
        reason: "Not a regular file (symlinks are not followed)",
      };
    const meta = { ...base, bytes: st.size, mtimeMs: st.mtimeMs };
    if (path.basename(file).endsWith(".icloud"))
      return { ...meta, state: "cloud-placeholder", reason: "iCloud placeholder" };
    if (platform === "darwin") {
      try {
        if (/\bdataless\b/i.test(await flags(file)))
          return { ...meta, state: "cloud-placeholder", reason: "macOS dataless flag" };
      } catch {
        return { ...meta, state: "unknown", reason: "Could not inspect macOS file flags" };
      }
    } else if (platform === "win32") {
      return {
        ...meta,
        state: "unknown",
        reason: "Cloud recall flags are not supported on this platform",
      };
    }
    return { ...meta, state: "local" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      return { ...base, state: "unknown", reason: "Metadata unavailable" };
    const placeholder = path.join(path.dirname(file), "." + path.basename(file) + ".icloud");
    if (await lstat(placeholder).catch(() => null))
      return { ...base, state: "cloud-placeholder", reason: "Adjacent iCloud placeholder" };
    return { ...base, state: "missing" };
  }
}

export const dependencyManifest = z.strictObject({
  schemaVersion: z.literal(1),
  project: z.strictObject({ path: z.string(), bytes: z.number(), mtimeMs: z.number() }),
  dependencies: z.array(z.string()).max(5000),
  coverage: z.enum(["footage-and-proxies", "partial"]),
  expressionDependencies: z.literal("unknown"),
});

export async function requireLocal(file: string): Promise<FileAvailability> {
  const value = await inspectAvailability(file);
  if (value.state !== "local") throw new Error(`File is ${value.state}: ${file}`);
  return value;
}

export async function preflightProject(project: string, manifestPath?: string) {
  const source = await inspectAvailability(project);
  let dependencies: FileAvailability[] = [];
  let coverage = "unknown";
  let manifestError: string | null = null;
  const candidate = manifestPath ?? project + ".kynem-media.json";
  if (await lstat(candidate).catch(() => null)) {
    try {
      const meta = await requireLocal(candidate);
      if ((meta.bytes ?? 0) > 1_048_576) throw new Error("Dependency manifest is too large");
      const manifest = dependencyManifest.parse(JSON.parse(await readFile(candidate, "utf8")));
      if (
        path.resolve(manifest.project.path) !== path.resolve(project) ||
        manifest.project.bytes !== source.bytes ||
        manifest.project.mtimeMs !== source.mtimeMs
      )
        throw new Error("Dependency manifest is stale or belongs to another project");
      coverage = manifest.coverage;
      dependencies = await Promise.all(
        [...new Set(manifest.dependencies)].map((p) => inspectAvailability(p)),
      );
    } catch (error) {
      manifestError = String(error);
    }
  }
  const blocked = [source, ...dependencies].filter((f) => f.state !== "local");
  return {
    project: source,
    dependencies,
    coverage,
    expressionDependencies: "unknown",
    manifestError,
    canOpenKnownFiles: blocked.length === 0 && !manifestError,
    blocked,
    downloadBytesEstimate: dependencies
      .filter((f) => f.state === "cloud-placeholder")
      .reduce((sum, f) => sum + (f.bytes ?? 0), 0),
    downloadSizeComplete: dependencies.every(
      (f) => f.state !== "cloud-placeholder" || f.bytes !== null,
    ),
    warnings:
      coverage === "unknown"
        ? ["AEP dependencies are unknown; no offline binary AEP parser is used."]
        : [],
    mediaContentRead: false,
  };
}
