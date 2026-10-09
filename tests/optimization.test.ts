import { describe, expect, it } from "vitest";
import vm from "node:vm";
import "../src/operations/index.js";
import { getOp } from "../src/registry.js";
import { catalogTool } from "../src/tools/catalog.js";
import { doTool } from "../src/tools/do.js";
import { jsonResult } from "../src/tools/define-tool.js";
import {
  captureVerification,
  compareVerification,
  verifyTargetsTool,
} from "../src/tools/verify-targets.js";
import { nullTransport } from "./helpers/null-transport.js";

const path = ["ADBE Transform Group", "ADBE Opacity"];
const spec = { compId: 42, sampleTime: 0.5, targets: [{ layerIndex: 1, properties: [path] }] };
function fixture(cursor = 0, keyValue = 100) {
  const property = {
    matchName: path[1],
    propertyType: 1,
    numKeys: 1,
    isSpatial: false,
    canSetExpression: true,
    expression: "",
    expressionEnabled: false,
    value: cursor * 100,
    valueAtTime: (time: number) => time * 100,
    keyTime: () => 0.5,
    keyValue: () => keyValue,
    keyInInterpolationType: () => "bezier",
    keyOutInterpolationType: () => "bezier",
    keyInTemporalEase: () => [{ speed: 0, influence: 75 }],
    keyOutTemporalEase: () => [{ speed: 0, influence: 75 }],
    keyTemporalContinuous: () => false,
    keyTemporalAutoBezier: () => false,
  };
  const group = { matchName: path[0], numProperties: 1, property: () => property };
  const layer = {
    id: 9,
    numProperties: 1,
    property: () => group,
    source: { id: 3, file: { fsName: "/fixture/portrait.png" }, width: 400, height: 400 },
    inPoint: 0,
    outPoint: 4,
    startTime: 0,
    stretch: 100,
  };
  class Comp {
    id = 42;
    name = "Final";
    frameRate = 25;
    duration = 4;
    numLayers = 1;
    layer = () => layer;
  }
  const c = new Comp();
  const run = (code: string) =>
    vm.runInNewContext(`(function(){${code}})()`, {
      app: { project: { file: { fsName: "/fixture/project.aep" } } },
      CompItem: Comp,
      PropertyType: { PROPERTY: 1 },
      AE: { findItemById: () => c, valueToJson: (v: unknown) => v },
    });
  return { run, property, group };
}

describe("scoped verification", () => {
  it("ignores playhead movement and catches real key changes", () => {
    const code = captureVerification(spec);
    const before = fixture(0).run(code);
    const moved = fixture(3).run(code);
    expect(compareVerification(before, moved).verified).toBe(true);
    const edited = fixture(0, 75).run(code);
    expect(compareVerification(before, edited).changes.map((c) => c.field)).toEqual(["animation"]);
  });
  it("refuses missing/ambiguous properties rather than comparing nulls", () => {
    const f = fixture();
    f.group.numProperties = 2;
    expect(f.run(captureVerification(spec))).toMatchObject({
      ok: false,
      error: "missing or ambiguous canonical property",
    });
  });
  it("source-path allowance cannot hide dimension or identity changes", () => {
    const code = captureVerification(spec),
      a = fixture().run(code),
      b = fixture().run(code);
    b.targets[0].source.path = "/fixture/new.png";
    expect(compareVerification(a, b, ["sourcePath"]).verified).toBe(true);
    b.targets[0].source.width = 900;
    expect(compareVerification(a, b, ["sourcePath"]).verified).toBe(false);
    b.targets[0].layerId = 10;
    expect(
      compareVerification(a, b, ["sourcePath", "sample"]).changes.some(
        (c) => c.field === "identity" && !c.allowed,
      ),
    ).toBe(true);
  });
  it("keeps snapshots out of model context and flags failed invariants", async () => {
    const a = fixture().run(captureVerification(spec));
    const capture = await verifyTargetsTool.handler(
      { request: { action: "capture", spec } },
      nullTransport({ result: a }),
    );
    expect(capture.structuredContent).not.toHaveProperty("targets");
    const id = capture.structuredContent!.baselineId;
    const compare = await verifyTargetsTool.handler(
      { request: { action: "compare", baselineId: id as string } },
      nullTransport({ result: fixture(0, 2).run(captureVerification(spec)) }),
    );
    expect(compare.isError).toBe(true);
    expect(compare.structuredContent!.verified).toBe(false);
    expect(JSON.stringify(compare)).not.toContain('"keys"');
  });
  it("rejects incomplete snapshots and expired baselines", async () => {
    const incomplete = await verifyTargetsTool.handler(
      { request: { action: "capture", spec } },
      nullTransport({ result: { ok: true } }),
    );
    expect(incomplete.isError).toBe(true);
    const t = nullTransport();
    const expired = await verifyTargetsTool.handler(
      { request: { action: "compare", baselineId: "00000000-0000-4000-8000-000000000000" } },
      t,
    );
    expect(expired.isError).toBe(true);
    expect(t.calls).toHaveLength(0);
  });
});

