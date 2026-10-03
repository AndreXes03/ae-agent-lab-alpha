import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { jsxVal } from "../registry.js";
import { errorResult } from "../errors.js";
import { defineTool, jsonResult, toMcpResult } from "./define-tool.js";

const specSchema = z.strictObject({
  compId: z.number().int().positive(),
  sampleTime: z.number().finite().nonnegative(),
  targets: z
    .array(
      z.strictObject({
        layerIndex: z.number().int().positive(),
        properties: z
          .array(z.array(z.string().min(1).max(120)).min(1).max(12))
          .min(1)
          .max(16),
      }),
    )
    .min(1)
    .max(16),
});
type Spec = z.infer<typeof specSchema>;
const request = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("capture"), spec: specSchema }),
  z.strictObject({
    action: z.literal("compare"),
    baselineId: z.uuid(),
    allowChanges: z
      .array(z.enum(["sourcePath", "sample"]))
      .max(2)
      .optional(),
  }),
]);
const snapshotSchema = z.strictObject({
  ok: z.literal(true),
  projectPath: z.string().min(1),
  compId: z.number().int().positive(),
  fps: z.number().finite().positive(),
  targets: z.array(
    z.strictObject({
      layerId: z.number().int().positive(),
      layerIndex: z.number().int().positive(),
      source: z
        .strictObject({
          id: z.number().int().positive(),
          path: z.string().nullable(),
          width: z.number().finite(),
          height: z.number().finite(),
        })
        .nullable(),
      timing: z.strictObject({
        inPoint: z.number().finite(),
        outPoint: z.number().finite(),
        startTime: z.number().finite(),
        stretch: z.number().finite(),
      }),
      properties: z.array(
        z.strictObject({ path: z.array(z.string()), animation: z.unknown(), sample: z.unknown() }),
      ),
    }),
  ),
});
type Snapshot = z.infer<typeof snapshotSchema>;
const baselines = new Map<string, { spec: Spec; snapshot: Snapshot }>();
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Only explicitly named properties are traversed; complete key data never enters model context. */
export function captureVerification(spec: Spec): string {
  return `
var _vs = ${jsxVal(spec)};
if (!app.project.file) return {ok:false,error:"saved project required"};
var _vc = AE.findItemById(_vs.compId);
if (!_vc || !(_vc instanceof CompItem)) return {ok:false,error:"composition not found"};
if (_vs.sampleTime > _vc.duration) return {ok:false,error:"sample time outside composition"};
function _vease(e) { var out=[]; for(var i=0;i<e.length;i++) out.push([e[i].speed,e[i].influence]); return out; }
var _vt=[];
for(var _vi=0;_vi<_vs.targets.length;_vi++) {
  var _vtarget=_vs.targets[_vi];
  if (_vtarget.layerIndex>_vc.numLayers) return {ok:false,error:"layer index not found"};
  var _vl=_vc.layer(_vtarget.layerIndex);
  if(typeof _vl.id!=="number") return {ok:false,error:"stable layer id unavailable"};
  var _vsource=null;
  if(_vl.source) _vsource={id:_vl.source.id,path:_vl.source.file?_vl.source.file.fsName:null,width:_vl.source.width,height:_vl.source.height};
  var _vp=[];
  for(var _vpi=0;_vpi<_vtarget.properties.length;_vpi++) {
    var _vpath=_vtarget.properties[_vpi],_vn=_vl;
    for(var _vni=0;_vni<_vpath.length;_vni++) {
      var _vmatches=0,_vnext=null;
      for(var _vsi=1;_vsi<=_vn.numProperties;_vsi++) { var candidate=_vn.property(_vsi); if(candidate.matchName===_vpath[_vni]) { _vmatches++;_vnext=candidate; } }
      if(_vmatches!==1) return {ok:false,error:"missing or ambiguous canonical property"};
      _vn=_vnext;
    }
    if(_vn.propertyType!==PropertyType.PROPERTY) return {ok:false,error:"target is not a property"};
    if(_vn.numKeys>256) return {ok:false,error:"verification limited to 256 keys per property"};
    if(_vn.isSeparationLeader && _vn.dimensionsSeparated) return {ok:false,error:"inspect separated followers explicitly"};
    var _vkeys=[];
    for(var _vki=1;_vki<=_vn.numKeys;_vki++) {
      var _vk={time:_vn.keyTime(_vki),value:AE.valueToJson(_vn.keyValue(_vki)),inType:String(_vn.keyInInterpolationType(_vki)),outType:String(_vn.keyOutInterpolationType(_vki)),inEase:_vease(_vn.keyInTemporalEase(_vki)),outEase:_vease(_vn.keyOutTemporalEase(_vki)),temporalContinuous:_vn.keyTemporalContinuous(_vki),temporalAutoBezier:_vn.keyTemporalAutoBezier(_vki)};
      if(_vn.isSpatial) { _vk.inTangent=AE.valueToJson(_vn.keyInSpatialTangent(_vki));_vk.outTangent=AE.valueToJson(_vn.keyOutSpatialTangent(_vki));_vk.spatialContinuous=_vn.keySpatialContinuous(_vki);_vk.spatialAutoBezier=_vn.keySpatialAutoBezier(_vki);_vk.roving=_vn.keyRoving(_vki); }
      _vkeys.push(_vk);
    }
    _vp.push({path:_vpath,animation:{keys:_vkeys,expression:_vn.canSetExpression?_vn.expression:null,expressionEnabled:_vn.canSetExpression?_vn.expressionEnabled:false},sample:AE.valueToJson(_vn.valueAtTime(_vs.sampleTime,false))});
  }
  _vt.push({layerId:_vl.id,layerIndex:_vtarget.layerIndex,source:_vsource,timing:{inPoint:_vl.inPoint,outPoint:_vl.outPoint,startTime:_vl.startTime,stretch:_vl.stretch},properties:_vp});
}
return {ok:true,projectPath:app.project.file.fsName,compId:_vc.id,fps:_vc.frameRate,targets:_vt};
`;
}

