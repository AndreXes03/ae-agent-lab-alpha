import { z } from "zod";
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createLocalReview } from "../local-review.js";
import { analyzeProbe, fileDigest, mediaCommand, mediaExecutables, probeMedia } from "./media.js";
import { reviewWindow } from "./render-jobs.js";

export const motionReviewRequest = z.strictObject({
  video: z.string(),
  outputDir: z.string(),
  context: z.strictObject({
    compId: z.number().int().positive(),
    compName: z.string().min(1),
    fps: z.number().positive(),
    startFrame: z.number().int().nonnegative(),
    version: z.string().min(1),
    mainStartSeconds: z.number().finite().optional(),
    precompMapping: z
      .strictObject({ offsetSeconds: z.number().finite(), rate: z.number().finite() })
      .optional(),
  }),
  windows: z.array(reviewWindow).min(1).max(8),
  targets: z
    .array(
      z.strictObject({
        layerId: z.number().int().positive(),
        name: z.string().max(200),
        inPoint: z.number(),
        outPoint: z.number(),
      }),
    )
    .max(500)
    .default([]),
});
export type MotionReviewRequest = z.infer<typeof motionReviewRequest>;
export function selectReviewFrames(count: number, windows: MotionReviewRequest["windows"]) {
  const frames = new Set<number>();
  for (const w of windows) {
    if (w.endFrame <= w.startFrame || w.endFrame > count)
      throw new Error("Review window exceeds decoded video frames");
    for (let n = w.startFrame; n < w.endFrame; n += w.stepFrames) frames.add(n);
    frames.add(w.endFrame - 1);
  }
  if (frames.size > 120)
    throw new Error("Limit review grids to 120 samples; narrow the windows or increase stepFrames");
  return [...frames].sort((a, b) => a - b);
}
const html = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
export async function createMotionReview(raw: unknown) {
  const request = motionReviewRequest.parse(raw);
  if (!path.isAbsolute(request.video) || !path.isAbsolute(request.outputDir))
    throw new Error("Absolute review paths required");
  const digest = await fileDigest(request.video);
  const manifestFile = path.join(
    path.dirname(request.outputDir),
    "." + path.basename(request.outputDir) + "-input.json",
  );
  await writeFile(manifestFile, JSON.stringify({ video: request.video, ...request.context }), {
    flag: "wx",
  });
  const indexPath = await createLocalReview([
    "--manifest",
    manifestFile,
    "--out",
    request.outputDir,
  ]);
  const videoName = "video" + path.extname(request.video).toLowerCase();
  const reviewVideo = path.join(request.outputDir, videoName);
  if (digest !== (await fileDigest(reviewVideo)) || digest !== (await fileDigest(request.video)))
    throw new Error("Video changed while copying review; discard this incomplete review");
  const analyzed = analyzeProbe(await probeMedia(reviewVideo));
  if (!analyzed.video?.monotonic)
    throw new Error("Cannot map missing/nonmonotonic video timestamps");
  const samples = selectReviewFrames(analyzed.pts.length, request.windows);
  const framesDir = path.join(request.outputDir, "frames");
  await mkdir(framesDir);
  const results = [];
  for (const frame of samples) {
    const actualPts = analyzed.pts[frame],
      localSeconds = actualPts - analyzed.pts[0];
    const filename = `frames/frame-${frame}.png`;
    await mediaCommand(mediaExecutables().ffmpeg, [
      "-v",
      "error",
      "-i",
      reviewVideo,
      "-vf",
      `select=eq(n\\,${frame}),scale=480:-1`,
      "-frames:v",
      "1",
      "-fps_mode",
      "vfr",
      "-n",
      path.join(request.outputDir, filename),
    ]);
    const compSeconds = request.context.startFrame / request.context.fps + localSeconds;
    results.push({
      decodedFrame: frame,
      requestedFrame: frame,
      actualPts,
      localSeconds,
      compSeconds,
      compFrame: compSeconds * request.context.fps,
      mainSeconds:
        request.context.mainStartSeconds === undefined
          ? null
          : request.context.mainStartSeconds + localSeconds,
      precompSeconds: request.context.precompMapping
        ? request.context.precompMapping.offsetSeconds +
          localSeconds * request.context.precompMapping.rate
        : null,
      filename,
      targets: request.targets.filter((t) => t.inPoint <= compSeconds && t.outPoint > compSeconds),
    });
  }
  if (digest !== (await fileDigest(reviewVideo)))
    throw new Error("Review video changed during frame extraction");
  const report = {
    schemaVersion: 1,
    artifactSha256: digest,
    context: request.context,
    sourceTiming: "Composition binding supplied by caller; decoded frame/PTS measured from video",
    samples: results,
    warnings: analyzed.warnings,
    playbackReviewed: false,
    audioReviewed: false,
  };
  await writeFile(
    path.join(request.outputDir, "motion-review.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    path.join(request.outputDir, "grid.html"),
    `<!doctype html><meta charset="utf-8"><title>Motion review</title>
<style>body{font:16px system-ui;background:#161616;color:#eee;margin:24px}a{color:#9df}video{width:min(100%,760px);max-height:65vh}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}figure{margin:0;background:#252525;padding:12px}img{width:100%}button{background:none;border:0;color:inherit;text-align:left;cursor:pointer}small{display:block;line-height:1.5}</style>
<h1>${html(request.context.compName)} · ${html(request.context.version)}</h1>
<p><a href="index.html">Open contextual comments</a> · Rendered frames and measured timestamps. Playback and listening require review.</p>
<video id="clip" controls preload="metadata" src="${html(videoName)}"></video>
<section>${results
      .map(
        (
          s,
        ) => `<figure><button data-time="${s.localSeconds}"><img src="${s.filename}" alt="Decoded frame ${s.decodedFrame}">
<small>Decoded frame ${s.decodedFrame} · PTS ${s.actualPts.toFixed(6)} s<br>Composition ${s.compSeconds.toFixed(6)} s
<br>Main ${s.mainSeconds === null ? "unbound" : s.mainSeconds.toFixed(6) + " s"} · Precomp ${s.precompSeconds === null ? "unbound" : s.precompSeconds.toFixed(6) + " s"}
<br>${html(s.targets.map((t) => t.name).join(", "))}</small></button></figure>`,
      )
      .join("")}</section>
<script>document.querySelectorAll('[data-time]').forEach(function(b){b.onclick=function(){var v=document.getElementById('clip');v.currentTime=Number(b.dataset.time);v.scrollIntoView({block:'center'});};});</script>`,
  );
  const index = await readFile(indexPath, "utf8");
  await writeFile(
    indexPath,
    index.replace(
      "<body>",
      '<body><a href="grid.html" style="display:block;padding:12px;color:inherit">Frame grid · measured timestamps</a>',
    ),
  );
  return {
    indexPath,
    gridPath: path.join(request.outputDir, "grid.html"),
    reportPath: path.join(request.outputDir, "motion-review.json"),
    sampleCount: results.length,
    playbackReviewed: false,
    audioReviewed: false,
  };
}
