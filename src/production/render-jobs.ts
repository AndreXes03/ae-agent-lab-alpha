import { z } from "zod";
import path from "node:path";
import { copyFile, lstat, mkdir, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RUNTIME_DIR, rejectedOutputPath } from "../config.js";
import { allowedCategories, readOnlyMode } from "../policy.js";
import { jsxVal } from "../registry.js";
import type { AeTransport } from "../transport/AeTransport.js";
import { WorkflowService } from "../workflows/service.js";
import { requireLocal } from "./preflight.js";
import { fileDigest, mediaCommand, mediaExecutables } from "./media.js";
import { atomicJson, exclusiveClaim, privateDirectory, readJson } from "./storage.js";

export const reviewWindow = z.strictObject({
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  stepFrames: z.number().int().min(1).max(10000),
});
export const renderRequest = z.strictObject({
  requestId: z.uuid(),
  copyPath: z.string().min(1),
  items: z
    .array(
      z.strictObject({
        compId: z.number().int().positive(),
        startFrame: z.number().int().nonnegative(),
        endFrame: z.number().int().positive(),
        outputPath: z.string().min(1),
        outputTemplate: z.string().min(1),
        renderTemplate: z.string().min(1),
        audio: z.enum(["required", "intentional-none"]),
        reviewWindows: z.array(reviewWindow).max(8).optional(),
      }),
    )
    .min(1)
    .max(8),
});
export type RenderRequest = z.infer<typeof renderRequest>;
export interface RenderComp {
  compId: number;
  compName: string;
  fps: number;
  width: number;
  height: number;
  displayStartFrame: number;
  targets: Array<{ layerId: number; name: string; inPoint: number; outPoint: number }>;
}
export interface RenderManifest {
  schemaVersion: 1;
  request: RenderRequest;
  snapshot: string;
  projectDigest: string;
  dependencyCoverage?: "selected-composition-layer-graph";
  expressionDependencies?: "unknown";
  dependencies: Array<{ path: string; sha256: string }>;
  comps: RenderComp[];
  aerender: string;
}
export type RenderState = "queued" | "started" | "completed" | "failed" | "cancelled" | "unknown";
export interface RenderItemStatus {
  state: RenderState;
  outputPath: string;
  progress: { renderedFrame: number | null; totalFrames: number };
  error?: string;
  verification?: Awaited<ReturnType<typeof import("./media.js").verifyMedia>>;
  reviewPath?: string;
}
export interface RenderStatus {
  id: string;
  state: RenderState;
  updatedAt: string;
  workerPid?: number;
  renderPid?: number;
  items: RenderItemStatus[];
  error?: string;
  dependenciesUnchanged?: boolean;
}
export const renderRoot = () => path.join(RUNTIME_DIR, "render-jobs");
export function jobDirectory(root: string, id: string) {
  z.uuid().parse(id);
  return path.join(root, id);
}

export function renderCapture(request: RenderRequest) {
  return `
var spec=${jsxVal(request)};
if(!app.project.file || app.project.file.fsName!==spec.copyPath) return {ok:false,error:"Managed project changed"};
if(app.project.dirty) return {ok:false,error:"Save the managed copy before rendering"};
if(app.project.numItems>10000) return {ok:false,error:"Project dependency scan exceeds 10000 items"};
var deps=[],comps=[],visited={},scannedLayers=0;
function visit(item) {
 if(!item||visited[item.id])return;visited[item.id]=true;
 if(item instanceof FootageItem && item.file) deps.push(item.file.fsName);
 if((item instanceof FootageItem || item instanceof CompItem) && item.proxySource && item.proxySource.file) deps.push(item.proxySource.file.fsName);
 if(item instanceof FootageItem && item.footageMissing) throw new Error("Missing footage: "+item.name);
 if(item instanceof CompItem) for(var li=1;li<=item.numLayers;li++) {
  if(++scannedLayers>10000)throw new Error("Dependency layer budget exceeded");
  visit(item.layer(li).source);
 }
}
if(!spec.items.length)for(var p=1;p<=app.project.numItems;p++)visit(app.project.item(p));
for(var i=0;i<spec.items.length;i++) {
  var req=spec.items[i], comp=AE.findItemById(req.compId);
  if(!comp || !(comp instanceof CompItem)) return {ok:false,error:"Composition missing"};
  for(var j=1;j<=app.project.numItems;j++) {
    var other=app.project.item(j);
    if(other instanceof CompItem && other.id!==comp.id && other.name===comp.name) return {ok:false,error:"aerender requires an unambiguous composition name"};
  }
  if(req.endFrame<=req.startFrame || req.endFrame/comp.frameRate>comp.duration+0.00001) return {ok:false,error:"Invalid render range"};
  if(comp.numLayers>500) return {ok:false,error:"Review targets exceed 500 layers"};
  var targets=[];
  for(var k=1;k<=comp.numLayers;k++) {
    var layer=comp.layer(k);
    if(layer.outPoint>req.startFrame/comp.frameRate && layer.inPoint<req.endFrame/comp.frameRate)
      targets.push({layerId:layer.id,name:layer.name,inPoint:layer.inPoint,outPoint:layer.outPoint});
  }
  visit(comp);
  comps.push({compId:comp.id,compName:comp.name,fps:comp.frameRate,width:comp.width,height:comp.height,displayStartFrame:Math.round(comp.displayStartTime*comp.frameRate),targets:targets});
}
return {ok:true,dependencies:deps,comps:comps};
`;
}

