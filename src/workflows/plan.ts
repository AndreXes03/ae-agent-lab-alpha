/** Offline, bounded workflow recipes. No transport or AE state is accessed here. */
import { validateOpArgs } from "../opschema.js";
import { getOp } from "../registry.js";

export type LayerRef = number;
export interface RetimeTrack {
  layer: LayerRef;
  property: string[];
  /** Strictly increasing whole-frame key times read from the live property tree. */
  keyTimesFrames: number[];
  /** Total numKeys from the same live readback; must equal the complete list. */
  numKeys: number;
  hasExpression: boolean;
  /** Actual layer in/out points as whole frame boundaries. */
  inFrame: number;
  outFrame: number;
}
export interface RetimeRequest {
  recipe: "retime_properties";
  comp: string | number;
  fps: number;
  compDurationFrames: number;
  offsetFrames: number;
  timeScale?: number;
  pivotFrame?: number;
  tracks: RetimeTrack[];
}
export interface WorkflowFinding {
  code: string;
  message: string;
}
export interface WorkflowOperation {
  operation: "keyframe.shift" | "layer.info";
  args: Record<string, unknown>;
}
export interface WorkflowPlan {
  ready: boolean;
  findings: WorkflowFinding[];
  changes: Array<{
    layer: LayerRef;
    property: string[];
    fromFrames: number[];
    toFrames: number[];
  }>;
  batch?: {
    operation: "batch.run";
    args: { ops: WorkflowOperation[]; stopOnError: true };
  };
  verificationOperations: WorkflowOperation[];
  prerequisites: string[];
}

function refKey(ref: LayerRef): string {
  return `index:${ref}`;
}

