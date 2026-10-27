import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import { inspectAvailability, preflightProject } from "../src/production/preflight.js";
import { analyzeProbe, type Probe } from "../src/production/media.js";
import { selectReviewFrames } from "../src/production/motion-review.js";
import { mapAnchor } from "../src/production/anchors.js";
import { buildRecipe } from "../src/production/recipes.js";
import {
  renderJobStatus,
  startRenderJob,
  type RenderManifest,
  type RenderStatus,
} from "../src/production/render-jobs.js";
import { aerenderArgs } from "../src/production/render-worker.js";
import { atomicJson } from "../src/production/storage.js";
import { getOp } from "../src/registry.js";
import "../src/operations/index.js";

const dirs: string[] = [];
async function directory() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kynem-production-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("source metadata preflight", () => {
  it("classifies dataless files before opening their content and keeps unavailable flags unknown", async () => {
    const file = path.join(await directory(), "media.mov");
    await writeFile(file, "placeholder metadata fixture");
    expect(
      (await inspectAvailability(file, "darwin", async () => "dataless,compressed")).state,
    ).toBe("cloud-placeholder");
    expect(
      (
        await inspectAvailability(file, "darwin", async () => {
          throw new Error("denied");
        })
      ).state,
    ).toBe("unknown");
    expect((await inspectAvailability(file, "darwin", async () => "-")).state).toBe("local");
  });
  it("detects adjacent iCloud placeholders and refuses symlinks", async () => {
    const dir = await directory(),
      file = path.join(dir, "photo.png");
    await writeFile(path.join(dir, ".photo.png.icloud"), "metadata");
    expect((await inspectAvailability(file)).state).toBe("cloud-placeholder");
    const other = path.join(dir, "other.png");
    await symlink(path.join(dir, ".photo.png.icloud"), other);
    expect((await inspectAvailability(other)).state).toBe("unknown");
  });
  it("does not infer unknown AEP dependencies and rejects stale sidecar identity", async () => {
    const project = path.join(await directory(), "project.aep");
    await writeFile(project, "AEP");
    expect(await preflightProject(project)).toMatchObject({
      coverage: "unknown",
      mediaContentRead: false,
    });
    const info = await stat(project);
    await writeFile(
      project + ".kynem-media.json",
      JSON.stringify({
        schemaVersion: 1,
        project: { path: project, bytes: info.size + 1, mtimeMs: info.mtimeMs },
        dependencies: [],
        coverage: "footage-and-proxies",
        expressionDependencies: "unknown",
      }),
    );
    expect(await preflightProject(project)).toMatchObject({
      canOpenKnownFiles: false,
      coverage: "unknown",
    });
  });
});

describe("render queue accounting", () => {
  function run(mode: "done" | "cancel" | "throw") {
    const RQItemStatus = {
      DONE: 1,
      QUEUED: 2,
      USER_STOPPED: 3,
      ERR_STOPPED: 4,
      UNQUEUED: 5,
      RENDERING: 6,
      NEEDS_OUTPUT: 7,
      WILL_CONTINUE: 8,
    };
    const old = {
      render: false,
      status: 1,
      comp: { id: 10, name: "Old" },
      numOutputModules: 1,
      outputModule: () => ({ file: { fsName: "/old.mov", exists: true, length: 200 } }),
    };
    const fresh = { ...old, render: true, status: 2, comp: { id: 11, name: "Fresh" } };
    const skipped = { ...old, status: 5, comp: { id: 12, name: "Skipped" } };
    const items = [old, fresh, skipped];
    const renderQueue = {
      rendering: false,
      numItems: items.length,
      item: (i: number) => items[i - 1],
      render() {
        fresh.status = mode === "done" ? 1 : mode === "cancel" ? 3 : 4;
        if (mode === "throw") throw new Error("render failed");
      },
    };
    return vm.runInNewContext("(function(){" + getOp("render.start")!.toJsx({}) + "})()", {
      app: { project: { renderQueue } },
      RQItemStatus,
      AE: { ensureParentDir() {}, errText: (e: Error) => e.message },
    });
  }
  it("counts only newly completed selected items and retains previous completions/skips", () => {
    const result = run("done");
    expect(result).toMatchObject({
      ok: true,
      rendered: 1,
      completed: 1,
      previouslyCompleted: 1,
      total: 3,
      mediaVerified: false,
    });
    expect(result.items.map((i: { state: string }) => i.state)).toEqual([
      "previouslyCompleted",
      "completed",
      "skipped",
    ]);
  });
  it("reports cancellation and preserves item failure details even when render throws", () => {
    expect(run("cancel")).toMatchObject({ ok: false, completed: 0 });
    expect(run("throw")).toMatchObject({ ok: false, rendered: 0, error: "render failed" });
  });
});

