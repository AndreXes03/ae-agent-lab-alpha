import path from "node:path";
import { promises as fs } from "node:fs";
import { RUNTIME_DIR } from "../config.js";
import { allowedCategories, readOnlyMode } from "../policy.js";
import type { AeTransport } from "../transport/AeTransport.js";
import { WorkflowJobs, type WorkflowJob } from "../workflows/jobs.js";
import { WorkflowService } from "../workflows/service.js";
import { compileScene } from "./compile.js";
import { sceneRuntime, nativeScene } from "./native.js";

interface Options {
  transport: AeTransport;
  jobs?: WorkflowJobs;
  session?: Pick<WorkflowService, "validateSession">;
}
export class SceneService {
  private transport: AeTransport;
  private jobs: WorkflowJobs;
  private session: Pick<WorkflowService, "validateSession">;
  constructor(options: Options) {
    this.transport = options.transport;
    this.jobs = options.jobs ?? new WorkflowJobs(path.join(RUNTIME_DIR, "scene-jobs"));
    this.session = options.session ?? new WorkflowService({ transport: options.transport });
  }
  private async view(job: WorkflowJob) {
    const checkpointPath = path.join(
      path.dirname(job.payload.copyPath),
      `scene-${job.id}-before.aep`,
    );
    const checkpointCreated = (await fs.stat(checkpointPath).catch(() => null))?.isFile() === true;
    return {
      jobId: job.id,
      checkpointPath,
      checkpointCreated,
      state: job.state,
      summary: job.payload.summary,
      copyPath: job.payload.copyPath,
      result: job.result,
    };
  }
  async prepare(spec: unknown, copyPath: string, requestId: string) {
    const scene = nativeScene(compileScene(spec));
    const previous = await this.jobs.get(requestId);
    if (previous) {
      if (
        JSON.stringify(previous.payload.spec) !== JSON.stringify(scene) ||
        previous.payload.copyPath !== (await fs.realpath(copyPath))
      )
        throw new Error("Request id belongs to a different scene");
      return this.view(previous);
    }
    const { session, copy, runDir } = await this.session.validateSession(copyPath);
    const capture = await this.transport.execute({
      code: sceneRuntime,
      payload: { scene, mode: "capture", baselineDir: runDir, revision: requestId },
      instance: session.worker,
      undoGroup: false,
      label: "scene preflight",
      timeoutMs: 60000,
    });
    if (!capture.ok) throw new Error(capture.error ?? "Scene capture failed");
    const raw = capture.result as {
      snapshot: { projectPath: string };
      summary: { conflicts: string[] };
    };
    if (!raw?.snapshot || (await fs.realpath(raw.snapshot.projectPath)) !== copy)
      throw new Error("Scene capture differs from managed copy");
    return this.view(
      await this.jobs.createWithId(requestId, {
        recipe: "scene",
        spec: scene,
        snapshot: raw.snapshot,
        summary: raw.summary,
        copyPath: copy,
        instance: session.worker,
        captureCode: sceneRuntime,
        mutationCode: sceneRuntime,
      }),
    );
  }
  async status(id: string) {
    const job = await this.jobs.get(id);
    if (!job) throw new Error("Unknown scene job");
    return this.view(job);
  }
  async apply(id: string) {
    const job = await this.jobs.get(id);
    if (!job) throw new Error("Unknown scene job");
    if (job.state !== "prepared") return this.view(job);
    if (readOnlyMode()) throw new Error("Scene apply disabled in read-only mode");
    const allowed = allowedCategories(),
      required = ["project", "comp", "layer", "shape", "text", "keyframe", "transform"];
    if (allowed && required.some((c) => !allowed.has(c)))
      throw new Error("Scene requires allowed categories: " + required.join(", "));
    if ((job.payload.summary as { conflicts: string[] }).conflicts.length)
      throw new Error("Resolve scene conflicts before preparing again");
    const { session, runDir } = await this.session.validateSession(job.payload.copyPath);
    if (session.worker !== job.payload.instance) throw new Error("Scene worker changed");
    const claim = await this.jobs.claim(id);
    if (!claim.claimed) return this.view(claim.job);
    const checkpoint = path.join(path.dirname(job.payload.copyPath), `scene-${id}-before.aep`);
    const code = `var result={ok:false},state="failed";try {
      payload.mode="capture";var current=(function(){${sceneRuntime}})();
      if(JSON.stringify(current.snapshot)!==JSON.stringify(payload.snapshot)||current.summary.conflicts.length)throw new Error("Prepared scene changed; no mutation applied");
      app.project.save();var source=new File(${JSON.stringify(job.payload.copyPath)}),checkpoint=new File(${JSON.stringify(checkpoint)});
      if(!source.exists||checkpoint.exists||!source.copy(checkpoint.fsName))throw new Error("Scene checkpoint failed");
      payload.mode="apply";result=(function(){${sceneRuntime}})();if(!result||!result.ok)throw new Error("Scene mutation failed");app.project.save();result.checkpointPath=${JSON.stringify(checkpoint)};state="succeeded";
    }catch(e){result={ok:false,error:String(e.message||e)};}finally{var receipt=new File(${JSON.stringify(this.jobs.receiptPath(id))});receipt.encoding="UTF-8";if(!receipt.open("w"))throw new Error("Scene receipt failed");receipt.write(JSON.stringify({jobId:${JSON.stringify(id)},state:state,result:result}));receipt.close();}return result;`;
    try {
      const response = await this.transport.execute({
        code,
        payload: {
          scene: job.payload.spec,
          snapshot: job.payload.snapshot,
          baselineDir: runDir,
          revision: id,
        },
        instance: session.worker,
        label: "scene apply",
        timeoutMs: 120000,
      });
      const receipt = await this.jobs.get(id);
      if (receipt && (receipt.state === "succeeded" || receipt.state === "failed"))
        return this.view(receipt);
      return this.view(
        await this.jobs.finish(id, "uncertain", {
          error: response.error ?? "Receipt missing; inspect status",
        }),
      );
    } catch (e) {
      return this.view(await this.jobs.finish(id, "uncertain", { error: String(e) }));
    }
  }
}
