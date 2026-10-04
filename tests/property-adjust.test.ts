import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { getOp } from "../src/registry.js";
import "../src/operations/property-adjust.js";

function run(args: Record<string, unknown>, initial: Record<string, unknown>) {
  const code = getOp("property.adjust")!.toJsx({ comp: 1, layer: 1, property: ["test"], ...args });
  return vm.runInNewContext(`
    var state = ${JSON.stringify(initial)}, writes=0;
    var prop = {
      value: state.value, numKeys: (state.keys || []).length,
      expression: state.expression || "", expressionEnabled: false,
      hasMin: state.min !== undefined, minValue:state.min,
      hasMax: state.max !== undefined, maxValue:state.max,
      keyValue:function(k){return state.keys[k-1]},
      setValue:function(v){writes++;this.value=state.clamp === undefined?v:state.clamp},
      setValueAtKey:function(k,v){writes++;state.keys[k-1]=v}
    };
    var AE = {findCompByNameOrId:function(){return {}},findLayerInComp:function(){return {property:function(){return prop}}}};
    var result=(function(){${code}})();
    ({result:result,writes:writes,value:prop.value,keys:state.keys});
  `);
}

describe("runtime-relative numeric edits", () => {
  it("offsets a vector from its live values without a model read", () => {
    const out = run({ mode: "offset", amount: [10, -20] }, { value: [200, 300] });
    expect(out.value).toEqual([210, 280]);
    expect(out.result.verified).toBe(true);
  });
  it("adjusts all keys locally and keeps their ordering", () => {
    const out = run({ mode: "offset", amount: 5, scope: "keys" }, { keys: [10, 20, 30] });
    expect(out.keys).toEqual([15, 25, 35]);
    expect(out.result.adjustedValues).toBe(3);
  });
  it("preflights every key before any write", () => {
    const out = run({ mode: "offset", amount: 20, scope: "keys" }, { keys: [10, 90], max: 100 });
    expect(out.result.ok).toBe(false);
    expect(out.writes).toBe(0);
  });
  it("refuses a dimension mismatch, expressions, and implicit animation replacement", () => {
    for (const [args, initial] of [
      [{ mode: "offset", amount: [1, 2, 3] }, { value: [1, 2] }],
      [
        { mode: "offset", amount: 1 },
        { value: 3, expression: "value" },
      ],
      [{ mode: "offset", amount: 1 }, { keys: [3] }],
      [{ mode: "multiply", amount: 2, scope: "keys" }, { keys: [3] }],
    ]) {
      const out = run(args, initial);
      expect(out.result.ok).toBe(false);
      expect(out.writes).toBe(0);
    }
  });
  it("detects a clamped readback instead of claiming success", () => {
    const out = run({ mode: "multiply", amount: 2 }, { value: 10, clamp: 12 });
    expect(out.result.ok).toBe(false);
    expect(out.writes).toBe(1);
  });
});
