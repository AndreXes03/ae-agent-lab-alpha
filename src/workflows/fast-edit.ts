/** One guarded, durable AE edit call. No preparation round trip or automatic render. */
import path from "node:path";
import { z } from "zod";
import { RUNTIME_DIR } from "../config.js";
import { validateOpArgs } from "../opschema.js";
import { allowedCategories, denyOperation, readOnlyMode } from "../policy.js";
import { getOp, jsxVal, type Operation } from "../registry.js";
import type { AeTransport } from "../transport/AeTransport.js";
import { WorkflowJobs, type WorkflowJob } from "./jobs.js";
import { WorkflowService } from "./service.js";
import { loadTargetHandle, targetGuardJsx } from "./targets.js";
import "../operations/index.js";

const EDIT_NAMES = new Set([
  "text.set_content",
  "text.set_style",
  "text.set_style_range",
  "text.set_box",
  "transform.set",
  "property.set",
  "keyframe.add",
  "keyframe.apply",
  "keyframe.remove",
  "keyframe.set_easing",
  "keyframe.shift",
  "keyframe.set_value",
  "keyframe.set_interpolation",
  "keyframe.set_spatial",
  "keyframe.set_roving",
  "layer.set_anchor",
  "layer.set_timing",
  "layer.set_enabled",
  "layer.set_props",
  "layer.set_blend_mode",
  "comp.set_work_area",
]);
const READ_NAMES = new Set(["property.get", "layer.info", "comp.info"]);
const operationInput = z
  .object({
    operation: z
      .string()
      .min(1)
      .describe(
        "Edits: text.set_content, text.set_style, text.set_style_range, text.set_box, transform.set, property.set, keyframe.add/apply/remove/set_easing/shift/set_value/set_interpolation/set_spatial/set_roving, layer.set_anchor/set_timing/set_enabled/set_props/set_blend_mode, comp.set_work_area. Reads: property.get, layer.info, comp.info.",
      ),
    args: z.record(z.string(), z.unknown()),
    targetRef: z.string().optional(),
  })
  .strict();
export const fastEditRequest = z
  .object({
    requestId: z.uuid(),
    copyPath: z.string().min(1),
    edits: z.array(operationInput).min(1).max(12),
    /** Optional exact-value guards, evaluated in AE before the checkpoint and mutation. */
    preconditions: z
      .array(operationInput.extend({ equals: z.unknown() }))
      .max(12)
      .optional(),
    /** Extra compact reads after mutation. Basic reads are derived from each edit automatically. */
    readbacks: z.array(operationInput).max(12).optional(),
  })
  .strict();
export type FastEditRequest = z.infer<typeof fastEditRequest>;

function safeJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 32_000) throw new Error("Edit request exceeds 32 KB");
  if (/"(?:__proto__|prototype|constructor)"\s*:/.test(serialized))
    throw new Error("Unsafe object key in edit request");
  return serialized;
}

