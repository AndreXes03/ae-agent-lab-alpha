import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { sceneSpec, type SceneSpec } from "./model.js";
export const sceneInputShape = {
  spec: z
    .unknown()
    .optional()
    .describe(
      "Declarative scene JSON: id,name,width,height,fps,durationFrames,nodes. Supply exactly one of spec or specPath.",
    ),
  specPath: z
    .string()
    .min(1)
    .max(4096)
    .optional()
    .describe(
      "Absolute local JSON artifact path, e.g. from ae_scene_compose. Exactly one of spec or specPath; regular files only, max512KiB.",
    ),
};
export async function loadSceneInput(spec?: unknown, specPath?: string): Promise<SceneSpec> {
  if ((spec !== undefined) === (specPath !== undefined))
    throw new Error("Supply exactly one of spec or specPath");
  if (specPath === undefined) return sceneSpec.parse(spec);
  if (!path.isAbsolute(specPath)) throw new Error("specPath must be absolute");
  const file = await open(specPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await file.stat();
    const limit = 512 * 1024;
    if (!details.isFile() || details.size > limit)
      throw new Error("Scene input must be a regular JSON file at most512KiB");
    const buffer = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < buffer.length) {
      const result = await file.read(buffer, count, buffer.length - count, null);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    if (count > limit) throw new Error("Scene input exceeds512KiB");
    return sceneSpec.parse(JSON.parse(buffer.subarray(0, count).toString("utf8")));
  } finally {
    await file.close();
  }
}
