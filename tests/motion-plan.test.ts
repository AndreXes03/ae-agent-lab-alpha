import { describe, expect, it } from "vitest";

import "../src/operations/index.js";
import { planMotion, type MotionPlanRequest } from "../src/motion/plan.js";
import { validateOpArgs } from "../src/opschema.js";
import { getOp } from "../src/registry.js";
import { ALL_TOOLS } from "../src/tools/index.js";
import { nullTransport } from "./helpers/null-transport.js";

const fresh = {
  isTwoD: true,
  isUnparented: true,
  positionSeparated: false,
  hasTransformExpressions: false,
  existingKeyCounts: { anchor: 0, position: 0, scale: 0, opacity: 0 },
  staticOpacity: 100,
  pivotPrepared: true,
};

const base: MotionPlanRequest = {
  phase: "reveal",
  comp: 42,
  fps: 25,
  compDurationFrames: 200,
  sceneStartFrame: 0,
  sceneEndFrame: 100,
  staggerFrames: 5,
  minHoldFrames: 15,
  items: [
    {
      ...fresh,
      layer: { id: 9 },
      preset: "typography",
      targetPosition: [960, 480],
      finalScale: [100, 100],
      inFrame: 0,
      outFrame: 150,
      visibleAtSceneStart: false,
      measuredBounds: { left: 760, top: 430, width: 400, height: 100 },
      expectedCenter: [960, 480],
    },
    {
      ...fresh,
      layer: { id: 10 },
      preset: "panel",
      targetPosition: [960, 700],
      finalScale: [100, 100],
      inFrame: 0,
      outFrame: 150,
      visibleAtSceneStart: false,
    },
    {
      ...fresh,
      layer: { id: 11 },
      preset: "icon",
      targetPosition: [700, 700],
      finalScale: [100, 100],
      inFrame: 0,
      outFrame: 150,
      visibleAtSceneStart: false,
    },
    {
      ...fresh,
      layer: { id: 12 },
      preset: "bar",
      targetPosition: [850, 800],
      finalScale: [100, 100],
      inFrame: 0,
      outFrame: 150,
      visibleAtSceneStart: false,
    },
  ],
};

