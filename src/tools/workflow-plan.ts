import { z } from "zod";

import { planWorkflow } from "../workflows/plan.js";
import { defineTool, jsonResult } from "./define-tool.js";

const frame = z.number().int().nonnegative();

export const workflowPlanTool = defineTool({
  name: "ae_workflow_plan",
  title: "Plan a safe multi-property retime",
  description:
    "Offline recipe for retiming several inspected property tracks in one AE batch. It validates whole-frame timing and returns typed operations plus a readback plan. It never contacts After Effects or applies edits.",
  group: "operations",
  blockedInReadOnly: false,
  effect: "read",
  inputShape: {
    spec: z
      .object({
        recipe: z.literal("retime_properties"),
        comp: z.union([z.string().min(1), z.number().int().positive()]),
        fps: z.number().finite().positive(),
        compDurationFrames: frame.positive(),
        offsetFrames: z.number().int(),
        timeScale: z.number().finite().positive().optional(),
        pivotFrame: frame.optional(),
        tracks: z
          .array(
            z.object({
              layer: z
                .number()
                .int()
                .positive()
                .describe("Live 1-based layer index; recheck immediately before execution."),
              property: z
                .array(z.string().min(1))
                .min(1)
                .describe("Canonical property match-name path from live readback."),
              keyTimesFrames: z
                .array(frame)
                .min(1)
                .max(64)
                .describe(
                  "ALL property key times from one fresh layer.info readback; no partial list.",
                ),
              numKeys: frame
                .positive()
                .describe("Total property key count from that same readback."),
              hasExpression: z.boolean(),
              inFrame: frame,
              outFrame: frame,
            }),
          )
          .min(1)
          .max(16),
      })
      .describe(
        "Fresh live AE readback for one comp and 1–16 explicit property tracks. Times and layer bounds are in whole comp frames; the planner does not inspect AE.",
      ),
  },
  handler: async ({ spec }) => jsonResult({ ...planWorkflow(spec) }),
});
