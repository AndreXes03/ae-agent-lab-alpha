import { test, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalReview } from "../src/local-review.js";

test("review preserves source context, escapes script data and rejects overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kynem-review-"));
  try {
    await writeFile(join(dir, "movie.mp4"), "test fixture");
    await writeFile(
      join(dir, "manifest.json"),
      JSON.stringify({
        video: "movie.mp4",
        compName: "</script>",
        fps: 30,
        startFrame: 60,
        version: "v3",
      }),
    );
    const args = ["--manifest", join(dir, "manifest.json"), "--out", join(dir, "review")];
    const page = await createLocalReview(args);
    const html = await readFile(page, "utf8");
    expect(html).toContain('"startFrame":60');
    expect(html).toContain('"compName":"\\u003c/script>"');
    expect(html).toContain('"videoDigest":');
    expect(html).not.toContain("KYNEM-README-demo");
    expect(await readFile(join(dir, "review/video.mp4"), "utf8")).toBe("test fixture");
    await expect(createLocalReview(args)).rejects.toThrow();
    await expect(
      createLocalReview([
        "--video",
        join(dir, "movie.mp4"),
        "--out",
        join(dir, "bad"),
        "--fps",
        "NaN",
      ]),
    ).rejects.toThrow("fps");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("browser composer saves point feedback and rejects foreign imports", async () => {
  const { runInNewContext } = await import("node:vm");
  const template = await readFile(new URL("../assets/review.html", import.meta.url), "utf8");
  const elements: Record<string, any> = {};
  const element = (id: string): any =>
    (elements[id] ??= {
      id,
      value: "",
      textContent: "",
      style: {},
      files: [],
      paused: true,
      currentTime: 0,
      duration: 5,
      videoWidth: 1920,
      videoHeight: 1080,
      readyState: 1,
      offsetWidth: 300,
      offsetHeight: 180,
      hidden: true,
      focused: false,
      focus() {
        this.focused = true;
      },
      setPointerCapture() {},
      append() {},
      replaceChildren() {},
      setAttribute() {},
      pause() {
        this.paused = true;
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
      classList: { toggle: () => true },
    });
  element("reviewContext").textContent = JSON.stringify({
    video: "video.mp4",
    compName: "Delivery",
    compId: "42",
    fps: 30,
    startFrame: 60,
    version: "v3",
    videoDigest: "abc",
  });
  const saved = new Map();
  const context: any = {
    document: {
      getElementById: element,
      addEventListener() {},
      querySelector: () => element("layout"),
      createElement: () => element(Math.random().toString()),
    },
    localStorage: {
      getItem: (k: string) => saved.get(k),
      setItem: (k: string, v: string) => saved.set(k, v),
    },
    window: { innerWidth: 2000, innerHeight: 1200 },
    ResizeObserver: class {
      observe() {}
    },
    requestAnimationFrame: () => 1,
  };
  const script = template.split("<script>\n")[1].split("</script>")[0];
  runInNewContext(script, context);
  element("video").onloadedmetadata();
  element("video").currentTime = 1;
  element("video").onclick({ clientX: 960, clientY: 540 });
  expect(element("note").focused).toBe(true);
  element("note").value = "Move title";
  element("form").onsubmit({ preventDefault() {} });
  const feedback = JSON.parse([...saved.values()][0]);
  expect(feedback[0]).toMatchObject({
    type: "point",
    time: 1,
    position: { x: 0.5, y: 0.5 },
    note: "Move title",
  });
  const timeline = element("timeline");
  timeline.onpointerdown({
    preventDefault() {},
    target: { id: "timeline" },
    clientX: 384,
    pointerId: 1,
  });
  timeline.onpointerup({ clientX: 384, clientY: 900 });
  expect(element("target").textContent).toContain("Istante");
  element("note").value = "At this instant";
  element("form").onsubmit({ preventDefault() {} });
  timeline.onpointerdown({
    preventDefault() {},
    target: { id: "timeline" },
    clientX: 384,
    pointerId: 2,
  });
  timeline.onpointermove({ clientX: 1152 });
  timeline.onpointerup({ clientX: 1152, clientY: 900 });
  element("commentRange").onclick({ target: element("commentRange") });
  expect(element("target").textContent).toContain("Intervallo");
  element("note").value = "Speed this motion";
  element("form").onsubmit({ preventDefault() {} });
  const all = JSON.parse([...saved.values()][0]);
  expect(all.map((i: any) => i.type).toSorted()).toEqual(["point", "range", "time"]);
  expect(all.find((i: any) => i.type === "range")).toMatchObject({ start: 1, end: 3 });
  element("importFeedback").files = [
    { text: async () => JSON.stringify({ schemaVersion: 2, context: {}, feedback: [] }) },
  ];
  await element("importFeedback").onchange();
  expect(element("status").textContent).toContain("rifiutata");
  expect(JSON.parse([...saved.values()][0])).toHaveLength(3);
});
