import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { RUNTIME_DIR } from "../config.js";
import { errorResult } from "../errors.js";
import { loadSceneInput } from "../scenes/input.js";
import { sequenceScenes } from "../scenes/compile.js";
import { sceneSpec } from "../scenes/model.js";
import { defineTool, jsonResult } from "./define-tool.js";
export const sceneComposeTool = defineTool({
  name: "ae_scene_compose",
  title: "Compose frame-aligned scene sequence",
  description:
    "Concatenate declarative scenes offline at exact integer frame offsets. All scenes must share dimensions and fps. Writes a validated JSON scene artifact usable by ae_scene preview/prepare. IDs are prefixed s0_,s1_ etc; optional supplied text bounds use these prefixed IDs. Does not contact After Effects or create native precompositions.",
  group: "document",
  blockedInReadOnly: false,
  effect: "write",
  inputShape: {
    id: sceneSpec.shape.id,
    name: sceneSpec.shape.name,
    scenes: z
      .array(z.unknown())
      .min(1)
      .max(100)
      .describe("Scenes in order: JSON objects or absolute JSON file paths, same dimensions/fps."),
    textBounds: z
      .record(
        z.string(),
        z
          .object({ width: z.number().finite().positive(), height: z.number().finite().positive() })
          .strict(),
      )
      .optional(),
  },
  handler: async ({ id, name, scenes, textBounds }) => {
    try {
      const inputs = await Promise.all(
        scenes.map((scene) =>
          typeof scene === "string" ? loadSceneInput(undefined, scene) : loadSceneInput(scene),
        ),
      );
      const compiled = sequenceScenes(inputs, id, name, { textBounds });
      const resolvedBounds = new Map(compiled.nodes.map((node) => [node.id, node]));
      const artifactSpec = {
        ...compiled.spec,
        nodes: compiled.spec.nodes.map((node) => ({
          ...node,
          width: resolvedBounds.get(node.id)!.width,
          height: resolvedBounds.get(node.id)!.height,
        })),
      };
      const serialized = JSON.stringify(artifactSpec, null, 2);
      const hash = createHash("sha256").update(serialized).digest("hex");
      const directory = path.join(RUNTIME_DIR, "scene-compositions");
      await mkdir(directory, { recursive: true });
      const artifact = path.join(directory, `${hash}.json`);
      const temporary = artifact + `.${randomUUID()}.tmp`;
      await writeFile(temporary, serialized, { encoding: "utf8", flag: "w" });
      await rename(temporary, artifact);
      return jsonResult({
        artifact,
        hash,
        nodeCount: compiled.nodes.length,
        durationFrames: compiled.spec.durationFrames,
        fps: compiled.spec.fps,
        kind: "scene-spec",
        limitations: [
          "Frame-aligned concatenation; no native precomposition created.",
          "Supplied text bounds are not native measurements.",
        ],
      });
    } catch (error) {
      return errorResult("VALIDATION", error instanceof Error ? error.message : String(error));
    }
  },
});
