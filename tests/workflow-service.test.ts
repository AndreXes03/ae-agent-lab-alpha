import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import type { AeTransport, EvalRequest, EvalResult } from "../src/transport/AeTransport.js";
import type { InstanceInfo } from "../src/transport/instances.js";
import { WorkflowJobs, type WorkflowJob } from "../src/workflows/jobs.js";
import { WorkflowService } from "../src/workflows/service.js";

const dirs: string[] = [];
const spec = {
  comp: 10,
  tracks: [{ layer: 1, property: ["ADBE Transform Group", "ADBE Opacity"] }],
  offsetFrames: 2,
};
const snapshot = (projectPath: string) => ({
  ok: true,
  projectPath,
  compId: 10,
  compName: "Main",
  fps: 25,
  durationFrames: 100,
  tracks: [
    {
      layer: 1,
      layerId: 88,
      layerName: "Title",
      inFrame: 0,
      outFrame: 90,
      startTime: 0,
      stretch: 100,
      property: spec.tracks[0].property,
      expressionEnabled: false,
      separated: false,
      keys: [
        {
          frame: 10,
          value: 50,
          inInterp: "LINEAR",
          outInterp: "LINEAR",
          inEase: [[0, 33]],
          outEase: [[0, 33]],
          temporalContinuous: false,
          temporalAutoBezier: false,
          inSpatialTangent: null,
          outSpatialTangent: null,
          spatialContinuous: null,
          spatialAutoBezier: null,
          roving: null,
        },
      ],
    },
  ],
});

async function fixture(onExecute: (request: EvalRequest) => Promise<EvalResult>) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ae-service-")));
  dirs.push(dir);
  const runDir = path.join(dir, "run");
  await fs.mkdir(runDir);
  const input = path.join(dir, "input.aep");
  const copy = path.join(runDir, "project.aep");
  await fs.writeFile(input, "source");
  await fs.copyFile(input, copy);
  const sessionPath = path.join(dir, "session.json");
  await fs.writeFile(
    sessionPath,
    JSON.stringify({
      phase: "ready",
      worker: "worker-1",
      runtime: dir,
      input,
      project: copy,
      runDir,
    }),
  );
  const jobs = new WorkflowJobs(path.join(dir, "jobs"));
  const calls: EvalRequest[] = [];
  const transport: AeTransport = {
    execute: async (request) => {
      calls.push(request);
      return onExecute(request);
    },
  };
  const readWorker = async (): Promise<InstanceInfo> => ({
    id: "worker-1",
    dir: "",
    alive: true,
    ageMs: 1,
    heartbeat: { id: "worker-1", ts: Date.now(), project: copy, projectName: "project.aep" },
  });
  return {
    service: new WorkflowService({ transport, sessionPath, jobs, readWorker }),
    jobs,
    calls,
    copy,
    input,
    dir,
  };
}

