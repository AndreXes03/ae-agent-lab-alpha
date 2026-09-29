/** Prepare and apply bounded recipes only in the managed disposable AE session. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { RUNTIME_DIR } from "../config.js";
import { allowedCategories, readOnlyMode } from "../policy.js";
import type { AeTransport } from "../transport/AeTransport.js";
import { instanceDirFor } from "../config.js";
import { readInstance, type InstanceInfo } from "../transport/instances.js";
import { WorkflowJobs, type WorkflowJob, type WorkflowJobState } from "./jobs.js";
import { captureRetime, prepareRetime, retimeSpec } from "./retime.js";
import {
  captureVariants,
  prepareVariants,
  variantsSpec,
  type VariantsSnapshot,
} from "./variants.js";

export type WorkflowRecipe = "retime_properties" | "variants";
export interface WorkflowPublicStatus {
  id: string;
  state: WorkflowJobState;
  recipe: string;
  summary: unknown;
  copyPath: string;
  checkpointPath?: string;
  checkpointCreated?: boolean;
  result?: Record<string, unknown>;
}

export interface Session {
  phase: string;
  worker: string;
  runtime: string;
  input: string;
  project: string;
  runDir: string;
}

interface Options {
  transport: AeTransport;
  sessionPath?: string;
  jobs?: WorkflowJobs;
  /** Test seam for the resident worker heartbeat; production reads its mailbox. */
  readWorker?: (worker: string) => Promise<InstanceInfo>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function publicStatus(job: WorkflowJob): WorkflowPublicStatus {
  const raw = isRecord(job.result) ? job.result : undefined;
  const result = raw
    ? {
        ...(typeof raw.ok === "boolean" ? { ok: raw.ok } : {}),
        ...(typeof raw.error === "string" ? { error: raw.error.slice(0, 500) } : {}),
        ...(typeof raw.changedTracks === "number" ? { changedTracks: raw.changedTracks } : {}),
        ...(Array.isArray(raw.variants)
          ? {
              variants: raw.variants.map((value) =>
                isRecord(value)
                  ? { name: value.name, compId: value.compId, compName: value.compName }
                  : null,
              ),
            }
          : {}),
      }
    : undefined;
  return {
    id: job.id,
    state: job.state,
    recipe: job.payload.recipe,
    summary: job.payload.summary,
    copyPath: job.payload.copyPath,
    ...(result ? { result } : {}),
  };
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function jsxLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export class WorkflowService {
  private readonly transport: AeTransport;
  private readonly sessionPath: string;
  private readonly jobs: WorkflowJobs;
  private readonly readWorker: (worker: string) => Promise<InstanceInfo>;

  constructor(options: Options) {
    this.transport = options.transport;
    this.sessionPath = options.sessionPath ?? path.join(RUNTIME_DIR, "session.json");
    this.jobs = options.jobs ?? new WorkflowJobs(path.join(RUNTIME_DIR, "workflow-jobs"));
    this.readWorker = options.readWorker ?? ((worker) => readInstance(instanceDirFor(worker)));
  }

  private async view(job: WorkflowJob): Promise<WorkflowPublicStatus> {
    const output = publicStatus(job);
    if (job.state !== "prepared") {
      const checkpointPath = path.join(
        path.dirname(job.payload.copyPath),
        `workflow-${job.id}-before.aep`,
      );
      output.checkpointPath = checkpointPath;
      output.checkpointCreated =
        (await fs.stat(checkpointPath).catch(() => null))?.isFile() === true;
    }
    return output;
  }

  private policy(recipe: WorkflowRecipe): void {
    if (readOnlyMode()) throw new Error("Workflow apply is disabled by AE_MCP_READONLY=1");
    const allowed = allowedCategories();
    const required =
      recipe === "retime_properties"
        ? ["project", "keyframe"]
        : ["project", "comp", "layer", "footage", "text"];
    if (allowed && required.some((category) => !allowed.has(category)))
      throw new Error(`Workflow requires allowed categories: ${required.join(", ")}`);
  }

  async validateSession(
    copyPath: string,
  ): Promise<{ session: Session; copy: string; runDir: string }> {
    return this.session(copyPath);
  }

  private async session(
    copyPath: string,
  ): Promise<{ session: Session; copy: string; runDir: string }> {
    const raw = JSON.parse(await fs.readFile(this.sessionPath, "utf8")) as Session;
    if (
      !raw ||
      raw.phase !== "ready" ||
      !raw.worker ||
      !raw.input ||
      !raw.project ||
      !raw.runDir ||
      typeof raw.runtime !== "string"
    )
      throw new Error("Managed demo session is missing or not ready");
    if ((await fs.realpath(raw.runtime)) !== (await fs.realpath(path.dirname(this.sessionPath))))
      throw new Error("Managed session runtime differs from its record path");
    const [runDir, copy, input] = await Promise.all([
      fs.realpath(raw.runDir),
      fs.realpath(copyPath),
      fs.realpath(raw.input),
    ]);
    if (!inside(runDir, copy)) throw new Error("Copy is not inside the managed run folder");
    const [copyInfo, inputInfo] = await Promise.all([fs.stat(copy), fs.stat(input)]);
    if (
      !copyInfo.isFile() ||
      !inputInfo.isFile() ||
      (copyInfo.dev === inputInfo.dev && copyInfo.ino === inputInfo.ino)
    )
      throw new Error("Managed project is not an independent copy");
    const worker = await this.readWorker(raw.worker);
    if (
      !worker.alive ||
      worker.id !== raw.worker ||
      !worker.heartbeat?.project ||
      (await fs.realpath(worker.heartbeat.project).catch(() => "")) !== copy
    )
      throw new Error("Managed AE worker is not live on the copied project");
    if (this.transport.describeTarget) {
      const target = await this.transport.describeTarget();
      if (target.mode !== "pull" || target.instance.id !== raw.worker)
        throw new Error("Transport is bound to another AE instance or push mode");
    }
    return { session: raw, copy, runDir };
  }

  async prepare(
    recipe: WorkflowRecipe,
    specInput: unknown,
    copyPath: string,
  ): Promise<WorkflowPublicStatus> {
    if (recipe !== "retime_properties" && recipe !== "variants")
      throw new Error("Unsupported workflow recipe");
    const spec =
      recipe === "retime_properties" ? retimeSpec.parse(specInput) : variantsSpec.parse(specInput);
    const { session, copy } = await this.session(copyPath);
    const captureCode =
      recipe === "retime_properties"
        ? captureRetime(spec as Parameters<typeof captureRetime>[0])
        : captureVariants(spec as Parameters<typeof captureVariants>[0]);
    const capture = await this.transport.execute({
      code: captureCode,
      label: `workflow prepare ${recipe}`,
      instance: session.worker,
      undoGroup: false,
      timeoutMs: 60_000,
    });
    if (!capture.ok)
      throw new Error(
        `Workflow capture failed: ${capture.error ?? capture.errorCode ?? "unknown"}`,
      );
    if (
      !isRecord(capture.result) ||
      typeof capture.result.projectPath !== "string" ||
      (await fs.realpath(capture.result.projectPath).catch(() => "")) !== copy
    )
      throw new Error("AE capture is not from the managed copied project");
    const prepared =
      recipe === "retime_properties"
        ? prepareRetime(spec as Parameters<typeof prepareRetime>[0], capture.result)
        : prepareVariants(
            spec as Parameters<typeof prepareVariants>[0],
            capture.result as unknown as VariantsSnapshot,
          );
    const job = await this.jobs.create({
      recipe,
      spec,
      snapshot: capture.result,
      summary: prepared.summary,
      copyPath: copy,
      instance: session.worker,
      captureCode,
      mutationCode: prepared.mutationCode,
    });
    return this.view(job);
  }

  private applyCode(job: WorkflowJob, checkpoint: string): string {
    const copy = jsxLiteral(job.payload.copyPath);
    const checkpointLiteral = jsxLiteral(checkpoint);
    const receipt = jsxLiteral(this.jobs.receiptPath(job.id));
    const jobId = jsxLiteral(job.id);
    return `
var _workflowResult = {ok:false,error:"Workflow did not complete"};
var _workflowState = "failed";
try {
  var _workflowSnapshot = (function(){ ${job.payload.captureCode} })();
  if (!_workflowSnapshot || JSON.stringify(_workflowSnapshot) !== JSON.stringify(payload.snapshot))
    throw new Error("Prepared snapshot changed; no mutation applied");
  if (!app.project.file || _workflowSnapshot.projectPath !== payload.snapshot.projectPath)
    throw new Error("Active project differs from prepared copy");
  app.project.save();
  var _source = new File(${copy}), _checkpoint = new File(${checkpointLiteral});
  if (!_source.exists || _checkpoint.exists || !_source.copy(_checkpoint.fsName))
    throw new Error("Could not create pre-edit checkpoint");
  _workflowResult = (function(){ ${job.payload.mutationCode} })();
  if (!_workflowResult || !_workflowResult.ok) throw new Error(_workflowResult && _workflowResult.error ? String(_workflowResult.error) : "Mutation failed");
  app.project.save();
  _workflowState = "succeeded";
} catch (_workflowError) {
  _workflowResult = {ok:false,error:(_workflowError && _workflowError.message) ? String(_workflowError.message) : "Workflow failed"};
} finally {
  var _receipt = new File(${receipt});
  _receipt.encoding = "UTF-8";
  if (!_receipt.open("w")) throw new Error("Could not write workflow receipt");
  _receipt.write(JSON.stringify({jobId:${jobId},state:_workflowState,result:_workflowResult}));
  _receipt.close();
}
return _workflowResult;
`;
  }

  async apply(id: string): Promise<WorkflowPublicStatus> {
    const existing = await this.jobs.get(id);
    if (!existing) throw new Error("Unknown workflow job");
    if (existing.state !== "prepared") return this.view(existing);
    this.policy(existing.payload.recipe as WorkflowRecipe);
    const { session } = await this.session(existing.payload.copyPath);
    if (session.worker !== existing.payload.instance) throw new Error("Managed worker changed");
    const claim = await this.jobs.claim(id);
    if (!claim.claimed) return this.view(claim.job);
    const checkpoint = path.join(
      path.dirname(claim.job.payload.copyPath),
      `workflow-${id}-before.aep`,
    );
    try {
      const response = await this.transport.execute({
        code: this.applyCode(claim.job, checkpoint),
        payload: { snapshot: claim.job.payload.snapshot },
        label: `workflow apply ${claim.job.payload.recipe}`,
        instance: session.worker,
        timeoutMs: 120_000,
      });
      // A timeout, transport error or dispatcher error cannot prove whether AE executed.
      // Status will reconcile the receipt if the still-running JSX writes one later.
      const withReceipt = await this.jobs.get(id);
      if (withReceipt && (withReceipt.state === "succeeded" || withReceipt.state === "failed"))
        return this.view(withReceipt);
      if (!response.ok)
        return this.view(
          await this.jobs.finish(id, "uncertain", { error: response.error ?? "AE result unknown" }),
        );
      // Successful transport without a validated receipt is also uncertain.
      return this.view(
        await this.jobs.finish(id, "uncertain", { error: "AE receipt missing; inspect status" }),
      );
    } catch (error) {
      return this.view(
        await this.jobs.finish(id, "uncertain", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async status(id: string): Promise<WorkflowPublicStatus> {
    const job = await this.jobs.get(id);
    if (!job) throw new Error("Unknown workflow job");
    return this.view(job);
  }
}
