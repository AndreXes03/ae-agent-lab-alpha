import { z } from "zod";
import { errorResult } from "../errors.js";
import { RUNTIME_DIR } from "../config.js";
import { compileScene } from "../scenes/compile.js";
import { cacheScenePreview } from "../scenes/cache.js";
import { loadSceneInput, sceneInputShape } from "../scenes/input.js";
import { previewLimitations, scenePreviewHtml } from "../scenes/preview.js";
import { defineTool, jsonResult } from "./define-tool.js";

export const scenePreviewTool = defineTool({
  name: "ae_scene_preview",
  title: "Preview a declarative scene locally",
  description:
    "Create a self-contained local schematic HTML player without contacting After Effects. SCHEMATIC NOT AE RENDER: browser fonts and text metrics differ; no effects, footage, 3D or native motion blur. Uses shared integer-frame motion evaluation. Cache reuse requires complete asset/font/config fingerprints; expectedHash rejects stale input.",
  group: "render",
  blockedInReadOnly: false,
  effect: "write",
  inputShape: {
    ...sceneInputShape,
    textBounds: z
      .record(
        z.string(),
        z.object({ width: z.number().finite().positive(), height: z.number().finite().positive() }),
      )
      .optional(),
    dependencies: z
      .object({
        assets: z.record(z.string(), z.string().min(1)).optional(),
        fonts: z.record(z.string(), z.string().min(1)).optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        complete: z.boolean().default(false),
      })
      .strict()
      .optional(),
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  },
  handler: async ({ spec, specPath, textBounds, dependencies, expectedHash }) => {
    try {
      const compiled = compileScene(await loadSceneInput(spec, specPath), { textBounds });
      const result = await cacheScenePreview(
        RUNTIME_DIR,
        compiled,
        dependencies ?? {},
        () => scenePreviewHtml(compiled),
        expectedHash,
      );
      return jsonResult({ ...result, kind: "schematic", limitations: previewLimitations });
    } catch (error) {
      return errorResult("VALIDATION", error instanceof Error ? error.message : String(error));
    }
  },
});
