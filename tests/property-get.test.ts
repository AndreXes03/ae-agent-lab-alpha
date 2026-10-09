import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { getOp } from "../src/registry.js";
import "../src/operations/property.js";

function run(node: Record<string, unknown>, args: Record<string, unknown> = {}) {
  const layer = { property: () => node, propertyType: 2 };
  const code = getOp("property.get")!.toJsx({
    comp: 1,
    layer: 1,
    property: ["Transform"],
    ...args,
  });
  return vm.runInNewContext(`(function(){${code}})()`, {
    PropertyType: { PROPERTY: 1 },
    AE: {
      findCompByNameOrId: () => ({}),
      findLayerInComp: () => layer,
      valueToJson: (value: unknown) => value,
    },
  });
}

describe("property.get group diagnostics", () => {
  it.each([2, 3])("refuses group type %s without reading values at any time", (propertyType) => {
    const valueAtTime = vi.fn(() => {
      throw new Error("group has no valueAtTime");
    });
    const node = {
      propertyType,
      valueAtTime,
      get value() {
        throw new Error("group has no value");
      },
    };
    for (const args of [{}, { time: 1 }]) {
      expect(run(node, args)).toMatchObject({
        ok: false,
        errorCode: "INVALID_ARGS",
        hint: expect.stringContaining("property.list"),
      });
    }
    expect(valueAtTime).not.toHaveBeenCalled();
  });

  it("refuses the empty path resolving to the layer root", () => {
    expect(run({}, { property: [], time: 1 })).toMatchObject({
      ok: false,
      errorCode: "INVALID_ARGS",
    });
  });

  it("preserves current and animated leaf values and metadata", () => {
    const valueAtTime = vi.fn(() => [20, 30]);
    const node = {
      propertyType: 1,
      name: "Position",
      matchName: "ADBE Position",
      value: [10, 15],
      valueAtTime,
      numKeys: 2,
      canSetExpression: true,
      expressionEnabled: true,
    };
    expect(run(node)).toEqual({
      ok: true,
      name: "Position",
      matchName: "ADBE Position",
      value: [10, 15],
      numKeys: 2,
      hasExpression: true,
    });
    expect(valueAtTime).not.toHaveBeenCalled();
    expect(run(node, { time: 0 }).value).toEqual([20, 30]);
    expect(valueAtTime).toHaveBeenCalledWith(0, false);
  });
});
