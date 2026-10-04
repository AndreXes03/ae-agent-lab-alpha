import { test, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createStoryboard,
  contentHash,
  sceneHash,
  validateStoryboard,
  renderStyleframe,
} from "../src/storyboard.js";
const scene = (id: string, text: string, startFrame = 0) => ({
  id,
  title: id,
  startFrame,
  durationFrames: 60,
  elements: [{ id: "title", type: "text", x: 30, y: 60, fontSize: 32, text, fill: "#ffffff" }],
});
const spec = () => ({
  schemaVersion: 1,
  id: "demo",
  title: "Demo",
  revision: "v1",
  mode: "storyboard",
  format: { width: 960, height: 540, fps: 30 },
  scenes: [scene("a", "Command"), scene("b", "Title", 60)],
  transitions: [
    {
      id: "a-b",
      fromScene: "a",
      toScene: "b",
      elementIds: ["title"],
      durationFrames: 20,
      staggerFrames: 0,
      curve: { influence: 75 },
      recipe: "slide",
      properties: ["position"],
      handoff: "Title holds",
    },
  ],
});
test("storyboard produces clean artwork, production hashes and exclusive output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kynem-storyboard-"));
  try {
    const source = spec();
    await writeFile(join(dir, "spec.json"), JSON.stringify(source));
    const args = ["--manifest", join(dir, "spec.json"), "--out", join(dir, "review")];
    const page = await createStoryboard(args);
    const output = JSON.parse(await readFile(join(dir, "review/production.json"), "utf8"));
    expect(output.manifestHash).toBe(contentHash(source));
    expect(output.approval).toBeNull();
    expect(output.sceneHashes.a).toBe(sceneHash(source.scenes[0], source));
    expect(await readFile(join(dir, "review/frame-1.svg"), "utf8")).toContain(">Command</text>");
    expect(await readFile(page, "utf8")).toContain('"manifestHash"');
    await expect(createStoryboard(args)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("targeted revision preserves approved scene hash and rejects silent edits", () => {
  const original = spec();
  const approved = { id: "a", hash: sceneHash(original.scenes[0], original) };
  const revised = {
    ...original,
    revision: "v2",
    approvedScenes: [approved],
    scenes: [original.scenes[0], scene("b", "New ending", 60)],
  };
  expect(() => validateStoryboard(revised)).not.toThrow();
  expect(sceneHash(revised.scenes[0], revised)).toBe(approved.hash);
  revised.scenes[0] = scene("a", "Silently changed");
  expect(() => validateStoryboard(revised)).toThrow("Approved scene changed");
});
test("artwork escapes text and validates unsupported primitives", () => {
  const s = spec();
  s.scenes[0].elements[0].text = "<script>&";
  expect(renderStyleframe(s.scenes[0], s)).toContain("&lt;script&gt;&amp;");
  s.scenes[0].elements[0].type = "generated-material";
  expect(() => validateStoryboard(s)).toThrow("element");
});

test("principal navigation skips transitions, connectors infer motion, approval exports exact revision", async () => {
  const { runInNewContext } = await import("node:vm");
  const html = await readFile(new URL("../assets/storyboard.html", import.meta.url), "utf8");
  const elements: Record<string, any> = {};
  let serial = 0;
  const element = (id: string): any =>
    (elements[id] ??= {
      id,
      value: "",
      textContent: "",
      style: {},
      dataset: {},
      children: [],
      files: [],
      hidden: false,
      offsetWidth: 300,
      offsetHeight: 180,
      focused: false,
      focus() {
        this.focused = true;
      },
      append(...nodes: any[]) {
        this.children.push(...nodes);
      },
      replaceChildren() {
        this.children = [];
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
      querySelectorAll() {
        return this.children.filter((n: any) => n.className === "thumb");
      },
      classList: { toggle() {} },
      click() {},
    });
  const source = spec(),
    data = {
      spec: source,
      manifestHash: contentHash(source),
      sceneHashes: {
        a: sceneHash(source.scenes[0], source),
        b: sceneHash(source.scenes[1], source),
      },
      frames: source.scenes.map((s) => ({
        id: s.id,
        title: s.title,
        file: s.id + ".svg",
        source: "schematic",
        kind: "scene",
      })),
      transitions: source.transitions,
    };
  element("context").textContent = JSON.stringify(data);
  const saved = new Map();
  const sandbox: any = {
    document: {
      getElementById: element,
      createElement: () => element("created" + serial++),
      createTextNode: (text: string) => ({ textContent: text }),
      addEventListener() {},
    },
    localStorage: {
      getItem: (k: string) => saved.get(k),
      setItem: (k: string, v: string) => saved.set(k, v),
    },
    window: { innerWidth: 1200, innerHeight: 900 },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    Blob,
    setTimeout() {},
  };
  runInNewContext(html.split("<script>")[1].split("</script>")[0], sandbox);
  expect(element("frameTitle").textContent).toBe("a");
  expect(element("details").textContent).not.toContain("Raccordo:");
  element("next").onclick();
  expect(element("frameTitle").textContent).toBe("b");
  const connector = element("scenes").children.find((n: any) => n.className === "connector");
  connector.onclick();
  expect(element("frameTitle").textContent).toContain("Raccordo");
  element("artwork").onclick({ clientX: 480, clientY: 270 });
  expect(element("note").focused).toBe(true);
  expect(element("target").textContent).toContain("Movimento");
  element("note").value = "Fast arrival";
  element("composer").onsubmit({ preventDefault() {} });
  expect(JSON.parse([...saved.values()][0])[0].target).toEqual({ id: "a-b", kind: "motion" });
  element("next").onclick();
  expect(element("frameTitle").textContent).toBe("b");
  element("artwork").onclick({ clientX: 480, clientY: 270 });
  expect(element("target").textContent).toContain("Stile");
  expect(runInNewContext("payload().approval", sandbox)).toBeNull();
  element("approve").onclick();
  const approval = runInNewContext("payload().approval", sandbox);
  expect(approval).toMatchObject({
    status: "approved",
    manifestHash: data.manifestHash,
    revision: "v1",
  });
});

test("scene locks cover global styling and supplied image bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kynem-artwork-lock-"));
  try {
    const source: any = spec();
    source.scenes = [{ ...source.scenes[0], image: "frame.png" }];
    source.transitions = [];
    await writeFile(join(dir, "frame.png"), "first bytes");
    await writeFile(join(dir, "spec.json"), JSON.stringify(source));
    await createStoryboard(["--manifest", join(dir, "spec.json"), "--out", join(dir, "one")]);
    const generated = JSON.parse(await readFile(join(dir, "one/production.json"), "utf8"));
    source.approvedScenes = [{ id: "a", hash: generated.sceneHashes.a }];
    await writeFile(join(dir, "spec.json"), JSON.stringify(source));
    await createStoryboard(["--manifest", join(dir, "spec.json"), "--out", join(dir, "two")]);
    await writeFile(join(dir, "frame.png"), "different bytes");
    await expect(
      createStoryboard(["--manifest", join(dir, "spec.json"), "--out", join(dir, "three")]),
    ).rejects.toThrow("Approved scene changed");
    const simple: any = spec();
    simple.approvedScenes = [{ id: "a", hash: sceneHash(simple.scenes[0], simple) }];
    simple.style = { background: "#ffffff" };
    expect(() => validateStoryboard(simple)).toThrow("Approved scene changed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concrete five scene fixture revises only ending and its raccordo while preserving four locked scenes", async () => {
  const root = new URL("../examples/storyboard/", import.meta.url);
  const original = JSON.parse(await readFile(new URL("kynem-demo.json", root), "utf8"));
  const revision = JSON.parse(
    await readFile(new URL("kynem-demo-ending-revision.json", root), "utf8"),
  );
  revision.approvedScenes = original.scenes
    .slice(0, 4)
    .map((s: any) => ({ id: s.id, hash: sceneHash(s, original) }));
  expect(() => validateStoryboard(revision)).not.toThrow();
  for (let i = 0; i < 4; i++)
    expect(sceneHash(revision.scenes[i], revision)).toBe(sceneHash(original.scenes[i], original));
  expect(sceneHash(revision.scenes[4], revision)).not.toBe(sceneHash(original.scenes[4], original));
  expect(revision.transitions.slice(0, 3)).toEqual(original.transitions.slice(0, 3));
});
