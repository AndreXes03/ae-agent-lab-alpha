import { describe, it, expect } from "vitest";
import vm from "node:vm";
import { sceneRuntime, nativeScene } from "../src/scenes/native.js";
import { compileScene } from "../src/scenes/compile.js";
class Property {
  value: any;
  expression = "";
  keys: any[] = [];
  isSpatial = false;
  dimensionsSeparated = false;
  constructor(v: any) {
    this.value = v;
  }
  get numKeys() {
    return this.keys.length;
  }
  valueAtTime() {
    return this.value;
  }
  setValue(v: any) {
    this.value = v;
  }
  setValueAtTime(time: number, value: any) {
    this.keys.push({ time, value, type: "LINEAR" });
  }
  removeKey(i: number) {
    this.keys.splice(i - 1, 1);
  }
  keyTime(i: number) {
    return this.keys[i - 1].time;
  }
  keyValue(i: number) {
    return this.keys[i - 1].value;
  }
  keyInInterpolationType(i: number) {
    return this.keys[i - 1].type;
  }
  keyOutInterpolationType(i: number) {
    return this.keys[i - 1].type;
  }
  keyTemporalAutoBezier() {
    return false;
  }
  keyTemporalContinuous() {
    return false;
  }
  keyInTemporalEase() {
    return [{ speed: 0, influence: 33 }];
  }
  keyOutTemporalEase() {
    return [{ speed: 0, influence: 33 }];
  }
  setInterpolationTypeAtKey(i: number, type: string) {
    this.keys[i - 1].type = type;
  }
}
function Shape() {}
function fixture() {
  let sequence = 0;
  const items: any[] = [];
  const files = new Map<string, string>();
  let revision = 0;
  class FakeFile {
    fsName: string;
    constructor(name: string) {
      this.fsName = name;
    }
    get exists() {
      return files.has(this.fsName);
    }
    open() {
      return true;
    }
    read() {
      return files.get(this.fsName);
    }
    write(s: string) {
      files.set(this.fsName, s);
    }
    close() {}
  }
  const addComp = (
    name: string,
    width: number,
    height: number,
    _aspect: number,
    duration: number,
    frameRate: number,
  ) => {
    const list: any[] = [];
    const comp: any = {
      id: ++sequence,
      name,
      width,
      height,
      duration,
      frameRate,
      comment: "",
      get numLayers() {
        return list.length;
      },
      layer: (i: number) => list[i - 1],
    };
    const add = (text?: string) => {
      const props: any = {
        "ADBE Position": new Property([0, 0]),
        "ADBE Anchor Point": new Property([0, 0]),
        "ADBE Opacity": new Property(100),
        "ADBE Rotate Z": new Property(0),
        "ADBE Scale": new Property([100, 100]),
        "ADBE Text Document": new Property({
          text,
          font: "Arial",
          fontSize: 12,
          fillColor: [1, 1, 1],
        }),
      };
      const group: any = { property: (k: string) => props[k] };
      const l: any = {
        id: ++sequence,
        comment: "",
        parent: null,
        inPoint: 0,
        outPoint: duration,
        locked: false,
        threeDLayer: false,
        property: () => group,
        sourceRectAtTime: () => ({ left: 0, top: -10 }),
        setParentWithJump(p: any) {
          this.parent = p;
        },
        props,
      };
      list.push(l);
      return l;
    };
    comp.layers = {
      addNull: () => add(),
      addText: (text: string) => add(text),
      addShape: () => {
        const l = add(),
          parts: any[] = [];
        const vectors: any = {
          addProperty: (matchName: string) => {
            const vals: any = {
              "ADBE Vector Rect Size": new Property([100, 100]),
              "ADBE Vector Fill Color": new Property([1, 1, 1]),
              "ADBE Vector Stroke Color": new Property([1, 1, 1]),
              "ADBE Vector Stroke Width": new Property(2),
              "ADBE Vector Shape": new Property({
                vertices: [],
                inTangents: [],
                outTangents: [],
                closed: false,
              }),
            };
            const p = { matchName, property: (k: string) => vals[k] };
            parts.push(p);
            return p;
          },
          property: (i: number) => parts[i - 1],
        };
        const rootGroup: any = { property: () => vectors };
        const root: any = { addProperty: () => rootGroup, property: () => rootGroup };
        const original = l.property;
        l.property = (k: string) => (k === "ADBE Root Vectors Group" ? root : original(k));
        return l;
      },
    };
    items.push(comp);
    return comp;
  };
  const app = {
    project: {
      file: { fsName: "/copy.aep" },
      get numItems() {
        return items.length;
      },
      item: (i: number) => items[i - 1],
      items: { addComp },
    },
  };
  const run = (scene: any, mode = "capture", snapshot?: any) =>
    vm.runInNewContext("(function(){" + sceneRuntime + "})()", {
      app,
      payload: {
        scene,
        mode,
        snapshot,
        baselineDir: "/",
        revision: (++revision).toString(16).padStart(36, "0"),
      },
      File: FakeFile,
      KeyframeInterpolationType: { LINEAR: "LINEAR", HOLD: "HOLD" },
      Shape,
    });
  return { run, items };
}
const spec = {
  id: "Scene",
  name: "Scene",
  width: 100,
  height: 100,
  fps: 25,
  durationFrames: 100,
  nodes: [{ id: "Group", type: "group", width: 100, height: 100, x: 10 }],
};
describe("native differential scene runtime", () => {
  it("creates editable native layers, updates only changed fields and preserves unrelated layers/manual edits", () => {
    const f = fixture(),
      scene = nativeScene(compileScene(spec));
    let p = f.run(scene);
    expect(p.summary.changes).toBe(1);
    f.run(scene, "apply", p.snapshot);
    const layer = f.items[0].layer(1);
    expect(layer.props["ADBE Position"].value).toEqual([10, 0]);
    layer.props["ADBE Opacity"].value = 72;
    const update = nativeScene(compileScene({ ...spec, nodes: [{ ...spec.nodes[0], x: 20 }] }));
    p = f.run(update);
    expect(p.summary.conflicts).toEqual([]);
    f.run(update, "apply", p.snapshot);
    expect(layer.props["ADBE Position"].value).toEqual([20, 0]);
    expect(layer.props["ADBE Opacity"].value).toBe(72);
    expect(f.items[0].numLayers).toBe(1);
    expect(f.run(update).summary.changes).toBe(0);
  });
  it("rejects conflicting manual property edits and stale snapshots before mutation", () => {
    const f = fixture(),
      scene = nativeScene(compileScene(spec));
    f.run(scene, "apply", f.run(scene).snapshot);
    const layer = f.items[0].layer(1);
    const p = f.run(scene);
    layer.props["ADBE Position"].value = [50, 0];
    expect(() => f.run(scene, "apply", p.snapshot)).toThrow("Prepared scene changed");
    const update = nativeScene(compileScene({ ...spec, nodes: [{ ...spec.nodes[0], x: 20 }] }));
    expect(f.run(update).summary.conflicts).toEqual(["Group.position"]);
    expect(() => f.run(update, "apply", f.run(update).snapshot)).toThrow("Scene conflicts");
    expect(layer.props["ADBE Position"].value).toEqual([50, 0]);
  });
  it("captures expression edits and refuses changed desired properties before mutation", () => {
    const f = fixture(),
      scene = nativeScene(compileScene(spec));
    f.run(scene, "apply", f.run(scene).snapshot);
    f.items[0].layer(1).props["ADBE Position"].expression = "wiggle(1,20)";
    const update = nativeScene(compileScene({ ...spec, nodes: [{ ...spec.nodes[0], x: 20 }] }));
    expect(f.run(update).summary.conflicts).toEqual(["Group.position"]);
  });
  it("creates editable frame sampled curves and detects key edits", () => {
    const f = fixture(),
      scene = nativeScene(
        compileScene({
          ...spec,
          nodes: [
            {
              ...spec.nodes[0],
              type: "text",
              text: "Hello",
              font: "Arial",
              fontSize: 12,
              motion: [
                {
                  property: "opacity",
                  keys: [
                    { frame: 0, value: 0, easing: [0.2, 0, 0.8, 1] },
                    { frame: 30, value: 100 },
                  ],
                },
              ],
            },
          ],
        }),
      );
    expect(scene.nodes[0].tracks[0].keys.length).toBeGreaterThan(2);
    f.run(scene, "apply", f.run(scene).snapshot);
    const opacity = f.items[0].layer(1).props["ADBE Opacity"];
    opacity.keys[0].value = 12;
    const update = structuredClone(scene);
    update.nodes[0].tracks[0].keys[0].value = 30;
    expect(f.run(update).summary.conflicts).toEqual(["Group.opacity"]);
  });
});

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SceneService } from "../src/scenes/service.js";
import { WorkflowJobs } from "../src/workflows/jobs.js";
import type { AeTransport } from "../src/transport/AeTransport.js";
it("claims durable scene jobs once and reconciles late receipts after timeout", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "scene-job-"));
  try {
    const copy = path.join(root, "copy.aep");
    await fs.writeFile(copy, "fixture");
    const jobs = new WorkflowJobs(path.join(root, "jobs"));
    let calls = 0;
    const transport: AeTransport = {
      execute: async () => {
        calls++;
        return {
          ok: false,
          result: null,
          error: "timeout",
          errorCode: "TIMEOUT",
          stack: null,
          logs: [],
          durationMs: 1,
        };
      },
    };
    const scene = nativeScene(compileScene(spec)),
      id = randomUUID();
    await jobs.createWithId(id, {
      recipe: "scene",
      spec: scene,
      snapshot: {},
      summary: { conflicts: [] },
      copyPath: copy,
      instance: "resident",
      captureCode: sceneRuntime,
      mutationCode: sceneRuntime,
    });
    const session: any = {
      validateSession: async () => ({ session: { worker: "resident" }, copy, runDir: root }),
    };
    const service = new SceneService({ transport, jobs, session });
    expect((await service.apply(id)).state).toBe("uncertain");
    expect((await service.apply(id)).state).toBe("uncertain");
    expect(calls).toBe(1);
    const recovered = new SceneService({
      transport,
      jobs: new WorkflowJobs(path.join(root, "jobs")),
      session,
    });
    expect((await recovered.apply(id)).state).toBe("uncertain");
    expect(calls).toBe(1);
    await fs.writeFile(
      jobs.receiptPath(id),
      JSON.stringify({ jobId: id, state: "succeeded", result: { ok: true, compId: 1 } }),
    );
    expect((await recovered.status(id)).state).toBe("succeeded");
    expect((await recovered.apply(id)).state).toBe("succeeded");
    expect(calls).toBe(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("rejects unmanaged parenting conflicts, removed IDs and scene fps changes", () => {
  const f = fixture(),
    scene = nativeScene(compileScene(spec));
  f.run(scene, "apply", f.run(scene).snapshot);
  const layer = f.items[0].layer(1);
  layer.parent = { id: 99, comment: "" };
  const update = nativeScene(
    compileScene({
      ...spec,
      nodes: [
        { ...spec.nodes[0], parent: "Parent" },
        { id: "Parent", type: "group", width: 100, height: 100 },
      ],
    }),
  );
  expect(f.run(update).summary.conflicts).toContain("Group.parent");
  expect(() => f.run(nativeScene(compileScene({ ...spec, fps: 30 })))).toThrow("fps changes");
  expect(
    f.run(
      nativeScene(
        compileScene({ ...spec, nodes: [{ id: "Other", type: "group", width: 100, height: 100 }] }),
      ),
    ).summary.conflicts,
  ).toContain("Group: node removal requires an explicit separately reviewed operation");
});
it("creates and differentially resizes native rectangle geometry around the top-left anchor", () => {
  const f = fixture(),
    rect = {
      ...spec,
      nodes: [{ id: "Rect", type: "rect", x: 10, y: 20, width: 40, height: 60, rotation: 20 }],
    };
  const scene = nativeScene(compileScene(rect));
  f.run(scene, "apply", f.run(scene).snapshot);
  const l = f.items[0].layer(1);
  expect(l.props["ADBE Position"].value).toEqual([10, 20]);
  expect(l.props["ADBE Anchor Point"].value).toEqual([-20, -30]);
  const update = nativeScene(compileScene({ ...rect, nodes: [{ ...rect.nodes[0], width: 80 }] }));
  f.run(update, "apply", f.run(update).snapshot);
  expect(l.props["ADBE Anchor Point"].value).toEqual([-40, -30]);
  expect(f.items[0].numLayers).toBe(1);
});
it("updates text without replacing a manually changed text anchor", () => {
  const f = fixture(),
    text = {
      ...spec,
      nodes: [
        {
          id: "Title",
          type: "text",
          text: "Hello",
          font: "Arial",
          fontSize: 12,
          width: 100,
          height: 30,
        },
      ],
    };
  const scene = nativeScene(compileScene(text));
  f.run(scene, "apply", f.run(scene).snapshot);
  const l = f.items[0].layer(1);
  l.props["ADBE Anchor Point"].value = [20, 30];
  const update = nativeScene(
    compileScene({ ...text, nodes: [{ ...text.nodes[0], text: "Changed" }] }),
  );
  f.run(update, "apply", f.run(update).snapshot);
  expect(l.props["ADBE Anchor Point"].value).toEqual([20, 30]);
  expect(l.props["ADBE Text Document"].value.text).toBe("Changed");
});

it("creates editable connector geometry and keeps the AE comment pointer compact", () => {
  const f = fixture();
  const scene = nativeScene(
    compileScene({
      ...spec,
      nodes: [
        { id: "A", type: "rect", x: 0, y: 0, width: 20, height: 20 },
        { id: "B", type: "rect", x: 80, y: 0, width: 20, height: 20 },
        {
          id: "Link",
          type: "line",
          connector: { from: { node: "A", edge: "right" }, to: { node: "B", edge: "left" } },
        },
      ],
    }),
  );
  f.run(scene, "apply", f.run(scene).snapshot);
  const comp = f.items[0];
  expect(comp.numLayers).toBe(3);
  expect(comp.comment.length).toBeLessThan(150);
  const pathProp = comp
    .layer(3)
    .property("ADBE Root Vectors Group")
    .property(1)
    .property("ADBE Vectors Group")
    .property(1)
    .property("ADBE Vector Shape");
  expect(pathProp.value.vertices).toEqual([
    [20, 10],
    [80, 10],
  ]);
  expect(f.run(scene).summary.changes).toBe(0);
});