function success(result: unknown): EvalResult {
  return { ok: true, result, error: null, errorCode: null, stack: null, logs: [], durationMs: 1 };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("managed workflow coordinator", () => {
  it("prepares once, keeps snapshot local, and reconciles an AE receipt without another AE call", async () => {
    let copy = "";
    let jobId = "";
    let jobs!: WorkflowJobs;
    const fx = await fixture(async (request) => {
      if (request.label?.startsWith("workflow prepare")) return success(snapshot(copy));
      expect(request.instance).toBe("worker-1");
      expect(request.code).toContain("app.project.save()");
      expect(request.code).toContain("Could not create pre-edit checkpoint");
      expect(request.code).toContain(
        "JSON.stringify(_workflowSnapshot) !== JSON.stringify(payload.snapshot)",
      );
      await fs.writeFile(
        jobs.receiptPath(jobId),
        JSON.stringify({ jobId, state: "succeeded", result: { ok: true, changedTracks: 1 } }),
      );
      return success({ ok: true, changedTracks: 1 });
    });
    copy = fx.copy;
    jobs = fx.jobs;
    const prepared = await fx.service.prepare("retime_properties", spec, copy);
    jobId = prepared.id;
    expect(prepared).toMatchObject({
      state: "prepared",
      recipe: "retime_properties",
      copyPath: copy,
    });
    expect(JSON.stringify(prepared)).not.toContain("captureCode");
    expect(JSON.stringify(prepared)).not.toContain("snapshot");
    expect(fx.calls).toHaveLength(1);
    expect((await fx.service.apply(jobId)).state).toBe("succeeded");
    expect((await fx.service.status(jobId)).state).toBe("succeeded");
    expect(fx.calls).toHaveLength(2);
    expect((await fx.service.apply(jobId)).state).toBe("succeeded");
    expect(fx.calls).toHaveLength(2);
  });

  it("leaves a timed-out claimed job uncertain and never dispatches it twice", async () => {
    let copy = "";
    const fx = await fixture(async (request) =>
      request.label?.startsWith("workflow prepare")
        ? success(snapshot(copy))
        : {
            ok: false,
            result: null,
            error: "timed out",
            errorCode: "TIMEOUT",
            stack: null,
            logs: [],
            durationMs: 120000,
          },
    );
    copy = fx.copy;
    const prepared = await fx.service.prepare("retime_properties", spec, copy);
    expect((await fx.service.apply(prepared.id)).state).toBe("uncertain");
    expect((await fx.service.apply(prepared.id)).state).toBe("uncertain");
    expect(fx.calls).toHaveLength(2);
  });

  it("refuses the input file and any path outside the managed run folder before AE", async () => {
    const fx = await fixture(async () => {
      throw new Error("AE should not be called");
    });
    await expect(fx.service.prepare("retime_properties", spec, fx.input)).rejects.toThrow(
      "Copy is not",
    );
    await expect(
      fx.service.prepare("retime_properties", spec, path.join(fx.dir, "other.aep")),
    ).rejects.toThrow();
    expect(fx.calls).toHaveLength(0);
  });

  it("generated apply code rejects stale state and writes a receipt after checkpoint or mutation failure", async () => {
    const fx = await fixture(async () => success(null));
    const saved = await fx.jobs.create({
      recipe: "retime_properties",
      spec,
      snapshot: { projectPath: fx.copy, value: 1 },
      summary: {},
      copyPath: fx.copy,
      instance: "worker-1",
      captureCode: "return payload.actual;",
      mutationCode:
        "payload.events.push('mutate'); if(payload.throwMutation) throw new Error('boom'); return {ok:true,changedTracks:1};",
    });
    const code = (
      fx.service as unknown as { applyCode(job: WorkflowJob, checkpoint: string): string }
    ).applyCode(saved, path.join(path.dirname(fx.copy), "before.aep"));
    function run(actual: unknown, throwMutation = false) {
      const events: string[] = [];
      let receipt = "";
      class File {
        fsName: string;
        exists: boolean;
        constructor(public filePath: string) {
          this.fsName = filePath;
          this.exists = filePath === fx.copy;
        }
        copy(_to: string) {
          events.push("checkpoint");
          return true;
        }
        open(_mode: string) {
          events.push("receipt");
          return true;
        }
        write(data: string) {
          receipt = data;
        }
        close() {
          /* no-op */
        }
      }
      const app = { project: { file: { fsName: fx.copy }, save: () => events.push("save") } };
      const context = {
        app,
        File,
        payload: { actual, snapshot: saved.payload.snapshot, events, throwMutation },
        JSON,
        Error,
      };
      const result = vm.runInNewContext(`(function(){ ${code} })()`, context) as Record<
        string,
        unknown
      >;
      return { events, receipt: JSON.parse(receipt) as Record<string, unknown>, result };
    }
    const stale = run({ projectPath: fx.copy, value: 2 });
    expect(stale.events).toEqual(["receipt"]);
    expect(stale.receipt).toMatchObject({ jobId: saved.id, state: "failed" });
    const good = run({ projectPath: fx.copy, value: 1 });
    expect(good.events).toEqual(["save", "checkpoint", "mutate", "save", "receipt"]);
    expect(good.receipt).toMatchObject({
      jobId: saved.id,
      state: "succeeded",
      result: { ok: true },
    });
    const thrown = run({ projectPath: fx.copy, value: 1 }, true);
    expect(thrown.events).toEqual(["save", "checkpoint", "mutate", "receipt"]);
    expect(thrown.receipt).toMatchObject({
      jobId: saved.id,
      state: "failed",
      result: { ok: false, error: "boom" },
    });
  });
});
