import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { captureRetime, prepareRetime, retimeSpec } from "../src/workflows/retime.js";

const spec = {
  comp: 7,
  tracks: [{ layer: 1, property: ["ADBE Transform Group", "ADBE Opacity"] }],
  offsetFrames: 8,
};

function fixture(fps = 25) {
  const keys = [
    { time: 20 / fps, value: 20 },
    { time: 40 / fps, value: 80 },
  ];
  const prop = {
    matchName: "ADBE Opacity",
    propertyType: 1,
    dimensionsSeparated: false,
    isSeparationFollower: false,
    expressionEnabled: false,
    isSpatial: false,
    get numKeys() {
      return keys.length;
    },
    keyTime(i: number) {
      return keys[i - 1].time;
    },
    keyValue(i: number) {
      return keys[i - 1].value;
    },
    keyInInterpolationType() {
      return "linear";
    },
    keyOutInterpolationType() {
      return "linear";
    },
    keyInTemporalEase() {
      return [{ speed: 0, influence: 33 }];
    },
    keyOutTemporalEase() {
      return [{ speed: 0, influence: 33 }];
    },
    keyTemporalContinuous() {
      return false;
    },
    keyTemporalAutoBezier() {
      return false;
    },
    removeKey(i: number) {
      keys.splice(i - 1, 1);
    },
    addKey(time: number) {
      keys.push({ time, value: 0 });
      keys.sort((a, b) => a.time - b.time);
      return keys.findIndex((k) => k.time === time) + 1;
    },
    setValueAtKey(i: number, value: number) {
      keys[i - 1].value = value;
    },
    nearestKeyIndex(time: number) {
      return keys.findIndex((k) => k.time === time) + 1;
    },
    setTemporalEaseAtKey() {},
    setInterpolationTypeAtKey() {},
    setTemporalContinuousAtKey() {},
    setTemporalAutoBezierAtKey() {},
  };
  const group = {
    matchName: "ADBE Transform Group",
    property(name: string) {
      return name === "ADBE Opacity" ? prop : null;
    },
  };
  const layer = {
    id: 99,
    index: 1,
    name: "Title",
    inPoint: 0,
    outPoint: 100 / fps,
    startTime: 0,
    stretch: 100,
    property(name: string) {
      return name === "ADBE Transform Group" ? group : null;
    },
  };
  class CompItem {
    readonly kind = "comp";
  }
  const comp = Object.assign(new CompItem(), {
    id: 7,
    name: "Main",
    frameRate: fps,
    duration: 120 / fps,
    numLayers: 1,
    layer(i: number) {
      return i === 1 ? layer : null;
    },
  });
  const AE = {
    findItemById(id: number) {
      return id === 7 ? comp : null;
    },
    findCompByNameOrId(id: number) {
      return id === 7 ? comp : null;
    },
    findLayerInComp(_comp: unknown, i: number) {
      return i === 1 ? layer : null;
    },
    snapshotKeys(_prop: unknown) {
      return keys.map((k) => ({ time: k.time, value: k.value }));
    },
    removeAllKeys(_prop: unknown) {
      keys.length = 0;
    },
    applyKeys(_prop: unknown, source: Array<{ time: number; value: number }>) {
      keys.push(...source);
      keys.sort((a, b) => a.time - b.time);
    },
  };
  const context = {
    app: { project: { file: { fsName: "/tmp/copy.aep" } } },
    AE,
    CompItem,
    PropertyType: { PROPERTY: 1 },
    JSON,
    Math,
    isFinite,
  };
  function run(body: string, extras: Record<string, unknown> = {}) {
    return vm.runInNewContext(`(function () { ${body} })()`, { ...context, ...extras });
  }
  return { keys, run };
}

describe("workflow retime engine", () => {
  it("captures fractional native fps, retimes locally, and verifies readback", () => {
    const ae = fixture(24000 / 1001);
    const before = ae.run(captureRetime(spec)) as Record<string, any>;
    expect(before.ok).toBe(true);
    expect(before.fps).toBe(24000 / 1001);
    expect(before.tracks[0].keys.map((k: { frame: number }) => k.frame)).toEqual([20, 40]);
    const prepared = prepareRetime(spec, before);
    expect(prepared.summary).toMatchObject({
      changedTracks: 1,
      tracks: [{ expectedFrames: [28, 48] }],
    });
    expect(JSON.stringify(prepared.summary)).not.toContain('"value"');
    const result = ae.run(prepared.mutationCode, { _workflowSnapshot: before }) as Record<
      string,
      any
    >;
    expect(result.ok).toBe(true);
    expect(result.tracks[0].actualFrames).toEqual([28, 48]);
    expect(ae.keys.map((k) => k.value)).toEqual([20, 80]);
  });

  it("rejects unsupported subframes and unsafe plans before mutation", () => {
    const ae = fixture();
    ae.keys[0].time += 0.5 / 25;
    expect(ae.run(captureRetime(spec))).toMatchObject({
      ok: false,
      error: "unsupported value or subframe key",
    });
    ae.keys[0].time = 20 / 25;
    const before = ae.run(captureRetime(spec));
    expect(() => prepareRetime({ ...spec, timeScale: 0.125 }, before)).toThrow(/SUBFRAME/);
    expect(ae.keys.map((k) => k.time)).toEqual([20 / 25, 40 / 25]);
  });

  it("refuses stale key values and invalid duplicate tracks", () => {
    const ae = fixture();
    const before = ae.run(captureRetime(spec)) as Record<string, any>;
    ae.keys[1].value = 81;
    const fresh = ae.run(captureRetime(spec));
    expect(JSON.stringify(fresh)).not.toBe(JSON.stringify(before));
    expect(() => retimeSpec.parse({ ...spec, tracks: [], offsetFrames: 8 })).toThrow();
    expect(() => captureRetime({ ...spec, tracks: [spec.tracks[0], spec.tracks[0]] })).toThrow(
      /duplicate/,
    );
  });
});
