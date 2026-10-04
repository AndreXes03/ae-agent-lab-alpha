import { test, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initializeReviewSession,
  serveReview,
  readReviewInbox,
  acknowledgeReview,
} from "../src/review-session.js";

test("loopback feedback validates identity, requires origin/token, persists receipts and honest agent status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kynem-inbox-"));
  let server: any;
  try {
    const review = {
      videoDigest: "digest",
      video: "video.mp4",
      compId: "26",
      compName: "Demo",
      version: "v1",
      fps: 30,
      startFrame: 60,
    };
    await writeFile(join(dir, "index.html"), "preview");
    await writeFile(join(dir, "video.mp4"), "0123456789");
    await initializeReviewSession(dir, { kind: "video", review });
    const service = await serveReview(dir);
    server = service.server;
    const session: any = await (await fetch(service.url + "/api/session")).json();
    const payload = {
      schemaVersion: 2,
      context: review,
      duration: 2,
      feedback: [
        { id: "n1", type: "range", time: 0.2, start: 0.2, end: 1, note: "Shorten this settle" },
      ],
    };
    const input = { sessionId: session.sessionId, context: session.context, feedback: payload };
    const send = (value: any = input, headers: any = {}) =>
      fetch(service.url + "/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: service.url,
          "X-Kynem-Token": session.token,
          ...headers,
        },
        body: JSON.stringify(value),
      });
    expect((await send(input, { Origin: "https://foreign.example" })).status).toBe(403);
    expect((await send(input, { "X-Kynem-Token": "wrong" })).status).toBe(403);
    expect(
      (await send({ ...input, feedback: { ...payload, context: { ...review, version: "v0" } } }))
        .status,
    ).toBe(400);
    expect(
      (
        await send({
          ...input,
          feedback: { ...payload, feedback: [{ ...payload.feedback[0], end: 3 }] },
        })
      ).status,
    ).toBe(400);
    const response = await send();
    expect(response.status).toBe(201);
    const receipt: any = await response.json();
    expect(receipt.status.state).toBe("queued");
    expect(receipt.status.message).toContain("invoke KYNEM");
    const duplicate: any = await (await send()).json();
    expect(duplicate.feedbackId).toBe(receipt.feedbackId);
    expect(duplicate.duplicate).toBe(true);
    const inbox = await readReviewInbox(dir);
    expect(inbox.feedback).toHaveLength(1);
    expect(inbox.feedback[0].payload.feedback[0].note).toBe("Shorten this settle");
    await acknowledgeReview(dir, receipt.feedbackId, "processing", "Reading requested change");
    expect(((await (await fetch(service.url + "/api/status")).json()) as any).state).toBe(
      "processing",
    );
    await writeFile(join(dir, "latest.html"), "new preview");
    await acknowledgeReview(
      dir,
      receipt.feedbackId,
      "completed",
      "Saved updated copy",
      "latest.html",
    );
    expect(((await (await fetch(service.url + "/api/status")).json()) as any).latestPreview).toBe(
      "latest.html",
    );
    await Promise.all([
      send({
        ...input,
        feedback: {
          ...payload,
          feedback: [
            ...payload.feedback,
            { ...payload.feedback[0], id: "n2", note: "Raise the title" },
          ],
        },
      }),
      acknowledgeReview(dir, receipt.feedbackId, "completed", "Completed earlier request"),
    ]);
    const pendingStatus: any = await (await fetch(service.url + "/api/status")).json();
    expect(pendingStatus.state).toBe("queued");
    expect(pendingStatus.pendingCount).toBe(1);
    expect(pendingStatus.latestPreview).toBe("latest.html");
    const freshInbox = await readReviewInbox(dir);
    expect(freshInbox.feedback[0].payload.feedback).toHaveLength(1);
    expect(freshInbox.feedback[0].payload.feedback[0].id).toBe("n2");
    await acknowledgeReview(dir, freshInbox.feedback[0].id, "failed", "Could not locate target");
    const retry = await send({
      ...input,
      feedback: {
        ...payload,
        feedback: [
          ...payload.feedback,
          { ...payload.feedback[0], id: "n2", note: "Raise the title" },
        ],
      },
    });
    expect(retry.status).toBe(201);
    expect((await readReviewInbox(dir)).feedback[0].payload.feedback[0].id).toBe("n2");

    expect((await fetch(service.url + "/.kynem-review.json")).status).toBe(404);
    expect((await fetch(service.url + "/production.json")).status).toBe(404);
    const range = await fetch(service.url + "/video.mp4", { headers: { Range: "bytes=2-4" } });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe("234");
    await symlink(join(dir, "index.html"), join(dir, "escape.html"));
    expect((await fetch(service.url + "/escape.html")).status).toBe(404);
    await expect(
      acknowledgeReview(dir, receipt.feedbackId, "completed", "x", "../other.html"),
    ).rejects.toThrow("Preview");
  } finally {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});

test("storyboard inbox binds manifest, revision, hashes and scene targets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kynem-board-inbox-"));
  let server: any;
  try {
    await writeFile(join(dir, "index.html"), "board");
    const context = {
      kind: "storyboard",
      manifestHash: "hash",
      revision: "r1",
      sceneHashes: { scene: "s" },
      sceneIds: ["scene"],
      transitionIds: ["join"],
    };
    await initializeReviewSession(dir, context);
    const service = await serveReview(dir);
    server = service.server;
    const session: any = await (await fetch(service.url + "/api/session")).json();
    const note = {
      target: { id: "join", kind: "motion" },
      position: { x: 0.5, y: 0.4 },
      note: "Faster transition",
    };
    const payload = {
      schemaVersion: 1,
      manifestHash: "hash",
      revision: "r1",
      sceneHashes: { scene: "s" },
      feedback: [note],
    };
    const send = (feedback: any) =>
      fetch(service.url + "/api/feedback", {
        method: "POST",
        headers: {
          Origin: service.url,
          "Content-Type": "application/json",
          "X-Kynem-Token": session.token,
        },
        body: JSON.stringify({ sessionId: session.sessionId, context, feedback }),
      });
    expect((await send({ ...payload, revision: "stale" })).status).toBe(400);
    expect(
      (
        await send({
          ...payload,
          feedback: [{ ...note, target: { id: "unknown", kind: "styling" } }],
        })
      ).status,
    ).toBe(400);
    expect((await send(payload)).status).toBe(201);
    expect((await readReviewInbox(dir)).feedback[0].state).toBe("queued");
    expect(await readFile(join(dir, "index.html"), "utf8")).toBe("board");
  } finally {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await rm(dir, { recursive: true, force: true });
  }
});
