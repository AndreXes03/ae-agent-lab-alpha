import { z } from "zod";

import { errorResult } from "../errors.js";
import { retimeSpec } from "../workflows/retime.js";
import { variantsSpec } from "../workflows/variants.js";
import { WorkflowService } from "../workflows/service.js";
import { defineTool, jsonResult } from "./define-tool.js";

const prepare = z
  .object({
    action: z.literal("prepare"),
    recipe: z.enum(["retime_properties", "variants"]),
    copyPath: z
      .string()
      .min(1)
      .describe("Existing absolute path to the active managed copied .aep project."),
    spec: z.union([retimeSpec, variantsSpec]),
  })
  .strict();
const jobAction = (action: "apply" | "status") =>
  z
    .object({
      action: z.literal(action),
      jobId: z.string().min(1),
    })
    .strict();
export const workflowRequest = z.discriminatedUnion("action", [
  prepare,
  jobAction("apply"),
  jobAction("status"),
]);

/** Persistent prepare/apply/status workflow. Apply is mutation-gated by the service. */
export const workflowTool = defineTool({
  name: "ae_workflow",
  title: "Prepare, apply, or inspect an AE workflow",
  description:
    "Prepare a typed retime or text/logo variants recipe against an existing active managed .aep copy and persist a guarded job. Apply only after reviewing the job, or read its status. Apply edits only that copy. No production render is started automatically.",
  group: "operations",
  blockedInReadOnly: false,
  effect: "destructive",
  inputShape: {
    request: workflowRequest.describe(
      "Action-specific workflow request. Use prepare first, then apply or status with its jobId.",
    ),
  },
  handler: async ({ request }, transport) => {
    const parsed = workflowRequest.safeParse(request);
    if (!parsed.success)
      return errorResult("INVALID_ARGS", "Invalid workflow request", {
        details: {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
    const r = parsed.data;
    if (r.action === "prepare") {
      if (r.recipe === "variants" && !variantsSpec.safeParse(r.spec).success)
        return errorResult("INVALID_ARGS", "Variants recipe does not match the supplied spec");
      if (r.recipe === "retime_properties" && !retimeSpec.safeParse(r.spec).success)
        return errorResult("INVALID_ARGS", "Retime recipe does not match the supplied spec");
    }
    try {
      const service = new WorkflowService({ transport });
      const result =
        r.action === "prepare"
          ? await service.prepare(r.recipe, r.spec, r.copyPath)
          : r.action === "apply"
            ? await service.apply(r.jobId)
            : await service.status(r.jobId);
      if (result.state === "failed" || result.state === "uncertain") {
        const payload = { ok: false, ...result };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
          isError: true,
        };
      }
      return jsonResult({ ...result });
    } catch (error) {
      return errorResult(
        "OPERATION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  },
});
