import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

async function bridge(request?: any) {
  const source = await readFile(new URL("../assets/codex-feedback.js", import.meta.url), "utf8");
  const document: any = { oai: request ? { annotation: { request } } : undefined };
  const sandbox: any = { document, TextEncoder };
  runInNewContext(source, sandbox);
  return {
    api: sandbox.KynemCodexFeedback,
    target: { ownerDocument: document, isConnected: true },
  };
}
const payload = { feedback: [{ id: "note", note: "Make the title brighter" }] };
const session = {
  sessionId: "session",
  reviewDir: "/local/review",
  contextHash: "context-sha",
  context: { kind: "video", review: { videoDigest: "video-sha" } },
};
test("native annotation remains synchronous, bounded, user-submitted and never claims delivery", async () => {
  let calls = 0,
    options: any;
  const { api, target } = await bridge((_target: any, opts: any) => {
    calls++;
    options = opts;
    return { accepted: true };
  });
  const result = api.request({
    target,
    session,
    receipt: { feedbackId: "receipt" },
    payload,
    submittedPayload: payload,
  });
  expect(calls).toBe(1);
  expect(result.accepted).toBe(true);
  expect(result.reason).toContain("delivery is not yet confirmed");
  expect(options.metadata.receiptId).toBe("receipt");
  expect(options.metadata.reviewDir).toBe("/local/review");
  expect(Object.keys(options.metadata)).toHaveLength(6);
  expect(options.initialComment.length).toBeLessThanOrEqual(240);
  expect(
    Object.values(options.metadata).every(
      (v) => typeof v === "string" && (v as string).length <= 256,
    ),
  ).toBe(true);
  expect(options.metadata).not.toHaveProperty("token");
  const changed = api.request({
    target,
    session,
    receipt: { feedbackId: "receipt" },
    payload: { feedback: [{ id: "note", note: "different" }] },
    submittedPayload: payload,
  });
  expect(changed.accepted).toBe(false);
  expect(calls).toBe(1);
  const oversized = api.request({
    target,
    session: { ...session, reviewDir: "x".repeat(257) },
    receipt: { feedbackId: "receipt" },
    payload,
    submittedPayload: payload,
  });
  expect(oversized.accepted).toBe(false);
  expect(calls).toBe(1);
});
test("unsupported, declined and throwing host APIs retain local feedback fallback", async () => {
  const unsupported = await bridge();
  expect(unsupported.api.available()).toBe(false);
  expect(unsupported.api.request({}).accepted).toBe(false);
  for (const request of [
    () => ({ accepted: false }),
    () => {
      throw Error("permission denied");
    },
  ]) {
    const { api, target } = await bridge(request);
    const result = api.request({
      target,
      session,
      receipt: { feedbackId: "receipt" },
      payload,
      submittedPayload: payload,
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("queued locally");
  }
});
