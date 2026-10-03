import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn() };
});
vi.mock("../src/agent-install.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/agent-install.js")>();
  return {
    ...actual,
    agentInstallStatus: async () => [
      { version: "26.5", stubPath: "/fake/stub.jsx", installed: true, current: true },
    ],
  };
});
vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return { ...actual, resolveAfterFxPath: () => "/fake/After Effects.app" };
});

import "../src/operations/index.js";
import { getOp } from "../src/registry.js";
import { nullTransport } from "./helpers/null-transport.js";

describe.skipIf(process.platform !== "darwin")("instance.start macOS launcher failure", () => {
  it("reports a fake open failure and stderr promptly instead of waiting for AE registration", async () => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stderr: EventEmitter;
      unref: () => void;
    };
    child.pid = 12345;
    child.stderr = new EventEmitter();
    child.unref = () => {};
    vi.mocked(spawn).mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stderr.emit("data", Buffer.from("Launch Services denied this open"));
        child.emit("exit", 1);
      });
      return child as unknown as ReturnType<typeof spawn>;
    });

    const start = getOp("instance.start")!;
    const began = Date.now();
    const result = (await start.run!(
      { name: `test-launch-fail-${Date.now()}`, timeoutMs: 90000 },
      nullTransport(),
    )) as {
      ok: boolean;
      errorCode?: string;
      error?: string;
    };
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("TRANSPORT");
    expect(result.error).toContain("exit 1");
    expect(result.error).toContain("Launch Services denied this open");
    expect(Date.now() - began).toBeLessThan(3000);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
