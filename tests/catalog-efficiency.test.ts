import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";

import "../src/operations/index.js";
import { catalogTool } from "../src/tools/catalog.js";
import { nullTransport } from "./helpers/null-transport.js";

const transport = nullTransport();

function payload(result: Awaited<ReturnType<typeof catalogTool.handler>>) {
  return result.structuredContent as Record<string, unknown>;
}

function responseBytes(result: Awaited<ReturnType<typeof catalogTool.handler>>) {
  const content = result.content[0];
  if (content.type !== "text") throw new Error("catalog response was not text");
  return Buffer.byteLength(content.text, "utf8");
}

afterEach(() => {
  delete process.env.AE_MCP_READONLY;
  delete process.env.AE_MCP_ALLOW_CATEGORIES;
  delete process.env.AE_MCP_ENABLE_EVAL;
});

describe("bounded catalog lookup", () => {
  it("keeps the no-argument listing and category detail contract", async () => {
    const index = payload(await catalogTool.handler({}, transport));
    expect(index.categories).toBeInstanceOf(Array);
    expect(index).toHaveProperty("totalOperations");
    const category = payload(await catalogTool.handler({ category: "keyframe" }, transport));
    const operations = category.operations as Array<Record<string, unknown>>;
    expect(operations.length).toBeGreaterThan(1);
    expect(operations[0].params).toBeInstanceOf(Array);
  });

  it("returns only requested exact names, retaining their complete parameters", async () => {
    const category = payload(await catalogTool.handler({ category: "keyframe" }, transport));
    const all = category.operations as Array<{ name: string; params: unknown[] }>;
    const names = ["keyframe.add", "keyframe.apply"];
    const chosen = payload(await catalogTool.handler({ operations: names }, transport));
    expect(chosen.operations).toEqual(names.map((name) => all.find((op) => op.name === name)));
    expect(chosen).not.toHaveProperty("category");
    const scoped = payload(
      await catalogTool.handler({ category: "keyframe", operations: names }, transport),
    );
    expect(scoped.operations).toEqual(chosen.operations);
    expect(scoped.category).toBe("keyframe");
  });

  it("offers category summaries without parameter schemas", async () => {
    const summary = payload(
      await catalogTool.handler({ category: "keyframe", detail: "summary" }, transport),
    );
    const full = payload(await catalogTool.handler({ category: "keyframe" }, transport));
    const small = summary.operations as Array<Record<string, unknown>>;
    const complete = full.operations as Array<Record<string, unknown>>;
    expect(small.map((op) => op.name)).toEqual(complete.map((op) => op.name));
    expect(small[0]).toHaveProperty("description");
    expect(small.every((op) => !("params" in op))).toBe(true);
  });

  it("uses the same error for unknown and policy-withheld exact names", async () => {
    process.env.AE_MCP_READONLY = "1";
    const unknown = await catalogTool.handler(
      { operations: ["layer.no_such_operation"] },
      transport,
    );
    const withheld = await catalogTool.handler({ operations: ["layer.create_solid"] }, transport);
    expect(unknown.isError).toBe(true);
    expect(payload(withheld)).toEqual(payload(unknown));
    expect((payload(withheld).error as { code: string }).code).toBe("UNKNOWN_OPERATION");
    const mixed = await catalogTool.handler(
      { operations: ["property.get", "layer.create_solid"] },
      transport,
    );
    expect(payload(mixed)).toEqual(payload(unknown));
  });

  it("bounds the new input schema", () => {
    const schema = catalogTool.inputShape.operations;
    expect(schema.safeParse(["keyframe.add"]).success).toBe(true);
    expect(schema.safeParse([]).success).toBe(false);
    expect(schema.safeParse(Array(13).fill("keyframe.add")).success).toBe(false);
    expect(schema.safeParse(["keyframe.add", "keyframe.add"]).success).toBe(false);
    expect(schema.safeParse(["a".repeat(121)]).success).toBe(false);
    expect(catalogTool.inputShape.detail.safeParse("brief").success).toBe(false);
  });

  it("reduces actual JSON response bytes for a realistic two-operation lookup", async () => {
    const full = await catalogTool.handler({ category: "keyframe" }, transport);
    const summary = await catalogTool.handler(
      { category: "keyframe", detail: "summary" },
      transport,
    );
    const selected = await catalogTool.handler(
      { operations: ["keyframe.add", "keyframe.apply"] },
      transport,
    );
    const fullBytes = responseBytes(full);
    const summaryBytes = responseBytes(summary);
    const selectedBytes = responseBytes(selected);
    expect(selectedBytes).toBeLessThan(fullBytes);
    expect(summaryBytes).toBeLessThan(fullBytes);
  });
});
