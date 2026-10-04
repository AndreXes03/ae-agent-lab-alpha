import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, extname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export async function createLocalReview(argv: string[]): Promise<string> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (
      !["--manifest", "--video", "--out", "--comp", "--fps", "--version"].includes(key) ||
      !argv[i + 1] ||
      opts[key]
    )
      throw new Error(`Invalid review option: ${key}`);
    opts[key] = argv[i + 1];
  }
  const manifestPath = opts["--manifest"] && resolve(opts["--manifest"]);
  const manifest = manifestPath ? JSON.parse(await readFile(manifestPath, "utf8")) : {};
  const video = opts["--video"] || manifest.video;
  if (typeof video !== "string" || !video || !opts["--out"])
    throw new Error("review requires --video (or manifest.video) and --out <new directory>");
  const source = isAbsolute(video)
    ? video
    : resolve(manifestPath ? dirname(manifestPath) : process.cwd(), video);
  const extension = extname(source).toLowerCase();
  if (![".mp4", ".mov", ".webm", ".m4v"].includes(extension))
    throw new Error("Unsupported review video format");
  const fps = opts["--fps"] ? Number(opts["--fps"]) : (manifest.fps ?? null);
  const startFrame = manifest.startFrame ?? 0;
  if (fps !== null && (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0 || fps > 1000))
    throw new Error("fps must be a positive number");
  if (!Number.isSafeInteger(startFrame) || startFrame < 0)
    throw new Error("startFrame must be a nonnegative integer");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(source)) hash.update(chunk);
  const videoDigest = hash.digest("hex");
  const context = {
    videoDigest,
    video: `video${extension}`,
    compId:
      typeof manifest.compId === "number" &&
      Number.isSafeInteger(manifest.compId) &&
      manifest.compId > 0
        ? String(manifest.compId)
        : (manifest.compId ?? null),
    compName: opts["--comp"] ?? manifest.compName ?? null,
    version: opts["--version"] ?? manifest.version ?? null,
    fps,
    startFrame,
  };
  for (const key of ["compId", "compName", "version"] as const)
    if (context[key] !== null && typeof context[key] !== "string")
      throw new Error(`${key} must be a string`);
  const template = await readFile(
    fileURLToPath(new URL("../assets/review.html", import.meta.url)),
    "utf8",
  );
  const output = resolve(opts["--out"]);
  // Exclusive directory creation prevents overwriting an earlier review or user files.
  await mkdir(output);
  try {
    await copyFile(source, resolve(output, context.video));
    await writeFile(
      resolve(output, "index.html"),
      template.replace("__REVIEW_CONTEXT__", JSON.stringify(context).replace(/</g, "\\u003c")),
    );
  } catch (error) {
    throw new Error(
      `Review creation failed; partial directory preserved at ${output}: ${String(error)}`,
      { cause: error },
    );
  }
  return resolve(output, "index.html");
}
