import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowJobs, type WorkflowJobPayload } from "../src/workflows/jobs.js";

const dirs: string[] = [];
async function journal(): Promise<{ jobs: WorkflowJobs; dir: string }> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ae-jobs-")));
  dirs.push(dir);
  return { jobs: new WorkflowJobs(dir), dir };
}
const payload: WorkflowJobPayload = {
  recipe: "retime_properties",
  spec: { offsetFrames: 3 },
  snapshot: { layer: 2 },
  summary: { text: "Three frame shift" },
  copyPath: "/tmp/copy.aep",
  instance: "ae-1",
  captureCode: "capture();",
  mutationCode: "mutate();",
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("workflow job journal", () => {
  it("deduplicates a caller request id across concurrent clients and rejects different content", async () => {
    const { jobs, dir } = await journal();
    const id = "119793f6-bc72-4cda-a87c-1c6acd674103";
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => new WorkflowJobs(dir).createWithId(id, payload)),
    );
    expect(attempts.every((job) => job.id === id)).toBe(true);
    await jobs.claim(id);
    expect((await jobs.createWithId(id, payload)).state).toBe("running");
    await expect(jobs.createWithId(id, { ...payload, spec: { offsetFrames: 9 } })).rejects.toThrow(
      "different workflow",
    );
  });

  it("persists a private prepared payload and allows exactly one concurrent claim", async () => {
    const { jobs, dir } = await journal();
    const created = await jobs.create(payload);
    expect(created.state).toBe("prepared");
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(path.join(dir, `${created.id}.json`))).mode & 0o777).toBe(0o600);
    const claims = await Promise.all(
      Array.from({ length: 16 }, () => new WorkflowJobs(dir).claim(created.id)),
    );
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect((await jobs.get(created.id))?.state).toBe("running");
    expect((await new WorkflowJobs(dir).claim(created.id)).claimed).toBe(false);
  });

  it("keeps the claim after an uncertain timeout or process restart", async () => {
    const { jobs, dir } = await journal();
    const created = await jobs.create(payload);
    await jobs.claim(created.id);
    await jobs.finish(created.id, "uncertain", { reason: "timeout" });
    const restarted = new WorkflowJobs(dir);
    expect((await restarted.get(created.id))?.state).toBe("uncertain");
    expect((await restarted.claim(created.id)).claimed).toBe(false);
    expect((await fs.stat(path.join(dir, `${created.id}.claim`))).mode & 0o777).toBe(0o600);
  });

  it("does not rerun after a crash between claim creation and state write", async () => {
    const { jobs, dir } = await journal();
    const created = await jobs.create(payload);
    await fs.writeFile(path.join(dir, `${created.id}.claim`), "claimed", { mode: 0o600 });
    const restarted = new WorkflowJobs(dir);
    expect((await restarted.get(created.id))?.state).toBe("running");
    expect((await restarted.claim(created.id)).claimed).toBe(false);
  });

  it("accepts only a matching terminal receipt and caches its result", async () => {
    const { jobs } = await journal();
    const created = await jobs.create(payload);
    await jobs.claim(created.id);
    const receipt = jobs.receiptPath(created.id);
    await fs.writeFile(receipt, "{not json");
    expect((await jobs.get(created.id))?.state).toBe("running");
    await fs.writeFile(
      receipt,
      JSON.stringify({ jobId: "wrong", state: "succeeded", result: { ok: true } }),
    );
    expect((await jobs.get(created.id))?.state).toBe("running");
    await fs.writeFile(
      receipt,
      JSON.stringify({ jobId: created.id, state: "uncertain", result: { ok: true } }),
    );
    expect((await jobs.get(created.id))?.state).toBe("running");
    await fs.writeFile(
      receipt,
      JSON.stringify({ jobId: created.id, state: "succeeded", result: { ok: true } }),
    );
    expect(await jobs.get(created.id)).toMatchObject({ state: "succeeded", result: { ok: true } });
    await fs.unlink(receipt);
    expect((await jobs.get(created.id))?.state).toBe("succeeded");
    expect((await jobs.claim(created.id)).claimed).toBe(false);
  });

  it("rejects traversal ids and symlinked journal files", async () => {
    const { jobs, dir } = await journal();
    await expect(jobs.get("../other")).rejects.toThrow("Invalid workflow job id");
    expect(() => jobs.receiptPath("/tmp/escape")).toThrow("Invalid workflow job id");
    const created = await jobs.create(payload);
    const external = path.join(dir, "external.json");
    await fs.writeFile(external, "{}");
    await fs.unlink(path.join(dir, `${created.id}.json`));
    await fs.symlink(external, path.join(dir, `${created.id}.json`));
    await expect(jobs.get(created.id)).rejects.toThrow();
  });
});
