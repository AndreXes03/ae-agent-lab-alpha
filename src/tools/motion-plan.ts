import { z } from "zod";

import { planMotion } from "../motion/plan.js";
import { defineTool, jsonResult } from "./define-tool.js";

const vec2 = z.tuple([z.number().finite(), z.number().finite()]);
const frame = z.number().int().nonnegative();
const layerRef = z.union([
  z.string().min(1),
  z.number().int().positive(),
  z.object({ id: z.number().int().positive() }),
]);

export const motionPlanTool = defineTool({
  name: "ae_motion_plan",
  title: "Plan motion reveals",
  description:
    "Offline motion planner for typography, panels, icons, and bars. Prepare pivots, reread positions, then request reveal ops. Audit phase checks camera samples without proposing edits. It never contacts After Effects or applies edits. Supply real readback and render before/after.",
  group: "operations",
  blockedInReadOnly: false,
  effect: "read",
  inputShape: {
    spec: z
      .object({
        phase: z.enum(["prepare", "reveal", "audit"]),
        comp: z.union([z.string().min(1), z.number().int().positive()]),
        fps: z.number().finite().positive(),
        compDurationFrames: frame,
        sceneStartFrame: frame,
        sceneEndFrame: frame,
        staggerFrames: frame,
        minHoldFrames: frame,
        items: z
          .array(
            z.object({
              layer: layerRef,
              preset: z.enum(["typography", "panel", "icon", "bar"]),
              targetPosition: vec2,
              finalScale: vec2,
              inFrame: frame,
              outFrame: frame,
              visibleAtSceneStart: z.boolean(),
              isTwoD: z.boolean(),
              isUnparented: z.boolean(),
              positionSeparated: z.boolean(),
              hasTransformExpressions: z.boolean(),
              existingKeyCounts: z.object({
                anchor: frame,
                position: frame,
                scale: frame,
                opacity: frame,
              }),
              staticOpacity: z.number().finite().min(0).max(100),
              pivotPrepared: z.boolean(),
              measuredBounds: z
                .object({
                  left: z.number().finite(),
                  top: z.number().finite(),
                  width: z.number().finite().nonnegative(),
                  height: z.number().finite().nonnegative(),
                })
                .optional(),
              expectedCenter: vec2.optional(),
              centerTolerancePx: z.number().finite().nonnegative().optional(),
            }),
          )
          .min(0),
        cameraSamples: z
          .array(z.object({ frame, position: vec2, scale: vec2.optional() }))
          .optional(),
        intentionalReversalFrames: z.array(frame).optional(),
        transitionJoins: z
          .array(
            z.object({
              frame,
              incomingVelocity: vec2,
              outgoingVelocity: vec2,
              intentionalStop: z.boolean().optional(),
              intentionalCut: z.boolean().optional(),
            }),
          )
          .optional(),
      })
      .describe(
        "Verified scene measurements and intended layout. Frame values must come from the live AE composition and layers; the planner cannot inspect them.",
      ),
  },
  handler: async ({ spec }) =>
    jsonResult({
      ...planMotion(spec),
      application:
        spec.phase === "audit"
          ? "Read-only audit of supplied camera samples and transition velocities. No operations are proposed. Inspect real playback before deciding whether a reversal or stop is intentional."
          : spec.phase === "prepare"
            ? "Planning only. Apply each pivot with ae_do on the saved copied project, then reread Position and call ae_motion_plan again with phase:reveal and pivotPrepared:true. Do not reuse the pre-pivot Position value."
            : "Planning only. Render baseline frames before applying reveal operations with ae_do or batch.run stopOnError:true. Read back keyframes and render matching after frames. Inspect motion playback for rhythm and visual quality.",
    }),
});
