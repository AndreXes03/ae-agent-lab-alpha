import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { requireLocal } from "./preflight.js";

const exec = promisify(execFile);
export interface MediaFrame {
  media_type: string;
  stream_index: number;
  best_effort_timestamp_time?: string;
  pkt_duration_time?: string;
  nb_samples?: number;
}
export interface MediaStream {
  index: number;
  codec_type: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  duration?: string;
  side_data_list?: Array<{ rotation?: number }>;
}
export interface Probe {
  streams: MediaStream[];
  frames: MediaFrame[];
  format: { duration?: string };
}
export function mediaExecutables() {
  return {
    ffmpeg: process.env.KYNEM_FFMPEG || "ffmpeg",
    ffprobe: process.env.KYNEM_FFPROBE || "ffprobe",
  };
}
export async function mediaCommand(executable: string, args: string[], timeout = 300_000) {
  try {
    return (
      await exec(executable, args, { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true })
    ).stdout;
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT")
      throw new Error(
        "Install FFmpeg/ffprobe or set KYNEM_FFMPEG and KYNEM_FFPROBE to their executable paths.",
      );
    throw new Error(`Media command failed: ${(e.stderr || e.message).slice(-1500)}`);
  }
}
export async function probeMedia(file: string): Promise<Probe> {
  await requireLocal(file);
  const raw = await mediaCommand(mediaExecutables().ffprobe, [
    "-v",
    "error",
    "-show_streams",
    "-show_format",
    "-show_frames",
    "-show_entries",
    "frame=media_type,stream_index,best_effort_timestamp_time,pkt_duration_time,nb_samples",
    "-of",
    "json",
    file,
  ]);
  const result = JSON.parse(raw) as Probe;
  if (!Array.isArray(result.streams) || !Array.isArray(result.frames) || !result.format)
    throw new Error("Incomplete media probe");
  if (result.frames.length > 300_000) throw new Error("Media exceeds bounded analysis limit");
  return result;
}
const numeric = (s: string | undefined) => (s === undefined ? NaN : Number(s));
export function fraction(value: string | undefined): number {
  if (!value) return NaN;
  const [a, b = "1"] = value.split("/");
  return Number(a) / Number(b);
}
export function analyzeProbe(probe: Probe) {
  const video = probe.streams.find((s) => s.codec_type === "video");
  const audio = probe.streams.filter((s) => s.codec_type === "audio");
  const frames = probe.frames.filter(
    (f) => f.stream_index === video?.index && f.media_type === "video",
  );
  const pts = frames.map((f) => numeric(f.best_effort_timestamp_time));
  const deltas = pts.slice(1).map((p, i) => p - pts[i]);
  const sorted = deltas.filter((d) => Number.isFinite(d) && d > 0).sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  const variable = deltas.some((d) => Math.abs(d - typical) > Math.max(0.00001, typical * 0.01));
  const warnings: string[] = [];
  if (variable) warnings.push("Variable video timestamps or a discontinuity");
  const monotonic = pts.length > 0 && pts.every(Number.isFinite) && deltas.every((d) => d > 0);
  if (!monotonic) warnings.push("Missing or nonmonotonic video timestamps");
  const audioReports = audio.map((s) => {
    const af = probe.frames.filter((f) => f.media_type === "audio" && f.stream_index === s.index);
    const rate = numeric(s.sample_rate);
    let gaps = 0,
      overlaps = 0,
      missingTimestamps = 0;
    for (let i = 0; i < af.length; i++) {
      const at = numeric(af[i].best_effort_timestamp_time);
      if (!Number.isFinite(at) || !af[i].nb_samples) missingTimestamps++;
      if (i > 0) {
        const expected =
          numeric(af[i - 1].best_effort_timestamp_time) + (af[i - 1].nb_samples ?? 0) / rate;
        const delta = at - expected;
        if (delta > 2 / rate) gaps++;
        if (delta < -2 / rate) overlaps++;
      }
    }
    if (gaps || overlaps || missingTimestamps)
      warnings.push(`Audio stream ${s.index}: timestamp discontinuities or missing data`);
    const first = numeric(af[0]?.best_effort_timestamp_time);
    const last = af.at(-1);
    const end = last
      ? numeric(last.best_effort_timestamp_time) + (last.nb_samples ?? 0) / rate
      : NaN;
    return {
      streamIndex: s.index,
      rate,
      decodedFrames: af.length,
      samples: af.reduce((n, f) => n + (f.nb_samples ?? 0), 0),
      firstPts: first,
      endPts: end,
      gaps,
      overlaps,
      missingTimestamps,
    };
  });
  if (audio.length > 1) warnings.push("Multiple audio streams: review intended voice and mix");
  const end = pts.length
    ? pts.at(-1)! + (numeric(frames.at(-1)?.pkt_duration_time) || typical || 0)
    : 0;
  return {
    video: video
      ? {
          width: video.width,
          height: video.height,
          fps: fraction(video.avg_frame_rate),
          decodedFrames: frames.length,
          firstPts: pts[0],
          endPts: end,
          durationSeconds: end - pts[0],
          monotonic,
          variable,
          rotation: video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0,
        }
      : null,
    audio: audioReports,
    warnings,
    pts,
  };
}
export async function fileDigest(file: string) {
  await requireLocal(file);
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function packetDigest(file: string, kind: "audio" | "video") {
  await requireLocal(file);
  const text = await mediaCommand(mediaExecutables().ffmpeg, [
    "-v",
    "error",
    "-copyts",
    "-i",
    file,
    "-map",
    kind === "audio" ? "0:a:0" : "0:v:0",
    "-c",
    "copy",
    "-avoid_negative_ts",
    "disabled",
    "-f",
    "framehash",
    "-hash",
    "sha256",
    "-",
  ]);
  // Retain timebase and packet PTS/DTS/duration/hash. Ignore only build-identifying comments.
  const stable = text
    .split("\n")
    .filter((line) => line.startsWith("#tb") || (line && !line.startsWith("#")))
    .join("\n");
  if (!stable.split("\n").some((line) => !line.startsWith("#")))
    throw new Error(`No ${kind} packets`);
  return createHash("sha256").update(stable).digest("hex");
}
export const audioPacketDigest = (file: string) => packetDigest(file, "audio");
export interface MediaExpectation {
  frames?: number;
  fps?: number;
  width?: number;
  height?: number;
  audio: "required" | "intentional-none";
  referenceAudio?: string;
}
export async function verifyMedia(file: string, expected: MediaExpectation) {
  const beforeDigest = await fileDigest(file);
  const probe = await probeMedia(file);
  const analyzed = analyzeProbe(probe);
  const { pts: _pts, ...report } = analyzed;
  const blockers: string[] = [];
  const v = report.video;
  if (!v || !v.monotonic) blockers.push("Video or monotonic timestamps missing");
  if (expected.frames !== undefined && v?.decodedFrames !== expected.frames)
    blockers.push("Frame count mismatch");
  if (expected.fps !== undefined && (!v || Math.abs(v.fps - expected.fps) > 0.001 || v.variable))
    blockers.push("Frame rate/timing mismatch");
  for (const key of ["width", "height"] as const)
    if (expected[key] !== undefined && expected[key] !== v?.[key]) blockers.push(`${key} mismatch`);
  if (expected.audio === "required" && !report.audio.length)
    blockers.push("Required audio missing");
  if (expected.audio === "intentional-none" && report.audio.length)
    blockers.push("Unexpected audio stream");
  if (report.audio.some((a) => a.gaps || a.overlaps || a.missingTimestamps || !a.samples))
    blockers.push("Audio timestamp continuity failed");
  if (v && expected.audio === "required") {
    for (const a of report.audio) {
      if (
        Math.abs(a.firstPts - v.firstPts) > 1 / v.fps ||
        Math.abs(a.endPts - v.endPts) > 1 / v.fps
      )
        blockers.push("Audio/video boundary mismatch");
    }
  }
  let audioIdentical: boolean | null = null;
  if (expected.referenceAudio) {
    audioIdentical =
      (await audioPacketDigest(file)) === (await audioPacketDigest(expected.referenceAudio));
    if (!audioIdentical) blockers.push("Audio packet payload/timestamp comparison failed");
  }
  await mediaCommand(
    mediaExecutables().ffmpeg,
    ["-v", "error", "-xerror", "-i", file, "-map", "0:v:0", "-map", "0:a?", "-f", "null", "-"],
    3_600_000,
  );
  const digest = await fileDigest(file);
  if (digest !== beforeDigest) blockers.push("Media changed during verification");
  return {
    ...report,
    sha256: digest,
    decoded: true,
    passed: blockers.length === 0,
    blockers,
    audioIdentical,
    playbackReviewed: false,
    audioReviewed: false,
  };
}

export async function masterReferenceAudio(
  video: string,
  referenceAudio: string,
  referenceSha256: string,
  output: string,
) {
  const path = await import("node:path");
  const { lstat } = await import("node:fs/promises");
  if (!path.isAbsolute(output) || !/\.(mp4|mov)$/i.test(output))
    throw new Error("Use a new absolute MP4/MOV output");
  if (await lstat(output).catch(() => null)) throw new Error("Master output already exists");
  if ((await fileDigest(referenceAudio)) !== referenceSha256)
    throw new Error("Reference audio artifact changed");
  const videoDigest = await fileDigest(video);
  const report = analyzeProbe(await probeMedia(video));
  if (!report.video || !report.video.monotonic || report.video.variable)
    throw new Error("Use verified constant-frame-rate video for audio mastering");
  await mediaCommand(mediaExecutables().ffmpeg, [
    "-v",
    "error",
    "-copyts",
    "-i",
    video,
    "-i",
    referenceAudio,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c",
    "copy",
    "-avoid_negative_ts",
    "disabled",
    "-n",
    output,
  ]);
  const verification = await verifyMedia(output, {
    frames: report.video.decodedFrames,
    fps: report.video.fps,
    width: report.video.width,
    height: report.video.height,
    audio: "required",
    referenceAudio,
  });
  if ((await fileDigest(referenceAudio)) !== referenceSha256)
    throw new Error("Reference changed during mastering");
  const videoIdentical =
    (await packetDigest(video, "video")) === (await packetDigest(output, "video"));
  if (!videoIdentical) {
    verification.passed = false;
    verification.blockers.push("Video packet payload/timestamp comparison failed");
  }
  if (videoDigest !== (await fileDigest(video))) throw new Error("Video changed during mastering");
  return {
    outputPath: output,
    passed: verification.passed,
    videoIdentical,
    verification,
    appliedOffsetSeconds: 0,
    playbackReviewed: false,
    audioReviewed: false,
  };
}
