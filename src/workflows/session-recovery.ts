/** Reconcile only a proven managed binding or an observed absence of all AE processes. */
import path from "node:path";
import { readFile, realpath, lstat, mkdir, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { readInstance, type InstanceInfo } from "../transport/instances.js";
import { observeAeProcesses } from "../transport/health.js";
import { atomicJson, exclusiveClaim, privateDirectory } from "../production/storage.js";

type Probe = { project?: string | null; dirty?: boolean; readiness?: string };
export async function reconcileSession(
  runtime: string,
  worker: string,
  probe: () => Promise<Probe>,
  options: {
    readWorker?: () => Promise<InstanceInfo>;
    processes?: typeof observeAeProcesses;
  } = {},
) {
  await privateDirectory(runtime);
  const lock = path.join(runtime, "session-reconcile.lock");
  if (!(await exclusiveClaim(lock, { at: new Date().toISOString() })))
    throw new Error("Session reconciliation busy or interrupted; inspect its lock");
  try {
    const file = path.join(runtime, "session.json");
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576)
      throw new Error("Invalid session record");
    const raw = await readFile(file, "utf8"),
      session = JSON.parse(raw);
    if (session.worker !== worker || session.runtime !== runtime)
      throw new Error("Session runtime/worker identity differs");
    const read =
      options.readWorker ?? (() => readInstance(path.join(runtime, "instances", worker)));
    const processes = options.processes ?? observeAeProcesses;
    const live = await read();
    let phase: string,
      project = session.project,
      reason: string;
    if (live.alive) {
      if (live.heartbeat?.busy) throw new Error("Resident is busy; leave its session unchanged");
      const result = await probe();
      if (
        result.readiness !== "round-trip-and-subsequent-heartbeat" ||
        typeof result.project !== "string"
      )
        throw new Error("Resident readiness/project unconfirmed; nothing reconciled");
      const folder = await realpath(session.runDir),
        actual = await realpath(result.project);
      const relative = path.relative(folder, actual);
      if (
        !relative ||
        relative === ".." ||
        relative.startsWith(".." + path.sep) ||
        path.isAbsolute(relative) ||
        path.extname(actual).toLowerCase() !== ".aep"
      )
        throw new Error("Live project is outside the recorded managed run; preserve it");
      const latest = await read();
      if (
        !latest.alive ||
        latest.heartbeat?.busy ||
        latest.heartbeat?.startedAt !== live.heartbeat?.startedAt ||
        latest.heartbeat?.project !== result.project
      )
        throw new Error("Resident changed while reconciling");
      phase = "ready";
      project = result.project;
      reason = "confirmed-managed-project";
    } else {
      const observed = await processes();
      if (!observed.observed || observed.processes.length)
        throw new Error(
          "Stale heartbeat does not prove AE exited. Running/unknown AE processes remain; no record reset and no relaunch.",
        );
      const latest = await read(),
        second = await processes();
      if (latest.alive || !second.observed || second.processes.length)
        throw new Error("AE state changed while reconciling");
      phase = "stopped";
      reason = "no-ae-process-observed";
    }
    if ((await readFile(file, "utf8")) !== raw)
      throw new Error("Session record changed concurrently");
    const history = path.join(runtime, "session-history");
    await mkdir(history, { recursive: true, mode: 0o700 });
    const archived = path.join(history, randomUUID() + ".json");
    await writeFile(archived, raw, { flag: "wx", mode: 0o600 });
    await atomicJson(file, {
      ...session,
      phase,
      project,
      reconciledAt: new Date().toISOString(),
      reconciliationReason: reason,
      previousRecord: archived,
    });
    return { phase, project, archived, reason, launched: false, savedProject: false };
  } finally {
    await unlink(lock);
  }
}
