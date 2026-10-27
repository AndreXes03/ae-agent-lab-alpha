import path from "node:path";
import { z } from "zod";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { renderRoot, jobDirectory, renderJobStatus, type RenderManifest } from "./render-jobs.js";
import { atomicJson, exclusiveClaim, readJson } from "./storage.js";
import { fileDigest, verifyMedia } from "./media.js";

const review = z.strictObject({ passed: z.literal(true), notes: z.string().min(1).max(4000) });
export const deliveryRequest = z.strictObject({
  renderJobId: z.uuid(),
  itemIndex: z.number().int().nonnegative().max(7),
  wipDirectory: z.string(),
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  reviews: z.strictObject({
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    frames: review,
    playback: review,
    audio: review,
  }),
  provisional: z.array(z.string().min(1).max(500)).max(50).default([]),
  collectSources: z.boolean().default(false),
});
export async function publishDelivery(raw: unknown, root = renderRoot()) {
  const request = deliveryRequest.parse(raw);
  if (!path.isAbsolute(request.wipDirectory))
    throw new Error("An absolute WIP directory is required");
  const jobDir = jobDirectory(root, request.renderJobId);
  const job = await readJson<RenderManifest>(path.join(jobDir, "manifest.json"));
  const status = await renderJobStatus(request.renderJobId, root);
  const item = job.request.items[request.itemIndex],
    entry = status.items[request.itemIndex],
    comp = job.comps[request.itemIndex];
  if (
    status.state !== "completed" ||
    !status.dependenciesUnchanged ||
    entry?.state !== "completed" ||
    !entry.verification?.passed ||
    !item ||
    !comp
  )
    throw new Error("A completed, verified render job with unchanged dependencies is required");
  if (
    request.reviews.artifactSha256 !== entry.verification.sha256 ||
    (await fileDigest(item.outputPath)) !== entry.verification.sha256
  )
    throw new Error("Reviews or output do not match this exact rendered artifact");
  if ((await fileDigest(job.snapshot)) !== job.projectDigest)
    throw new Error("Saved render project changed");
  const verified = await verifyMedia(item.outputPath, {
    frames: item.endFrame - item.startFrame,
    fps: comp.fps,
    width: comp.width,
    height: comp.height,
    audio: item.audio,
  });
  if (!verified.passed) throw new Error(verified.blockers.join("; "));
  for (const dep of job.dependencies)
    if (dep.sha256 !== (await fileDigest(dep.path)))
      throw new Error("A linked source changed after rendering");
  const wip = request.wipDirectory;
  await mkdir(wip, { recursive: true });
  if ((await lstat(wip)).isSymbolicLink()) throw new Error("WIP must not be a symlink");
  const lock = path.join(wip, ".kynem-delivery.lock");
  if (!(await exclusiveClaim(lock, { jobId: request.renderJobId })))
    throw new Error("WIP delivery busy or interrupted; inspect its lock before retrying");
  try {
    const pointer = path.join(wip, ".kynem-current.json");
    const previous = (await lstat(pointer).catch(() => null))
      ? await readJson<{ currentFile: string; artifactSha256: string; version: string }>(pointer)
      : null;
    const currentFile = "current" + path.extname(item.outputPath).toLowerCase();
    const existingMovies = (await readdir(wip)).filter((f) => /\.(mp4|mov|webm|m4v)$/i.test(f));
    if (existingMovies.some((f) => f !== previous?.currentFile))
      throw new Error(
        "WIP contains unowned movie files; organize them explicitly before publishing",
      );
    if (
      previous &&
      (previous.currentFile !== currentFile ||
        previous.artifactSha256 !== (await fileDigest(path.join(wip, currentFile))))
    )
      throw new Error("Current delivery changed outside KYNEM or its format differs");
    const relativeVersion = path.join(
      "_versions",
      request.version + "-" + request.renderJobId + "-" + request.itemIndex,
    );
    const versionDir = path.join(wip, relativeVersion);
    if (
      previous?.artifactSha256 === verified.sha256 &&
      previous.version === request.version &&
      (await lstat(path.join(versionDir, "manifest.json")).catch(() => null))
    ) {
      const priorManifest = await readJson<{ renderJobId: string; itemIndex: number }>(
        path.join(versionDir, "manifest.json"),
      );
      if (
        priorManifest.renderJobId !== request.renderJobId ||
        priorManifest.itemIndex !== request.itemIndex
      )
        throw new Error("Existing delivery identity differs");
      return {
        currentPath: path.join(wip, currentFile),
        manifestPath: path.join(versionDir, "manifest.json"),
        projectPath: path.join(versionDir, "project.aep"),
        galleryPath: path.join(wip, "_review", "index.html"),
        artifactSha256: verified.sha256,
        alreadyPublished: true,
      };
    }
    await mkdir(path.dirname(versionDir), { recursive: true });
    await mkdir(versionDir); // Never overwrite an earlier version, including partial delivery.
    const movie = path.join(versionDir, currentFile),
      project = path.join(versionDir, "project.aep");
    await copyFile(item.outputPath, movie, constants.COPYFILE_EXCL);
    await copyFile(job.snapshot, project, constants.COPYFILE_EXCL);
    if (
      (await fileDigest(movie)) !== verified.sha256 ||
      (await fileDigest(project)) !== job.projectDigest
    )
      throw new Error("Delivery copies failed identity verification");
    const sources = [];
    if (request.collectSources) await mkdir(path.join(versionDir, "sources"));
    for (const [index, dep] of job.dependencies.entries()) {
      const collected = request.collectSources
        ? path.join("sources", `${index}-${path.basename(dep.path)}`)
        : null;
      if (collected) {
        await copyFile(dep.path, path.join(versionDir, collected), constants.COPYFILE_EXCL);
        if ((await fileDigest(path.join(versionDir, collected))) !== dep.sha256)
          throw new Error("Collected asset changed during copy");
      }
      sources.push({ ...dep, collected });
    }
    const manifest = {
      schemaVersion: 1,
      version: request.version,
      renderJobId: request.renderJobId,
      itemIndex: request.itemIndex,
      project: {
        file: "project.aep",
        sha256: job.projectDigest,
        originalSavedCopy: job.request.copyPath,
      },
      composition: comp,
      range: { startFrame: item.startFrame, endFrame: item.endFrame },
      render: { file: currentFile, sha256: verified.sha256 },
      sources,
      projectLinks: "AEP source paths retained; collected files are not automatically relinked",
      expressionDependencies: "unknown",
      verification: verified,
      reviews: request.reviews,
      provisional: request.provisional,
    };
    await atomicJson(path.join(versionDir, "manifest.json"), manifest);
    // The immutable version is complete before changing the current file.
    const staged = path.join(wip, ".current-" + request.renderJobId + path.extname(currentFile));
    await copyFile(movie, staged, constants.COPYFILE_EXCL);
    if ((await fileDigest(staged)) !== verified.sha256)
      throw new Error("Current copy verification failed");
    await rename(staged, path.join(wip, currentFile));
    await atomicJson(pointer, {
      currentFile,
      version: request.version,
      artifactSha256: verified.sha256,
      manifest: path.join(relativeVersion, "manifest.json"),
    });
    const gallery = path.join(wip, "_review");
    await mkdir(gallery, { recursive: true });
    const escapedVersion = request.version.replace(/</g, "&lt;");
    await writeFile(
      path.join(gallery, "index.html"),
      `<!doctype html><meta charset="utf-8"><title>Current delivery</title><style>body{font:18px system-ui;margin:32px;background:#181818;color:#eee}video{max-width:100%;max-height:80vh}a{color:#9df}</style><h1>${escapedVersion}</h1><video controls src="../${relativeVersion.replaceAll(path.sep, "/")}/${currentFile}"></video><p><a href="../${relativeVersion.replaceAll(path.sep, "/")}/manifest.json">Project, sources and verification</a></p>`,
    );
    return {
      currentPath: path.join(wip, currentFile),
      manifestPath: path.join(versionDir, "manifest.json"),
      projectPath: project,
      galleryPath: path.join(gallery, "index.html"),
      artifactSha256: verified.sha256,
    };
  } finally {
    await unlink(lock);
  }
}
