import { z } from "zod";

import { errorResult } from "../errors.js";
import { jsxVal } from "../registry.js";
import { saveTargetHandle, type TargetHandle } from "../workflows/targets.js";
import { defineTool, jsonResult, toMcpResult } from "./define-tool.js";

const pathPart = z
  .object({
    matchName: z.string().min(1).max(200),
    index: z.number().int().positive().optional(),
  })
  .strict();

const target = z
  .object({
    layerIndex: z.number().int().positive(),
    propertyPath: z.array(pathPart).min(1).max(12).optional(),
  })
  .strict();

type Inspected = {
  ok: boolean;
  error?: string;
  layerIndex?: number;
  layerId?: number;
  layerName?: string;
  propertyPath?: Array<{ matchName: string; name: string; index: number }>;
  value?: unknown;
  valueTruncated?: boolean;
  valueUnavailable?: boolean;
  numKeys?: number;
};

export const inspectTargetsTool = defineTool({
  name: "ae_inspect_targets",
  title: "Inspect targets",
  description:
    "Inspect up to 16 explicit layer or property targets in one read. Returns compact current values, key counts, and reusable opaque references. Requires a numeric composition ID and 1-based layer indices; property paths use canonical match names. Repeated sibling match names cannot receive reusable property references.",
  group: "inspect",
  blockedInReadOnly: false,
  effect: "read",
  inputShape: {
    compId: z
      .number()
      .int()
      .positive()
      .describe("Numeric composition item ID from ae_project_info."),
    targets: z.array(target).min(1).max(16),
  },
  handler: async (args, transport) => {
    const code = `
var _compId = ${jsxVal(args.compId)};
var _targets = ${jsxVal(args.targets)};
var _file = app.project.file;
if (!_file) return { ok: false, error: "save the project before inspecting reusable targets" };
var _projectPath = _file.fsName.replace(/\\\\/g, "/");
var _comp = AE.findItemById(_compId);
if (!_comp || !(_comp instanceof CompItem)) return { ok: false, error: "composition id not found" };
var _out = [];
for (var _ti = 0; _ti < _targets.length; _ti++) {
  var _spec = _targets[_ti];
  if (_spec.layerIndex > _comp.numLayers) {
    _out.push({ ok: false, error: "layer index out of range" });
    continue;
  }
  var _layer = _comp.layer(_spec.layerIndex);
  var _id = AE.safeGet(function () { return _layer.id; }, null);
  if (typeof _id !== "number" || _id < 1) {
    _out.push({ ok: false, error: "stable layer.id is unavailable" });
    continue;
  }
  var _entry = { ok: true, layerIndex: _spec.layerIndex, layerId: _id,
    layerName: String(_layer.name).substring(0, 120) };
  if (_spec.propertyPath) {
    var _node = _layer;
    var _identity = [];
    var _error = null;
    for (var _pi = 0; _pi < _spec.propertyPath.length; _pi++) {
      var _part = _spec.propertyPath[_pi];
      var _index = _part.index || 0;
      if (!_node || !_node.numProperties) { _error = "property group not found"; break; }
      var _matches = 0;
      for (var _si = 1; _si <= _node.numProperties; _si++) {
        var _candidate = _node.property(_si);
        if (_candidate && _candidate.matchName === _part.matchName) {
          _matches++; if (!_index) _index = _si;
        }
      }
      if (_matches !== 1) { _error = _matches ? "ambiguous property match name; reusable reference unavailable" : "property match name not found"; break; }
      if (_index > _node.numProperties) { _error = "property index out of range"; break; }
      _node = _node.property(_index);
      if (!_node || _node.matchName !== _part.matchName) { _error = "property match name differs at index"; break; }
      _identity.push({ matchName: _node.matchName, name: _node.name, index: _index });
    }
    if (_error) { _out.push({ ok: false, error: _error }); continue; }
    _entry.propertyPath = _identity;
    _entry.numKeys = AE.safeGet(function () { return _node.numKeys; }, 0);
    try {
      var _raw = AE.valueToJson(_node.value);
      var _encoded = JSON.stringify(_raw);
      if (_encoded.length <= 512) _entry.value = _raw;
      else _entry.valueTruncated = true;
    } catch (_valueError) { _entry.valueUnavailable = true; }
  }
  _out.push(_entry);
}
return { ok: true, projectPath: _projectPath, compId: _comp.id, targets: _out };
`;
    const result = await transport.execute({ code, label: "inspect_targets", undoGroup: false });
    if (!result.ok || !result.result || typeof result.result !== "object")
      return toMcpResult(result);
    const payload = result.result as {
      ok?: boolean;
      projectPath?: string;
      compId?: number;
      targets?: Inspected[];
    };
    if (payload.ok === false) return toMcpResult(result);
    if (
      typeof payload.projectPath !== "string" ||
      !Array.isArray(payload.targets) ||
      payload.compId !== args.compId ||
      payload.targets.length !== args.targets.length
    ) {
      return errorResult("VALIDATION", "unexpected target inspection response");
    }
    const targets: Array<Inspected & { ref?: string }> = [];
    try {
      for (const item of payload.targets) {
        if (!item.ok) {
          targets.push(item);
          continue;
        }
        const handle: TargetHandle = {
          version: 1,
          projectPath: payload.projectPath,
          compId: payload.compId,
          layerId: item.layerId!,
          layerIndex: item.layerIndex!,
          ...(item.propertyPath ? { propertyPath: item.propertyPath } : {}),
        };
        targets.push({ ...item, ref: await saveTargetHandle(handle) });
      }
    } catch (e) {
      return errorResult(
        "IO",
        `could not save target references: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return jsonResult({ projectPath: payload.projectPath, compId: payload.compId, targets });
  },
});
