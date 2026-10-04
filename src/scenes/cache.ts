import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const digest = (html: string) => createHash("sha256").update(html).digest("hex");

export interface SceneDependencies {
  assets?: Record<string, string>;
  fonts?: Record<string, string>;
  config?: Record<string, unknown>;
  complete?: boolean;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function sceneCacheHash(scene: unknown, dependencies: SceneDependencies = {}): string {
  return createHash("sha256")
    .update(canonical({ renderer: "schematic-v1", scene, dependencies }))
    .digest("hex");
}
export async function cacheScenePreview(
  root: string,
  scene: unknown,
  dependencies: SceneDependencies,
  source: string | (() => string),
  expectedHash?: string,
) {
  const hash = sceneCacheHash(scene, dependencies);
  if (expectedHash !== undefined && expectedHash !== hash)
    throw new Error("Stale scene identity: expectedHash differs from scene and dependency content");
  const reusable = dependencies.complete === true;
  const dir = path.join(root, "scene-previews", reusable ? hash : `${hash}-${randomUUID()}`);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const artifactPath = path.join(dir, "index.html");
  const manifestPath = path.join(dir, "integrity.sha256");
  if (reusable && typeof source === "function") {
    try {
      const [existing, integrity] = await Promise.all([
        fs.readFile(artifactPath, "utf8"),
        fs.readFile(manifestPath, "utf8"),
      ]);
      if (digest(existing) !== integrity)
        throw new Error("Immutable preview cache integrity mismatch");
      return { hash, cacheHit: true, reusable, artifactPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const html = typeof source === "function" ? source() : source;
  let cacheHit = false;
  const temporary = path.join(dir, `.preview-${randomUUID()}.tmp`);
  await fs.writeFile(temporary, html, { flag: "wx", mode: 0o600 });
  try {
    try {
      await fs.link(temporary, artifactPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await fs.readFile(artifactPath, "utf8")) !== html)
        throw new Error("Immutable preview cache integrity mismatch", { cause: error });
      cacheHit = true;
    }
  } finally {
    await fs.unlink(temporary);
  }
  const manifestTemporary = path.join(dir, `.integrity-${randomUUID()}.tmp`);
  await fs.writeFile(manifestTemporary, digest(html), { flag: "wx", mode: 0o600 });
  try {
    try {
      await fs.link(manifestTemporary, manifestPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if ((await fs.readFile(manifestPath, "utf8")) !== digest(html))
        throw new Error("Immutable preview cache integrity mismatch", { cause: error });
    }
  } finally {
    await fs.unlink(manifestTemporary);
  }
  return { hash, cacheHit, reusable, artifactPath };
}
