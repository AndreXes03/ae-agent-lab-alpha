import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";

import { RUNTIME_DIR } from "../config.js";
import { jsxVal } from "../registry.js";

export interface PropertyIdentity {
  matchName: string;
  name: string;
  index: number;
}

/** Identity only. Values in an inspection are never authoritative for a later edit. */
export interface TargetHandle {
  version: 1;
  projectPath: string;
  compId: number;
  layerId: number;
  layerIndex: number;
  propertyPath?: PropertyIdentity[];
}

const REF_RE = /^target:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const REF_DIR = path.join(RUNTIME_DIR, "target-refs");

function validHandle(value: unknown): value is TargetHandle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const h = value as Partial<TargetHandle>;
  return (
    h.version === 1 &&
    typeof h.projectPath === "string" &&
    (path.isAbsolute(h.projectPath) || /^[A-Za-z]:\//.test(h.projectPath)) &&
    Number.isSafeInteger(h.compId) &&
    h.compId! > 0 &&
    Number.isSafeInteger(h.layerId) &&
    h.layerId! > 0 &&
    Number.isSafeInteger(h.layerIndex) &&
    h.layerIndex! > 0 &&
    (h.propertyPath === undefined ||
      (Array.isArray(h.propertyPath) &&
        h.propertyPath.length > 0 &&
        h.propertyPath.length <= 12 &&
        h.propertyPath.every(
          (p) =>
            p &&
            typeof p.matchName === "string" &&
            p.matchName.length > 0 &&
            p.matchName.length <= 200 &&
            typeof p.name === "string" &&
            p.name.length > 0 &&
            p.name.length <= 200 &&
            Number.isSafeInteger(p.index) &&
            p.index > 0,
        )))
  );
}

async function checkedDir(dir: string, create: boolean, privateMode: boolean): Promise<void> {
  if (create)
    await mkdir(dir, { recursive: false, mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
  const st = await lstat(dir);
  if (!st.isDirectory() || st.isSymbolicLink())
    throw new Error("target reference directory is not a plain directory");
  if (
    process.platform !== "win32" &&
    ((st.mode & (privateMode ? 0o077 : 0o022)) !== 0 || st.uid !== process.getuid?.())
  ) {
    throw new Error(
      privateMode
        ? "target reference directory must be owned by this user and mode 0700"
        : "target reference parent must not be writable by others",
    );
  }
}

async function refDir(create: boolean, dir: string): Promise<string> {
  // The mailbox already owns its runtime directory. Never follow a substituted
  // symlink at either boundary, and never accept an arbitrary ref as a path.
  await checkedDir(path.dirname(dir), false, false);
  await checkedDir(dir, create, true);
  return dir;
}

export async function saveTargetHandle(handle: TargetHandle, dir = REF_DIR): Promise<string> {
  if (!validHandle(handle)) throw new Error("invalid target identity");
  await refDir(true, dir);
  const id = randomUUID();
  const fd = await open(
    path.join(dir, `${id}.json`),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await fd.writeFile(JSON.stringify(handle), "utf8");
  } finally {
    await fd.close();
  }
  return `target:${id}`;
}

export async function loadTargetHandle(ref: string, dir = REF_DIR): Promise<TargetHandle> {
  const id = REF_RE.exec(ref)?.[1];
  if (!id) throw new Error("invalid target reference");
  await refDir(false, dir);
  const fd = await open(
    path.join(dir, `${id}.json`),
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const st = await fd.stat();
    if (
      !st.isFile() ||
      st.size > 8192 ||
      (process.platform !== "win32" && ((st.mode & 0o077) !== 0 || st.uid !== process.getuid?.()))
    ) {
      throw new Error("target reference file is unsafe");
    }
    const parsed: unknown = JSON.parse(await fd.readFile("utf8"));
    if (!validHandle(parsed)) throw new Error("target reference is corrupt");
    return parsed;
  } finally {
    await fd.close();
  }
}

/**
 * Inject immediately before an edit, inside the SAME AE call. It returns the
 * live objects only after checking the saved project, comp id, layer id and
 * layer index, plus every property match name and sibling index. A reorder is
 * deliberately stale even if the id can still be found elsewhere.
 */
export function targetGuardJsx(handle: TargetHandle): string {
  if (!validHandle(handle)) throw new Error("invalid target identity");
  return `
function _targetGuard() {
  var _expected = ${jsxVal(handle)};
  var _file = app.project.file;
  if (!_file || _file.fsName.replace(/\\\\/g, "/") !== _expected.projectPath)
    return { ok: false, error: "target reference stale: project changed" };
  var _comp = AE.findItemById(_expected.compId);
  if (!_comp || !( _comp instanceof CompItem))
    return { ok: false, error: "target reference stale: composition deleted" };
  if (_expected.layerIndex > _comp.numLayers)
    return { ok: false, error: "target reference stale: layer deleted or reordered" };
  var _layer = _comp.layer(_expected.layerIndex);
  if (!_layer || _layer.id !== _expected.layerId)
    return { ok: false, error: "target reference stale: layer deleted or reordered" };
  var _prop = null;
  if (_expected.propertyPath) {
    _prop = _layer;
    for (var _pi = 0; _pi < _expected.propertyPath.length; _pi++) {
      var _part = _expected.propertyPath[_pi];
      if (!_prop || !_prop.numProperties || _part.index > _prop.numProperties)
        return { ok: false, error: "target reference stale: property deleted or reordered" };
      var _parent = _prop;
      _prop = _parent.property(_part.index);
      if (!_prop || _prop.matchName !== _part.matchName || _prop.name !== _part.name)
        return { ok: false, error: "target reference stale: property deleted or reordered" };
      var _matches = 0;
      for (var _si = 1; _si <= _parent.numProperties; _si++) {
        var _sibling = _parent.property(_si);
        if (_sibling && _sibling.matchName === _part.matchName) _matches++;
      }
      if (_matches !== 1) return { ok: false, error: "target reference stale: ambiguous property identity" };
    }
  }
  return { ok: true, comp: _comp, layer: _layer, property: _prop };
}
`;
}
