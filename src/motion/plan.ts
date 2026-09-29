/** Offline motion planning. Output is data for ae_do, never an AE mutation. */
export type LayerRef = string | number | { id: number };
export type Preset = "typography" | "panel" | "icon" | "bar";
export type Vec2 = [number, number];

export interface MotionItem {
  layer: LayerRef;
  preset: Preset;
  /** Local Position value read AFTER pivot preparation on the real layer. */
  targetPosition: Vec2;
  /** Final scale in percent, read from the layer unless a new layout is intended. */
  finalScale: Vec2;
  /** Real layer in/out points converted to frame numbers. */
  inFrame: number;
  outFrame: number;
  /** True if visible on the first scene frame, including through a camera reveal. */
  visibleAtSceneStart: boolean;
  /** Readback guards: the planner only authors fresh, unparented 2D layers. */
  isTwoD: boolean;
  isUnparented: boolean;
  positionSeparated: boolean;
  hasTransformExpressions: boolean;
  existingKeyCounts: { anchor: number; position: number; scale: number; opacity: number };
  staticOpacity: number;
  /** True only after the recommended anchor was applied and Position reread. */
  pivotPrepared: boolean;
  /** Optional comp-space rectangle measured with layer.bounds. */
  measuredBounds?: { left: number; top: number; width: number; height: number };
  expectedCenter?: Vec2;
  centerTolerancePx?: number;
}

export interface MotionPlanRequest {
  /** First call prepare, apply pivots, reread Position, then call reveal. */
  phase: "prepare" | "reveal" | "audit";
  comp: string | number;
  fps: number;
  compDurationFrames: number;
  sceneStartFrame: number;
  sceneEndFrame: number;
  staggerFrames: number;
  minHoldFrames: number;
  items: MotionItem[];
  cameraSamples?: Array<{ frame: number; position: Vec2; scale?: Vec2 }>;
  intentionalReversalFrames?: number[];
  transitionJoins?: Array<{
    frame: number;
    incomingVelocity: Vec2;
    outgoingVelocity: Vec2;
    intentionalStop?: boolean;
    intentionalCut?: boolean;
  }>;
}

