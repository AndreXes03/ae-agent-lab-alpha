import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compileScene, sequenceScenes } from "../src/scenes/compile.js";
import { evaluateNode, evaluateTrack, sampleTrack } from "../src/scenes/motion.js";
import type { MotionTrack } from "../src/scenes/model.js";
const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/scenes/card.json", import.meta.url), "utf8"),
);
describe("native scene core", () => {
  it("compiles deterministic parent-local geometry and frame timing", () => {
    const a = compileScene(fixture);
    expect(a).toEqual(compileScene(fixture));
    expect(a.nodes[0]).toMatchObject({ x: 320, y: 200 });
    expect(evaluateNode(a.nodes[2], 0).opacity).toBe(0);
    expect(evaluateNode(a.nodes[2], 24).opacity).toBe(100);
    expect(evaluateNode(a.nodes[2], 120).visible).toBe(false);
  });
  it("rejects cycles, duplicates, unknown parents, unsupported fields and unaligned keys", () => {
    for (const mutate of [
      (s: any) => {
        s.nodes.push(s.nodes[0]);
      },
      (s: any) => {
        s.nodes[0].parent = "card";
      },
      (s: any) => {
        s.nodes[1].parent = "missing";
      },
      (s: any) => {
        s.nodes[0].connector = {};
      },
      (s: any) => {
        s.nodes[2].motion[0].keys[0].frame = 0.5;
      },
      (s: any) => {
        s.nodes[2].motion[0].keys[1].frame = 120;
      },
    ]) {
      const s = structuredClone(fixture);
      mutate(s);
      expect(() => compileScene(s)).toThrow();
    }
  });
  it("requires measured text bounds and uses supplied measurements in layout", () => {
    const s = structuredClone(fixture);
    delete s.nodes[2].width;
    delete s.nodes[2].height;
    expect(() => compileScene(s)).toThrow(/measured/);
    expect(
      compileScene(s, { textBounds: { title: { width: 510, height: 58 } } }).nodes[2].width,
    ).toBe(510);
  });
  it("bounds adaptive overshoot sampling against every actual frame", () => {
    const t: MotionTrack = {
      property: "rotation",
      keys: [
        { frame: 0, value: 0, easing: [0.25, 1.8, 0.7, 1.2] },
        { frame: 100, value: 90, easing: "linear" },
      ],
    };
    const sampled = sampleTrack(t, 0.2);
    expect(sampled.keys.length).toBeLessThan(101);
    for (let f = 0; f <= 100; f++)
      expect(
        Math.abs((evaluateTrack(t, f) as number) - (evaluateTrack(sampled, f) as number)),
      ).toBeLessThanOrEqual(0.200001);
    expect(() => sampleTrack(t, 0.001, 2)).toThrow(/budget/);
  });
  it("keeps hold transitions exact", () => {
    const t: MotionTrack = {
      property: "opacity",
      keys: [
        { frame: 0, value: 0, easing: "hold" },
        { frame: 20, value: 100, easing: "linear" },
      ],
    };
    expect(evaluateTrack(sampleTrack(t), 19)).toBe(0);
    expect(evaluateTrack(sampleTrack(t), 20)).toBe(100);
  });
});

describe("scene geometry and workload safeguards", () => {
  it("resolves sibling connector anchors and rejects ambiguous transforms", () => {
    const s = structuredClone(fixture);
    s.nodes.push({
      id: "line",
      type: "line",
      parent: "card",
      connector: { from: { node: "surface", edge: "left" }, to: { node: "title", edge: "right" } },
    });
    expect(compileScene(s).nodes[3].linePoints).toEqual([
      [0, 160],
      [588, 104],
    ]);
    s.nodes[2].rotation = 10;
    expect(() => compileScene(s)).toThrow(/static siblings/);
  });
  it("propagates parent lifetime and rejects native-null opacity", () => {
    const s = structuredClone(fixture);
    s.nodes[0].startFrame = 10;
    s.nodes[0].endFrame = 90;
    expect(compileScene(s).nodes[2]).toMatchObject({ startFrame: 10, endFrame: 90 });
    s.nodes[0].opacity = 50;
    expect(() => compileScene(s)).toThrow(/group opacity/);
  });
  it("sequences exact frame offsets with stable prefixed references", () => {
    const c = sequenceScenes([fixture, fixture], "sequence", "Two studies");
    expect(c.spec.durationFrames).toBe(240);
    expect(c.nodes[5].parent).toBe("s1_card");
    expect(c.nodes[5].tracks[0].keys[0].frame).toBe(120);
  });
  it("rejects opacity overshoot and excessive sampling", () => {
    const s = structuredClone(fixture);
    s.nodes[2].motion[0].keys[0].easing = [0.2, 2, 0.8, 1];
    expect(() => compileScene(s)).toThrow(/opacity overshoot/);
    expect(() =>
      sampleTrack({
        property: "rotation",
        keys: [
          { frame: 0, value: 0, easing: "linear" },
          { frame: 10001, value: 10, easing: "linear" },
        ],
      }),
    ).toThrow(/interval budget/);
  });
});

it("rejects identifiers that collide with ExtendScript object maps", () => {
  for (const id of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
    const s = structuredClone(fixture);
    s.nodes[0].id = id;
    expect(() => compileScene(s)).toThrow(/Reserved/);
  }
});
it("preserves sampling across hold followed by nonlinear motion", () => {
  const track: MotionTrack = {
    property: "rotation",
    keys: [
      { frame: 0, value: 0, easing: "hold" },
      { frame: 10, value: 20, easing: [0.2, 0, 0.8, 1] },
      { frame: 40, value: 90, easing: "linear" },
    ],
  };
  const sampled = sampleTrack(track, 0.1);
  for (let f = 0; f <= 40; f++)
    expect(
      Math.abs((evaluateTrack(track, f) as number) - (evaluateTrack(sampled, f) as number)),
    ).toBeLessThanOrEqual(0.100001);
});
