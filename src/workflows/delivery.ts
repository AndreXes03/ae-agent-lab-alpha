import { z } from "zod";

const label = z.string().trim().min(1).max(512);
const frame = z.number().int().min(0).max(10_000_000);
const identity = z.strictObject({
  compId: z.number().int().positive(),
  sourceVersion: label,
  artifactId: label.describe("Exact immutable output identity, preferably a file SHA-256."),
});
const review = z.strictObject({
  identity,
  passed: z.boolean(),
  notes: label,
});
const protectedRange = z
  .strictObject({ startFrame: frame, endFrame: frame, signature: label })
  .refine((v) => v.endFrame > v.startFrame, "endFrame must exceed startFrame");
const output = z.strictObject({
  identity,
  name: label,
  folder: label,
  durationFrames: frame.refine((v) => v > 0),
  fps: z.number().finite().min(1).max(240),
  requiredText: z.array(label).max(100),
  audioDecision: z.enum(["required", "intentional-none", "unknown"]).optional(),
  protectedRanges: z.array(protectedRange).max(100).optional(),
});
export const deliveryCheckSchema = z.strictObject({
  outputs: z.array(output).min(1).max(50),
  observations: z
    .array(
      z.strictObject({
        identity,
        name: label,
        folder: label,
        durationFrames: frame,
        fps: z.number().finite().min(1).max(240),
        textLabels: z.array(label).max(100),
        audioPresent: z.boolean().optional(),
        protectedRanges: z.array(protectedRange).max(100).optional(),
        frameReview: review.optional(),
        playbackReview: review.optional(),
        audioReview: review.optional(),
      }),
    )
    .max(50),
});
export type DeliveryCheckRequest = z.infer<typeof deliveryCheckSchema>;

const sameIdentity = (a: z.infer<typeof identity>, b: z.infer<typeof identity>) =>
  a.compId === b.compId && a.sourceVersion === b.sourceVersion && a.artifactId === b.artifactId;

/** Offline evaluation only: caller-supplied observations are never independently verified. */
export function checkDelivery(input: DeliveryCheckRequest) {
  const spec = deliveryCheckSchema.parse(input);
  const results = spec.outputs.map((expected) => {
    const blockers: string[] = [];
    const matches = spec.observations.filter((o) => sameIdentity(expected.identity, o.identity));
    const observation = matches.length === 1 ? matches[0] : undefined;
    if (!observation)
      blockers.push(matches.length ? "ambiguous-observations" : "missing-exact-observation");
    if (spec.outputs.filter((o) => o.identity.compId === expected.identity.compId).length > 1)
      blockers.push("duplicate-output-comp-id");
    const structuralBlockers: string[] = [];
    if (observation) {
      for (const key of ["name", "folder", "durationFrames", "fps"] as const)
        if (observation[key] !== expected[key]) structuralBlockers.push(`${key}-mismatch`);
      for (const text of expected.requiredText)
        if (!observation.textLabels.includes(text)) structuralBlockers.push(`missing-text:${text}`);
      for (const range of expected.protectedRanges ?? []) {
        if (range.endFrame > expected.durationFrames)
          structuralBlockers.push("protected-range-outside-duration");
        if (
          !(observation.protectedRanges ?? []).some(
            (r) =>
              r.startFrame === range.startFrame &&
              r.endFrame === range.endFrame &&
              r.signature === range.signature,
          )
        )
          structuralBlockers.push(`protected-range-mismatch:${range.startFrame}-${range.endFrame}`);
      }
    }
    blockers.push(...structuralBlockers);
    const reviews = { frameReview: false, playbackReview: false, audioReview: false };
    for (const key of ["frameReview", "playbackReview", "audioReview"] as const) {
      const evidence = observation?.[key];
      reviews[key] =
        !!evidence && evidence.passed && sameIdentity(expected.identity, evidence.identity);
      if (!reviews[key]) blockers.push(`${key}-missing-failed-or-wrong-artifact`);
    }
    if (!expected.audioDecision || expected.audioDecision === "unknown")
      blockers.push("audio-decision-required");
    if (expected.audioDecision === "required" && observation?.audioPresent !== true)
      blockers.push("required-audio-unconfirmed");
    if (expected.audioDecision === "intentional-none" && observation?.audioPresent !== false)
      blockers.push("intentional-no-audio-unconfirmed");
    return {
      identity: expected.identity,
      structuralReadbackPassed: !!observation && structuralBlockers.length === 0,
      ...reviews,
      suppliedEvidencePassed: blockers.length === 0,
      blockers,
    };
  });
  return {
    scope: "offline-supplied-evidence-only",
    suppliedEvidencePassed: results.every((r) => r.suppliedEvidencePassed),
    actualAeVerified: false,
    notVerified: [
      "Live AE project state",
      "Observation freshness and truth",
      "Artifact bytes and identity",
      "Rendered frames, playback and audio were not inspected by this tool",
    ],
    outputs: results,
  };
}