export interface Finding {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface PlannedOperation {
  operation: "layer.set_anchor" | "keyframe.apply";
  args: Record<string, unknown>;
}

export interface MotionPlan {
  ready: boolean;
  findings: Finding[];
  operations: PlannedOperation[];
  schedule: Array<{ layer: LayerRef; preset: Preset; startFrame: number; endFrame: number }>;
}

const durationSeconds: Record<Preset, number> = {
  typography: 0.52,
  panel: 0.58,
  icon: 0.42,
  bar: 0.62,
};

const pivot: Record<Preset, string> = {
  typography: "center",
  panel: "center",
  icon: "center",
  bar: "centerLeft",
};

function length(v: Vec2): number {
  return Math.hypot(v[0], v[1]);
}

function dot(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

/** Both tangents have zero endpoint speed: a monotone, strong ease with no overshoot. */
function revealKeys(time0: number, time1: number, from: number | Vec2, to: number | Vec2) {
  return [
    { time: time0, value: from, interp: "ease", outInfluence: 70, outSpeed: 0 },
    { time: time1, value: to, interp: "ease", inInfluence: 75, inSpeed: 0 },
  ];
}

function apply(
  comp: string | number,
  layer: LayerRef,
  property: string,
  keys: ReturnType<typeof revealKeys>,
): PlannedOperation {
  return {
    operation: "keyframe.apply",
    args: {
      comp,
      layer,
      property: ["Transform", property],
      keys,
      replace: true,
      ...(property === "Position" ? { spatialTangents: "linear" } : {}),
    },
  };
}

export function planMotion(request: MotionPlanRequest): MotionPlan {
  const findings: Finding[] = [];
  const operations: PlannedOperation[] = [];
  const schedule: MotionPlan["schedule"] = [];
  const error = (code: string, message: string) =>
    findings.push({ severity: "error", code, message });
  const warning = (code: string, message: string) =>
    findings.push({ severity: "warning", code, message });

  if (request.phase !== "audit" && request.items.length === 0)
    error("NO_ITEMS", "Provide at least one layer.");
  if (request.phase !== "audit" && request.sceneEndFrame > request.compDurationFrames)
    error("SCENE_AFTER_COMP", "The scene extends past the composition duration.");
  if (request.phase !== "audit" && request.sceneEndFrame <= request.sceneStartFrame)
    error("SCENE_RANGE", "Scene end must follow scene start.");
  if (request.phase !== "audit" && (request.staggerFrames < 0 || request.minHoldFrames < 0))
    error("NEGATIVE_TIMING", "Stagger and minimum hold must be nonnegative.");

  // A repeated target would emit replacement keyframes twice for the same layer.
  const layerRefs = new Set<string>();
  for (const [index, item] of (request.phase === "audit" ? [] : request.items).entries()) {
    const ref =
      typeof item.layer === "object"
        ? `id:${item.layer.id}`
        : typeof item.layer === "number"
          ? `index:${item.layer}`
          : `name:${item.layer}`;
    if (layerRefs.has(ref))
      error("DUPLICATE_LAYER", `Layer ${index + 1} repeats an earlier layer reference.`);
    layerRefs.add(ref);
  }

  for (const [index, item] of (request.phase === "audit" ? [] : request.items).entries()) {
    const startFrame = request.sceneStartFrame + index * request.staggerFrames;
    const endFrame =
      startFrame + Math.max(2, Math.round(durationSeconds[item.preset] * request.fps));
    schedule.push({ layer: item.layer, preset: item.preset, startFrame, endFrame });
    if (item.visibleAtSceneStart)
      error(
        "VISIBLE_AT_START",
        `Layer ${index + 1} is already visible at scene start; preserve its existing state instead of giving it an entrance.`,
      );
    if (!item.isTwoD || !item.isUnparented || item.positionSeparated)
      error(
        "UNSUPPORTED_SPACE",
        `Layer ${index + 1} must be 2D, unparented, and have an unseparated Position property.`,
      );
    if (
      item.hasTransformExpressions ||
      Object.values(item.existingKeyCounts).some((count) => count !== 0)
    )
      error(
        "EXISTING_ANIMATION",
        `Layer ${index + 1} has transform keys or expressions; this fresh-layer preset would replace them.`,
      );
    if (item.staticOpacity !== 100)
      error(
        "STATIC_OPACITY",
        `Layer ${index + 1} needs static 100% opacity so the reveal does not change its intended settled opacity.`,
      );
    if (item.finalScale[0] <= 0 || item.finalScale[1] <= 0)
      error("FINAL_SCALE", `Layer ${index + 1} needs positive final X and Y scale values.`);
    if (request.phase === "reveal" && !item.pivotPrepared)
      error(
        "PIVOT_NOT_PREPARED",
        `Layer ${index + 1} needs the recommended anchor applied and Position reread before reveal planning.`,
      );
    if (item.inFrame > startFrame || item.outFrame < request.sceneEndFrame)
      error("LAYER_RANGE", `Layer ${index + 1} does not cover its reveal and scene hold.`);
    if (endFrame > request.sceneEndFrame)
      error("REVEAL_AFTER_SCENE", `Layer ${index + 1} finishes revealing after the scene ends.`);
    if (item.measuredBounds && item.expectedCenter) {
      const b = item.measuredBounds;
      const delta = length([
        b.left + b.width / 2 - item.expectedCenter[0],
        b.top + b.height / 2 - item.expectedCenter[1],
      ]);
      if (delta > (item.centerTolerancePx ?? 8))
        warning(
          "MISALIGNED",
          `Layer ${index + 1} measured center is ${delta.toFixed(1)} px from its intended center; inspect the layout.`,
        );
    } else {
      warning(
        "UNMEASURED_LAYOUT",
        `Layer ${index + 1} has no comp-space bounds and target center pair; alignment cannot be checked.`,
      );
    }

    const t0 = startFrame / request.fps;
    const t1 = endFrame / request.fps;
    const [x, y] = item.targetPosition;
    const [sx, sy] = item.finalScale;
    if (request.phase === "prepare") {
      operations.push({
        operation: "layer.set_anchor",
        args: { comp: request.comp, layer: item.layer, preset: pivot[item.preset], time: t1 },
      });
      continue;
    }
    if (item.preset === "typography") {
      operations.push(
        apply(request.comp, item.layer, "Position", revealKeys(t0, t1, [x, y + 28], [x, y])),
      );
      operations.push(
        apply(
          request.comp,
          item.layer,
          "Scale",
          revealKeys(t0, t1, [sx * 0.96, sy * 0.96], [sx, sy]),
        ),
      );
    } else if (item.preset === "panel") {
      operations.push(
        apply(request.comp, item.layer, "Position", revealKeys(t0, t1, [x, y + 18], [x, y])),
      );
      operations.push(
        apply(
          request.comp,
          item.layer,
          "Scale",
          revealKeys(t0, t1, [sx * 0.94, sy * 0.94], [sx, sy]),
        ),
      );
    } else if (item.preset === "icon") {
      operations.push(
        apply(
          request.comp,
          item.layer,
          "Scale",
          revealKeys(t0, t1, [sx * 0.78, sy * 0.78], [sx, sy]),
        ),
      );
      operations.push(
        apply(request.comp, item.layer, "Position", revealKeys(t0, t1, [x, y + 12], [x, y])),
      );
    } else {
      operations.push(
        apply(request.comp, item.layer, "Scale", revealKeys(t0, t1, [0, sy], [sx, sy])),
      );
      operations.push(
        apply(request.comp, item.layer, "Position", revealKeys(t0, t1, [x, y], [x, y])),
      );
    }
    if (item.preset !== "bar")
      operations.push(apply(request.comp, item.layer, "Opacity", revealKeys(t0, t1, 0, 100)));
  }

  const lastEnd = Math.max(request.sceneStartFrame, ...schedule.map((s) => s.endFrame));
  if (request.phase !== "audit" && request.sceneEndFrame - lastEnd < request.minHoldFrames)
    error(
      "SHORT_HOLD",
      `Only ${request.sceneEndFrame - lastEnd} frames remain after the final reveal; requested hold is ${request.minHoldFrames}.`,
    );

  const samples = request.cameraSamples ?? [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].frame <= samples[i - 1].frame)
      error("CAMERA_SAMPLE_ORDER", "Camera samples must have strictly increasing frame numbers.");
  }
  for (let i = 2; i < samples.length; i++) {
    const a = samples[i - 2],
      b = samples[i - 1],
      c = samples[i];
    const incoming: Vec2 = [b.position[0] - a.position[0], b.position[1] - a.position[1]];
    const outgoing: Vec2 = [c.position[0] - b.position[0], c.position[1] - b.position[1]];
    if (
      length(incoming) > 0.1 &&
      length(outgoing) > 0.1 &&
      dot(incoming, outgoing) / (length(incoming) * length(outgoing)) < -0.2 &&
      !(request.intentionalReversalFrames ?? []).includes(b.frame)
    )
      error(
        "CAMERA_REVERSAL",
        `Camera direction reverses near frame ${b.frame}; mark it intentional only after reviewing playback.`,
      );
    if (a.scale && b.scale && c.scale) {
      const zoomIn: Vec2 = [b.scale[0] - a.scale[0], b.scale[1] - a.scale[1]];
      const zoomOut: Vec2 = [c.scale[0] - b.scale[0], c.scale[1] - b.scale[1]];
      if (
        length(zoomIn) > 0.1 &&
        length(zoomOut) > 0.1 &&
        dot(zoomIn, zoomOut) / (length(zoomIn) * length(zoomOut)) < -0.2 &&
        !(request.intentionalReversalFrames ?? []).includes(b.frame)
      )
        error(
          "CAMERA_SCALE_REVERSAL",
          `Camera scale reverses near frame ${b.frame}; review playback.`,
        );
    }
  }
  for (const join of request.transitionJoins ?? []) {
    const a = length(join.incomingVelocity),
      b = length(join.outgoingVelocity);
    if (join.intentionalStop || join.intentionalCut) continue;
    if (a < 0.01 || b < 0.01)
      error(
        "TRANSITION_STOP",
        `Transition at frame ${join.frame} has a zero-speed endpoint without an intentional stop.`,
      );
    else if (dot(join.incomingVelocity, join.outgoingVelocity) / (a * b) < 0.8)
      error(
        "TRANSITION_DIRECTION",
        `Transition velocities at frame ${join.frame} change direction abruptly.`,
      );
    else if (Math.abs(a - b) / Math.max(a, b) > 0.35)
      warning(
        "TRANSITION_SPEED",
        `Transition speed changes by more than 35% at frame ${join.frame}.`,
      );
  }

  return {
    ready: !findings.some((f) => f.severity === "error"),
    findings,
    operations: findings.some((f) => f.severity === "error") ? [] : operations,
    schedule,
  };
}
