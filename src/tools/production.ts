import { deliveryRequest, publishDelivery } from "../production/delivery.js";
import { recipeRequest, saveRecipe } from "../production/recipes.js";
import { anchorRequest, mapAnchor } from "../production/anchors.js";
import { readOnlyMode, allowedCategories } from "../policy.js";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { defineTool, jsonResult } from "./define-tool.js";
import { errorResult } from "../errors.js";
import { preflightProject, requireLocal } from "../production/preflight.js";
import {
  renderCapture,
  renderRequest,
  startRenderJob,
  renderJobStatus,
  cancelRenderJob,
} from "../production/render-jobs.js";
import { createMotionReview, motionReviewRequest } from "../production/motion-review.js";
import { fileDigest, verifyMedia, masterReferenceAudio } from "../production/media.js";
import { WorkflowService } from "../workflows/service.js";

const guard = async (fn: () => Promise<Record<string, unknown>>) => {
  try {
    const payload = await fn();
    const failed =
      payload.passed === false ||
      payload.state === "failed" ||
      payload.state === "unknown" ||
      payload.state === "cancelled";
    return { ...jsonResult({ ...payload, ok: !failed }), isError: failed };
  } catch (e) {
    return errorResult("OPERATION_FAILED", String(e));
  }
};
export const mediaPreflightTool = defineTool({
  name: "ae_media_preflight",
  title: "Inspect source availability before opening AE",
  description:
    "Metadata-only inventory of a saved project and its optional .kynem-media.json dependency manifest. Distinguishes local, cloud-placeholder, missing and unknown. Does not hydrate, hash or open media. Unknown AEP dependencies remain explicit.",
  group: "inspect",
  blockedInReadOnly: false,
  effect: "read",
  inputShape: { project: z.string(), manifestPath: z.string().optional() },
  handler: async ({ project, manifestPath }) =>
    guard(() => preflightProject(project, manifestPath)),
});
export const dependencyManifestTool = defineTool({
  name: "ae_dependency_manifest",
  title: "Save a dependency inventory for the managed project",
  description:
    "Inspect an already-open, saved managed copy and save its footage/proxy inventory beside the AEP for future non-hydrating preflight. Never claims to discover expression-generated dependencies.",
  group: "document",
  blockedInReadOnly: false,
  effect: "write",
  inputShape: { copyPath: z.string() },
  handler: async ({ copyPath }, transport) =>
    guard(async () => {
      await new WorkflowService({ transport }).validateSession(copyPath);
      const before = await requireLocal(copyPath),
        digest = await fileDigest(copyPath);
      const read = await transport.execute({
        code: renderCapture({ requestId: randomUUID(), copyPath, items: [] }),
        undoGroup: false,
        label: "dependency inventory",
      });
      const result = read.result as { ok: boolean; dependencies: string[]; error?: string };
      if (!read.ok || !result?.ok)
        throw new Error(result?.error || read.error || "Dependency capture failed");
      if (digest !== (await fileDigest(copyPath)))
        throw new Error("Project changed during inventory");
      const manifestPath = copyPath + ".kynem-media.json";
      const value = {
        schemaVersion: 1,
        project: { path: copyPath, bytes: before.bytes, mtimeMs: before.mtimeMs },
        dependencies: [...new Set(result.dependencies)],
        coverage: "footage-and-proxies",
        expressionDependencies: "unknown",
      };
      // Export is explicit; preserve an earlier inventory rather than silently overwriting it.
      await writeFile(manifestPath, JSON.stringify(value, null, 2), { flag: "wx" });
      return {
        manifestPath,
        dependencies: value.dependencies.length,
        expressionDependencies: "unknown",
      };
    }),
});
const renderAction = z.discriminatedUnion("action", [
  renderRequest.extend({ action: z.literal("start") }),
  z.strictObject({ action: z.literal("status"), requestId: z.uuid() }),
  z.strictObject({ action: z.literal("cancel"), requestId: z.uuid() }),
]);
export const renderJobTool = defineTool({
  name: "ae_render_job",
  title: "Start or recover a background render",
  description:
    "Persistently render 1–8 explicit comp ranges from a saved managed AEP snapshot in a separate aerender process. Supply exact local templates, audio intent and a fresh UUID per intended job. Same UUID on retry/status, including after disconnection. Output verification and optional variable-density motion reviews run after rendering. No live JSX polling, no reuse of the editing AE instance.",
  group: "render",
  blockedInReadOnly: false,
  effect: "write",
  inputShape: { request: renderAction },
  handler: async ({ request }, transport) =>
    guard(async () => {
      if (request.action === "status") return { ...(await renderJobStatus(request.requestId)) };
      if (request.action === "cancel") {
        if (readOnlyMode() || (allowedCategories() && !allowedCategories()!.has("render")))
          throw new Error("Render cancellation disabled by policy");
        return cancelRenderJob(request.requestId);
      }
      const { action: _action, ...spec } = request;
      return { ...(await startRenderJob(spec, transport)) };
    }),
});
export const motionReviewTool = defineTool({
  name: "ae_motion_review",
  title: "Create a measured motion review package",
  description:
    "From an existing local rendered video, produce a player with audio, contextual feedback, variable-density frame grid, actual decoded PTS and relevant supplied layer targets. Composition binding is explicit; Main/precomp time remains unbound unless a known mapping is supplied. Does not mark playback or listening approved.",
  group: "render",
  blockedInReadOnly: false,
  effect: "write",
  inputShape: { request: motionReviewRequest },
  handler: async ({ request }) => guard(() => createMotionReview(request)),
});
export const mediaVerifyTool = defineTool({
  name: "ae_media_verify",
  title: "Decode and inspect the rendered media",
  description:
    "Verify the actual local movie: full decode, frame count, dimensions, FPS/PTS, audio continuity and boundaries. Optional audio reference compares encoded packets and timestamps. Numerical checks do not establish perceived sync or listening approval. Requires FFmpeg and ffprobe.",
  group: "inspect",
  blockedInReadOnly: false,
  effect: "read",
  inputShape: {
    path: z.string(),
    expected: z.strictObject({
      frames: z.number().int().positive().optional(),
      fps: z.number().positive().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      audio: z.enum(["required", "intentional-none"]),
      referenceAudio: z.string().optional(),
    }),
  },
  handler: async ({ path: file, expected }) => guard(() => verifyMedia(file, expected)),
});

