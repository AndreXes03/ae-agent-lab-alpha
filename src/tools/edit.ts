import { z } from "zod";
import { errorResult } from "../errors.js";
import { FastEditService, fastEditRequest } from "../workflows/fast-edit.js";
import { defineTool, jsonResult } from "./define-tool.js";

const request = z.discriminatedUnion("action", [
  fastEditRequest.extend({ action: z.literal("edit") }),
  z.object({ action: z.literal("status"), requestId: z.uuid() }).strict(),
]);

/** Small general edits on the resident managed .aep copy, with durable idempotency. */
export const editTool = defineTool({
  name: "ae_edit",
  title: "Edit a managed After Effects project copy",
  description:
    "Apply up to 12 typed, registered edits to the active managed .aep copy in one AE call. " +
    "A UUID requestId prevents repeat execution after a retry or timeout. The call captures pre-edit values, " +
    "saves a checkpoint, edits, reads back values and saves the project. Use action=status with the same " +
    "requestId to inspect a delayed receipt. This does not render frames.",
  group: "operations",
  blockedInReadOnly: false,
  effect: "destructive",
  inputShape: { request: request.describe("Edit or inspect a prior edit by requestId.") },
  handler: async ({ request: raw }, transport) => {
    const parsed = request.safeParse(raw);
    if (!parsed.success)
      return errorResult("INVALID_ARGS", "Invalid fast edit request", {
        details: {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
    try {
      const service = new FastEditService({ transport });
      const value =
        parsed.data.action === "status"
          ? await service.status(parsed.data.requestId)
          : await service.execute((({ action: _action, ...edit }) => edit)(parsed.data));
      const payload = { ...value };
      if (value.state === "failed" || value.state === "uncertain")
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: false, ...payload }, null, 2) }],
          structuredContent: { ok: false, ...payload },
          isError: true,
        };
      return jsonResult(payload);
    } catch (error) {
      return errorResult(
        "OPERATION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  },
});