function operation(
  input: z.infer<typeof operationInput>,
  read: boolean,
): { op: Operation; args: Record<string, unknown> } {
  if (!(read ? READ_NAMES : EDIT_NAMES).has(input.operation))
    throw new Error(`Operation '${input.operation}' is outside the fast edit allowlist`);
  const op = getOp(input.operation);
  if (!op || op.run) throw new Error(`Operation '${input.operation}' is unavailable`);
  const denied = denyOperation(op);
  if (denied) throw new Error(denied.message);
  const checked = validateOpArgs(op, input.args);
  if (!checked.ok)
    throw new Error(
      `${op.name}: ${checked.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    );
  const args = checked.value;
  // A fast edit must address stable, bounded targets, never the current selection or all layers.
  if (typeof args.comp !== "number" || !Number.isSafeInteger(args.comp) || args.comp < 1)
    throw new Error(`${op.name}: comp must be a numeric AE item id`);
  if (
    "layer" in args &&
    !(typeof args.layer === "number" && Number.isSafeInteger(args.layer) && args.layer >= 1)
  )
    throw new Error(`${op.name}: layer must be a fixed 1-based index`);
  if (
    Array.isArray(args.property) &&
    (args.property.length < 1 ||
      args.property.length > 12 ||
      args.property.some((p) => typeof p !== "string" && typeof p !== "number"))
  )
    throw new Error(`${op.name}: property must be a short path`);
  return { op, args };
}

function compactReadbacks(
  edits: FastEditRequest["edits"],
  extras: NonNullable<FastEditRequest["readbacks"]>,
) {
  const reads: z.infer<typeof operationInput>[] = [];
  for (const edit of edits) {
    const { comp, layer, property } = edit.args;
    if (typeof layer === "number" && Array.isArray(property))
      reads.push({ operation: "property.get", args: { comp, layer, property } });
    else if (typeof layer === "number" && edit.operation === "text.set_content")
      reads.push({ operation: "property.get", args: { comp, layer, property: ["Source Text"] } });
    else if (typeof layer === "number")
      reads.push({
        operation: "layer.info",
        args: { comp, layer, includeProperties: false, detail: "summary" },
      });
    else reads.push({ operation: "comp.info", args: { comp } });
  }
  const unique = new Map<string, z.infer<typeof operationInput>>();
  for (const read of [...reads, ...extras]) unique.set(safeJson(read), read);
  return [...unique.values()].slice(0, 24);
}

function jsxCallCode(op: Operation, args: Record<string, unknown>): string {
  return `(function(){ ${op.toJsx(args)} })()`;
}

function codeFor(
  request: FastEditRequest,
  jobId: string,
  checkpoint: string,
  receipt: string,
  targetGuards: string[],
): string {
  const edits = request.edits.map((e) => operation(e, false));
  const reads = compactReadbacks(request.edits, request.readbacks ?? []).map((r) =>
    operation(r, true),
  );
  const guards = (request.preconditions ?? []).map((r) => ({
    ...operation(r, true),
    equals: r.equals,
  }));
  const runGuards = guards
    .map(
      ({ op, args, equals }, i) => `
    var _g${i} = ${jsxCallCode(op, args)};
    if (_g${i} && _g${i}.ok === false) throw new Error("Precondition ${i + 1}: " + _g${i}.error);
    if (JSON.stringify(_g${i}) !== JSON.stringify(${jsxVal(equals)})) throw new Error("Precondition ${i + 1} changed");`,
    )
    .join("\n");
  const runTargetGuards = targetGuards
    .map(
      (guard, i) => `
    var _targetCheck${i} = (function(){ ${guard} return _targetGuard(); })();
    if (!_targetCheck${i}.ok) throw new Error(_targetCheck${i}.error);`,
    )
    .join("\n");
  const before = reads
    .map(
      ({ op, args }, i) => `
    var _b${i} = ${jsxCallCode(op, args)};
    if (!_b${i} || _b${i}.ok === false) throw new Error("Before read ${i + 1} failed");
    _before.push(_compactRead(_b${i}));`,
    )
    .join("\n");
  const changes = edits
    .map(
      ({ op, args }, i) => `
    var _e${i} = ${jsxCallCode(op, args)};
    if (!_e${i} || _e${i}.ok === false) throw new Error("Edit ${i + 1} failed: " + (_e${i} && _e${i}.error || "unknown"));
    if (_e${i}.layers && _e${i}.layers.length) for (var _j${i}=0; _j${i}<_e${i}.layers.length; _j${i}++) {
      if (_e${i}.layers[_j${i}].ok === false || (_e${i}.layers[_j${i}].warnings && _e${i}.layers[_j${i}].warnings.length)) throw new Error("Edit ${i + 1} reported a layer failure");
    }
    _changed.push(${jsxVal(op.name)});`,
    )
    .join("\n");
  const assertions = reads.map(({ op, args }, i) => {
    if (op.name !== "property.get") return "";
    const matching = request.edits
      .map((edit, index) => ({ edit, index }))
      .filter(({ edit }) => edit.args.comp === args.comp && edit.args.layer === args.layer);
    const last = matching.at(-1);
    if (
      last?.edit.operation === "property.set" &&
      safeJson(last.edit.args.property) === safeJson(args.property)
    )
      return `if (JSON.stringify(_a${i}.value) !== JSON.stringify(${jsxVal(last.edit.args.value)})) throw new Error("Property readback differs from requested value"); _verified.push(${last.index});`;
    if (
      last?.edit.operation === "text.set_content" &&
      safeJson(args.property) === safeJson(["Source Text"])
    )
      return `if (!_a${i}.value || _a${i}.value.text !== ${jsxVal(last.edit.args.text)}) throw new Error("Text readback differs from requested text"); _verified.push(${last.index});`;
    return "";
  });
  const after = reads
    .map(
      ({ op, args }, i) => `
    var _a${i} = ${jsxCallCode(op, args)};
    if (!_a${i} || _a${i}.ok === false) throw new Error("After read ${i + 1} failed");
    ${assertions[i]}
    _after.push(_compactRead(_a${i}));`,
    )
    .join("\n");
  return `
var _fastResult = {ok:false,error:"Fast edit did not complete"}, _fastState = "failed";
var _fastStart = new Date().getTime(), _fastCheckpoint = false;
function _compactRead(_r) {
  if (_r && _r.layers && _r.layers.length) { _r.numLayers = _r.layers.length; delete _r.layers; }
  if (JSON.stringify(_r).length > 2048) return {ok:true,name:_r.name || null,numKeys:_r.numKeys || 0,valueTruncated:true};
  return _r;
}
try {
  if (!app.project.file || app.project.file.fsName.replace(/\\\\/g,"/") !== ${jsxVal(request.copyPath.replace(/\\/g, "/"))}) throw new Error("Active project is not the managed copy");
  ${runTargetGuards}
  ${runGuards}
  var _before = [], _after = [], _changed = [], _verified = [];
  ${before}
  app.project.save();
  var _source = new File(${jsxVal(request.copyPath)}), _checkpoint = new File(${jsxVal(checkpoint)});
  if (!_source.exists || _checkpoint.exists || !_source.copy(_checkpoint.fsName)) throw new Error("Could not create pre-edit checkpoint");
  _fastCheckpoint = true;
  ${changes}
  ${after}
  app.project.save();
  _fastResult = {ok:true,changed:_changed,verifiedEditIndexes:_verified,before:_before,after:_after,checkpointCreated:true,aeMs:new Date().getTime()-_fastStart};
  _fastState = "succeeded";
} catch (_fastError) {
  _fastResult = {ok:false,error:AE.errText(_fastError).substring(0,500),checkpointCreated:_fastCheckpoint,aeMs:new Date().getTime()-_fastStart};
} finally {
  var _receipt = new File(${jsxVal(receipt)}); _receipt.encoding = "UTF-8";
  if (!_receipt.open("w")) throw new Error("Could not write fast edit receipt");
  _receipt.write(JSON.stringify({jobId:${jsxVal(jobId)},state:_fastState,result:_fastResult})); _receipt.close();
}
return _fastResult;`;
}

export interface FastEditStatus {
  id: string;
  state: WorkflowJob["state"];
  copyPath: string;
  checkpointPath: string;
  checkpointCreated: boolean;
  result?: unknown;
  callCount: number;
  durationMs?: number;
}

interface Options {
  transport: AeTransport;
  jobs?: WorkflowJobs;
  sessionPath?: string;
  service?: WorkflowService;
}

export class FastEditService {
  private readonly transport: AeTransport;
  private readonly jobs: WorkflowJobs;
  private readonly workflow: WorkflowService;
  constructor(options: Options) {
    this.transport = options.transport;
    this.jobs = options.jobs ?? new WorkflowJobs(path.join(RUNTIME_DIR, "workflow-jobs"));
    this.workflow =
      options.service ??
      new WorkflowService({
        transport: options.transport,
        jobs: this.jobs,
        sessionPath: options.sessionPath,
      });
  }
  private async view(
    job: WorkflowJob,
    callCount: number,
    durationMs?: number,
  ): Promise<FastEditStatus> {
    const checkpointPath = path.join(
      path.dirname(job.payload.copyPath),
      `workflow-${job.id}-before.aep`,
    );
    const { promises: fs } = await import("node:fs");
    const raw =
      job.result && typeof job.result === "object" ? (job.result as Record<string, unknown>) : null;
    const briefRead = (value: unknown) => {
      if (!value || typeof value !== "object") return value;
      const r = value as Record<string, unknown>;
      const item =
        r.value && typeof r.value === "object" ? (r.value as Record<string, unknown>) : null;
      const smallValue = (value: unknown) => {
        const json = JSON.stringify(value);
        return json && json.length > 512 ? { preview: json.slice(0, 512), truncated: true } : value;
      };
      return {
        ...(typeof r.name === "string" ? { name: r.name.slice(0, 100) } : {}),
        ...(typeof r.numKeys === "number" ? { numKeys: r.numKeys } : {}),
        ...(r.valueTruncated === true ? { valueTruncated: true } : {}),
        ...(item?.__kind === "TextDocument"
          ? { text: smallValue(item.text) }
          : "value" in r
            ? { value: smallValue(r.value) }
            : {}),
        ...(typeof r.numLayers === "number" ? { numLayers: r.numLayers } : {}),
      };
    };
    const result = raw
      ? {
          ...(typeof raw.ok === "boolean" ? { ok: raw.ok } : {}),
          ...(typeof raw.error === "string" ? { error: raw.error } : {}),
          ...(Array.isArray(raw.changed) ? { changed: raw.changed } : {}),
          ...(Array.isArray(raw.verifiedEditIndexes)
            ? {
                verifiedEditIndexes: raw.verifiedEditIndexes,
                verification:
                  new Set(raw.verifiedEditIndexes).size ===
                  (raw.changed as unknown[] | undefined)?.length
                    ? "asserted"
                    : "readback_only",
              }
            : {}),
          ...(Array.isArray(raw.before) ? { before: raw.before.map(briefRead) } : {}),
          ...(Array.isArray(raw.after) ? { after: raw.after.map(briefRead) } : {}),
          ...(typeof raw.aeMs === "number" ? { aeMs: raw.aeMs } : {}),
        }
      : undefined;
    return {
      id: job.id,
      state: job.state,
      copyPath: job.payload.copyPath,
      checkpointPath,
      checkpointCreated: (await fs.stat(checkpointPath).catch(() => null))?.isFile() === true,
      ...(result ? { result } : {}),
      callCount,
      ...(durationMs === undefined ? {} : { durationMs }),
    };
  }
  async execute(input: unknown): Promise<FastEditStatus> {
    const request = fastEditRequest.parse(input);
    safeJson(request);
    const old = await this.jobs.get(request.requestId);
    if (old) {
      if (old.payload.recipe !== "fast_edit" || safeJson(old.payload.spec) !== safeJson(request))
        throw new Error("requestId was already used for another edit");
      return this.view(old, 0);
    }
    if (readOnlyMode()) throw new Error("Fast edit is disabled by AE_MCP_READONLY=1");
    const allowed = allowedCategories();
    if (allowed && !allowed.has("project"))
      throw new Error("Fast edit requires project category for save and checkpoint");
    const { session, copy } = await this.workflow.validateSession(request.copyPath);
    const targetGuards: string[] = [];
    const resolve = async (entry: z.infer<typeof operationInput>) => {
      if (!entry.targetRef) return entry;
      const handle = await loadTargetHandle(entry.targetRef);
      if (handle.projectPath !== copy)
        throw new Error("Target reference belongs to another project copy");
      const args = { ...entry.args };
      if (args.comp !== undefined && args.comp !== handle.compId)
        throw new Error("Target comp conflicts with reference");
      if (args.layer !== undefined && args.layer !== handle.layerIndex)
        throw new Error("Target layer conflicts with reference");
      args.comp = handle.compId;
      args.layer = handle.layerIndex;
      if (handle.propertyPath) {
        const property = handle.propertyPath.map((p) => p.index);
        if (args.property !== undefined && safeJson(args.property) !== safeJson(property))
          throw new Error("Target property conflicts with reference");
        args.property = property;
      }
      targetGuards.push(targetGuardJsx(handle));
      return { operation: entry.operation, args };
    };
    const normalized = {
      ...request,
      copyPath: copy,
      edits: await Promise.all(request.edits.map(resolve)),
      preconditions: request.preconditions
        ? await Promise.all(
            request.preconditions.map(async (p) => ({ ...(await resolve(p)), equals: p.equals })),
          )
        : undefined,
      readbacks: request.readbacks ? await Promise.all(request.readbacks.map(resolve)) : undefined,
    };
    normalized.edits.forEach((e) => operation(e, false));
    normalized.preconditions?.forEach((e) => operation(e, true));
    normalized.readbacks?.forEach((e) => operation(e, true));
    const checkpoint = path.join(path.dirname(copy), `workflow-${request.requestId}-before.aep`);
    const receipt = this.jobs.receiptPath(request.requestId);
    const mutationCode = codeFor(normalized, request.requestId, checkpoint, receipt, targetGuards);
    const job = await this.jobs.createWithId(request.requestId, {
      recipe: "fast_edit",
      spec: request,
      snapshot: null,
      summary: { edits: request.edits.map((e) => e.operation) },
      copyPath: copy,
      instance: session.worker,
      captureCode: "",
      mutationCode,
    });
    const claimed = await this.jobs.claim(job.id);
    if (!claimed.claimed) return this.view(claimed.job, 0);
    const start = Date.now();
    try {
      const result = await this.transport.execute({
        code: mutationCode,
        instance: session.worker,
        label: "fast edit",
        timeoutMs: 120_000,
      });
      const settled = await this.jobs.get(job.id);
      if (settled && (settled.state === "succeeded" || settled.state === "failed"))
        return this.view(settled, 1, Date.now() - start);
      return this.view(
        await this.jobs.finish(job.id, "uncertain", {
          error: result.error ?? "AE receipt missing",
        }),
        1,
        Date.now() - start,
      );
    } catch (error) {
      return this.view(
        await this.jobs.finish(job.id, "uncertain", {
          error: error instanceof Error ? error.message : String(error),
        }),
        1,
        Date.now() - start,
      );
    }
  }
  async status(id: string): Promise<FastEditStatus> {
    const job = await this.jobs.get(id);
    if (!job || job.payload.recipe !== "fast_edit") throw new Error("Unknown fast edit job");
    return this.view(job, 0);
  }
}
