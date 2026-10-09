import { describe, expect, it } from "vitest";
import { getOp } from "../src/registry.js";
import "../src/operations/hierarchy.js";

function fixture() {
  const expression = {name: "Position", matchName: "ADBE Position", numKeys: 2, canSetExpression: true, expression: 'thisComp.layer("Controller").transform.position', expressionEnabled: true, numProperties: 0};
  const transform = {numProperties: 1, property: () => expression};
  const layers = [1, 2, 3].map(index => ({id: 100 + index, index, name: `L${index}`, parent: null as unknown, trackMatteLayer: null as unknown, trackMatteType: 0, numProperties: 1, property: (key: unknown) => key === "ADBE Transform Group" || key === 1 ? transform : null}));
  layers[1].parent = layers[0];
  layers[2].trackMatteLayer = layers[0];
  const comp = {id: 42, name: "Main", numLayers: 3, selectedLayers: [layers[0]], layer: (index: number) => layers[index - 1]};
  const AE = {findCompByNameOrId: () => comp, findLayerInComp: (_comp: unknown, spec: number | {id: number}) => typeof spec === "number" ? layers[spec - 1] : layers.find(layer => layer.id === spec.id)};
  return {layers, comp, AE};
}
function run(args: Record<string, unknown> = {}, data = fixture()) {
  return Function("AE", getOp("comp.inspect_hierarchy")!.toJsx({comp: 42, ...args}))(data.AE);
}

describe("bounded hierarchy inspection (mock JSX execution)", () => {
  it("returns stable IDs, direct children, matte consumers and expression flags without expression source", () => {
    const result = run();
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].layer.id).toBe(101);
    expect(result.layers[0].directChildren[0].id).toBe(102);
    expect(result.layers[0].matteConsumers[0].id).toBe(103);
    expect(result.layers[0].transforms[0]).toMatchObject({animated: true, expressionEnabled: true});
    expect(result.layers[0].expressions[0]).toMatchObject({path: [1, 1], enabled: true});
    expect(JSON.stringify(result)).not.toContain("thisComp");
    expect(result.expressionReferencesComplete).toBe(false);
    expect(result.layers[0].externalDependencies.status).toBe("unknown");
  });
  it("guards cycles and reports ancestor bounds", () => {
    const data = fixture();
    data.layers[0].parent = data.layers[1];
    expect(run({}, data).layers[0].parentCycle).toBe(true);
    data.layers[0].parent = data.layers[2];
    data.layers[2].parent = data.layers[1];
    expect(run({maxAncestors: 1}, data).layers[0].ancestorsTruncated).toBe(true);
  });
  it("reports every bounded scan and handles ID selectors, duplicates and misses", () => {
    const result = run({layer: [{id: 101}, 1, 99], maxLayers: 2, maxProperties: 1, maxRelationLayers: 1});
    expect(result.layers).toHaveLength(1);
    expect(result.selectionTruncated).toBe(true);
    expect(result.layers[0].propertiesTruncated).toBe(true);
    expect(result.layers[0].childrenAndMatteScanComplete).toBe(false);
    expect(result.relationLayersScanned).toBe(1);
    expect(run({layer: 99}).missing).toEqual([99]);
    expect(run({layer: 3}).layers[0].matte.layer.id).toBe(101);
  });
  it("is read-only and refuses invalid limits", () => {
    expect(getOp("comp.inspect_hierarchy")!.readOnly).toBe(true);
    expect(run({maxProperties: 0})).toMatchObject({ok: false});
    expect(run({maxLayers: 101})).toMatchObject({ok: false});
  });
});
