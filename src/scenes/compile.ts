import { sceneSpec, type CompiledScene, type CompileContext, type ResolvedNode } from "./model.js";
import { resolveLayout } from "./layout.js";
export function compileScene(input: unknown, context: CompileContext = {}): CompiledScene {
  const spec = sceneSpec.parse(input);
  const byId = new Map(spec.nodes.map((node) => [node.id, node]));
  if (byId.size !== spec.nodes.length) throw new Error("Duplicate scene node IDs");
  let sampleWork = 0;
  const nodes: ResolvedNode[] = spec.nodes.map((node) => {
    const endFrame = node.endFrame ?? spec.durationFrames;
    if (node.startFrame >= endFrame || endFrame > spec.durationFrames)
      throw new Error(`Node ${node.id}: invalid timing`);
    if (node.parent && (!byId.has(node.parent) || byId.get(node.parent)!.type !== "group"))
      throw new Error(`Node ${node.id}: parent must reference a group`);
    const seen = new Set([node.id]);
    let parent = node.parent;
    while (parent) {
      if (seen.has(parent)) throw new Error(`Node ${node.id}: parent cycle`);
      seen.add(parent);
      parent = byId.get(parent)?.parent;
    }
    if (node.layout && node.type !== "group")
      throw new Error(`Node ${node.id}: layout requires a group`);
    if (node.type === "text" && (!node.text || !node.font || !node.fontSize))
      throw new Error(`Node ${node.id}: text, font and fontSize required`);
    if (
      node.type !== "text" &&
      (node.text !== undefined || node.font !== undefined || node.fontSize !== undefined)
    )
      throw new Error(`Node ${node.id}: text properties require text type`);
    if (
      node.type === "group" &&
      (node.opacity !== 100 || node.motion.some((t) => t.property === "opacity"))
    )
      throw new Error(`Node ${node.id}: group opacity is unsupported by native null parenting`);
    if ((node.type === "line") !== Boolean(node.connector))
      throw new Error(`Node ${node.id}: line requires connector and connector requires line`);
    const measured = context.textBounds?.[node.id];
    const width =
      node.type === "line"
        ? 1
        : (node.width ?? (node.type === "text" ? measured?.width : undefined));
    const height =
      node.type === "line"
        ? 1
        : (node.height ?? (node.type === "text" ? measured?.height : undefined));
    if (
      !width ||
      !height ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 0 ||
      height < 0 ||
      width > 16384 ||
      height > 16384
    )
      throw new Error(`Node ${node.id}: explicit dimensions or measured text bounds required`);
    const properties = new Set<string>();
    for (const track of node.motion) {
      sampleWork += track.keys[track.keys.length - 1].frame - track.keys[0].frame;
      if (sampleWork > 200000)
        throw new Error("Scene motion exceeds total 200000 frame sampling budget");
      if (properties.has(track.property))
        throw new Error(`Node ${node.id}: duplicate motion property`);
      properties.add(track.property);
      let previous = -1;
      for (const key of track.keys) {
        if (key.frame <= previous || key.frame < node.startFrame || key.frame >= endFrame)
          throw new Error(`Node ${node.id}: keys must be increasing and within visible timing`);
        previous = key.frame;
        if (
          track.property === "opacity" &&
          Array.isArray(key.easing) &&
          (key.easing[1] < 0 || key.easing[1] > 1 || key.easing[3] < 0 || key.easing[3] > 1)
        )
          throw new Error(`Node ${node.id}: opacity overshoot is unsupported`);
        const vector = track.property === "position" || track.property === "scale";
        if (Array.isArray(key.value) !== vector)
          throw new Error(`Node ${node.id}: invalid motion value arity`);
        if (
          track.property === "opacity" &&
          ((key.value as number) < 0 || (key.value as number) > 100)
        )
          throw new Error(`Node ${node.id}: opacity key outside 0..100`);
      }
    }
    const { motion, ...rest } = node;
    return { ...rest, width, height, endFrame, tracks: motion };
  });
  const resolved = resolveLayout(nodes, spec.width, spec.height);
  const lookup = new Map(resolved.map((n) => [n.id, n]));
  for (const node of resolved) {
    let parent = node.parent;
    while (parent) {
      const p = lookup.get(parent)!;
      node.startFrame = Math.max(node.startFrame, p.startFrame);
      node.endFrame = Math.min(node.endFrame, p.endFrame);
      parent = p.parent;
    }
    if (node.startFrame >= node.endFrame)
      throw new Error(`Node ${node.id}: no visible interval inside parent`);
    if (node.type !== "line") continue;
    if (
      node.anchor !== "top-left" ||
      node.x !== 0 ||
      node.y !== 0 ||
      node.rotation !== 0 ||
      node.scale.some((v) => v !== 100) ||
      node.tracks.some((t) => t.property !== "opacity") ||
      (node.parent && lookup.get(node.parent)!.layout)
    )
      throw new Error(`Node ${node.id}: transformed or layout-managed connectors unsupported`);
    const point = (endpoint: NonNullable<typeof node.connector>["from"]): [number, number] => {
      const target = lookup.get(endpoint.node);
      if (
        !target ||
        target.type === "line" ||
        target.parent !== node.parent ||
        target.rotation !== 0 ||
        target.scale.some((v) => v !== 100) ||
        target.tracks.some((t) => t.property !== "opacity")
      )
        throw new Error(
          `Node ${node.id}: connector endpoints must be static siblings without transforms`,
        );
      const dx =
        endpoint.edge === "left" ? 0 : endpoint.edge === "right" ? target.width : target.width / 2;
      const dy =
        endpoint.edge === "top"
          ? 0
          : endpoint.edge === "bottom"
            ? target.height
            : target.height / 2;
      return [target.x + dx + endpoint.offset[0], target.y + dy + endpoint.offset[1]];
    };
    node.linePoints = [point(node.connector!.from), point(node.connector!.to)];
  }
  return { spec, nodes: resolved };
}

/** Concatenates scenes at frame boundaries; dimensions and frame rate must match. */
export function sequenceScenes(
  inputs: unknown[],
  id: string,
  name: string,
  context: CompileContext = {},
): CompiledScene {
  if (!inputs.length || inputs.length > 100) throw new Error("Sequence requires 1..100 scenes");
  const scenes = inputs.map((input) => sceneSpec.parse(input));
  const first = scenes[0];
  let offset = 0;
  const nodes: typeof first.nodes = [];
  scenes.forEach((scene, index) => {
    if (scene.width !== first.width || scene.height !== first.height || scene.fps !== first.fps)
      throw new Error("Sequence dimensions and fps must match");
    const prefix = `s${index}_`;
    for (const node of scene.nodes) {
      nodes.push({
        ...node,
        id: prefix + node.id,
        parent: node.parent ? prefix + node.parent : undefined,
        startFrame: node.startFrame + offset,
        endFrame: (node.endFrame ?? scene.durationFrames) + offset,
        connector: node.connector
          ? {
              from: { ...node.connector.from, node: prefix + node.connector.from.node },
              to: { ...node.connector.to, node: prefix + node.connector.to.node },
            }
          : undefined,
        motion: node.motion.map((track) => ({
          ...track,
          keys: track.keys.map((key) => ({ ...key, frame: key.frame + offset })),
        })),
      });
    }
    offset += scene.durationFrames;
  });
  return compileScene(
    {
      id,
      name,
      width: first.width,
      height: first.height,
      fps: first.fps,
      durationFrames: offset,
      nodes,
    },
    context,
  );
}
