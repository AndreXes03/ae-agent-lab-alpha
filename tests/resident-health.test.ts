import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  confirmResidentReady,
  observeAeProcesses,
  parseAeProcesses,
  heartbeatHealth,
} from "../src/transport/health.js";
import type { InstanceInfo } from "../src/transport/instances.js";
import type { AeTransport } from "../src/transport/AeTransport.js";
import { reconcileSession } from "../src/workflows/session-recovery.js";

const info = (ticks = 2, ts = 100, served = 0, alive = true): InstanceInfo => ({
  id: "worker",
  dir: "/tmp/worker",
  alive,
  ageMs: 0,
  heartbeat: {
    id: "worker",
    startedAt: 50,
    ts,
    ticks,
    served,
    busy: false,
    project: "/tmp/copy.aep",
    projectName: "copy.aep",
  },
});
function probeFixture(advance: boolean) {
  let reads = 0,
    clock = 0,
    calls = 0;
  const transport: AeTransport = {
    execute: async (request) => {
      calls++;
      const nonce = JSON.parse(request.code.match(/nonce:("[^"]+")/)![1]);
      return {
        ok: true,
        result: { ok: true, nonce, instance: "worker", startedAt: 50, project: "/tmp/copy.aep" },
        error: null,
        errorCode: null,
        stack: null,
        logs: [],
        durationMs: 1,
      };
    },
  };
  const options = {
    read: async () => {
      reads++;
      return reads === 1
        ? info()
        : info(advance && reads > 2 ? 4 : 3, advance && reads > 2 ? 102 : 101, 1);
    },
    now: () => clock,
    sleep: async (ms: number) => {
      clock += ms;
    },
  };
  return { transport, options, calls: () => calls };
}
describe("resident readiness and honest observation", () => {
  it("requires a nonce round-trip and a later advancing heartbeat", async () => {
    const f = probeFixture(true);
    expect(await confirmResidentReady("worker", f.transport, 1000, f.options)).toMatchObject({
      ok: true,
      readiness: "round-trip-and-subsequent-heartbeat",
    });
    expect(f.calls()).toBe(1);
  });
  it("rejects the initial tick without dispatch and rejects a stalled scheduler after reply", async () => {
    const f = probeFixture(false);
    await expect(
      confirmResidentReady("worker", f.transport, 1000, {
        ...f.options,
        read: async () => info(1),
      }),
    ).rejects.toThrow(/recurring/);
    expect(f.calls()).toBe(0);
    await expect(confirmResidentReady("worker", f.transport, 1000, f.options)).rejects.toThrow(
      /subsequent heartbeat/,
    );
  });
  it("keeps process presence, stale registration, project and modal uncertainty separate", async () => {
    const ps =
      "12 /Applications/Adobe After Effects 2026/Adobe After Effects 2026.app/Contents/MacOS/After Effects\n13 /usr/bin/node\n14 /Applications/Adobe After Effects 2026/aerender";
    expect(parseAeProcesses(ps).map((p) => p.pid)).toEqual([12, 14]);
    expect(await observeAeProcesses("darwin", async () => ps)).toMatchObject({
      observed: true,
      modalState: "unknown",
      currentProject: null,
      instanceAssociation: "unverified",
    });
    expect(
      await observeAeProcesses("darwin", async () => {
        throw new Error("denied");
      }),
    ).toMatchObject({ observed: false });
    expect(heartbeatHealth(info(3, 100, 1, false)).projectEvidence).toBe(
      "stale-heartbeat-not-current",
    );
  });
});
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function sessionFixture() {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "kynem-reconcile-")));
  dirs.push(dir);
  const project = path.join(dir, "copy.aep");
  await writeFile(project, "fixture");
  const session = {
    phase: "startup-unconfirmed",
    worker: "worker",
    runtime: dir,
    project,
    runDir: dir,
  };
  const raw = JSON.stringify(session, null, 2);
  await writeFile(path.join(dir, "session.json"), raw);
  return { dir, raw, project };
}
it("archives the exact old record when all AE processes are observed absent, never starts AE", async () => {
  const f = await sessionFixture();
  let probes = 0;
  const result = await reconcileSession(
    f.dir,
    "worker",
    async () => {
      probes++;
      return {};
    },
    {
      readWorker: async () => info(1, 100, 0, false),
      processes: () => observeAeProcesses("darwin", async () => ""),
    },
  );
  expect(result).toMatchObject({ phase: "stopped", launched: false, savedProject: false });
  expect(await readFile(result.archived, "utf8")).toBe(f.raw);
  expect(probes).toBe(0);
});
it("preserves stale records when an unassociated AE process is still running", async () => {
  const f = await sessionFixture();
  await expect(
    reconcileSession(f.dir, "worker", async () => ({}), {
      readWorker: async () => info(1, 100, 0, false),
      processes: () =>
        observeAeProcesses(
          "darwin",
          async () => "7 /Applications/AE.app/Contents/MacOS/After Effects",
        ),
    }),
  ).rejects.toThrow(/does not prove/);
  expect(await readFile(path.join(f.dir, "session.json"), "utf8")).toBe(f.raw);
});
it("adopts only a confirmed managed project without saving or opening it", async () => {
  const f = await sessionFixture();
  const live = info();
  live.heartbeat!.project = f.project;
  expect(
    await reconcileSession(
      f.dir,
      "worker",
      async () => ({
        project: f.project,
        readiness: "round-trip-and-subsequent-heartbeat",
        dirty: true,
      }),
      { readWorker: async () => live },
    ),
  ).toMatchObject({ phase: "ready", project: f.project, savedProject: false });
});