export function compareVerification(before: Snapshot, after: Snapshot, allowed: string[] = []) {
  const changes: Array<{
    layerIndex?: number;
    property?: string[];
    field: string;
    allowed: boolean;
  }> = [];
  const add = (field: string, a: unknown, b: unknown, layerIndex?: number, property?: string[]) => {
    if (digest(a) !== digest(b))
      changes.push({
        field,
        allowed: allowed.includes(field),
        ...(layerIndex === undefined ? {} : { layerIndex }),
        ...(property ? { property } : {}),
      });
  };
  add(
    "identity",
    [before.projectPath, before.compId, before.fps, before.targets.length],
    [after.projectPath, after.compId, after.fps, after.targets.length],
  );
  before.targets.forEach((a, i) => {
    const b = after.targets[i];
    if (!b) {
      changes.push({ field: "identity", layerIndex: a.layerIndex, allowed: false });
      return;
    }
    add(
      "identity",
      [a.layerId, a.layerIndex, a.properties.map((p) => p.path)],
      [b.layerId, b.layerIndex, b.properties.map((p) => p.path)],
      a.layerIndex,
    );
    add("sourceIdentity", a.source?.id ?? null, b.source?.id ?? null, a.layerIndex);
    add("sourcePath", a.source?.path ?? null, b.source?.path ?? null, a.layerIndex);
    add(
      "sourceDimensions",
      a.source ? [a.source.width, a.source.height] : null,
      b.source ? [b.source.width, b.source.height] : null,
      a.layerIndex,
    );
    add("timing", a.timing, b.timing, a.layerIndex);
    a.properties.forEach((p, j) => {
      const q = b.properties[j];
      if (!q) return;
      add("animation", p.animation, q.animation, a.layerIndex, p.path);
      add("sample", p.sample, q.sample, a.layerIndex, p.path);
    });
  });
  return { verified: changes.every((c) => c.allowed), changedCount: changes.length, changes };
}

export const verifyTargetsTool = defineTool({
  name: "ae_verify_targets",
  title: "Verify scoped invariants",
  group: "inspect",
  effect: "read",
  blockedInReadOnly: false,
  description:
    "Capture/compare explicit source, timing and property animation invariants in one AE read per action. Full snapshots stay in this server process (64 baselines). Always samples the same explicit time, independent of the playhead. Missing/ambiguous properties fail. Compare reports changed fields only; allowChanges marks intentional source-path or sampled-value changes, never identity, keys or timing. Not visual verification.",
  inputShape: { request },
  handler: async ({ request: raw }, transport) => {
    const input = request.safeParse(raw);
    if (!input.success) return errorResult("INVALID_ARGS", "Invalid scoped verification request");
    const r = input.data;
    const baseline = r.action === "compare" ? baselines.get(r.baselineId) : undefined;
    if (r.action === "compare" && !baseline)
      return errorResult(
        "VALIDATION",
        "Baseline expired or server restarted; capture again before editing.",
      );
    const spec = r.action === "capture" ? r.spec : baseline!.spec;
    const result = await transport.execute({
      code: captureVerification(spec),
      label: "verify_targets",
      undoGroup: false,
    });
    if (!result.ok || (result.result as { ok?: boolean } | null)?.ok === false)
      return toMcpResult(result);
    const parsed = snapshotSchema.safeParse(result.result);
    if (
      !parsed.success ||
      parsed.data.compId !== spec.compId ||
      parsed.data.targets.length !== spec.targets.length ||
      parsed.data.targets.some(
        (t, i) =>
          t.layerIndex !== spec.targets[i].layerIndex ||
          t.properties.length !== spec.targets[i].properties.length ||
          t.properties.some(
            (p, j) =>
              digest(p.path) !== digest(spec.targets[i].properties[j]) ||
              p.animation === undefined ||
              p.sample === undefined,
          ),
      ) ||
      JSON.stringify(result.result).length > 2_000_000
    )
      return errorResult(
        "VALIDATION",
        "Incomplete or oversized verification snapshot; no assertion made.",
      );
    if (r.action === "compare") {
      const comparison = compareVerification(baseline!.snapshot, parsed.data, r.allowChanges);
      return {
        ...jsonResult({ ...comparison, baselineId: r.baselineId, sampleTime: spec.sampleTime }),
        isError: !comparison.verified,
      };
    }
    const baselineId = randomUUID();
    if (baselines.size >= 64) baselines.delete(baselines.keys().next().value!);
    baselines.set(baselineId, { spec, snapshot: parsed.data });
    return jsonResult({
      baselineId,
      sampleTime: spec.sampleTime,
      targetCount: spec.targets.length,
      fingerprint: digest(parsed.data),
    });
  },
});
