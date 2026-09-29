import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AeTransport, EvalRequest, EvalResult } from "../src/transport/AeTransport.js";
import type { InstanceInfo } from "../src/transport/instances.js";
import { WorkflowJobs } from "../src/workflows/jobs.js";
import { WorkflowService } from "../src/workflows/service.js";
import { FastEditService } from "../src/workflows/fast-edit.js";

const refState = vi.hoisted(() => ({ copy: "" }));
vi.mock("../src/workflows/targets.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/workflows/targets.js")>();
  return {
    ...real,
    loadTargetHandle: async () => ({
      version: 1,
      projectPath: refState.copy,
      compId: 11,
      layerId: 45,
      layerIndex: 2,
      propertyPath: [{ matchName: "ADBE Opacity", index: 1, name: "Opacity" }],
    }),
  };
});

const dirs: string[] = [];
const id = "d050bf22-1a23-4cf4-86a8-81ec42d688da";
const edit = (requestId = id) => ({
  requestId,
  copyPath: "",
  edits: [{ operation: "text.set_content", args: { comp: 11, layer: 2, text: "Updated" } }],
});

async function fixture(onCall?: (req: EvalRequest, jobs: WorkflowJobs) => Promise<EvalResult>) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "fast-edit-")));
  dirs.push(dir);
  const runDir = path.join(dir, "run");
  await fs.mkdir(runDir);
  const input = path.join(dir, "source.aep");
  const copy = path.join(runDir, "copy.aep");
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
  const success: EvalResult = {
    ok: true,
    result: { ok: true },
    error: null,
    errorCode: null,
    stack: null,
    logs: [],
    durationMs: 2,
  };
  const transport: AeTransport = {
    execute: async (req) => {
      calls.push(req);
      return onCall ? onCall(req, jobs) : success;
    },
  };
  const readWorker = async (): Promise<InstanceInfo> =>
    ({
      id: "worker-1",
      dir: "",
      alive: true,
      ageMs: 1,
      heartbeat: { project: copy },
    }) as InstanceInfo;
  const workflow = new WorkflowService({ transport, jobs, sessionPath, readWorker });
  return {
    copy,
    calls,
    jobs,
    service: new FastEditService({ transport, jobs, service: workflow }),
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("fast edit", () => {
  it("resolves a property target by sibling index and rejects a stale reference before mutation", async () => {
    let opacity = 20;
    let writes = 0;
    let stale = false;
    let receipt = "";
    const f = await fixture(async (req, jobs) => {
      const property = {
        name: "Opacity",
        matchName: "ADBE Opacity",
        numKeys: 0,
        canSetExpression: false,
        get value() {
          return opacity;
        },
      };
      const layer = {
        id: stale ? 46 : 45,
        name: "Title",
        numProperties: 1,
        property: (index: number) => (index === 1 ? property : null),
      };
      class CompItem {
        numLayers = 2;
        layer(index: number) {
          return index === 2 ? layer : null;
        }
      }
      const comp = new CompItem();
      class File {
        fsName: string;
        encoding = "";
        constructor(name: string) {
          this.fsName = name;
        }
        get exists() {
          return this.fsName === f.copy;
        }
        copy() {
          return true;
        }
        open() {
          return true;
        }
        write(value: string) {
          receipt = value;
        }
        close() {}
      }
      const context = {
        app: { project: { file: { fsName: f.copy }, save: () => {} } },
        File,
        CompItem,
        AE: {
          findItemById: () => comp,
          findCompByNameOrId: () => comp,
          findLayerInComp: () => layer,
          resolveLayers: () => [layer],
          valueToJson: (v: unknown) => v,
          writeValue: (_node: unknown, value: number) => {
            writes++;
            opacity = value;
            return { separated: false };
          },
          errText: (e: Error) => e.message,
        },
      };
      const result = vm.runInNewContext(`(function(){${req.code}})()`, context) as {
        ok: boolean;
        error?: string;
      };
      const currentId = JSON.parse(receipt).jobId as string;
      await fs.writeFile(jobs.receiptPath(currentId), receipt);
      return {
        ok: true,
        result,
        error: null,
        errorCode: null,
        stack: null,
        logs: [],
        durationMs: 2,
      };
    });
    refState.copy = f.copy;
    const targetRef = "target:bf337130-d853-42a5-a9fe-9b29a148b759";
    const request = (requestId: string) => ({
      requestId,
      copyPath: f.copy,
      edits: [{ operation: "property.set", targetRef, args: { value: 55 } }],
    });
    expect((await f.service.execute(request(id))).state).toBe("succeeded");
    expect(opacity).toBe(55);
    expect(writes).toBe(1);
    expect(f.calls[0].code).toContain("var _propPath = [1]");
    stale = true;
    const second = await f.service.execute(request("eddd90e8-39f2-4714-8396-cfae15a7060b"));
    expect(second.state).toBe("failed");
    expect(writes).toBe(1);
    expect(JSON.stringify(second.result)).toContain("target reference stale");
  });

  it("runs the generated text edit, checkpoint, readback and receipt inside one simulated AE call", async () => {
    let saves = 0;
    let currentText = "Before";
    let writtenReceipt = "";
    const f = await fixture(async (req, jobs) => {
      class TextLayer {
        name = "Title";
        property(name: string) {
          if (name !== "Source Text") return null;
          return {
            name,
            matchName: "ADBE Text Document",
            numKeys: 0,
            canSetExpression: false,
            get value() {
              return { text: currentText, fontSize: 100 };
            },
            setValue(doc: { text: string }) {
              currentText = doc.text;
            },
          };
        }
      }
      class File {
        fsName: string;
        encoding = "";
        constructor(name: string) {
          this.fsName = name;
        }
        get exists() {
          return this.fsName === f.copy;
        }
        copy() {
          return true;
        }
        open() {
          return true;
        }
        write(value: string) {
          writtenReceipt = value;
        }
        close() {}
      }
      const layer = new TextLayer();
      const comp = { numLayers: 2, layer: () => layer };
      const context = {
        app: {
          project: {
            file: { fsName: f.copy },
            save: () => {
              saves++;
            },
          },
        },
        AE: {
          findCompByNameOrId: (n: number) => (n === 11 ? comp : null),
          findLayerInComp: () => layer,
          valueToJson: (v: unknown) => v,
          errText: (e: Error) => e.message,
        },
        TextLayer,
        File,
      };
      const result = vm.runInNewContext(`(function(){${req.code}})()`, context) as {
        ok: boolean;
        changed: string[];
        verifiedEditIndexes: number[];
      };
      expect(result.ok).toBe(true);
      expect(result.verifiedEditIndexes).toEqual([0]);
      expect(saves).toBe(2);
      expect(currentText).toBe("Updated");
      await fs.writeFile(jobs.receiptPath(id), writtenReceipt);
      return {
        ok: true,
        result,
        error: null,
        errorCode: null,
        stack: null,
        logs: [],
        durationMs: 2,
      };
    });
    const status = await f.service.execute({ ...edit(), copyPath: f.copy });
    expect(status.state).toBe("succeeded");
    expect(f.calls).toHaveLength(1);
  });

  it("claims the job before the one AE call and reconciles its receipt", async () => {
    const f = await fixture(async (_req, jobs) => {
      expect((await jobs.get(id))?.state).toBe("running");
      await fs.writeFile(
        jobs.receiptPath(id),
        JSON.stringify({
          jobId: id,
          state: "succeeded",
          result: { ok: true, changed: ["text.set_content"] },
        }),
      );
      return {
        ok: true,
        result: { ok: true },
        error: null,
        errorCode: null,
        stack: null,
        logs: [],
        durationMs: 2,
      };
    });
    const request = { ...edit(), copyPath: f.copy };
    const first = await f.service.execute(request);
    expect(first.state).toBe("succeeded");
    expect(first.callCount).toBe(1);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].code).toContain("pre-edit checkpoint");
    expect(f.calls[0].code).toContain("Source Text");
    expect(f.calls[0].code).not.toContain("render.frame");
    const retry = await f.service.execute(request);
    expect(retry.state).toBe("succeeded");
    expect(retry.callCount).toBe(0);
    expect(f.calls).toHaveLength(1);
  });

  it("rejects unsafe and ambiguous operations before dispatch", async () => {
    const f = await fixture();
    for (const change of [
      { operation: "eval.run", args: { code: "app.project.close()" } },
      { operation: "render.frame", args: { comp: 11, time: 0, outPath: "/tmp/x.png" } },
      {
        operation: "property.set",
        args: { comp: 11, layer: "all", property: ["Transform", "Opacity"], value: 50 },
      },
      { operation: "text.set_content", args: { comp: 11, layer: 2, texxt: "oops" } },
    ])
      await expect(
        f.service.execute({ ...edit(), copyPath: f.copy, edits: [change] }),
      ).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });

  it("checks the final requested value when one property is written twice", async () => {
    const f = await fixture();
    await f.service.execute({
      requestId: id,
      copyPath: f.copy,
      edits: [
        {
          operation: "property.set",
          args: { comp: 11, layer: 2, property: ["Transform", "Opacity"], value: 50 },
        },
        {
          operation: "property.set",
          args: { comp: 11, layer: 2, property: ["Transform", "Opacity"], value: 70 },
        },
      ],
    });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].code).toContain("JSON.stringify(70)");
    expect(f.calls[0].code).toContain("_verified.push(1)");
  });

  it("reports uncertainty and never resends after a lost receipt", async () => {
    const f = await fixture();
    const request = { ...edit(), copyPath: f.copy };
    expect((await f.service.execute(request)).state).toBe("uncertain");
    expect((await f.service.execute(request)).callCount).toBe(0);
    expect(f.calls).toHaveLength(1);
  });
});
