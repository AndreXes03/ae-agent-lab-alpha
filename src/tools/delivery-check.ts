import { checkDelivery, deliveryCheckSchema } from "../workflows/delivery.js";
import { defineTool, jsonResult } from "./define-tool.js";

export const deliveryCheckTool = defineTool({
  name: "ae_delivery_check",
  title: "Check delivery evidence",
  description:
    "Bounded offline preflight comparing a delivery manifest with supplied readback and artifact-specific frame, playback and audio reviews. Never contacts AE, reads media or mutates a project. Passing supplied evidence is not native or visual verification.",
  group: "inspect",
  blockedInReadOnly: false,
  effect: "read",
  inputShape: { spec: deliveryCheckSchema },
  handler: async ({ spec }) => jsonResult(checkDelivery(spec)),
});
