/** Durable, local journal for a single prepared workflow. No AE calls happen here. */
import { randomUUID } from "node:crypto";
import { constants, realpathSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

export type WorkflowJobState = "prepared" | "running" | "succeeded" | "failed" | "uncertain";
export type WorkflowTerminalState = "succeeded" | "failed";

/** Kept on disk for recovery; callers should return only summary/status to the model. */
export interface WorkflowJobPayload {
  recipe: string;
  spec: unknown;
  snapshot: unknown;
  summary: unknown;
  copyPath: string;
  instance: string;
  captureCode: string;
  mutationCode: string;
}

export interface WorkflowJob {
  id: string;
  state: WorkflowJobState;
  payload: WorkflowJobPayload;
  result: unknown | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowReceipt {
  jobId: string;
  state: WorkflowTerminalState;
  result: Record<string, unknown>;
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL = new Set<WorkflowJobState>(["succeeded", "failed"]);

function safeId(id: string): string {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Error("Invalid workflow job id");
  return id;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validReceipt(value: unknown, id: string): value is WorkflowReceipt {
  return (
    record(value) &&
    value.jobId === id &&
    (value.state === "succeeded" || value.state === "failed") &&
    record(value.result)
  );
}

export class WorkflowJobs {
  private readonly root: string;

  constructor(rootDir: string) {
    const resolved = path.resolve(rootDir);
    // macOS exposes its private temp directory through /var -> /private/var.
    // Canonicalize that trusted parent before checking the journal itself.
    let parent = path.dirname(resolved);
    try {
      parent = realpathSync(parent);
    } catch {
      // ensureRoot will report a missing or unsafe path with filesystem context.
    }
    this.root = path.join(parent, path.basename(resolved));
  }

  private async ensureRoot(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const info = await fs.lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Unsafe workflow journal directory");
    if ((await fs.realpath(this.root)) !== this.root)
      throw new Error("Workflow journal directory traverses a symlink");
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
      throw new Error("Workflow journal directory must be owner-only (0700)");
  }

  private jobPath(id: string): string {
    return path.join(this.root, `${safeId(id)}.json`);
  }

  private claimPath(id: string): string {
    return path.join(this.root, `${safeId(id)}.claim`);
  }

  receiptPath(id: string): string {
    return path.join(this.root, `${safeId(id)}.receipt.json`);
  }

  private async readRegular(file: string): Promise<string | null> {
    let handle;
    try {
      handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      if (!(await handle.stat()).isFile()) throw new Error("Unsafe workflow journal file");
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  }

  private async atomicWrite(file: string, value: unknown, create = false): Promise<void> {
    const tmp = path.join(this.root, `.${randomUUID()}.tmp`);
    const handle = await fs.open(tmp, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(value), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      if (create) await fs.link(tmp, file);
      else await fs.rename(tmp, file);
    } finally {
      await fs.unlink(tmp).catch(() => undefined);
    }
  }

  async create(payload: WorkflowJobPayload): Promise<WorkflowJob> {
    return this.createWithId(randomUUID(), payload);
  }

  /** A client-supplied id keeps retries on the same durable claim. */
  async createWithId(id: string, payload: WorkflowJobPayload): Promise<WorkflowJob> {
    safeId(id);
    await this.ensureRoot();
    // Round trip freezes the submitted payload against later caller mutations and rejects
    // values that cannot be represented by the recovery file.
    const copy = JSON.parse(JSON.stringify(payload)) as WorkflowJobPayload;
    if (
      !record(copy) ||
      typeof copy.recipe !== "string" ||
      typeof copy.copyPath !== "string" ||
      typeof copy.instance !== "string" ||
      typeof copy.captureCode !== "string" ||
      typeof copy.mutationCode !== "string" ||
      !("spec" in copy) ||
      !("snapshot" in copy) ||
      !("summary" in copy)
    )
      throw new Error("Invalid workflow job payload");
    const now = new Date().toISOString();
    const job: WorkflowJob = {
      id,
      state: "prepared",
      payload: copy,
      result: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.atomicWrite(this.jobPath(id), job, true);
      return job;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await this.get(id);
      if (!existing || JSON.stringify(existing.payload) !== JSON.stringify(copy))
        throw new Error("Request id already belongs to a different workflow");
      return existing;
    }
  }

  async get(id: string): Promise<WorkflowJob | null> {
    await this.ensureRoot();
    const raw = await this.readRegular(this.jobPath(id));
    if (raw === null) return null;
    const job = JSON.parse(raw) as WorkflowJob;
    if (!record(job) || job.id !== id || !record(job.payload) || typeof job.state !== "string")
      throw new Error("Malformed workflow job");
    if (TERMINAL.has(job.state)) return job;
    const receiptRaw = await this.readRegular(this.receiptPath(id));
    if (receiptRaw !== null) {
      let receipt: unknown;
      try {
        receipt = JSON.parse(receiptRaw);
      } catch {
        receipt = null;
      }
      if (validReceipt(receipt, id)) return this.finish(id, receipt.state, receipt.result);
    }
    // The claim file is never deleted. A crash between its creation and the
    // running-state write must still report a claimed job on restart.
    if (job.state === "prepared" && (await this.readRegular(this.claimPath(id))) !== null)
      return { ...job, state: "running" };
    return job;
  }

  /** Exactly one process can create this durable marker. It is never expired. */
  async claim(id: string): Promise<{ claimed: boolean; job: WorkflowJob }> {
    await this.ensureRoot();
    const current = await this.get(id);
    if (!current) throw new Error("Unknown workflow job");
    if (current.state !== "prepared") return { claimed: false, job: current };
    let handle;
    try {
      handle = await fs.open(this.claimPath(id), "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        return { claimed: false, job: (await this.get(id))! };
      throw error;
    }
    try {
      await handle.writeFile(
        JSON.stringify({ id, pid: process.pid, at: new Date().toISOString() }),
        "utf8",
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    const running: WorkflowJob = {
      ...current,
      state: "running",
      updatedAt: new Date().toISOString(),
    };
    await this.atomicWrite(this.jobPath(id), running);
    return { claimed: true, job: running };
  }

  /** `uncertain` preserves the claim after a timeout; only a valid AE receipt settles it. */
  async finish(
    id: string,
    state: WorkflowTerminalState | "uncertain",
    result: unknown,
  ): Promise<WorkflowJob> {
    await this.ensureRoot();
    if (state !== "succeeded" && state !== "failed" && state !== "uncertain")
      throw new Error("Invalid workflow completion state");
    const raw = await this.readRegular(this.jobPath(id));
    if (raw === null) throw new Error("Unknown workflow job");
    const current = JSON.parse(raw) as WorkflowJob;
    if (TERMINAL.has(current.state)) return current;
    if ((await this.readRegular(this.claimPath(id))) === null)
      throw new Error("Cannot finish an unclaimed workflow job");
    // A timeout may race the AE `finally` receipt. Give that receipt priority
    // over an uncertain transport outcome whenever it is already durable.
    if (state === "uncertain") {
      const receiptRaw = await this.readRegular(this.receiptPath(id));
      if (receiptRaw !== null) {
        let receipt: unknown;
        try {
          receipt = JSON.parse(receiptRaw);
        } catch {
          receipt = null;
        }
        if (validReceipt(receipt, id)) {
          state = receipt.state;
          result = receipt.result;
        }
      }
    }
    const next: WorkflowJob = { ...current, state, result, updatedAt: new Date().toISOString() };
    await this.atomicWrite(this.jobPath(id), next);
    return state === "uncertain" ? (await this.get(id))! : next;
  }
}
