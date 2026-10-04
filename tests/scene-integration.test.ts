import { describe, expect, it } from "vitest";
import { compileScene, sequenceScenes } from "../src/scenes/compile.js";
import { nativeScene } from "../src/scenes/native.js";
import { previewFrame } from "../src/scenes/preview.js";

const scene = {
  id: "Card",
  name: "Card",
  width: 640,
  height: 360,
  fps: 24,
  durationFrames: 72,
  nodes: [
    {
      id: "Group",
      type: "group",
      x: 24,
      y: 30,
      width: 400,
      height: 220,
      rotation: 8,
      scale: [90, 90],
    },
    {
      id: "Title",
      type: "text",
      parent: "Group",
      text: "Directed title",
      font: "Arial",
      fontSize: 30,
      width: 320,
      height: 50,
      motion: [
        {
          property: "position",
          keys: [
            { frame: 0, value: [-60, 0], easing: [0.22, 0, 0.4, 1] },
            { frame: 36, value: [0, 0] },
          ],
        },
        {
          property: "opacity",
          keys: [
            { frame: 0, value: 0, easing: "hold" },
            { frame: 12, value: 100 },
          ],
        },
      ],
    },
  ],
};
describe("scene compiler, schematic and native integration", () => {
  it("keeps sampled native frame states within shared evaluator tolerance", () => {
    const compiled = compileScene(scene),
      native = nativeScene(compiled);
    for (let frame = 0; frame < scene.durationFrames; frame++) {
      const original = previewFrame(compiled, frame),
        sampled = previewFrame(native, frame);
      for (let node = 0; node < original.length; node++) {
        for (let property = 0; property < original[node].length; property++) {
          expect(Math.abs(original[node][property] - sampled[node][property])).toBeLessThanOrEqual(
            0.100001,
          );
        }
      }
    }
    expect(native.nodes[1].parent).toBe("Group");
    expect(native.nodes[0].rotation).toBe(8);
  });
  it("sequences hierarchy and frame motion without changing relative layout", () => {
    const compiled = sequenceScenes([scene, scene], "Sequence", "Two cards");
    expect(compiled.spec.durationFrames).toBe(144);
    const first = previewFrame(compiled, 18),
      second = previewFrame(compiled, 90);
    expect(first.slice(0, 2)).toEqual(second.slice(2));
    expect(first[2][6]).toBe(0);
    expect(second[0][6]).toBe(0);
    expect(compiled.nodes[3].parent).toBe("s1_Group");
  });
});
