import { describe, expect, it } from "vitest";

import "../src/operations/index.js";
import { planWorkflow, type RetimeRequest } from "../src/workflows/plan.js";
import { validateOpArgs } from "../src/opschema.js";
import { getOp } from "../src/registry.js";
import { workflowPlanTool } from "../src/tools/workflow-plan.js";
import { nullTransport } from "./helpers/null-transport.js";

const base: RetimeRequest = {
  recipe: "retime_properties",
  comp: "Main",
  fps: 25,
  compDurationFrames: 200,
  offsetFrames: 8,
  timeScale: 1.5,
  pivotFrame: 20,
  tracks: [
    {
      layer: 2,
      property: ["Transform", "Opacity"],
      keyTimesFrames: [20, 40],
      numKeys: 2,
      hasExpression: false,
      inFrame: 0,
      outFrame: 150,
    },
    {
      layer: 2,
      property: ["Transform", "Scale"],
      keyTimesFrames: [24, 44],
      numKeys: 2,
      hasExpression: false,
      inFrame: 0,
      outFrame: 150,
    },
    {
      layer: 4,
      property: ["Effects", "Glow", "Exposure"],
      keyTimesFrames: [12, 32],
      numKeys: 2,
      hasExpression: false,
      inFrame: 0,
      outFrame: 150,
    },
  ],
};

const codes = (r: RetimeRequest) => planWorkflow(r).findings.map((f) => f.code);

describe("offline workflow retime recipe", () => {
  it("calculates frames and emits one validated stop-on-error batch plus layer readbacks", () => {
    const plan = planWorkflow(base);
    expect(plan.ready).toBe(true);
    expect(plan.changes.map((c) => c.toFrames)).toEqual([
      [28, 58],
      [34, 64],
      [16, 46],
    ]);
    expect(plan.batch?.args.stopOnError).toBe(true);
    expect(plan.batch?.args.ops).toHaveLength(3);
    expect(plan.verificationOperations).toHaveLength(2);
    expect(plan.verificationOperations.every((o) => o.operation === "layer.info")).toBe(true);
    for (const entry of [...plan.batch!.args.ops, ...plan.verificationOperations]) {
      const op = getOp(entry.operation)!;
      expect(op).toBeDefined();
      expect(validateOpArgs(op, entry.args).ok).toBe(true);
    }
    expect(validateOpArgs(getOp("batch.run")!, plan.batch!.args).ok).toBe(true);
    expect(plan.batch?.args.ops[0].args).toMatchObject({
      offset: 8 / 25,
      scale: 1.5,
      pivot: 20 / 25,
    });
  });

  it("refuses duplicate targets, expressions, collapsed and subframe keys", () => {
    expect(codes({ ...base, tracks: [base.tracks[0], base.tracks[0]] })).toContain(
      "DUPLICATE_TARGET",
    );
    expect(codes({ ...base, tracks: [{ ...base.tracks[0], numKeys: 3 }] })).toContain(
      "INCOMPLETE_KEYS",
    );
    expect(codes({ ...base, tracks: [{ ...base.tracks[0], hasExpression: true }] })).toContain(
      "EXPRESSION",
    );
    expect(
      codes({ ...base, timeScale: 0.1, tracks: [{ ...base.tracks[0], keyTimesFrames: [20, 21] }] }),
    ).toContain("SUBFRAME");
    expect(codes({ ...base, tracks: [{ ...base.tracks[0], keyTimesFrames: [20, 20] }] })).toContain(
      "KEY_ORDER",
    );
    expect(
      planWorkflow({ ...base, tracks: [{ ...base.tracks[0], hasExpression: true }] }).batch,
    ).toBeUndefined();
  });

  it("refuses source or target times outside layer and comp bounds", () => {
    expect(codes({ ...base, tracks: [{ ...base.tracks[0], inFrame: 30 }] })).toContain(
      "SOURCE_BOUNDS",
    );
    expect(codes({ ...base, offsetFrames: 150 })).toContain("TARGET_BOUNDS");
    expect(codes({ ...base, compDurationFrames: 50 })).toContain("LAYER_BOUNDS");
    expect(codes({ ...base, fps: Number.POSITIVE_INFINITY })).toContain("FPS");
  });

  it("plans without AE transport", async () => {
    const transport = nullTransport();
    const result = await workflowPlanTool.handler({ spec: base }, transport);
    expect(result.isError).toBe(false);
    expect(transport.calls).toHaveLength(0);
  });
});
