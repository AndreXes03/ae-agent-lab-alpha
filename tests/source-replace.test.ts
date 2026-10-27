import { describe, it, expect } from "vitest";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { prepareRetime } from "../src/workflows/retime.js";
import {
  captureSourceReplace,
  prepareSourceReplace,
  sourceReplaceSpec,
} from "../src/workflows/source-replace.js";

function fixture(breakScale = false) {
  class FootageItem {
    id = 10;
    width = 100;
    height = 100;
    pixelAspect = 1;
    mainSource = { isStill: true };
    parentFolder = {};
  }
  const old = new FootageItem(),
    replacement = Object.assign(new FootageItem(), { id: 11, width: 200, height: 200 });
  function layer(id: number) {
    function property(name: string, initial: number[]) {
      let value = initial;
      return {
        name,
        matchName: name,
        propertyType: 1,
        propertyValueType: 1,
        canSetExpression: false,
        numKeys: 0,
        expressionEnabled: false,
        get value() {
          return [...value];
        },
        valueAtTime() {
          return [...value];
        },
        setValue(next: number[]) {
          value = breakScale && name === "ADBE Scale" ? [999, 999] : [...next];
        },
      };
    }
    const props = [
      property("ADBE Scale", [50, 50]),
      property("ADBE Anchor Point", [50, 50]),
      property("ADBE Position", [200, 300]),
    ];
    const transform = {
      matchName: "ADBE Transform Group",
      name: "Transform",
      propertyType: 2,
      numProperties: props.length,
      property(key: number | string) {
        return typeof key === "number" ? props[key - 1] : props.find((p) => p.matchName === key);
      },
    };
    return {
      id,
      name: "portrait",
      index: id - 19,
      source: old,
      inPoint: 1,
      outPoint: 3,
      startTime: 0,
      stretch: 100,
      parent: null,
      trackMatteType: 0,
      audioEnabled: false,
      enabled: true,
      locked: false,
      threeDLayer: false,
      numProperties: 1,
      property(key: number | string) {
        return key === 1 || key === transform.matchName ? transform : { numProperties: 0 };
      },
      replaceSource(source: typeof old) {
        this.source = source;
      },
      transform,
    };
  }
  const selected = layer(20),
    untouched = layer(21);
  class CompItem {
    id = 7;
    name = "Main";
    numLayers = 2;
    layer(index: number) {
      return [selected, untouched][index - 1];
    }
  }
  const comp = new CompItem();
  const AE = {
    findItemById(id: number) {
      return id === 10 ? old : id === 7 ? comp : null;
    },
    findLayerById(_comp: unknown, id: number) {
      return [selected, untouched].find((l) => l.id === id);
    },
    snapshotKeys() {
      return [];
    },
    valueToJson(v: unknown) {
      return v;
    },
    errText: String,
  };
  const app = {
    project: {
      file: { fsName: "/tmp/copy.aep" },
      numItems: 2,
      item(i: number) {
        return [old, comp][i - 1];
      },
      importFile() {
        return replacement;
      },
    },
  };
  const context = {
    app,
    AE,
    FootageItem,
    CompItem,
    PropertyType: { PROPERTY: 1 },
    PropertyValueType: { NO_VALUE: 0 },
    File: class {
      exists = true;
      length = 42;
      modified = new Date(100);
    },
    ImportOptions: class {},
  };
  const run = (code: string, extras = {}) =>
    vm.runInNewContext(`(function(){${code}})()`, { ...context, ...extras });
  const spec = sourceReplaceSpec.parse({
    sourceId: 10,
    newPath: "/tmp/new.png",
    targets: [{ compId: 7, layerId: 20 }],
    framing: "preserve-normalized",
    semanticChange: true,
    newWidth: 200,
    newHeight: 200,
    newSha256: "a".repeat(64),
  });
  return { run, spec, selected, untouched, old, replacement };
}

