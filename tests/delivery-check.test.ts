import { describe, expect, it } from "vitest";
import {
  checkDelivery,
  deliveryCheckSchema,
  type DeliveryCheckRequest,
} from "../src/workflows/delivery.js";

function fixture(): DeliveryCheckRequest {
  const identity = { compId: 42, sourceVersion: "copy-v2", artifactId: "sha256:example" };
  const review = { identity, passed: true, notes: "Reviewed exact output" };
  return {
    outputs: [
      {
        identity,
        name: "FINAL_15s",
        folder: "Delivery",
        durationFrames: 375,
        fps: 25,
        requiredText: ["Brand"],
        audioDecision: "required",
      },
    ],
    observations: [
      {
        identity,
        name: "FINAL_15s",
        folder: "Delivery",
        durationFrames: 375,
        fps: 25,
        textLabels: ["Brand"],
        audioPresent: true,
        frameReview: review,
        playbackReview: review,
        audioReview: review,
      },
    ],
  };
}
describe("offline delivery evidence", () => {
  it("rejects a 20 second output against a 15 second contract", () => {
    const spec = fixture();
    spec.observations[0].durationFrames = 500;
    expect(checkDelivery(spec).outputs[0].blockers).toContain("durationFrames-mismatch");
  });
  it("blocks missing and unknown audio decisions", () => {
    for (const decision of [undefined, "unknown"] as const) {
      const spec = fixture();
      spec.outputs[0].audioDecision = decision;
      expect(checkDelivery(spec).suppliedEvidencePassed).toBe(false);
    }
  });
  it("requires reviews tied to the exact artifact", () => {
    const spec = fixture();
    spec.observations[0].playbackReview = {
      identity: { ...spec.outputs[0].identity, artifactId: "old-render" },
      passed: true,
      notes: "Old render",
    };
    expect(checkDelivery(spec).outputs[0].blockers).toContain(
      "playbackReview-missing-failed-or-wrong-artifact",
    );
  });
  it("accepts explicit intentional silence with reviewed evidence but never claims AE verification", () => {
    const spec = fixture();
    spec.outputs[0].audioDecision = "intentional-none";
    spec.observations[0].audioPresent = false;
    const result = checkDelivery(spec);
    expect(result.suppliedEvidencePassed).toBe(true);
    expect(result.actualAeVerified).toBe(false);
    expect(result.notVerified.length).toBeGreaterThan(0);
  });
  it("cannot pass on metadata or audio presence alone", () => {
    const spec = fixture();
    delete spec.observations[0].frameReview;
    delete spec.observations[0].audioReview;
    expect(checkDelivery(spec).suppliedEvidencePassed).toBe(false);
  });
  it("bounds arrays and rejects invalid protected ranges", () => {
    const spec = fixture();
    spec.outputs[0].protectedRanges = [{ startFrame: 10, endFrame: 5, signature: "unchanged" }];
    expect(deliveryCheckSchema.safeParse(spec).success).toBe(false);
    expect(
      deliveryCheckSchema.safeParse({
        outputs: Array(51).fill(fixture().outputs[0]),
        observations: [],
      }).success,
    ).toBe(false);
  });
});
