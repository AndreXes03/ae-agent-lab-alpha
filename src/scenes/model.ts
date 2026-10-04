import { z } from "zod";
const finite = z.number().finite();
const coordinate = finite.min(-100000).max(100000);
const dimension = finite.positive().max(16384);
const reservedIds = new Set([...Object.getOwnPropertyNames(Object.prototype), "prototype"]);
const id = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
  .refine((value) => !reservedIds.has(value), "Reserved scene identifier");
export const easingSpec = z.union([
  z.enum(["linear", "hold"]),
  z.tuple([
    finite.min(0).max(1),
    finite.min(-10).max(10),
    finite.min(0).max(1),
    finite.min(-10).max(10),
  ]),
]);
export type Easing = z.infer<typeof easingSpec>;
export const motionTrackSpec = z
  .object({
    property: z.enum(["position", "opacity", "rotation", "scale"]),
    keys: z
      .array(
        z
          .object({
            frame: z.number().int().min(0).max(180000),
            value: z.union([coordinate, z.tuple([coordinate, coordinate])]),
            easing: easingSpec.default("linear"),
          })
          .strict(),
      )
      .min(2)
      .max(256),
  })
  .strict();
export type MotionTrack = z.infer<typeof motionTrackSpec>;
const endpointSpec = z
  .object({
    node: id,
    edge: z.enum(["left", "right", "top", "bottom", "center"]),
    offset: z.tuple([coordinate, coordinate]).default([0, 0]),
  })
  .strict();
const nodeSpec = z
  .object({
    id,
    type: z.enum(["group", "rect", "text", "line"]),
    parent: id.optional(),
    connector: z.object({ from: endpointSpec, to: endpointSpec }).strict().optional(),
    strokeWidth: finite.positive().max(1000).default(2),
    x: coordinate.default(0),
    y: coordinate.default(0),
    width: dimension.optional(),
    height: dimension.optional(),
    text: z.string().max(10000).optional(),
    font: z.string().min(1).max(200).optional(),
    fontSize: dimension.optional(),
    color: z
      .tuple([finite.min(0).max(1), finite.min(0).max(1), finite.min(0).max(1)])
      .default([1, 1, 1]),
    opacity: finite.min(0).max(100).default(100),
    rotation: coordinate.default(0),
    scale: z.tuple([coordinate, coordinate]).default([100, 100]),
    startFrame: z.number().int().min(0).default(0),
    endFrame: z.number().int().positive().optional(),
    anchor: z.enum(["top-left", "center", "bottom-right"]).default("top-left"),
    layout: z
      .object({
        type: z.enum(["stack", "grid"]),
        direction: z.enum(["horizontal", "vertical"]).default("vertical"),
        gap: finite.min(0).max(16384).default(0),
        padding: finite.min(0).max(16384).default(0),
        columns: z.number().int().min(1).max(100).default(1),
      })
      .strict()
      .optional(),
    motion: z.array(motionTrackSpec).max(4).default([]),
  })
  .strict();
export const sceneSpec = z
  .object({
    id,
    name: z.string().min(1).max(200),
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
    fps: z.number().int().min(1).max(120),
    durationFrames: z.number().int().positive().max(180000),
    nodes: z.array(nodeSpec).min(1).max(500),
  })
  .strict();
export type SceneSpec = z.infer<typeof sceneSpec>;
export type SceneNode = SceneSpec["nodes"][number];
export interface ResolvedNode extends Omit<SceneNode, "width" | "height" | "endFrame" | "motion"> {
  width: number;
  height: number;
  endFrame: number;
  tracks: MotionTrack[];
  linePoints?: [[number, number], [number, number]];
}
export interface CompiledScene {
  spec: SceneSpec;
  nodes: ResolvedNode[];
}
export interface CompileContext {
  textBounds?: Record<string, { width: number; height: number }>;
}
