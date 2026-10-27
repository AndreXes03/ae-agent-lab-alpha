import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  fileDigest,
  mediaCommand,
  mediaExecutables,
  masterReferenceAudio,
  verifyMedia,
} from "../src/production/media.js";
import { createMotionReview } from "../src/production/motion-review.js";
import { runRenderWorker } from "../src/production/render-worker.js";
import {
  renderJobStatus,
  type RenderManifest,
  type RenderStatus,
} from "../src/production/render-jobs.js";
import { atomicJson } from "../src/production/storage.js";
import { publishDelivery } from "../src/production/delivery.js";

const bins = mediaExecutables();
const available = [bins.ffmpeg, bins.ffprobe].every(
  (bin) => spawnSync(bin, ["-version"], { timeout: 5000 }).status === 0,
);
describe.skipIf(!available)(
  "real media decoding and detached-process protocol (synthetic media, not native AE)",
  () => {
    let root: string, source: string, digest: string;
    beforeAll(async () => {
      root = await mkdtemp(path.join(os.tmpdir(), "kynem-media-"));
      source = path.join(root, "source.mp4");
      await mediaCommand(bins.ffmpeg, [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x180:rate=30:duration=1.2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=1.2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-n",
        source,
      ]);
      digest = await fileDigest(source);
    });
    afterAll(async () => {
      await rm(root, { recursive: true, force: true });
    });
    it("decodes the full video/audio and rejects false frame counts, audio intent and corrupt files", async () => {
      expect(
        await verifyMedia(source, {
          frames: 36,
          fps: 30,
          width: 320,
          height: 180,
          audio: "required",
        }),
      ).toMatchObject({
        passed: true,
        decoded: true,
        playbackReviewed: false,
        audioReviewed: false,
      });
      expect((await verifyMedia(source, { frames: 37, audio: "required" })).passed).toBe(false);
      expect((await verifyMedia(source, { audio: "intentional-none" })).passed).toBe(false);
      const broken = path.join(root, "broken.mp4");
      await writeFile(broken, "not a movie");
      await expect(verifyMedia(broken, { audio: "required" })).rejects.toThrow();
    });
    it("produces a variable-density grid with exact decoded indices/PTS and unknown nested mapping", async () => {
      const result = await createMotionReview({
        video: source,
        outputDir: path.join(root, "review"),
        context: {
          compId: 12,
          compName: "Synthetic fixture",
          fps: 30,
          startFrame: 120,
          version: digest,
        },
        windows: [
          { startFrame: 0, endFrame: 16, stepFrames: 5 },
          { startFrame: 16, endFrame: 19, stepFrames: 1 },
        ],
        targets: [],
      });
      const report = JSON.parse(await readFile(result.reportPath, "utf8"));
      expect(report.samples.map((s: { decodedFrame: number }) => s.decodedFrame)).toEqual([
        0, 5, 10, 15, 16, 17, 18,
      ]);
      expect(report.samples[0]).toMatchObject({
        actualPts: 0,
        compSeconds: 4,
        mainSeconds: null,
        precompSeconds: null,
      });
      expect(report.samples[6].compSeconds).toBeCloseTo(4.6, 5);
      expect(report.artifactSha256).toBe(digest);
      expect(await fileDigest(path.join(root, "review", "video.mp4"))).toBe(digest);
    });
    it("preserves encoded reference audio without a universal AAC offset", async () => {
      const result = await masterReferenceAudio(
        source,
        source,
        digest,
        path.join(root, "master.mp4"),
      );
      expect(result).toMatchObject({
        appliedOffsetSeconds: 0,
        verification: { passed: true, audioIdentical: true },
      });
      await expect(
        masterReferenceAudio(source, source, "0".repeat(64), path.join(root, "wrong.mp4")),
      ).rejects.toThrow("changed");
    });
    async function prepareJob(id: string, fail = false) {
      const dir = path.join(root, id);
      await mkdir(dir);
      const snapshot = path.join(dir, "project.aep");
      await writeFile(snapshot, "synthetic snapshot; not native AE");
      const executable = path.join(dir, "fake-aerender");
      await writeFile(
        executable,
        "#!" +
          process.execPath +
          "\n" +
          "const fs=require('node:fs');fs.appendFileSync(" +
          JSON.stringify(path.join(dir, "launches")) +
          ",'1');" +
          (fail
            ? "process.exit(0);"
            : "setTimeout(()=>{fs.copyFileSync(" +
              JSON.stringify(source) +
              ",process.argv[process.argv.indexOf('-output')+1]);process.stdout.write('PROGRESS: frame (36)\\n');},150);"),
      );
      await chmod(executable, 0o700);
      const outputPath = path.join(dir, "render.mp4");
      const manifest: RenderManifest = {
        schemaVersion: 1,
        aerender: executable,
        snapshot,
        projectDigest: await fileDigest(snapshot),
        dependencies: [],
        request: {
          requestId: id,
          copyPath: snapshot,
          items: [
            {
              compId: 1,
              startFrame: 0,
              endFrame: 36,
              outputPath,
              outputTemplate: "Fake",
              renderTemplate: "Fake",
              audio: "required",
            },
          ],
        },
        comps: [
          {
            compId: 1,
            compName: "Synthetic",
            fps: 30,
            width: 320,
            height: 180,
            displayStartFrame: 0,
            targets: [],
          },
        ],
      };
      await atomicJson(path.join(dir, "manifest.json"), manifest);
      await atomicJson(path.join(dir, "status.json"), {
        id,
        state: "queued",
        updatedAt: new Date().toISOString(),
        items: [
          { state: "queued", outputPath, progress: { renderedFrame: null, totalFrames: 36 } },
        ],
      } satisfies RenderStatus);
      return { dir, manifest, outputPath };
    }
    it("claims a job once, verifies output, publishes one current file, and rejects later corruption", async () => {
      const id = randomUUID(),
        job = await prepareJob(id);
      await Promise.all([runRenderWorker(job.dir), runRenderWorker(job.dir)]);
      expect(await readFile(path.join(job.dir, "launches"), "utf8")).toBe("1");
      expect(await renderJobStatus(id, root)).toMatchObject({
        state: "completed",
        dependenciesUnchanged: true,
      });
      const request = {
        renderJobId: id,
        itemIndex: 0,
        wipDirectory: path.join(root, "WIP"),
        version: "v1",
        reviews: {
          artifactSha256: digest,
          frames: { passed: true, notes: "Synthetic test fixture" },
          playback: { passed: true, notes: "Synthetic test fixture" },
          audio: { passed: true, notes: "Synthetic test fixture" },
        },
      };
      const delivery = await publishDelivery(request, root);
      expect(await fileDigest(delivery.currentPath)).toBe(digest);
      expect((await publishDelivery(request, root)).alreadyPublished).toBe(true);
      await writeFile(job.outputPath, "corruption");
      await expect(publishDelivery({ ...request, version: "v2" }, root)).rejects.toThrow("match");
      expect(await fileDigest(delivery.currentPath)).toBe(digest);
    });
    it("refuses successful process exit when no movie was produced", async () => {
      const id = randomUUID(),
        job = await prepareJob(id, true);
      await runRenderWorker(job.dir);
      expect(await renderJobStatus(id, root)).toMatchObject({
        state: "failed",
        items: [{ state: "failed" }],
      });
    });
    it("refuses a WIP with an unowned movie instead of deleting or moving it", async () => {
      const id = randomUUID(),
        job = await prepareJob(id);
      await runRenderWorker(job.dir);
      const wip = path.join(root, "unowned");
      await mkdir(wip);
      await copyFile(source, path.join(wip, "client-original.mp4"));
      const reviewed = { passed: true, notes: "Synthetic fixture only" };
      await expect(
        publishDelivery(
          {
            renderJobId: id,
            itemIndex: 0,
            wipDirectory: wip,
            version: "v1",
            reviews: {
              artifactSha256: digest,
              frames: reviewed,
              playback: reviewed,
              audio: reviewed,
            },
          },
          root,
        ),
      ).rejects.toThrow("unowned");
      expect(await fileDigest(path.join(wip, "client-original.mp4"))).toBe(digest);
    });
  },
);