describe("motion plan", () => {
  it("emits only registered typed operations, with separate pivots and staggered frames", () => {
    const prep = planMotion({
      ...base,
      phase: "prepare",
      items: base.items.map((item) => ({ ...item, pivotPrepared: false })),
    });
    expect(prep.ready).toBe(true);
    expect(prep.operations.map((o) => o.args.preset)).toEqual([
      "center",
      "center",
      "center",
      "centerLeft",
    ]);
    const plan = planMotion(base);
    expect(plan.ready).toBe(true);
    expect(plan.schedule.map((s) => s.startFrame)).toEqual([0, 5, 10, 15]);
    expect(plan.operations.every((o) => o.operation === "keyframe.apply")).toBe(true);
    const postPivot = planMotion({
      ...base,
      items: [{ ...base.items[0], targetPosition: [1000, 500] }],
    });
    const position = postPivot.operations.find(
      (o) => (o.args.property as string[])[1] === "Position",
    )!;
    expect((position.args.keys as Array<{ value: [number, number] }>)[1].value).toEqual([
      1000, 500,
    ]);
    for (const entry of plan.operations) {
      const op = getOp(entry.operation);
      expect(op).toBeDefined();
      expect(validateOpArgs(op!, entry.args).ok).toBe(true);
    }
    expect(JSON.stringify(plan.operations)).not.toContain("Rotation");
    const bar = plan.operations.filter(
      (o) => JSON.stringify(o.args.layer) === JSON.stringify({ id: 12 }),
    );
    expect(bar.some((o) => (o.args.property as string[])[1] === "Opacity")).toBe(false);
  });

  it("uses zero endpoint speeds and a monotone no-overshoot ease", () => {
    const plan = planMotion({ ...base, items: [base.items[0]] });
    const opacity = plan.operations.find(
      (o) => o.operation === "keyframe.apply" && (o.args.property as string[])[1] === "Opacity",
    )!;
    const keys = opacity.args.keys as Array<{
      time: number;
      value: number;
      outSpeed?: number;
      inSpeed?: number;
      outInfluence?: number;
      inInfluence?: number;
    }>;
    expect(keys[0].outSpeed).toBe(0);
    expect(keys[1].inSpeed).toBe(0);
    expect(keys[0].outInfluence).toBeGreaterThan(50);
    expect(keys[1].inInfluence).toBeGreaterThan(50);
    // With zero endpoint speed, the normalized value handles are 0 and 1.
    // The cubic is monotone regardless of temporal handle influence.
    let previous = 0;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const value = 3 * t * t - 2 * t * t * t;
      expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });

  it("blocks an entrance that hides an already visible layer or lacks a hold", () => {
    const visible = planMotion({
      ...base,
      items: [{ ...base.items[0], visibleAtSceneStart: true }],
    });
    expect(visible.ready).toBe(false);
    expect(visible.operations).toEqual([]);
    expect(visible.findings.some((f) => f.code === "VISIBLE_AT_START")).toBe(true);
    const short = planMotion({ ...base, sceneEndFrame: 32, minHoldFrames: 8 });
    expect(short.findings.some((f) => f.code === "SHORT_HOLD")).toBe(true);
  });

  it("requires post-pivot Position readback and rejects existing animation", () => {
    const stale = planMotion({ ...base, items: [{ ...base.items[0], pivotPrepared: false }] });
    expect(stale.ready).toBe(false);
    expect(stale.findings.map((f) => f.code)).toContain("PIVOT_NOT_PREPARED");
    const animated = planMotion({
      ...base,
      items: [
        { ...base.items[0], existingKeyCounts: { anchor: 0, position: 1, scale: 0, opacity: 0 } },
      ],
    });
    expect(animated.operations).toEqual([]);
    expect(animated.findings.map((f) => f.code)).toContain("EXISTING_ANIMATION");
    const parented = planMotion({ ...base, items: [{ ...base.items[0], isUnparented: false }] });
    expect(parented.findings.map((f) => f.code)).toContain("UNSUPPORTED_SPACE");
    const dimmed = planMotion({ ...base, items: [{ ...base.items[0], staticOpacity: 70 }] });
    expect(dimmed.findings.map((f) => f.code)).toContain("STATIC_OPACITY");
  });

  it("rejects duplicate layer references before emitting replacement keys", () => {
    const plan = planMotion({
      ...base,
      items: [base.items[0], { ...base.items[0] }],
    });
    expect(plan.ready).toBe(false);
    expect(plan.operations).toEqual([]);
    expect(plan.findings.map((f) => f.code)).toContain("DUPLICATE_LAYER");
  });

  it("requires camera samples in strictly increasing frame order", () => {
    const plan = planMotion({
      ...base,
      cameraSamples: [
        { frame: 10, position: [0, 0] },
        { frame: 10, position: [100, 0] },
      ],
    });
    expect(plan.ready).toBe(false);
    expect(plan.operations).toEqual([]);
    expect(plan.findings.map((f) => f.code)).toContain("CAMERA_SAMPLE_ORDER");
  });

  it("audits existing camera motion without requiring fresh layers or proposing edits", () => {
    const plan = planMotion({
      ...base,
      phase: "audit",
      items: [],
      cameraSamples: [
        { frame: 0, position: [0, 0], scale: [100, 100] },
        { frame: 10, position: [100, 0], scale: [120, 120] },
        { frame: 20, position: [50, 0], scale: [110, 110] },
      ],
    });
    expect(plan.operations).toEqual([]);
    expect(plan.findings.map((f) => f.code)).toContain("CAMERA_REVERSAL");
    expect(plan.findings.map((f) => f.code)).toContain("CAMERA_SCALE_REVERSAL");
    expect(plan.findings.map((f) => f.code)).not.toContain("NO_ITEMS");
  });

  it("checks unintended camera reversals and join velocity, respecting explicit stops", () => {
    const cameraSamples = [
      { frame: 0, position: [0, 0] as [number, number] },
      { frame: 10, position: [100, 0] as [number, number] },
      { frame: 20, position: [50, 0] as [number, number] },
    ];
    const plan = planMotion({
      ...base,
      cameraSamples,
      transitionJoins: [{ frame: 20, incomingVelocity: [10, 0], outgoingVelocity: [0, 0] }],
    });
    expect(plan.findings.map((f) => f.code)).toContain("CAMERA_REVERSAL");
    expect(plan.findings.map((f) => f.code)).toContain("TRANSITION_STOP");
    const intentional = planMotion({
      ...base,
      cameraSamples,
      intentionalReversalFrames: [10],
      transitionJoins: [
        { frame: 20, incomingVelocity: [10, 0], outgoingVelocity: [0, 0], intentionalStop: true },
      ],
    });
    expect(intentional.ready).toBe(true);
    const continuous = planMotion({
      ...base,
      transitionJoins: [{ frame: 20, incomingVelocity: [10, 0], outgoingVelocity: [9, 1] }],
    });
    expect(continuous.ready).toBe(true);
    const cut = planMotion({
      ...base,
      transitionJoins: [
        { frame: 20, incomingVelocity: [10, 0], outgoingVelocity: [-10, 0], intentionalCut: true },
      ],
    });
    expect(cut.ready).toBe(true);
  });

  it("is an offline MCP tool: planning never calls a transport", async () => {
    const tool = ALL_TOOLS.find((t) => t.name === "ae_motion_plan")!;
    expect("instance" in tool.inputShape).toBe(false);
    const transport = nullTransport();
    const result = await tool.handler({ spec: base }, transport);
    expect(result.isError).toBe(false);
    expect(transport.calls).toHaveLength(0);
  });
});
