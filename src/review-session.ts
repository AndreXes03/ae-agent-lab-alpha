import { createServer, type Server } from "node:http";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, readdir, lstat, realpath, rename, mkdir, rm } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import { stableJson } from "./storyboard.js";

const descriptor = ".kynem-review.json";
const states = new Set(["idle", "queued", "processing", "completed", "failed"]);
const mime: Record<string, string> = {
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/mp4",
};
export async function initializeReviewSession(dir: string, context: any): Promise<void> {
  await writeFile(
    resolve(dir, descriptor),
    JSON.stringify({
      sessionId: randomUUID(),
      context,
      status: { state: "idle", message: "Ready for feedback", updatedAt: new Date().toISOString() },
    }),
    { flag: "wx", mode: 0o600 },
  );
}
async function readSession(dir: string): Promise<any> {
  const path = resolve(dir, descriptor);
  if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink())
    throw Error("Invalid review session file");
  const data = JSON.parse(await readFile(path, "utf8"));
  if (!data.sessionId || !data.context || !states.has(data.status?.state))
    throw Error("Invalid review session");
  return data;
}
async function writeSession(dir: string, data: any) {
  const temporary = resolve(dir, `.session-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(data), { flag: "wx", mode: 0o600 });
  await rename(temporary, resolve(dir, descriptor));
}
const bounded = (n: any, max: number) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;
function validateFeedback(payload: any, context: any) {
  if (
    !payload ||
    !Array.isArray(payload.feedback) ||
    !payload.feedback.length ||
    payload.feedback.length > 1000
  )
    throw Error("Provide 1–1000 feedback notes");
  if (context.kind === "video") {
    if (
      payload.schemaVersion !== 2 ||
      stableJson(payload.context) !== stableJson(context.review) ||
      !bounded(payload.duration, 86400)
    )
      throw Error("Feedback belongs to a different video context");
    for (const n of payload.feedback) {
      if (!n || !["point", "time", "range"].includes(n.type) || !bounded(n.time, payload.duration))
        throw Error("Invalid video timing");
      if (
        n.type === "range" &&
        (!bounded(n.start, payload.duration) ||
          !bounded(n.end, payload.duration) ||
          n.end < n.start)
      )
        throw Error("Invalid range");
      if (
        n.type === "point" &&
        (!n.position || !bounded(n.position.x, 1) || !bounded(n.position.y, 1))
      )
        throw Error("Invalid point");
    }
  } else if (context.kind === "storyboard") {
    if (
      payload.schemaVersion !== 1 ||
      payload.manifestHash !== context.manifestHash ||
      payload.revision !== context.revision ||
      stableJson(payload.sceneHashes) !== stableJson(context.sceneHashes)
    )
      throw Error("Feedback belongs to a different storyboard revision");
    for (const n of payload.feedback) {
      if (
        !n?.target ||
        !["styling", "motion"].includes(n.target.kind) ||
        !(n.target.kind === "motion" ? context.transitionIds : context.sceneIds).includes(
          n.target.id,
        ) ||
        !n.position ||
        !bounded(n.position.x, 1) ||
        !bounded(n.position.y, 1)
      )
        throw Error("Invalid storyboard target");
    }
  } else throw Error("Unsupported review context");
  for (const n of payload.feedback)
    if (typeof n.note !== "string" || !n.note.trim() || n.note.length > 20000)
      throw Error("Invalid note");
}
export async function readReviewInbox(dir: string, limit = 10): Promise<any> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw Error("Inbox limit must be 1–50");
  const session = await readSession(dir),
    receipts = [];
  for (const name of (await readdir(dir))
    .filter((n) => /^\.feedback-[0-9a-f-]{36}\.json$/.test(n))
    // oxlint-disable-next-line unicorn/no-array-sort -- filter creates a new private array.
    .sort()) {
    const path = resolve(dir, name);
    if ((await lstat(path)).isSymbolicLink()) throw Error("Invalid inbox file");
    const item = JSON.parse(await readFile(path, "utf8"));
    if (item.sessionId === session.sessionId) receipts.push(item);
  }
  const pending = receipts
    .filter((item) => ["queued", "processing"].includes(item.state))
    // oxlint-disable-next-line unicorn/no-array-sort -- filter creates a new private array.
    .sort(
      (a, b) =>
        Number(b.state === "processing") - Number(a.state === "processing") ||
        a.updatedAt.localeCompare(b.updatedAt),
    );
  return {
    sessionId: session.sessionId,
    context: session.context,
    status: session.status,
    pendingCount: pending.length,
    hasMore: pending.length > limit,
    feedback: pending.slice(0, limit),
  };
}
async function withReviewLock<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const lock = resolve(dir, ".review-lock");
  let held = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await mkdir(lock);
      held = true;
      break;
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  if (!held)
    throw Error("Review inbox busy; inspect a stale .review-lock only after writers have stopped");
  try {
    return await work();
  } finally {
    await rm(lock, { recursive: true });
  }
}
async function aggregateStatus(dir: string, session: any, requested: any) {
  const pending = (await readReviewInbox(dir, 50)).feedback;
  const processing = pending.find((n: any) => n.state === "processing"),
    queued = pending.find((n: any) => n.state === "queued");
  const next = processing ?? queued;
  session.status = {
    ...requested,
    ...(next
      ? {
          state: processing ? "processing" : "queued",
          message: processing
            ? requested.state === "processing"
              ? requested.message
              : "Agent processing acknowledged feedback; additional notes remain queued"
            : requested.state === "queued"
              ? requested.message
              : "Previous feedback handled; additional notes await KYNEM",
          feedbackId: next.id,
        }
      : {}),
    pendingCount: (await readReviewInbox(dir, 1)).pendingCount,
  };
}
export async function acknowledgeReview(
  dir: string,
  id: string,
  state: string,
  message?: string,
  preview?: string,
): Promise<any> {
  return withReviewLock(dir, async () => {
    if (!/^[0-9a-f-]{36}$/.test(id) || !["processing", "completed", "failed"].includes(state))
      throw Error("Invalid feedback acknowledgement");
    const path = resolve(dir, `.feedback-${id}.json`);
    if ((await lstat(path)).isSymbolicLink()) throw Error("Invalid inbox file");
    const item = JSON.parse(await readFile(path, "utf8")),
      session = await readSession(dir);
    if (item.sessionId !== session.sessionId) throw Error("Different review session");
    if (["completed", "failed"].includes(item.state) && state !== item.state)
      throw Error("A terminal receipt cannot return to processing; submit a new feedback request");
    if (message && message.length > 2000) throw Error("Status message too long");
    if (preview) {
      if (basename(preview) !== preview || preview.startsWith(".") || !mime[extname(preview)])
        throw Error("Preview must be a supported file in this review directory");
      if (
        !(await lstat(resolve(dir, preview))).isFile() ||
        (await lstat(resolve(dir, preview))).isSymbolicLink()
      )
        throw Error("Invalid preview file");
    }
    item.state = state;
    item.updatedAt = new Date().toISOString();
    await writeFile(path, JSON.stringify(item), { mode: 0o600 });
    session.status = {
      state,
      message: message ?? state,
      updatedAt: item.updatedAt,
      feedbackId: id,
      ...(preview
        ? { latestPreview: preview }
        : session.status.latestPreview
          ? { latestPreview: session.status.latestPreview }
          : {}),
    };
    await aggregateStatus(dir, session, session.status);
    await writeSession(dir, session);
    return session.status;
  });
}
export async function serveReview(dir: string, port = 0): Promise<{ server: Server; url: string }> {
  const root = await realpath(resolve(dir));
  await readSession(root);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error("Invalid port");
  const token = randomBytes(32).toString("hex");
  let origin = "",
    sequence = Promise.resolve();
  const server = createServer((req, res) => {
    void (async () => {
      const json = (code: number, data: any) => {
        res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(data));
      };
      if (
        req.headers.host !== origin.slice(7) ||
        (req.headers.origin && req.headers.origin !== origin)
      )
        return json(403, { error: "Foreign host/origin refused" });
      const url = new URL(req.url ?? "/", origin);
      if (url.pathname === "/api/session" && req.method === "GET") {
        const session = await readSession(root);
        return json(200, { ...session, token });
      }
      if (url.pathname === "/api/status" && req.method === "GET")
        return json(200, (await readSession(root)).status);
      if (url.pathname === "/api/feedback" && req.method === "POST") {
        if (
          req.headers.origin !== origin ||
          req.headers["x-kynem-token"] !== token ||
          !req.headers["content-type"]?.startsWith("application/json")
        )
          return json(403, { error: "Missing session token/origin" });
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of req) {
          const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += part.length;
          if (bytes > 1024 * 1024) return json(413, { error: "Feedback exceeds 1 MiB" });
          chunks.push(part);
        }
        const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        let result: any;
        const run = sequence.then(() =>
          withReviewLock(root, async () => {
            const session = await readSession(root);
            if (
              input.sessionId !== session.sessionId ||
              stableJson(input.context) !== stableJson(session.context)
            )
              throw Error("Stale review session");
            validateFeedback(input.feedback, session.context);
            const files = (await readdir(root)).filter((n) =>
              /^\.feedback-[0-9a-f-]{36}\.json$/.test(n),
            );
            const previous: any[] = [];
            for (const file of files) {
              const path = resolve(root, file);
              if ((await lstat(path)).isSymbolicLink()) throw Error("Invalid inbox file");
              const receipt = JSON.parse(await readFile(path, "utf8"));
              if (receipt.sessionId === session.sessionId) previous.push(receipt);
            }
            const submittedHash = createHash("sha256")
              .update(stableJson(input.feedback))
              .digest("hex");
            const handled = new Set(
              previous
                .filter((r) => r.state !== "failed")
                .flatMap((r) => r.payload.feedback.map((note: any) => stableJson(note))),
            );
            const fresh = input.feedback.feedback.filter(
              (note: any) => !handled.has(stableJson(note)),
            );
            if (!fresh.length) {
              const exact = previous.find(
                (r) => r.submittedHash === submittedHash && r.state !== "failed",
              );
              result = {
                feedbackId: exact?.id ?? null,
                status: session.status,
                duplicate: true,
                message: "No new or changed notes queued",
              };
              return;
            }
            if (files.length >= 1000) throw Error("Inbox limit reached");
            const id = randomUUID(),
              updatedAt = new Date().toISOString();
            await writeFile(
              resolve(root, `.feedback-${id}.json`),
              JSON.stringify({
                id,
                sessionId: session.sessionId,
                context: session.context,
                state: "queued",
                updatedAt,
                submittedHash,
                payload: { ...input.feedback, feedback: fresh },
              }),
              { flag: "wx", mode: 0o600 },
            );
            session.status = {
              state: session.status.state === "processing" ? "processing" : "queued",
              message:
                session.status.state === "processing"
                  ? "Agent processing acknowledged feedback; additional feedback queued"
                  : "Feedback queued locally; invoke KYNEM in Codex to process it",
              updatedAt,
              feedbackId: id,
              ...(session.status.latestPreview
                ? { latestPreview: session.status.latestPreview }
                : {}),
            };
            await aggregateStatus(root, session, session.status);
            await writeSession(root, session);
            result = { feedbackId: id, status: session.status };
          }),
        );
        sequence = run.catch(() => {});
        await run;
        return json(result.duplicate ? 200 : 201, result);
      }
      if (url.pathname.startsWith("/api/")) return json(404, { error: "Unknown endpoint" });
      if (!["GET", "HEAD"].includes(req.method ?? ""))
        return json(405, { error: "Method refused" });
      const file = decodeURIComponent(url.pathname === "/" ? "index.html" : url.pathname.slice(1));
      if (basename(file) !== file || file.startsWith(".") || !mime[extname(file)])
        return json(404, { error: "File not served" });
      const path = resolve(root, file),
        stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) return json(404, { error: "File not served" });
      // Range support keeps large local videos seekable; inbox/config files never enter this path.
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      let start = 0,
        end = stat.size - 1;
      if (range) {
        start = Number(range[1]);
        end = range[2] ? Math.min(Number(range[2]), end) : end;
        if (start > end || start >= stat.size) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
          res.end();
          return;
        }
      }
      const { createReadStream } = await import("node:fs");
      res.writeHead(range ? 206 : 200, {
        "Content-Type": mime[extname(file)],
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
      });
      if (req.method === "HEAD") res.end();
      else
        createReadStream(path, { start, end })
          .on("error", () => res.destroy())
          .pipe(res);
    })().catch((error) => {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(error) }));
      } else res.end();
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.maxConnections = 16;
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => ok());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing server address");
  origin = `http://127.0.0.1:${address.port}`;
  return { server, url: origin };
}
export async function runReviewSessionCli(
  command: string,
  argv: string[],
  out: (line: string) => void,
): Promise<void> {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (
      !["--dir", "--port", "--id", "--state", "--message", "--preview", "--limit"].includes(
        argv[i],
      ) ||
      !argv[i + 1] ||
      opts[argv[i]]
    )
      throw Error("Invalid session option");
    opts[argv[i]] = argv[i + 1];
  }
  if (!opts["--dir"]) throw Error("--dir is required");
  const dir = resolve(opts["--dir"]);
  if (command === "review-serve")
    out((await serveReview(dir, opts["--port"] ? Number(opts["--port"]) : 0)).url);
  else if (command === "review-inbox")
    out(JSON.stringify(await readReviewInbox(dir, opts["--limit"] ? Number(opts["--limit"]) : 10)));
  else
    out(
      JSON.stringify(
        await acknowledgeReview(
          dir,
          opts["--id"] ?? "",
          opts["--state"] ?? "",
          opts["--message"],
          opts["--preview"],
        ),
      ),
    );
}