export const deliveryPublishTool = defineTool({
  name: "ae_delivery_publish",
  title: "Publish one verified current WIP delivery",
  description:
    "Collect a completed render job, its exact AEP snapshot, source inventory and exact-artifact frame/playback/audio reviews into a versioned local package. Verify copies before atomically replacing the one current movie in WIP. Preserve previous versions. Refuse unowned movies; never claims relinking or aesthetic approval.",
  group: "document",
  blockedInReadOnly: true,
  effect: "write",
  inputShape: { request: deliveryRequest },
  handler: async ({ request }) =>
    guard(async () => {
      if (readOnlyMode()) throw new Error("Delivery publication disabled in read-only mode");
      return publishDelivery(request);
    }),
});
export const sceneRecipeTool = defineTool({
  name: "ae_scene_recipe",
  title: "Prepare an editable motion recipe",
  description:
    "Generate a bounded native scene JSON for locate/enlarge/explain/recompose, comparison or split-screen. Groups share progress with their labels. Declares editable material slots, external materials, spoken interval and unreviewed status. Apply through ae_scene to a managed copy, then review real playback; does not invent medical content or approve quality.",
  group: "document",
  blockedInReadOnly: false,
  effect: "write",
  inputShape: { request: recipeRequest },
  handler: async ({ request }) => guard(() => saveRecipe(request)),
});
export const anchorMapTool = defineTool({
  name: "ae_anchor_map",
  title: "Map an annotation through inspected 2D spaces",
  description:
    "Convert a pixel/normalized source anchor through an explicit sequence of inspected layer/precomp/Main 2D transforms at one sample time. Reports each space; semantic landmark alignment and unsupported 3D remain unverified.",
  group: "inspect",
  blockedInReadOnly: false,
  effect: "read",
  inputShape: { request: anchorRequest },
  handler: async ({ request }) => guard(async () => mapAnchor(request)),
});

export const audioMasterTool = defineTool({
  name: "ae_audio_master",
  title: "Preserve verified reference audio in a visual revision",
  description:
    "Create a new movie by copying the video and reference audio streams without an offset or re-encoding. Requires the reference artifact SHA-256, verifies output decoding, frame count, boundaries and identical audio packet payload/timestamps. Does not listen or approve perceptual sync.",
  group: "render",
  blockedInReadOnly: false,
  effect: "write",
  inputShape: {
    video: z.string(),
    referenceAudio: z.string(),
    referenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    outputPath: z.string(),
  },
  handler: async ({ video, referenceAudio, referenceSha256, outputPath }) =>
    guard(() => masterReferenceAudio(video, referenceAudio, referenceSha256, outputPath)),
});
