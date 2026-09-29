import { describe, expect, it, vi } from "vitest";
import { nullTransport } from "./helpers/null-transport.js";

const calls = vi.hoisted(() => [] as Array<{ method: string; args: unknown[] }>);
vi.mock("../src/workflows/service.js", () => ({
  WorkflowService: class {
    async prepare(...args: unknown[]) {
      calls.push({ method: "prepare", args });
      return {
        id: "job-1",
        state: "prepared",
        recipe: args[0],
        copyPath: args[2],
        summary: { changes: 1 },
      };
    }
    async apply(...args: unknown[]) {
      calls.push({ method: "apply", args });
      const state =
        args[0] === "job-uncertain"
          ? "uncertain"
          : args[0] === "job-failed"
            ? "failed"
            : "succeeded";
      return {
        id: args[0],
        state,
        recipe: "variants",
        copyPath: "/tmp/copy.aep",
        summary: {},
        ...(state === "succeeded" ? {} : { result: { error: "AE receipt missing" } }),
      };
    }
    async status(...args: unknown[]) {
      calls.push({ method: "status", args });
      const state =
        args[0] === "job-uncertain"
          ? "uncertain"
          : args[0] === "job-failed"
            ? "failed"
            : "prepared";
      return {
        id: args[0],
        state,
        recipe: "variants",
        copyPath: "/tmp/copy.aep",
        summary: {},
        ...(state === "prepared" ? {} : { result: { error: "AE receipt missing" } }),
      };
    }
  },
}));

import { workflowRequest, workflowTool } from "../src/tools/workflow.js";

const variantSpec = {
  compId: 1,
  fields: [{ key: "title", kind: "text" as const, layerPath: [1] }],
  variants: [{ name: "Client A", values: { title: "Hello" } }],
};
const retimeSpec = {
  comp: 1,
  offsetFrames: 2,
  tracks: [{ layer: 1, property: ["ADBE Transform Group", "ADBE Opacity"] }],
};

describe("ae_workflow tool", () => {
  it("exposes the three action shapes and mutation hint", () => {
    expect(workflowTool.effect).toBe("destructive");
    expect(workflowTool.blockedInReadOnly).toBe(false);
    expect(workflowRequest.safeParse({ action: "apply", jobId: "job-1" }).success).toBe(true);
    expect(workflowRequest.safeParse({ action: "status", jobId: "job-1" }).success).toBe(true);
    expect(workflowRequest.safeParse({ action: "apply", copyPath: "/tmp/x.aep" }).success).toBe(
      false,
    );
    expect(
      workflowRequest.safeParse({
        action: "prepare",
        recipe: "variants",
        copyPath: "/tmp/x.aep",
        spec: variantSpec,
      }).success,
    ).toBe(true);
    expect(
      workflowRequest.safeParse({
        action: "prepare",
        recipe: "retime_properties",
        copyPath: "/tmp/x.aep",
        spec: retimeSpec,
      }).success,
    ).toBe(true);
  });

  it("routes prepare, apply and status to the persistent service", async () => {
    calls.length = 0;
    const transport = nullTransport();
    const first = await workflowTool.handler(
      {
        request: {
          action: "prepare",
          recipe: "variants",
          copyPath: "/tmp/copy.aep",
          spec: variantSpec,
        },
      },
      transport,
    );
    expect(first.isError).toBe(false);
    expect(first.structuredContent).toMatchObject({ ok: true, id: "job-1", state: "prepared" });
    await workflowTool.handler({ request: { action: "apply", jobId: "job-1" } }, transport);
    await workflowTool.handler({ request: { action: "status", jobId: "job-1" } }, transport);
    expect(calls.map((c) => c.method)).toEqual(["prepare", "apply", "status"]);
    expect(calls[0].args).toEqual(["variants", variantSpec, "/tmp/copy.aep"]);
    expect(transport.calls).toHaveLength(0);
  });

  it("rejects a recipe/spec mismatch before reaching the service", async () => {
    calls.length = 0;
    const result = await workflowTool.handler(
      {
        request: {
          action: "prepare",
          recipe: "variants",
          copyPath: "/tmp/copy.aep",
          spec: retimeSpec,
        },
      },
      nullTransport(),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
    expect(calls).toHaveLength(0);
  });

  it("marks failed and uncertain jobs as errors while retaining status and job id", async () => {
    for (const jobId of ["job-failed", "job-uncertain"]) {
      for (const action of ["apply", "status"] as const) {
        const response = await workflowTool.handler(
          { request: { action, jobId } },
          nullTransport(),
        );
        expect(response.isError).toBe(true);
        expect(response.structuredContent).toMatchObject({
          ok: false,
          id: jobId,
          state: jobId === "job-failed" ? "failed" : "uncertain",
          result: { error: "AE receipt missing" },
        });
      }
    }
  });
});
