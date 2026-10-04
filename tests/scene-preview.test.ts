import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { cacheScenePreview, sceneCacheHash } from "../src/scenes/cache.js";
import { compileScene } from "../src/scenes/compile.js";
import { evaluateNode } from "../src/scenes/motion.js";
import { previewFrame, scenePreviewHtml } from "../src/scenes/preview.js";

const scene = () =>
  compileScene({
    id: "scene",
    name: "Preview",
    width: 320,
    height: 180,
    fps: 24,
    durationFrames: 12,
    nodes: [
      {
        id: "text",
        type: "text",
        font: "Arial",
        fontSize: 24,
        text: '</script><img src="https://bad.invalid" onerror="alert(1)">',
        width: 100,
        height: 30,
        motion: [
          {
            property: "position",
            keys: [
              { frame: 0, value: [0, 0], easing: "linear" },
              { frame: 10, value: [100, 50], easing: [0.2, 0, 0.8, 1] },
            ],
          },
        ],
      },
    ],
  });
describe("local schematic scene preview", () => {
  it("uses the original motion evaluator and escapes script injection", () => {
    const compiled = scene();
    const state = evaluateNode(compiled.nodes[0], 5);
    expect(previewFrame(compiled, 5)[0]).toEqual([
      state.x,
      state.y,
      state.opacity,
      state.rotation,
      ...state.scale,
      1,
    ]);
    const html = scenePreviewHtml(compiled);
    expect(html).toContain("SCHEMATIC NOT AE RENDER");
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).toContain("shape.textContent=node.text");
    expect(html).toContain("connect-src 'none'");
  });
  it("runs local controls and draws shared motion frames without HTML insertion", () => {
    class Element {
      attributes: Record<string, string> = {};
      children: Element[] = [];
      textContent = "";
      value: string | number = "0";
      max = 0;
      onclick?: () => void;
      oninput?: () => void;
      setAttribute(key: string, value: string) {
        this.attributes[key] = String(value);
      }
      appendChild(child: Element) {
        this.children.push(child);
        return child;
      }
    }
    const elements = new Map<string, Element>();
    const get = (id: string) => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id)!;
    };
    let callback: ((now: number) => void) | undefined;
    const context = vm.createContext({
      document: {
        getElementById: get,
        createElement: () => new Element(),
        createElementNS: () => new Element(),
      },
      performance: { now: () => 0 },
      requestAnimationFrame: (next: (now: number) => void) => {
        callback = next;
      },
    });
    const script = scenePreviewHtml(scene()).split("<script>")[1].split("</script>")[0];
    vm.runInContext(script, context, { timeout: 1000 });
    get("scrub").value = "5";
    get("scrub").oninput!();
    expect(get("frame").textContent).toContain("Frame 5");
    expect(get("stage").children[0].attributes.transform).toContain("translate(50");
    get("play").onclick!();
    callback!(1000);
    expect(get("frame").textContent).toContain("Frame 11");
    get("pause").onclick!();
  });
  it("draws connector lines and compiles parent lifetime visibility", () => {
    const compiled = compileScene({
      id: "lines",
      name: "Lines",
      width: 320,
      height: 180,
      fps: 24,
      durationFrames: 12,
      nodes: [
        { id: "group", type: "group", width: 300, height: 150, startFrame: 3, endFrame: 9 },
        { id: "a", type: "rect", parent: "group", width: 20, height: 20 },
        { id: "b", type: "rect", parent: "group", x: 80, width: 20, height: 20 },
        {
          id: "line",
          type: "line",
          parent: "group",
          connector: { from: { node: "a", edge: "right" }, to: { node: "b", edge: "left" } },
        },
      ],
    });
    expect(previewFrame(compiled, 0).every((state) => state[6] === 0)).toBe(true);
    expect(previewFrame(compiled, 5).every((state) => state[6] === 1)).toBe(true);
    expect(scenePreviewHtml(compiled)).toContain("createElementNS(ns,'line')");
  });
  it("reuses immutable complete content and invalidates mutations and dependencies", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scene-preview-"));
    try {
      const compiled = scene(),
        deps = { complete: true, fonts: { sans: "system-v1" } };
      const first = await cacheScenePreview(root, compiled, deps, scenePreviewHtml(compiled));
      expect(first.cacheHit).toBe(false);
      expect(
        (
          await cacheScenePreview(root, compiled, deps, () => {
            throw new Error("Must not regenerate cache hit");
          })
        ).cacheHit,
      ).toBe(true);
      expect(
        (await cacheScenePreview(root, compiled, deps, scenePreviewHtml(compiled))).cacheHit,
      ).toBe(true);
      expect(sceneCacheHash({ ...compiled, changed: true }, deps)).not.toBe(first.hash);
      const changed = await cacheScenePreview(
        root,
        compiled,
        { ...deps, fonts: { sans: "system-v2" } },
        scenePreviewHtml(compiled),
      );
      expect(changed.cacheHit).toBe(false);
      await expect(cacheScenePreview(root, compiled, deps, "changed html")).rejects.toThrow(
        "integrity",
      );
      await expect(cacheScenePreview(root, compiled, deps, "html", changed.hash)).rejects.toThrow(
        "Stale",
      );
      const unknown = await cacheScenePreview(root, compiled, {}, "html");
      expect((await cacheScenePreview(root, compiled, {}, "html")).artifactPath).not.toBe(
        unknown.artifactPath,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
