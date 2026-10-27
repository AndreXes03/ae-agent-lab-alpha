import { z } from "zod";
import { sceneSpec } from "../scenes/model.js";
import { compileScene } from "../scenes/compile.js";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const recipeRequest = z.strictObject({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,50}$/),
  recipe: z.enum(["locate-explain-recompose", "comparison", "split-screen"]),
  width: z.number().int().min(320).max(4096),
  height: z.number().int().min(320).max(4096),
  fps: z.number().int().min(1).max(120),
  durationFrames: z.number().int().min(24).max(2400),
  title: z.string().min(1).max(120),
  labels: z.tuple([z.string().min(1).max(120), z.string().min(1).max(120)]),
  font: z.string().min(1),
  outputDirectory: z.string(),
  spokenRange: z.strictObject({
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().positive(),
  }),
  externalMaterials: z
    .array(z.strictObject({ role: z.string(), path: z.string() }))
    .max(16)
    .default([]),
});
export function buildRecipe(raw: unknown) {
  const r = recipeRequest.parse(raw),
    w = r.width,
    h = r.height,
    d = r.durationFrames;
  if (r.spokenRange.endFrame <= r.spokenRange.startFrame)
    throw new Error("Invalid spoken interval");
  const a = Math.floor(d * 0.16),
    b = Math.floor(d * 0.38),
    c = Math.floor(d * 0.72),
    e = Math.floor(d * 0.9);
  const ease: [number, number, number, number] = [0.25, 0, 0.25, 1];
  const panel = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
  ) => [
    { id, type: "group", x, y, width, height },
    { id: id + "_material", parent: id, type: "rect", width, height, color: [0.12, 0.16, 0.2] },
    {
      id: id + "_label",
      parent: id,
      type: "text",
      text: label,
      font: r.font,
      fontSize: Math.round(Math.min(w, h) * 0.035),
      x: 20,
      y: height - 64,
      width: width - 40,
      height: 50,
    },
  ];
  const nodes: unknown[] = [
    { id: "background", type: "rect", width: w, height: h, color: [0.025, 0.035, 0.045] },
    {
      id: "title",
      type: "text",
      text: r.title,
      font: r.font,
      fontSize: Math.round(Math.min(w, h) * 0.055),
      x: w * 0.06,
      y: h * 0.06,
      width: w * 0.88,
      height: h * 0.12,
    },
  ];
  if (r.recipe === "locate-explain-recompose") {
    nodes.push(...panel("subject", w * 0.08, h * 0.25, w * 0.58, h * 0.54, r.labels[0]));
    const group = nodes.find((n) => (n as { id: string }).id === "subject") as Record<
      string,
      unknown
    >;
    group.motion = [
      {
        property: "position",
        keys: [
          { frame: 0, value: [w * 0.08, h * 0.25], easing: ease },
          { frame: b, value: [w * 0.03, h * 0.22], easing: "hold" },
          { frame: c, value: [w * 0.03, h * 0.22], easing: ease },
          { frame: e, value: [w * 0.08, h * 0.25], easing: "hold" },
        ],
      },
      {
        property: "scale",
        keys: [
          { frame: a, value: [100, 100], easing: ease },
          { frame: b, value: [115, 115], easing: "hold" },
          { frame: c, value: [115, 115], easing: ease },
          { frame: e, value: [100, 100], easing: "hold" },
        ],
      },
    ];
    nodes.push({
      id: "focus",
      parent: "subject",
      type: "rect",
      x: w * 0.15,
      y: h * 0.12,
      width: w * 0.12,
      height: h * 0.12,
      color: [0.95, 0.4, 0.2],
      opacity: 25,
      startFrame: a,
      endFrame: e,
    });
    nodes.push({
      id: "explanation",
      type: "text",
      text: r.labels[1],
      font: r.font,
      fontSize: Math.round(Math.min(w, h) * 0.04),
      x: w * 0.7,
      y: h * 0.4,
      width: w * 0.25,
      height: h * 0.3,
      startFrame: b,
      endFrame: c,
    });
  } else {
    const horizontal = r.recipe === "comparison";
    const pw = horizontal ? w * 0.42 : w * 0.84,
      ph = horizontal ? h * 0.58 : h * 0.29;
    nodes.push(...panel("first", w * 0.06, h * 0.25, pw, ph, r.labels[0]));
    nodes.push(
      ...panel(
        "second",
        horizontal ? w * 0.52 : w * 0.06,
        horizontal ? h * 0.25 : h * 0.58,
        pw,
        ph,
        r.labels[1],
      ),
    );
    for (const id of ["first", "second"]) {
      const group = nodes.find((n) => (n as { id: string }).id === id) as Record<string, unknown>;
      const start = id === "first" ? 0 : a;
      group.motion = [
        {
          property: "position",
          keys: [
            { frame: start, value: [group.x, Number(group.y) + 40], easing: ease },
            { frame: start + a, value: [group.x, group.y], easing: "hold" },
          ],
        },
      ];
    }
  }
  const scene = sceneSpec.parse({
    id: r.id,
    name: r.title,
    width: w,
    height: h,
    fps: r.fps,
    durationFrames: d,
    nodes,
  });
  compileScene(scene);
  return {
    scene,
    production: {
      recipe: r.recipe,
      spokenRange: r.spokenRange,
      externalMaterials: r.externalMaterials,
      materialSlots: scene.nodes.filter((n) => n.id.endsWith("_material")).map((n) => n.id),
      note: "Material rectangles are explicit slots; supplied footage/3D sources must be inserted separately as editable sources. The geometry is a native scene recipe, not clinical content.",
      approval: "unreviewed",
      nativePlaybackReviewed: false,
      sequenceReviewRequired: true,
      phases:
        r.recipe === "locate-explain-recompose"
          ? [
              { name: "locate", start: 0, end: a },
              { name: "enlarge", start: a, end: b },
              { name: "explain", start: b, end: c },
              { name: "recompose", start: c, end: d },
            ]
          : [{ name: r.recipe, start: 0, end: d }],
    },
  };
}
export async function saveRecipe(raw: unknown) {
  const r = recipeRequest.parse(raw),
    built = buildRecipe(r);
  if (!path.isAbsolute(r.outputDirectory))
    throw new Error("Absolute new recipe directory required");
  await mkdir(r.outputDirectory);
  const scenePath = path.join(r.outputDirectory, "scene.json");
  await writeFile(scenePath, JSON.stringify(built.scene, null, 2));
  await writeFile(
    path.join(r.outputDirectory, "production.json"),
    JSON.stringify(built.production, null, 2),
  );
  return {
    scenePath,
    productionPath: path.join(r.outputDirectory, "production.json"),
    nativePlaybackReviewed: false,
  };
}
