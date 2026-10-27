/** Read-only OS observations and an actual resident round-trip. Never launch or reconnect AE here. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { AeTransport } from "./AeTransport.js";
import { readInstance, type InstanceInfo } from "./instances.js";
import { instanceDirFor } from "../config.js";
import { jsxVal } from "../registry.js";

export function parseAeProcesses(text: string) {
  return text.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!match || !/(?:^|\/)(?:After Effects|AfterFX(?:\.exe)?|aerender)(?:$|\s)/i.test(match[2]))
      return [];
    return [{ pid: Number(match[1]), executable: match[2] }];
  });
}
export async function observeAeProcesses(
  platform = process.platform,
  read = async () =>
    (
      await promisify(execFile)("/bin/ps", ["-axo", "pid=,comm="], {
        timeout: 3000,
        maxBuffer: 2 * 1024 * 1024,
      })
    ).stdout,
) {
  const base = {
    observedAt: new Date().toISOString(),
    windowTitle: null,
    currentProject: null,
    modalState: "unknown" as const,
    instanceAssociation: "unverified" as const,
  };
  if (platform !== "darwin" && platform !== "linux")
    return {
      ...base,
      observed: false,
      processes: [],
      error: "OS process observation unsupported on this platform",
    };
  try {
    return { ...base, observed: true, processes: parseAeProcesses(await read()) };
  } catch {
    return { ...base, observed: false, processes: [], error: "OS process list unavailable" };
  }
}
export function heartbeatHealth(info: InstanceInfo) {
  return {
    heartbeatState: !info.heartbeat
      ? "missing"
      : !info.alive
        ? "stale"
        : info.heartbeat.busy
          ? "busy"
          : (info.heartbeat.ticks ?? 0) < 2
            ? "initial-heartbeat"
            : "ticking",
    projectEvidence: info.alive ? "last-heartbeat" : "stale-heartbeat-not-current",
    startedAt: info.heartbeat?.startedAt ?? null,
    ticks: info.heartbeat?.ticks ?? null,
    served: info.heartbeat?.served ?? null,
    lastError: info.heartbeat?.lastError ?? null,
    engineName: info.heartbeat?.engineName ?? null,
    schedulerArmed: info.heartbeat?.schedulerArmed ?? null,
  };
}
export async function confirmResidentReady(
  name: string,
  transport: AeTransport,
  timeoutMs = 10000,
  options: {
    read?: () => Promise<InstanceInfo>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
) {
  const read = options.read ?? (() => readInstance(instanceDirFor(name)));
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + Math.max(1, timeoutMs);
  const before = await read(),
    hb = before.heartbeat;
  if (!before.alive || hb?.busy || (hb?.ticks ?? 0) < 2 || !hb?.startedAt)
    throw new Error(
      "Resident has not established recurring idle heartbeats; no readiness confirmed",
    );
  const nonce = randomUUID();
  const response = await transport.execute({
    instance: name,
    label: "resident readiness probe",
    undoGroup: false,
    timeoutMs: Math.max(1, deadline - now()),
    code: `var a=$.global.AE_MCP_AGENT;if(!a||!a.state)return {ok:false,error:"resident state unavailable"};return {ok:true,nonce:${jsxVal(nonce)},instance:a.state.id,startedAt:a.state.startedAt,project:app.project.file?app.project.file.fsName:null,dirty:!!app.project.dirty,numItems:app.project.numItems};`,
  });
  const reply = response.result as {
    ok?: boolean;
    nonce?: string;
    instance?: string;
    startedAt?: number;
    project?: string | null;
    dirty?: boolean;
    numItems?: number;
  } | null;
  if (
    !response.ok ||
    !reply?.ok ||
    reply.nonce !== nonce ||
    reply.instance !== name ||
    reply.startedAt !== hb.startedAt
  )
    throw new Error(
      "Resident round-trip failed or identity changed; inspect AE/dialogs without relaunching",
    );
  const afterReply = await read();
  while (now() < deadline) {
    await sleep(Math.min(250, deadline - now()));
    const current = await read(),
      next = current.heartbeat;
    if (
      current.alive &&
      !next?.busy &&
      next?.startedAt === hb.startedAt &&
      next.project === reply.project &&
      next.ts > (afterReply.heartbeat?.ts ?? hb.ts) &&
      (next.ticks ?? 0) > (afterReply.heartbeat?.ticks ?? hb.ticks ?? 0) &&
      (next.served ?? 0) > (hb.served ?? 0)
    )
      return {
        ok: true as const,
        instance: name,
        project: reply.project,
        dirty: reply.dirty,
        numItems: reply.numItems,
        readiness: "round-trip-and-subsequent-heartbeat",
        heartbeat: heartbeatHealth(current),
      };
  }
  throw new Error(
    "Resident replied but subsequent heartbeat did not advance; readiness unconfirmed, do not relaunch",
  );
}