describe("selective still replacement", () => {
  it("inventories shared usages and changes only the selected stable layer, preserving normalized framing", () => {
    const f = fixture(),
      snapshot = f.run(captureSourceReplace(f.spec));
    const plan = prepareSourceReplace(f.spec, snapshot);
    expect(plan.summary.preservedUses).toHaveLength(1);
    expect(plan.summary.warnings.join(" ")).toContain("identical resolution");
    const result = f.run(plan.mutationCode, { _workflowSnapshot: snapshot });
    expect(result).toMatchObject({
      ok: true,
      semanticReviewRequired: true,
      changedUses: [{ verification: "persistent-preserved" }],
    });
    expect(f.selected.source).toBe(f.replacement);
    expect(f.untouched.source).toBe(f.old);
    expect(f.selected.transform.property("ADBE Scale")?.value).toEqual([25, 25]);
    expect(f.selected.transform.property("ADBE Anchor Point")?.value).toEqual([100, 100]);
    expect(f.selected.transform.property("ADBE Position")?.value).toEqual([200, 300]);
  });
  it("reports partial mutation when native readback disagrees instead of claiming rollback", () => {
    const f = fixture(true),
      snapshot = f.run(captureSourceReplace(f.spec));
    const result = f.run(prepareSourceReplace(f.spec, snapshot).mutationCode, {
      _workflowSnapshot: snapshot,
    });
    expect(result).toMatchObject({
      ok: false,
      rollbackPerformed: false,
      importedSourceId: 11,
      changedUses: [{ verification: "pending" }],
    });
    expect(result.error).toContain("Persistent properties");
    expect(f.untouched.source).toBe(f.old);
  });
  it("refuses ambiguous/aspect-changing and masked resolution retargets before mutation", () => {
    const f = fixture(),
      snapshot = f.run(captureSourceReplace(f.spec));
    expect(() => prepareSourceReplace({ ...f.spec, newHeight: 100 }, snapshot)).toThrow(/aspect/);
    snapshot.targets[0].maskCount = 1;
    expect(() => prepareSourceReplace(f.spec, snapshot)).toThrow(/mask-coordinate/);
    f.selected.threeDLayer = true;
    expect(() => f.run(captureSourceReplace(f.spec))).toThrow(/2D/);
    expect(f.selected.source).toBe(f.old);
  });
});

it("generated replacement and retime code reference only installed JSX helper functions", () => {
  const helpers = readFileSync(new URL("../jsx/helpers.jsx", import.meta.url), "utf8");
  const installed = new Set(
    [...helpers.matchAll(/AE\.([A-Za-z_][\w]*)\s*=\s*function/g)].map((m) => m[1]),
  );
  const f = fixture(),
    snapshot = f.run(captureSourceReplace(f.spec));
  const retime = prepareRetime(
    {
      comp: 7,
      tracks: [{ layer: 1, property: ["ADBE Transform Group", "ADBE Opacity"] }],
      offsetFrames: 0,
      timeScale: 2,
    },
    {
      ok: true,
      projectPath: "/tmp/copy.aep",
      compId: 7,
      fps: 25,
      durationFrames: 100,
      tracks: [
        {
          layer: 1,
          layerId: 20,
          layerName: "label",
          property: ["ADBE Transform Group", "ADBE Opacity"],
          inFrame: 0,
          outFrame: 100,
          expressionEnabled: false,
          separated: false,
          keys: [
            {
              frame: 10,
              value: 50,
              inEase: [[20, 33]],
              outEase: [[40, 33]],
              roving: false,
              temporalAutoBezier: false,
            },
          ],
        },
      ],
    },
  );
  const generated =
    captureSourceReplace(f.spec) +
    prepareSourceReplace(f.spec, snapshot).mutationCode +
    retime.mutationCode;
  for (const match of generated.matchAll(/AE\.([A-Za-z_][\w]*)\(/g))
    expect(installed.has(match[1]), match[1]).toBe(true);
});
