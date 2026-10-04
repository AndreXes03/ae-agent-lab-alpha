import { z } from "zod";
import { sceneInputShape, loadSceneInput } from "../scenes/input.js";
import { SceneService } from "../scenes/service.js";
import { errorResult } from "../errors.js";
import { defineTool, jsonResult } from "./define-tool.js";
export const sceneRequest = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("prepare"),
      ...sceneInputShape,
      copyPath: z.string().min(1),
      requestId: z.string().uuid(),
    })
    .strict(),
  z.object({ action: z.literal("apply"), jobId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("status"), jobId: z.string().uuid() }).strict(),
]);
export const sceneTool = defineTool({
  name: "ae_scene",
  title: "Prepare and apply a native scene",
  description:
    "Compile a bounded native comp, text, rectangle, connector and group scene, inspect its differential preflight, then apply to the managed saved copy. Stable IDs preserve unrelated manual edits. Use the same requestId after timeout. Unknown layers are never adopted or deleted.",
  group: "operations",
  blockedInReadOnly: false,
  effect: "destructive",
  inputShape: { request: sceneRequest },
  handler: async ({ request }, transport) => {
    try {
      const service = new SceneService({ transport });
      const r = sceneRequest.parse(request);
      const result =
        r.action === "prepare"
          ? await service.prepare(await loadSceneInput(r.spec, r.specPath), r.copyPath, r.requestId)
          : r.action === "apply"
            ? await service.apply(r.jobId)
            : await service.status(r.jobId);
      if (result.state === "failed" || result.state === "uncertain")
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ok: false, ...result }) }],
          structuredContent: { ok: false, ...result },
          isError: true,
        };
      return jsonResult(result);
    } catch (e) {
      return errorResult("OPERATION_FAILED", e instanceof Error ? e.message : String(e));
    }
  },
});
