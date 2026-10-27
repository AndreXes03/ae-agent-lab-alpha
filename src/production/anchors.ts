import { z } from "zod";
const finite = z.number().finite();
export const anchorRequest = z.strictObject({
  sourceSize: z.tuple([finite.positive(), finite.positive()]),
  point: z.tuple([finite, finite]),
  coordinates: z.enum(["pixels", "normalized"]),
  sampleTime: finite.nonnegative(),
  // Each entry is the inspected 2D local-to-parent transform at sampleTime.
  chain: z
    .array(
      z.strictObject({
        label: z.string().min(1),
        anchor: z.tuple([finite, finite]),
        position: z.tuple([finite, finite]),
        scale: z.tuple([finite, finite]),
        rotation: finite,
        geometry: z.literal("2d"),
      }),
    )
    .min(1)
    .max(16),
});
export function mapAnchor(raw: unknown) {
  const r = anchorRequest.parse(raw);
  let point: [number, number] =
    r.coordinates === "pixels"
      ? [...r.point]
      : [r.point[0] * r.sourceSize[0], r.point[1] * r.sourceSize[1]];
  const spaces = [{ label: "source", point }];
  for (const t of r.chain) {
    if (!t.scale[0] || !t.scale[1])
      throw new Error("Singular transform cannot define a reliable annotation mapping");
    const rad = (t.rotation * Math.PI) / 180,
      x = ((point[0] - t.anchor[0]) * t.scale[0]) / 100,
      y = ((point[1] - t.anchor[1]) * t.scale[1]) / 100;
    point = [
      t.position[0] + Math.cos(rad) * x - Math.sin(rad) * y,
      t.position[1] + Math.sin(rad) * x + Math.cos(rad) * y,
    ];
    spaces.push({ label: t.label, point });
  }
  return {
    spaces,
    sampleTime: r.sampleTime,
    basis: "supplied inspected 2D transforms",
    semanticAlignmentVerified: false,
    warning:
      "A source change requires landmark review even when dimensions match. 3D, perspective and unsampled expressions are unsupported.",
  };
}
