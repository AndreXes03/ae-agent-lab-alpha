/** Local readback and guarded retime code generation. Full key data stays on the AE bridge. */
import { z } from "zod";
import "../operations/index.js";
import { getOp, jsxVal } from "../registry.js";
import { planWorkflow, type RetimeRequest } from "./plan.js";

const positiveInt = z.number().int().safe().positive();
export const retimeSpec = z.strictObject({
  comp: positiveInt,
  tracks: z
    .array(
      z.strictObject({
        layer: positiveInt,
        property: z.array(z.string().min(1)).min(1).max(12),
      }),
    )
    .min(1)
    .max(16),
  offsetFrames: z.number().int().safe(),
  timeScale: z.number().finite().positive().optional(),
  pivotFrame: z.number().int().safe().nonnegative().optional(),
});
export type RetimeSpec = z.infer<typeof retimeSpec>;

type Key = {
  frame: number;
  value: number | number[];
  inInterp: string;
  outInterp: string;
  inEase: Array<[number, number]>;
  outEase: Array<[number, number]>;
  temporalContinuous: boolean;
  temporalAutoBezier: boolean;
  inSpatialTangent: number[] | null;
  outSpatialTangent: number[] | null;
  spatialContinuous: boolean | null;
  spatialAutoBezier: boolean | null;
  roving: boolean | null;
};
type TrackSnapshot = {
  layer: number;
  layerId: number;
  layerName: string;
  inFrame: number;
  outFrame: number;
  startTime: number;
  stretch: number;
  property: string[];
  expressionEnabled: boolean;
  separated: boolean;
  keys: Key[];
};
type Snapshot = {
  ok: true;
  projectPath: string;
  compId: number;
  compName: string;
  fps: number;
  durationFrames: number;
  tracks: TrackSnapshot[];
};

function parsedSpec(input: unknown): RetimeSpec {
  const spec = retimeSpec.parse(input);
  const seen = new Set<string>();
  for (const track of spec.tracks) {
    const id = JSON.stringify([track.layer, track.property]);
    if (seen.has(id)) throw new Error("duplicate retime target");
    seen.add(id);
  }
  return spec;
}