export async function locateAerender() {
  if (process.env.KYNEM_AERENDER) return process.env.KYNEM_AERENDER;
  if (process.platform === "darwin") {
    const dirs = (await readdir("/Applications"))
      .filter((d) => /^Adobe After Effects \d+$/.test(d))
      .sort()
      .reverse();
    for (const d of dirs) {
      const candidate = path.join("/Applications", d, "aerender");
      if ((await lstat(candidate).catch(() => null))?.isFile()) return candidate;
    }
  }
  throw new Error("Set KYNEM_AERENDER to the installed Adobe aerender executable");
}

export async function renderJobStatus(id: string, root = renderRoot()): Promise<RenderStatus> {
  const dir = jobDirectory(root, id);
  const status = await readJson<RenderStatus>(path.join(dir, "status.json"));
  if (
    (status.state === "queued" || status.state === "started") &&
    Date.now() - Date.parse(status.updatedAt) > 15_000
  ) {
    return {
      ...status,
      state: "unknown",
      error: "Supervisor heartbeat stale. Do not relaunch; inspect this job and its output.",
    };
  }
  return status;
}
export async function cancelRenderJob(id: string, root = renderRoot()) {
  const dir = jobDirectory(root, id);
  const status = await renderJobStatus(id, root);
  if (!["completed", "failed", "cancelled"].includes(status.state))
    await exclusiveClaim(path.join(dir, "cancel.json"), { requestedAt: new Date().toISOString() });
  return { ...status, cancelRequested: true };
}
export async function startRenderJob(raw: unknown, transport: AeTransport, root = renderRoot()) {
  const request = renderRequest.parse(raw);
  for (const item of request.items) {
    if (item.endFrame <= item.startFrame) throw new Error("Invalid render range");
    const frames = new Set<number>();
    for (const w of item.reviewWindows ?? []) {
      if (w.endFrame <= w.startFrame || w.endFrame > item.endFrame - item.startFrame)
        throw new Error("Review window exceeds requested render frames");
      if (Math.ceil((w.endFrame - w.startFrame) / w.stepFrames) > 120)
        throw new Error("Limit review grids to 120 samples");
      for (let n = w.startFrame; n < w.endFrame; n += w.stepFrames) frames.add(n);
      frames.add(w.endFrame - 1);
    }
    if (frames.size > 120) throw new Error("Limit review grids to 120 samples");
  }
  const dir = jobDirectory(root, request.requestId);
  if (await lstat(dir).catch(() => null)) {
    const manifest = await readJson<RenderManifest>(path.join(dir, "manifest.json"));
    if (JSON.stringify(manifest.request) !== JSON.stringify(request))
      throw new Error("requestId belongs to a different render");
    return renderJobStatus(request.requestId, root);
  }
  if (readOnlyMode()) throw new Error("Background rendering disabled in read-only mode");
  const allowed = allowedCategories();
  if (allowed && (!allowed.has("render") || !allowed.has("project")))
    throw new Error("Render and project categories required");
  await new WorkflowService({ transport }).validateSession(request.copyPath);
  await requireLocal(request.copyPath);
  const executables = mediaExecutables();
  await Promise.all([
    mediaCommand(executables.ffmpeg, ["-version"]),
    mediaCommand(executables.ffprobe, ["-version"]),
  ]);
  const aerender = await locateAerender();
  const before = await fileDigest(request.copyPath);
  const capture = await transport.execute({
    code: renderCapture(request),
    undoGroup: false,
    label: "render snapshot preflight",
  });
  const data = capture.result as {
    ok: boolean;
    error?: string;
    comps: RenderComp[];
    dependencies: string[];
  };
  if (!capture.ok || !data?.ok)
    throw new Error(data?.error || capture.error || "Render capture failed");
  const dependencyPaths = [...new Set(data.dependencies)];
  const dependencies = [];
  for (const file of dependencyPaths)
    dependencies.push({ path: file, sha256: await fileDigest(file) });
  const paths = new Set<string>();
  for (const item of request.items) {
    if (
      !path.isAbsolute(item.outputPath) ||
      rejectedOutputPath(item.outputPath) ||
      !/\.(mov|mp4|m4v|webm)$/i.test(item.outputPath)
    )
      throw new Error("Use a new absolute movie output path outside the bridge mailbox");
    if (paths.has(item.outputPath)) throw new Error("Render outputs must be distinct");
    paths.add(item.outputPath);
    if (await lstat(item.outputPath).catch(() => null))
      throw new Error("Render output already exists");
  }
  await privateDirectory(root);
  await mkdir(dir, { mode: 0o700 });
  const snapshot = path.join(dir, "project.aep");
  await copyFile(request.copyPath, snapshot, constants.COPYFILE_EXCL);
  if (before !== (await fileDigest(snapshot)) || before !== (await fileDigest(request.copyPath)))
    throw new Error("Project changed while creating render snapshot; job will not launch");
  const manifest: RenderManifest = {
    schemaVersion: 1,
    request,
    snapshot,
    projectDigest: before,
    dependencyCoverage: "selected-composition-layer-graph",
    expressionDependencies: "unknown",
    dependencies,
    comps: data.comps,
    aerender,
  };
  await atomicJson(path.join(dir, "manifest.json"), manifest);
  const status: RenderStatus = {
    id: request.requestId,
    state: "queued",
    updatedAt: new Date().toISOString(),
    items: request.items.map((item) => ({
      state: "queued",
      outputPath: item.outputPath,
      progress: { renderedFrame: null, totalFrames: item.endFrame - item.startFrame },
    })),
  };
  await atomicJson(path.join(dir, "status.json"), status);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./render-worker.js", import.meta.url)), dir],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  return status;
}
