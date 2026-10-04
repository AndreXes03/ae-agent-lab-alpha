import type { Easing, MotionTrack, ResolvedNode } from "./model.js";
const cubic = (t: number, a: number, b: number) =>
  3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
export function easeProgress(progress: number, easing: Easing): number {
  const p = Math.max(0, Math.min(1, progress));
  if (easing === "linear") return p;
  if (easing === "hold") return p === 1 ? 1 : 0;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(mid, easing[0], easing[2]) < p) lo = mid;
    else hi = mid;
  }
  return cubic((lo + hi) / 2, easing[1], easing[3]);
}
export function evaluateTrack(track: MotionTrack, frame: number): number | [number, number] {
  const keys = track.keys;
  if (frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys[keys.length - 1].frame) return keys[keys.length - 1].value;
  let lower = 1,
    upper = keys.length - 1;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (keys[middle].frame > frame) upper = middle;
    else lower = middle + 1;
  }
  const index = lower;
  const a = keys[index - 1],
    b = keys[index];
  const t = easeProgress((frame - a.frame) / (b.frame - a.frame), a.easing);
  if (typeof a.value === "number" && typeof b.value === "number")
    return a.value + (b.value - a.value) * t;
  const av = a.value as [number, number],
    bv = b.value as [number, number];
  return [av[0] + (bv[0] - av[0]) * t, av[1] + (bv[1] - av[1]) * t];
}
export function evaluateNode(node: ResolvedNode, frame: number) {
  const result = { ...node, visible: frame >= node.startFrame && frame < node.endFrame };
  for (const track of node.tracks) {
    const value = evaluateTrack(track, frame);
    if (track.property === "position") [result.x, result.y] = value as [number, number];
    else if (track.property === "scale") result.scale = value as [number, number];
    else result[track.property] = value as number;
  }
  return result;
}
/** Samples only frame boundaries; tolerance is absolute per component. Throws when budget cannot preserve it. */
export function sampleTrack(track: MotionTrack, tolerance = 0.1, maxKeys = 2048): MotionTrack {
  if (!Number.isFinite(tolerance) || tolerance <= 0 || !Number.isInteger(maxKeys) || maxKeys < 2)
    throw new Error("Invalid sampling bounds");
  if (track.keys[track.keys.length - 1].frame - track.keys[0].frame > 10000)
    throw new Error("Motion sampling exceeds 10000 frame interval budget");
  const output: MotionTrack["keys"] = [];
  const distance = (a: number | number[], b: number | number[]) =>
    typeof a === "number" && typeof b === "number"
      ? Math.abs(a - b)
      : Math.max(...(a as number[]).map((v, i) => Math.abs(v - (b as number[])[i])));
  for (let segment = 0; segment < track.keys.length - 1; segment++) {
    const a = track.keys[segment],
      b = track.keys[segment + 1];
    if (!output.length) output.push({ ...a, easing: a.easing === "hold" ? "hold" : "linear" });
    output[output.length - 1].easing = a.easing === "hold" ? "hold" : "linear";
    const subdivide = (left: number, right: number): void => {
      const lv = evaluateTrack(track, left),
        rv = evaluateTrack(track, right);
      let worst = 0,
        split = left;
      for (let f = left + 1; f < right; f++) {
        const t = (f - left) / (right - left);
        const linear =
          typeof lv === "number" && typeof rv === "number"
            ? lv + (rv - lv) * t
            : (lv as number[]).map((v, i) => v + ((rv as number[])[i] - v) * t);
        const error = distance(evaluateTrack(track, f), linear);
        if (error > worst) {
          worst = error;
          split = f;
        }
      }
      if (worst > tolerance) {
        subdivide(left, split);
        subdivide(split, right);
      } else {
        if (output.length >= maxKeys) throw new Error("Motion sampling exceeds key budget");
        output.push({ frame: right, value: rv, easing: b.easing === "hold" ? "hold" : "linear" });
      }
    };
    if (a.easing === "hold" || a.easing === "linear") {
      if (output.length >= maxKeys) throw new Error("Motion sampling exceeds key budget");
      output.push({ ...b, easing: b.easing === "hold" ? "hold" : "linear" });
    } else subdivide(a.frame, b.frame);
  }
  return { property: track.property, keys: output };
}