describe("context and catalog budgets", () => {
  it("uses compact lossless JSON and preserves structured interoperability", () => {
    const data = {
      ok: true,
      values: Array.from({ length: 50 }, (_, i) => ({ index: i, value: i })),
    };
    const r = jsonResult(data);
    const text = r.content[0];
    expect(text.type).toBe("text");
    if (text.type !== "text") return;
    expect(JSON.parse(text.text)).toEqual(r.structuredContent);
    expect(text.text.length).toBeLessThan(JSON.stringify(data, null, 2).length);
  });
  it("returns a short notModified reply, invalidated by a different lookup", async () => {
    const t = nullTransport();
    const a = await catalogTool.handler({ operations: ["keyframe.apply"] }, t);
    const cacheKey = a.structuredContent!.cacheKey as string;
    const b = await catalogTool.handler(
      { operations: ["keyframe.apply"], ifNoneMatch: cacheKey },
      t,
    );
    expect(b.structuredContent).toMatchObject({ notModified: true, cacheKey });
    expect(b.structuredContent).not.toHaveProperty("operations");
    const other = await catalogTool.handler(
      { operations: ["property.get"], ifNoneMatch: cacheKey },
      t,
    );
    expect(other.structuredContent).not.toHaveProperty("notModified");
    expect(JSON.stringify(b).length).toBeLessThan(JSON.stringify(a).length / 3);
  });
  it("omits ambient context unless explicitly requested and retains transport timing", async () => {
    const response = {
      result: { result: { ok: true }, context: { projectFile: "fixture.aep" } },
      queueWaitMs: 4,
      executionMs: 8,
    };
    const t = nullTransport(response);
    const r = await doTool.handler({ operation: "project.get_settings" }, t);
    expect(t.calls[0].code).toContain("var _ctx = null;");
    expect(r.structuredContent).not.toHaveProperty("context");
    expect(r.structuredContent).toMatchObject({ queueWaitMs: 4, executionMs: 8 });
    const full = await doTool.handler(
      { operation: "project.get_settings", includeContext: true },
      nullTransport(response),
    );
    expect(full.structuredContent).toHaveProperty("context");
  });
});

function reviewFixture(fail = false) {
  let renders = 0,
    removed = false;
  const existing = { render: true };
  const temporary = {
    render: true,
    status: "done",
    skipFrames: 2,
    timeSpanStart: 0,
    timeSpanDuration: 0,
    applyTemplate: () => {},
    outputModule: () => ({ applyTemplate: () => {}, file: null }),
    remove: () => {
      removed = true;
    },
  };
  const queue = {
    rendering: false,
    numItems: 1,
    item: () => existing,
    items: { add: () => temporary },
    render: () => {
      renders++;
      expect(existing.render).toBe(false);
      if (fail) throw new Error("renderer failed");
    },
  };
  class Comp {
    id = 42;
    name = "Final";
    frameRate = 25;
    duration = 30;
  }
  const comp = new Comp();
  const files = new Set<string>();
  const File = class {
    exists: boolean;
    constructor(p: string) {
      this.exists = files.has(p);
    }
  };
  const run = (args: Record<string, unknown>) =>
    vm.runInNewContext(`(function(){${getOp("render.review")!.toJsx(args)}})()`, {
      app: { project: { renderQueue: queue } },
      CompItem: Comp,
      RQItemStatus: { DONE: "done" },
      File,
      AE: {
        findCompByNameOrId: () => comp,
        ensureParentDir: (p: string) => {
          files.add(p);
          return p;
        },
        errText: (e: Error) => e.message,
      },
    });
  return { run, temporary, existing, state: () => ({ renders, removed }) };
}
describe("short temporal review isolation", () => {
  const args = {
    comp: 42,
    startFrame: 25,
    endFrame: 75,
    outputTemplate: "Movie",
    outputPath: "/tmp/review.mov",
  };
  it("renders only the new interval and restores queue state", () => {
    const f = reviewFixture();
    expect(f.run(args)).toMatchObject({
      ok: true,
      completed: true,
      startFrame: 25,
      endFrame: 75,
      compId: 42,
      compName: "Final",
      projectPath: null,
      playbackReviewed: false,
      audioReviewed: false,
    });
    expect(f.temporary.timeSpanStart).toBe(1);
    expect(f.temporary.timeSpanDuration).toBe(2);
    expect(f.temporary.skipFrames).toBe(0);
    expect(f.existing.render).toBe(true);
    expect(f.state()).toEqual({ renders: 1, removed: true });
  });
  it("restores the queue after render failure", () => {
    const f = reviewFixture(true);
    expect(f.run(args)).toMatchObject({ ok: false, error: "renderer failed" });
    expect(f.existing.render).toBe(true);
    expect(f.state().removed).toBe(true);
  });
  it("rejects long intervals without queue mutations", () => {
    const f = reviewFixture();
    expect(f.run({ ...args, endFrame: 600 })).toMatchObject({ ok: false });
    expect(f.state()).toEqual({ renders: 0, removed: false });
  });
});