/** ES3 function body. Its result deliberately contains the complete local snapshot. */
export function captureRetime(input: RetimeSpec): string {
  const spec = parsedSpec(input);
  return `
var _rs = ${jsxVal(spec)};
var _projectPath = app.project && app.project.file ? app.project.file.fsName : "";
if (!_projectPath) return { ok: false, error: "project must be saved before retiming" };
var _comp = AE.findItemById(_rs.comp);
if (!_comp || !(_comp instanceof CompItem)) return { ok: false, error: "composition id not found" };
var _fps = _comp.frameRate;
if (!isFinite(_fps) || _fps <= 0) return { ok: false, error: "invalid composition frame rate" };
function _frame(t) {
  var f = t * _fps;
  var r = Math.round(f);
  if (!isFinite(f) || Math.abs(f - r) > 0.0001) return null;
  return r;
}
function _numberValue(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (!v || typeof v.length !== "number" || v.length < 1 || v.length > 4) return null;
  var a = [];
  for (var i = 0; i < v.length; i++) {
    if (typeof v[i] !== "number" || !isFinite(v[i])) return null;
    a.push(v[i]);
  }
  return a;
}
function _ease(v) {
  var a = [];
  for (var i = 0; i < v.length; i++) a.push([v[i].speed, v[i].influence]);
  return a;
}
var _durationFrames = _frame(_comp.duration);
if (_durationFrames === null) return { ok: false, error: "composition duration is not frame aligned" };
var _tracks = [];
for (var _ti = 0; _ti < _rs.tracks.length; _ti++) {
  var _t = _rs.tracks[_ti];
  if (_t.layer > _comp.numLayers) return { ok: false, error: "layer index not found: " + _t.layer };
  var _layer = _comp.layer(_t.layer);
  if (!_layer) return { ok: false, error: "layer index not found: " + _t.layer };
  if (typeof _layer.id !== "number") return { ok: false, error: "layer has no stable id" };
  var _node = _layer;
  for (var _pi = 0; _pi < _t.property.length; _pi++) {
    _node = _node.property(_t.property[_pi]);
    if (!_node || _node.matchName !== _t.property[_pi]) return { ok: false, error: "property match-name path not found" };
  }
  if (_node.propertyType !== PropertyType.PROPERTY) return { ok: false, error: "target is not a property" };
  var _separated = !!_node.dimensionsSeparated || !!_node.isSeparationFollower;
  if (_separated) return { ok: false, error: "separated dimensions require manual review" };
  var _in = _frame(_layer.inPoint), _out = _frame(_layer.outPoint);
  if (_in === null || _out === null) return { ok: false, error: "layer bounds are not frame aligned" };
  var _keys = [];
  if (_node.numKeys < 1 || _node.numKeys > 64) return { ok: false, error: "target must have 1 to 64 keys" };
  for (var _ki = 1; _ki <= _node.numKeys; _ki++) {
    var _kf = _frame(_node.keyTime(_ki));
    var _kv = _numberValue(_node.keyValue(_ki));
    if (_kf === null || _kv === null) return { ok: false, error: "unsupported value or subframe key" };
    var _key = {
      frame: _kf, value: _kv,
      inInterp: String(_node.keyInInterpolationType(_ki)),
      outInterp: String(_node.keyOutInterpolationType(_ki)),
      inEase: _ease(_node.keyInTemporalEase(_ki)),
      outEase: _ease(_node.keyOutTemporalEase(_ki)),
      temporalContinuous: !!_node.keyTemporalContinuous(_ki),
      temporalAutoBezier: !!_node.keyTemporalAutoBezier(_ki),
      inSpatialTangent: null, outSpatialTangent: null,
      spatialContinuous: null, spatialAutoBezier: null, roving: null
    };
    if (_node.isSpatial) {
      _key.inSpatialTangent = _numberValue(_node.keyInSpatialTangent(_ki));
      _key.outSpatialTangent = _numberValue(_node.keyOutSpatialTangent(_ki));
      _key.spatialContinuous = !!_node.keySpatialContinuous(_ki);
      _key.spatialAutoBezier = !!_node.keySpatialAutoBezier(_ki);
      _key.roving = !!_node.keyRoving(_ki);
      if (_key.inSpatialTangent === null || _key.outSpatialTangent === null) return { ok: false, error: "unsupported spatial tangent" };
    }
    _keys.push(_key);
  }
  _tracks.push({ layer: _t.layer, layerId: _layer.id, layerName: _layer.name,
    inFrame: _in, outFrame: _out, startTime: _layer.startTime, stretch: _layer.stretch,
    property: _t.property, expressionEnabled: !!_node.expressionEnabled,
    separated: _separated, keys: _keys });
}
return { ok: true, projectPath: _projectPath, compId: _comp.id,
  compName: _comp.name, fps: _fps, durationFrames: _durationFrames, tracks: _tracks };
`;
}

function parseSnapshot(input: unknown, spec: RetimeSpec): Snapshot {
  if (!input || typeof input !== "object" || (input as { ok?: unknown }).ok !== true)
    throw new Error("retime capture failed");
  const snap = input as Snapshot;
  if (
    !snap.projectPath ||
    snap.compId !== spec.comp ||
    !Number.isFinite(snap.fps) ||
    snap.fps <= 0 ||
    !Number.isSafeInteger(snap.durationFrames) ||
    snap.tracks?.length !== spec.tracks.length
  )
    throw new Error("invalid retime snapshot");
  for (let i = 0; i < snap.tracks.length; i++) {
    const track = snap.tracks[i];
    if (
      track.layer !== spec.tracks[i].layer ||
      JSON.stringify(track.property) !== JSON.stringify(spec.tracks[i].property) ||
      !Number.isSafeInteger(track.layerId) ||
      track.separated ||
      track.expressionEnabled ||
      !Array.isArray(track.keys) ||
      track.keys.length < 1 ||
      track.keys.length > 64
    )
      throw new Error("unsafe retime track snapshot");
    for (const key of track.keys)
      if (!Number.isSafeInteger(key.frame)) throw new Error("unsupported subframe key");
  }
  return snap;
}

