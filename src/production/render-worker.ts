/** Detached supervisor. Owns a permanent claim; reconnects never spawn another render. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { appendFile, lstat, mkdir } from "node:fs/promises";
import { atomicJson, exclusiveClaim, readJson } from "./storage.js";
import type { RenderManifest, RenderStatus } from "./render-jobs.js";
import { fileDigest, verifyMedia } from "./media.js";
import { createMotionReview } from "./motion-review.js";

export function aerenderArgs(manifest: RenderManifest, index: number) {
  const item = manifest.request.items[index],
    comp = manifest.comps[index];
  return [
    "-project",
    manifest.snapshot,
    "-comp",
    comp.compName,
    "-s",
    String(item.startFrame + comp.displayStartFrame),
    "-e",
    String(item.endFrame - 1 + comp.displayStartFrame),
    "-i",
    "1",
    "-RStemplate",
    item.renderTemplate,
    "-OMtemplate",
    item.outputTemplate,
    "-output",
    item.outputPath,
    "-v",
    "ERRORS_AND_PROGRESS",
    "-close",
    "DO_NOT_SAVE_CHANGES",
  ];
}
export async function runRenderWorker(dir: string) {
  const manifest = await readJson<RenderManifest>(path.join(dir, "manifest.json"));
  if (
    !(await exclusiveClaim(path.join(dir, "claim.json"), {
      pid: process.pid,
      at: new Date().toISOString(),
    }))
  )
    return;
  const status = await readJson<RenderStatus>(path.join(dir, "status.json"));
  status.workerPid = process.pid;
  status.state = "started";
  let writeChain = Promise.resolve();
  const save = () => {
    status.updatedAt = new Date().toISOString();
    const snapshot = JSON.parse(JSON.stringify(status));
    writeChain = writeChain.then(() => atomicJson(path.join(dir, "status.json"), snapshot));
    return writeChain;
  };
  await save();
  const heartbeat = setInterval(() => {
    void save().catch(() => undefined);
  }, 2000);
  const cancelled = async () => !!(await lstat(path.join(dir, "cancel.json")).catch(() => null));
  try {
    if (manifest.projectDigest !== (await fileDigest(manifest.snapshot)))
      throw new Error("Snapshot digest changed");
    for (const dep of manifest.dependencies)
      if (dep.sha256 !== (await fileDigest(dep.path)))
        throw new Error("Source media changed before rendering");
    for (let i = 0; i < status.items.length; i++) {
      const item = manifest.request.items[i],
        comp = manifest.comps[i],
        entry = status.items[i];
      if (await cancelled()) {
        entry.state = "cancelled";
        continue;
      }
      try {
        if (await lstat(item.outputPath).catch(() => null))
          throw new Error("Output already exists");
        await mkdir(path.dirname(item.outputPath), { recursive: true });
        if (!(await exclusiveClaim(item.outputPath + ".kynem-render.lock", { jobId: status.id })))
          throw new Error("Output reserved by another render");
        entry.state = "started";
        await save();
        const exit = await new Promise<{ code: number | null; signal: string | null }>(
          (resolve, reject) => {
            const child = spawn(manifest.aerender, aerenderArgs(manifest, i), {
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true,
            });
            status.renderPid = child.pid;
            let tail = "",
              logging = Promise.resolve();
            const output = (chunk: Buffer) => {
              const text = chunk.toString();
              logging = logging
                .then(() => appendFile(path.join(dir, `item-${i}.log`), text))
                .catch(() => undefined);
              tail = (tail + text).slice(-4096);
              const matches = [...tail.matchAll(/PROGRESS:.*?\((\d+)\)/g)];
              if (matches.length) entry.progress.renderedFrame = Number(matches.at(-1)![1]);
            };
            child.stdout.on("data", output);
            child.stderr.on("data", output);
            let cancellationSent = false;
            const timer = setInterval(() => {
              void cancelled()
                .then((yes) => {
                  if (yes && !cancellationSent) {
                    cancellationSent = true;
                    child.kill("SIGTERM");
                  }
                })
                .catch(() => undefined);
            }, 1000);
            child.once("error", (e) => {
              clearInterval(timer);
              reject(e);
            });
            child.once("close", (code, signal) => {
              clearInterval(timer);
              void logging.then(() => resolve({ code, signal }));
            });
          },
        );
        delete status.renderPid;
        if (await cancelled()) {
          // aerender's child AE may still be shutting down: never attest cancellation as a clean artifact.
          entry.state = "cancelled";
          await save();
          continue;
        }
        if (exit.code !== 0 || exit.signal)
          throw new Error(`aerender exited ${exit.code ?? exit.signal}`);
        entry.verification = await verifyMedia(item.outputPath, {
          frames: item.endFrame - item.startFrame,
          fps: comp.fps,
          width: comp.width,
          height: comp.height,
          audio: item.audio,
        });
        if (!entry.verification.passed) throw new Error(entry.verification.blockers.join("; "));
        if (item.reviewWindows?.length) {
          const review = await createMotionReview({
            video: item.outputPath,
            outputDir: path.join(dir, `review-${i}`),
            context: {
              compId: comp.compId,
              compName: comp.compName,
              fps: comp.fps,
              startFrame: item.startFrame,
              version: manifest.projectDigest,
            },
            windows: item.reviewWindows,
            targets: comp.targets,
          });
          entry.reviewPath = review.indexPath;
        }
        entry.state = "completed";
      } catch (error) {
        entry.state = "failed";
        entry.error = String(error).slice(0, 1500);
      }
      await save();
    }
    status.dependenciesUnchanged = true;
    for (const dep of manifest.dependencies)
      if (dep.sha256 !== (await fileDigest(dep.path))) status.dependenciesUnchanged = false;
    if (!status.dependenciesUnchanged)
      throw new Error("Source media changed during render; outputs cannot be delivered");
    status.state = status.items.some((s) => s.state === "failed")
      ? "failed"
      : status.items.some((s) => s.state === "cancelled")
        ? "cancelled"
        : "completed";
  } catch (error) {
    status.state = "failed";
    status.error = String(error).slice(0, 1500);
    for (const item of status.items)
      if (item.state === "started" || item.state === "queued") {
        item.state = "failed";
        item.error = status.error;
      }
  } finally {
    clearInterval(heartbeat);
    await save();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runRenderWorker(process.argv[2]).catch((error) => {
    process.stderr.write(String(error));
    process.exitCode = 1;
  });
}
