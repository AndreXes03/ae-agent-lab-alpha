import { afterAll, describe, expect, it, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import type { AeTransport } from "../src/transport/AeTransport.js";
const settings = await vi.hoisted(async () => {
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return { directory: await mkdtemp(join(tmpdir(), "kynem-scene-compose-test-")) };
});
vi.mock("../src/config.js", () => ({ RUNTIME_DIR: settings.directory }));
import { sceneComposeTool } from "../src/tools/scene-compose.js";
import { sceneSpec } from "../src/scenes/model.js";
import { compileScene } from "../src/scenes/compile.js";
afterAll(() => rm(settings.directory, { recursive: true, force: true }));
const scene = () =>
  sceneSpec.parse({
    id: "study",
    name: "Study",
    width: 320,
    height: 180,
    fps: 30,
    durationFrames: 120,
    nodes: [{ id: "caption", type: "text", font: "ArialMT", fontSize: 20, text: "Study" }],
  });
describe("scene sequence artifact tool", () => {
  it("persists measured bounds and exact sequence offsets in directly compilable JSON", async () => {
    const result = await sceneComposeTool.handler(
      {
        id: "sequence",
        name: "Sequence",
        scenes: [scene(), scene()],
        textBounds: {
          s0_caption: { width: 70, height: 24 },
          s1_caption: { width: 70, height: 24 },
        },
      },
      {} as AeTransport,
    );
    expect(result.isError).toBe(false);
    const payload = result.structuredContent as {
      artifact: string;
      durationFrames: number;
      nodeCount: number;
    };
    expect(payload.durationFrames).toBe(240);
    expect(payload.nodeCount).toBe(2);
    const compiled = compileScene(JSON.parse(await readFile(payload.artifact, "utf8")));
    expect(compiled.nodes[1]).toMatchObject({
      id: "s1_caption",
      startFrame: 120,
      endFrame: 240,
      width: 70,
    });
  });
  it("rejects incompatible frame rates before writing a usable artifact", async () => {
    const a = scene();
    a.nodes[0].width = 70;
    a.nodes[0].height = 24;
    const b = structuredClone(a);
    b.fps = 24;
    const result = await sceneComposeTool.handler(
      { id: "bad", name: "Bad", scenes: [a, b] },
      {} as AeTransport,
    );
    expect(result.isError).toBe(true);
  });
});