/** Builds a small public summary and an ES3 mutation body; the full snapshot is kept in job storage. */
export function prepareRetime(
  input: RetimeSpec,
  rawSnapshot: unknown,
): { summary: Record<string, unknown>; mutationCode: string } {
  const spec = parsedSpec(input);
  const snap = parseSnapshot(rawSnapshot, spec);
  const request: RetimeRequest = {
    recipe: "retime_properties",
    comp: spec.comp,
    fps: snap.fps,
    compDurationFrames: snap.durationFrames,
    offsetFrames: spec.offsetFrames,
    timeScale: spec.timeScale,
    pivotFrame: spec.pivotFrame,
    tracks: snap.tracks.map((t) => ({
      layer: t.layer,
      property: t.property,
      keyTimesFrames: t.keys.map((k) => k.frame),
      numKeys: t.keys.length,
      hasExpression: t.expressionEnabled,
      inFrame: t.inFrame,
      outFrame: t.outFrame,
    })),
  };
  const plan = planWorkflow(request);
  if (!plan.ready || !plan.batch)
    throw new Error(plan.findings.map((f) => `${f.code}: ${f.message}`).join("; "));
  const shift = getOp("keyframe.shift");
  if (!shift) throw new Error("keyframe.shift is not registered");
  const bodies = plan.batch.args.ops.map((op, i) => {
    const operationCode = shift.toJsx(op.args);
    return `
var _r${i} = (function () { ${operationCode} })();
if (!_r${i} || !_r${i}.ok) return { ok: false, error: "retime failed on track ${i + 1}: " + (_r${i} ? _r${i}.error : "no result") };
`;
  });
  const expected = plan.changes.map((change) => ({
    layer: change.layer,
    property: change.property,
    toFrames: change.toFrames,
  }));
  const mutationCode = `
var _expected = ${jsxVal(expected)};
var _before = _workflowSnapshot;
if (!_before || !_before.ok || _before.tracks.length !== _expected.length) return { ok: false, error: "missing guarded retime snapshot" };
${bodies.join("\n")}
var _after = (function () { ${captureRetime(spec)} })();
if (!_after || !_after.ok) return { ok: false, error: "post-retime readback failed" };
if (_after.projectPath !== _before.projectPath || _after.compId !== _before.compId || _after.fps !== _before.fps || _after.durationFrames !== _before.durationFrames) return { ok: false, error: "post-retime project or composition state changed" };
if (_after.tracks.length !== _expected.length) return { ok: false, error: "post-retime track count changed" };
var _checked = [];
for (var _i = 0; _i < _expected.length; _i++) {
  var _a = _after.tracks[_i], _b = _before.tracks[_i], _e = _expected[_i];
  if (_a.layerId !== _b.layerId || _a.inFrame !== _b.inFrame || _a.outFrame !== _b.outFrame || _a.startTime !== _b.startTime || _a.stretch !== _b.stretch) return { ok: false, error: "post-retime layer state changed on track " + (_i + 1) };
  if (_a.keys.length !== _e.toFrames.length) return { ok: false, error: "post-retime key count differs on track " + (_i + 1) };
  for (var _j = 0; _j < _a.keys.length; _j++) {
    if (_a.keys[_j].frame !== _e.toFrames[_j]) return { ok: false, error: "post-retime key time differs on track " + (_i + 1) };
    var _av = _a.keys[_j], _bv = _b.keys[_j];
    for (var _field in _bv) {
      if (_field !== "frame" && JSON.stringify(_av[_field]) !== JSON.stringify(_bv[_field])) return { ok: false, error: "post-retime key attribute differs on track " + (_i + 1) };
    }
  }
  _checked.push({ layer: _a.layer, property: _a.property, keyCount: _a.keys.length, actualFrames: _e.toFrames });
}
return { ok: true, changedTracks: _checked.length, tracks: _checked };
`;
  return {
    summary: {
      compId: snap.compId,
      compName: snap.compName,
      fps: snap.fps,
      changedTracks: expected.length,
      tracks: expected.map((e) => ({
        layer: e.layer,
        property: e.property,
        keyCount: e.toFrames.length,
        expectedFrames: e.toFrames,
      })),
    },
    mutationCode,
  };
}
