import { afterAll, describe, expect, it } from "vitest";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { loadSceneInput } from "../src/scenes/input.js";
const directory = `/private/tmp/kynem-scene-input-test-${process.pid}`;
afterAll(() => rm(directory, { recursive: true, force: true }));
const scene = {
  id: "test",
  name: "Test",
  width: 320,
  height: 180,
  fps: 30,
  durationFrames: 120,
  nodes: [{ id: "rect", type: "rect", width: 100, height: 20 }],
};
describe("bounded scene artifact loading", () => {
  it("accepts inline or regular-file spec and rejects ambiguous/missing input", async () => {
    await mkdir(directory, { recursive: true });
    const filename = directory + "/scene.json";
    await writeFile(filename, JSON.stringify(scene));
    expect(await loadSceneInput(undefined, filename)).toEqual(await loadSceneInput(scene));
    await expect(loadSceneInput(scene, filename)).rejects.toThrow(/exactly one/);
    await expect(loadSceneInput()).rejects.toThrow(/exactly one/);
  });
  it("refuses oversized, symlink, nonregular and invalid JSON files", async () => {
    await mkdir(directory, { recursive: true });
    const big = directory + "/big.json";
    await writeFile(big, " ".repeat(512 * 1024 + 1));
    await expect(loadSceneInput(undefined, big)).rejects.toThrow(/512/);
    const small = directory + "/small.json";
    await writeFile(small, "{}");
    const link = directory + "/link.json";
    await symlink(small, link);
    await expect(loadSceneInput(undefined, link)).rejects.toThrow();
    await expect(loadSceneInput(undefined, directory)).rejects.toThrow(/regular/);
    await expect(loadSceneInput(undefined, small)).rejects.toThrow();
  });
});
