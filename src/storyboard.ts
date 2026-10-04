import { initializeReviewSession } from "./review-session.js";
import { readFile, mkdir, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

export function stableJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      // oxlint-disable-next-line unicorn/no-array-sort -- Object.keys creates a new array.
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function contentHash(value: any): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
export function sceneHash(scene: any, spec: any): string {
  return contentHash({
    scene,
    format: spec.format,
    style: spec.style ?? null,
    effects: spec.effects ?? null,
    imageDigest: scene.image ? (spec.imageDigests?.[scene.image] ?? null) : null,
  });
}
const escape = (value: any) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
const finite = (n: any) => typeof n === "number" && Number.isFinite(n);
export function validateStoryboard(spec: any): void {
  if (
    !spec ||
    (spec.schemaVersion ?? spec.version) !== 1 ||
    typeof spec.id !== "string" ||
    typeof spec.revision !== "string" ||
    !["storyboard", "styleframe"].includes(spec.mode)
  )
    throw Error("Invalid storyboard identity/revision/mode");
  if (
    !spec.format ||
    ![spec.format.width, spec.format.height, spec.format.fps].every((n) => finite(n) && n > 0) ||
    spec.format.width > 8192 ||
    spec.format.height > 8192
  )
    throw Error("Invalid format");
  if (!Array.isArray(spec.scenes) || !spec.scenes.length || spec.scenes.length > 100)
    throw Error("Provide 1–100 scenes");
  if (spec.mode === "styleframe" && spec.scenes.length !== 1)
    throw Error("Styleframe mode requires exactly one scene");
  let nextFrame = spec.scenes[0].startFrame;
  const ids = new Set<string>();
  function artwork(frame: any) {
    if (frame.image && typeof frame.image !== "string") throw Error("Image must be a local path");
    if (!frame.image && !Array.isArray(frame.elements)) throw Error("Provide image or elements");
    const elementIds = new Set();
    for (const e of frame.elements ?? []) {
      if (
        !e ||
        typeof e.id !== "string" ||
        elementIds.has(e.id) ||
        !["rect", "text", "ellipse", "line"].includes(e.type) ||
        !finite(e.x) ||
        !finite(e.y)
      )
        throw Error("Invalid or duplicate element");
      elementIds.add(e.id);
      for (const key of ["width", "height", "fontSize", "strokeWidth", "radius", "opacity"])
        if (e[key] !== undefined && !finite(e[key])) throw Error(`Invalid element ${key}`);
      for (const key of ["fill", "stroke"])
        if (
          e[key] !== undefined &&
          !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(e[key])
        )
          throw Error("Use hexadecimal artwork colors");
    }
  }
  for (const scene of spec.scenes) {
    if (
      typeof scene.id !== "string" ||
      ids.has(scene.id) ||
      !Number.isSafeInteger(scene.startFrame) ||
      scene.startFrame < 0 ||
      !Number.isSafeInteger(scene.durationFrames) ||
      scene.durationFrames <= 0
    )
      throw Error("Invalid scene identity/timing");
    if (scene.startFrame !== nextFrame)
      throw Error("Scene timing must be contiguous and nonoverlapping");
    nextFrame += scene.durationFrames;
    ids.add(scene.id);
    artwork(scene);
  }
  const transitionIds = new Set();
  for (const t of spec.transitions ?? []) {
    if (
      !t ||
      typeof t.id !== "string" ||
      transitionIds.has(t.id) ||
      !ids.has(t.fromScene) ||
      !ids.has(t.toScene) ||
      !Number.isSafeInteger(t.durationFrames) ||
      t.durationFrames <= 0 ||
      !Number.isSafeInteger(t.staggerFrames) ||
      t.staggerFrames < 0 ||
      !Array.isArray(t.elementIds) ||
      !t.elementIds.length ||
      typeof t.handoff !== "string" ||
      !t.curve ||
      !t.recipe ||
      !t.properties
    )
      throw Error("Incomplete transition production recipe");
    const index = spec.scenes.findIndex((s: any) => s.id === t.fromScene);
    if (spec.scenes[index + 1]?.id !== t.toScene || ids.has(t.id))
      throw Error("Transitions must link adjacent distinct scenes and use unique IDs");
    const available = new Set(
      [
        ...(spec.scenes[index].elements ?? []),
        ...(spec.scenes[index + 1].elements ?? []),
        ...(t.frame?.elements ?? []),
      ].map((e: any) => e.id),
    );
    if (t.elementIds.some((id: any) => typeof id !== "string" || !available.has(id)))
      throw Error("Unknown transition element ID");
    transitionIds.add(t.id);
    if (t.frame) artwork(t.frame);
  }
  if (spec.mode === "storyboard")
    for (let i = 0; i < spec.scenes.length - 1; i++)
      if (
        !(spec.transitions ?? []).some(
          (t: any) => t.fromScene === spec.scenes[i].id && t.toScene === spec.scenes[i + 1].id,
        )
      )
        throw Error("Missing scene transition");
  for (const approved of spec.approvedScenes ?? []) {
    const scene = spec.scenes.find((s: any) => s.id === approved.id);
    if (!scene || sceneHash(scene, spec) !== approved.hash)
      throw Error(`Approved scene changed: ${approved.id}. Explicitly unlock it before revision.`);
  }
}
export function renderStyleframe(scene: any, spec: any): string {
  const { width, height } = spec.format;
  const background = spec.style?.background ?? "#080c15";
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(background))
    throw Error("Use hexadecimal background color");
  const elements = scene.elements
    .map((e: any) => {
      const attrs = `fill="${escape(e.fill ?? (e.type === "text" ? "#ffffff" : "none"))}" stroke="${escape(e.stroke ?? "none")}" stroke-width="${e.strokeWidth ?? 0}" opacity="${e.opacity ?? 1}"`;
      if (e.type === "text")
        return `<text x="${e.x}" y="${e.y}" font-family="${escape(e.fontFamily ?? spec.style?.fontFamily ?? "Arial")}" font-size="${e.fontSize ?? 32}" ${attrs}>${escape(e.text)}</text>`;
      if (e.type === "ellipse")
        return `<ellipse cx="${e.x + (e.width ?? 0) / 2}" cy="${e.y + (e.height ?? 0) / 2}" rx="${(e.width ?? 0) / 2}" ry="${(e.height ?? 0) / 2}" ${attrs}/>`;
      if (e.type === "line")
        return `<line x1="${e.x}" y1="${e.y}" x2="${e.x + (e.width ?? 0)}" y2="${e.y + (e.height ?? 0)}" ${attrs}/>`;
      return `<rect x="${e.x}" y="${e.y}" width="${e.width ?? 0}" height="${e.height ?? 0}" rx="${e.radius ?? 0}" ${attrs}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${background}"/>${elements}</svg>`;
}
export async function createStoryboard(argv: string[]): Promise<string> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--manifest", "--out"].includes(argv[i]) || !argv[i + 1] || opts[argv[i]])
      throw Error("Use storyboard --manifest <json> --out <new directory>");
    opts[argv[i]] = argv[i + 1];
  }
  if (!opts["--manifest"] || !opts["--out"]) throw Error("Manifest and output required");
  const manifestPath = resolve(opts["--manifest"]),
    spec = JSON.parse(await readFile(manifestPath, "utf8"));
  // Resolve supplied image identities before validating any existing scene approvals.
  const imageDigests: Record<string, string> = {};
  for (const artwork of [
    ...(spec.scenes ?? []),
    ...(spec.transitions ?? []).map((t: any) => t.frame).filter(Boolean),
  ])
    if (typeof artwork.image === "string")
      imageDigests[artwork.image] = createHash("sha256")
        .update(await readFile(resolve(dirname(manifestPath), artwork.image)))
        .digest("hex");
  if (Object.keys(imageDigests).length) spec.imageDigests = imageDigests;
  validateStoryboard(spec);
  const template = await readFile(
    fileURLToPath(new URL("../assets/storyboard.html", import.meta.url)),
    "utf8",
  );
  const output = resolve(opts["--out"]);
  await mkdir(output);
  const frames: any[] = [];
  let serial = 0;
  async function frame(s: any, kind: string) {
    const number = ++serial;
    let file = `frame-${number}.svg`,
      source = "schematic";
    if (s.image) {
      const sourcePath = resolve(dirname(manifestPath), s.image);
      const ext = extname(sourcePath).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext))
        throw Error("Supplied artwork must be local PNG/JPEG/WebP");
      file = `frame-${number}${ext}`;
      await copyFile(sourcePath, resolve(output, file));
      source = "supplied image";
    } else await writeFile(resolve(output, file), renderStyleframe(s, spec));
    return { id: s.id, title: s.title ?? s.id, file, kind, source };
  }
  for (const s of spec.scenes) frames.push(await frame(s, "scene"));
  const transitions = [];
  for (const t of spec.transitions ?? [])
    transitions.push({
      ...t,
      preview: t.frame
        ? await frame({ ...t.frame, id: t.id, title: t.title ?? t.id }, "transition")
        : null,
    });
  const context = {
    spec,
    manifestHash: contentHash(spec),
    sceneHashes: Object.fromEntries(spec.scenes.map((s: any) => [s.id, sceneHash(s, spec)])),
    frames,
    transitions,
  };
  await writeFile(
    resolve(output, "production.json"),
    JSON.stringify({ ...context, approval: null }, null, 2),
  );
  await writeFile(
    resolve(output, "index.html"),
    template.replace("__STORYBOARD_CONTEXT__", JSON.stringify(context).replace(/</g, "\\u003c")),
  );
  await initializeReviewSession(output, {
    kind: "storyboard",
    manifestHash: context.manifestHash,
    revision: spec.revision,
    sceneHashes: context.sceneHashes,
    sceneIds: spec.scenes.map((s: any) => s.id),
    transitionIds: (spec.transitions ?? []).map((t: any) => t.id),
  });
  return resolve(output, "index.html");
}