function validFrame(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Plan a scoped retime, refusing all edits if any supplied readback is unsafe. */
export function planWorkflow(request: RetimeRequest): WorkflowPlan {
  const findings: WorkflowFinding[] = [];
  const changes: WorkflowPlan["changes"] = [];
  const shifts: WorkflowOperation[] = [];
  const verifications: WorkflowOperation[] = [];
  const seen = new Set<string>();
  const verifiedLayers = new Set<string>();
  const fail = (code: string, message: string) => findings.push({ code, message });
  const scale = request.timeScale ?? 1;
  const pivot = request.pivotFrame ?? 0;
  const prerequisites = [
    "Confirm the named AE instance, live composition, canonical property match-name paths, every property key time and numKeys from the same readback, expressions, and layer bounds. Reconfirm 1-based layer indices immediately before execution; layer order can change. The planner cannot prove supplied paths are canonical or that readback is current.",
    "Confirm the active project is the intended saved copy; save a new variant before executing the batch.",
    "After execution, compare layer.info key times with toFrames, inspect batch results, and render matching before/after frames. If a call times out, reread state before retrying.",
  ];

  if (request.recipe !== "retime_properties") fail("RECIPE", "Unsupported recipe.");
  if (
    (typeof request.comp !== "string" || !request.comp.trim()) &&
    (typeof request.comp !== "number" || !Number.isSafeInteger(request.comp) || request.comp < 1)
  )
    fail("COMP", "Composition must be a nonempty name or positive id.");
  if (!Number.isFinite(request.fps) || request.fps <= 0)
    fail("FPS", "Frame rate must be finite and positive.");
  if (!validFrame(request.compDurationFrames) || request.compDurationFrames < 1)
    fail("DURATION", "Composition duration must be a positive whole-frame count.");
  if (!Number.isSafeInteger(request.offsetFrames))
    fail("OFFSET", "Offset must be a finite whole-frame count.");
  if (!Number.isFinite(scale) || scale <= 0)
    fail("SCALE", "Time scale must be finite and positive.");
  if (!validFrame(pivot)) fail("PIVOT", "Pivot must be a nonnegative whole frame.");
  if (request.tracks.length < 1 || request.tracks.length > 16)
    fail("TRACK_COUNT", "Provide 1 to 16 explicit property tracks.");

  for (const [index, track] of request.tracks.entries()) {
    const label = `Track ${index + 1}`;
    const layer = refKey(track.layer);
    if (!Number.isSafeInteger(track.layer) || track.layer < 1)
      fail("LAYER", `${label}: use the positive 1-based layer index from fresh live readback.`);
    if (!track.property.length || track.property.some((p) => typeof p !== "string" || !p.trim()))
      fail("PROPERTY", `${label}: use a nonempty canonical match-name path from live readback.`);
    const target = JSON.stringify([layer, track.property]);
    if (seen.has(target))
      fail("DUPLICATE_TARGET", `${label}: target repeats an earlier layer/property pair.`);
    seen.add(target);
    if (track.hasExpression)
      fail("EXPRESSION", `${label}: expression-enabled properties need a manual retime review.`);
    if (
      !validFrame(track.inFrame) ||
      !validFrame(track.outFrame) ||
      track.outFrame <= track.inFrame ||
      track.outFrame > request.compDurationFrames
    )
      fail("LAYER_BOUNDS", `${label}: invalid layer in/out frame boundaries.`);
    if (track.keyTimesFrames.length < 1 || track.keyTimesFrames.length > 64)
      fail("KEY_COUNT", `${label}: provide 1 to 64 read-back key times.`);
    if (!Number.isSafeInteger(track.numKeys) || track.numKeys !== track.keyTimesFrames.length)
      fail(
        "INCOMPLETE_KEYS",
        `${label}: provide every key time; numKeys must equal the supplied list length.`,
      );
    let previousSource = -1;
    let previousTarget = -1;
    const toFrames: number[] = [];
    for (const frame of track.keyTimesFrames) {
      if (!validFrame(frame) || frame <= previousSource)
        fail("KEY_ORDER", `${label}: source key times must be strictly increasing whole frames.`);
      if (frame < track.inFrame || frame >= track.outFrame || frame >= request.compDurationFrames)
        fail(
          "SOURCE_BOUNDS",
          `${label}: source key at frame ${frame} is outside the supplied layer or comp bounds.`,
        );
      const targetFrame = (frame - pivot) * scale + pivot + request.offsetFrames;
      if (!Number.isSafeInteger(targetFrame))
        fail(
          "SUBFRAME",
          `${label}: retime sends frame ${frame} to a subframe or unsafe frame value.`,
        );
      if (targetFrame <= previousTarget)
        fail("KEY_COLLAPSE", `${label}: retime collapses or reverses key order.`);
      if (
        targetFrame < track.inFrame ||
        targetFrame >= track.outFrame ||
        targetFrame < 0 ||
        targetFrame >= request.compDurationFrames
      )
        fail(
          "TARGET_BOUNDS",
          `${label}: target frame ${targetFrame} leaves the layer or comp bounds.`,
        );
      toFrames.push(targetFrame);
      previousSource = frame;
      previousTarget = targetFrame;
    }
    changes.push({
      layer: track.layer,
      property: track.property,
      fromFrames: track.keyTimesFrames,
      toFrames,
    });
    if (Number.isFinite(request.fps) && request.fps > 0) {
      const args = {
        comp: request.comp,
        layer: track.layer,
        property: track.property,
        offset: request.offsetFrames / request.fps,
        scale,
        pivot: pivot / request.fps,
      };
      const op = getOp("keyframe.shift");
      if (!op || !validateOpArgs(op, args).ok)
        fail("OP_SCHEMA", `${label}: generated shift is not a registered valid operation.`);
      shifts.push({ operation: "keyframe.shift", args });
    }
    if (!verifiedLayers.has(layer)) {
      const args = {
        comp: request.comp,
        layer: track.layer,
        includeProperties: true,
        detail: "summary",
      };
      const op = getOp("layer.info");
      if (!op || !validateOpArgs(op, args).ok)
        fail("VERIFY_SCHEMA", `${label}: generated readback is not a registered valid operation.`);
      verifications.push({ operation: "layer.info", args });
      verifiedLayers.add(layer);
    }
  }
  const ready = findings.length === 0;
  return {
    ready,
    findings,
    changes,
    ...(ready
      ? {
          batch: {
            operation: "batch.run" as const,
            args: { ops: shifts, stopOnError: true as const },
          },
        }
      : {}),
    verificationOperations: ready ? verifications : [],
    prerequisites,
  };
}