describe("measured motion and audio", () => {
  const probe: Probe = {
    streams: [
      { index: 0, codec_type: "video", width: 100, height: 100, avg_frame_rate: "30/1" },
      { index: 1, codec_type: "audio", sample_rate: "48000" },
    ],
    format: { duration: "0.2" },
    frames: [
      ...[0, 1 / 30, 2 / 30, 4 / 30].map((t) => ({
        media_type: "video",
        stream_index: 0,
        best_effort_timestamp_time: String(t),
        pkt_duration_time: String(1 / 30),
      })),
      { media_type: "audio", stream_index: 1, best_effort_timestamp_time: "0", nb_samples: 1024 },
      { media_type: "audio", stream_index: 1, best_effort_timestamp_time: "0.1", nb_samples: 1024 },
    ],
  };
  it("detects VFR/discontinuities and an audio gap without inventing an offset correction", () => {
    const result = analyzeProbe(probe);
    expect(result.video).toMatchObject({ decodedFrames: 4, monotonic: true, variable: true });
    expect(result.audio[0]).toMatchObject({ gaps: 1, overlaps: 0 });
  });
  it("supports coarse and frame-by-frame windows with measured last frames and bounded output", () => {
    expect(
      selectReviewFrames(30, [
        { startFrame: 0, endFrame: 16, stepFrames: 5 },
        { startFrame: 16, endFrame: 20, stepFrames: 1 },
      ]),
    ).toEqual([0, 5, 10, 15, 16, 17, 18, 19]);
    expect(() =>
      selectReviewFrames(30, [{ startFrame: 0, endFrame: 31, stepFrames: 1 }]),
    ).toThrow();
    expect(() =>
      selectReviewFrames(300, [{ startFrame: 0, endFrame: 300, stepFrames: 1 }]),
    ).toThrow("120");
  });
});

describe("recoverable render identity", () => {
  it("reconnects to the same durable record without contacting AE or spawning a replacement", async () => {
    const root = await directory(),
      id = randomUUID();
    const request = {
      requestId: id,
      copyPath: "/copy.aep",
      items: [
        {
          compId: 1,
          startFrame: 0,
          endFrame: 30,
          outputPath: "/new.mov",
          outputTemplate: "Lossless",
          renderTemplate: "Best Settings",
          audio: "intentional-none" as const,
        },
      ],
    };
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, id));
    await atomicJson(path.join(root, id, "manifest.json"), { request });
    await atomicJson(path.join(root, id, "status.json"), {
      id,
      state: "completed",
      updatedAt: new Date().toISOString(),
      items: [],
    } satisfies RenderStatus);
    const transport = {
      execute: async () => {
        throw new Error("Unexpected AE call");
      },
    };
    expect((await startRenderJob(request, transport, root)).state).toBe("completed");
    await expect(
      startRenderJob({ ...request, copyPath: "/different.aep" }, transport, root),
    ).rejects.toThrow("different render");
  });
  it("never reports a stale running heartbeat as success", async () => {
    const root = await directory(),
      id = randomUUID();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(root, id));
    await atomicJson(path.join(root, id, "status.json"), {
      id,
      state: "started",
      updatedAt: "2000-01-01T00:00:00.000Z",
      items: [],
    });
    expect((await renderJobStatus(id, root)).state).toBe("unknown");
  });
  it("converts exclusive ranges to aerender inclusive frames without using the editor instance", () => {
    const manifest = {
      snapshot: "/copy.aep",
      comps: [{ compName: "Main", displayStartFrame: 100 }],
      request: {
        items: [
          {
            startFrame: 5,
            endFrame: 10,
            outputPath: "/out.mov",
            outputTemplate: "Movie",
            renderTemplate: "Best",
          },
        ],
      },
    } as RenderManifest;
    const args = aerenderArgs(manifest, 0);
    expect(args.slice(args.indexOf("-s"), args.indexOf("-s") + 4)).toEqual([
      "-s",
      "105",
      "-e",
      "109",
    ]);
    expect(args).not.toContain("-reuse");
  });
});

it("maps source anchors through source and precomp transforms without claiming semantic alignment", () => {
  const result = mapAnchor({
    sourceSize: [2048, 2048],
    point: [0.5, 0.5],
    coordinates: "normalized",
    sampleTime: 2,
    chain: [
      {
        label: "precomp",
        anchor: [1024, 1024],
        position: [200, 300],
        scale: [50, 50],
        rotation: 0,
        geometry: "2d",
      },
      {
        label: "Main",
        anchor: [0, 0],
        position: [10, 20],
        scale: [100, 100],
        rotation: 0,
        geometry: "2d",
      },
    ],
  });
  expect(result.spaces.at(-1)?.point).toEqual([210, 320]);
  expect(result.semanticAlignmentVerified).toBe(false);
});
it("creates three different editable recipe structures and keeps supplied material/approval context", () => {
  const base = {
    id: "Recipe",
    width: 1080,
    height: 1920,
    fps: 30,
    durationFrames: 150,
    title: "Explain",
    labels: ["Source", "Detail"],
    font: "ArialMT",
    outputDirectory: "/unused",
    spokenRange: { startFrame: 90, endFrame: 240 },
    externalMaterials: [{ role: "source", path: "/source.png" }],
  };
  const recipes = ["locate-explain-recompose", "comparison", "split-screen"].map((recipe) =>
    buildRecipe({ ...base, recipe }),
  );
  expect(new Set(recipes.map((r) => JSON.stringify(r.scene))).size).toBe(3);
  expect(recipes[0].production).toMatchObject({
    approval: "unreviewed",
    sequenceReviewRequired: true,
    externalMaterials: base.externalMaterials,
  });
  expect(recipes[0].scene.nodes.find((n) => n.id === "subject_label")?.parent).toBe("subject");
});
