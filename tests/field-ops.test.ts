// Offline codegen tests for the 2026-09 field-feedback operations — the
// composite ops (keyframe.apply, layer.set_anchor, comp.resize, …), the
// shape-contents ops, and the cross-cutting changes (separated-dimension
// routing, array layer targets). Assertions are on generated JSX text and on
// the Node-side validation that runs BEFORE anything reaches After Effects;
// the e2e suite covers what AE does with the result.

import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { RUNTIME_DIR } from "../src/config.js";
import { getOp } from "../src/registry.js";
import { doTool } from "../src/tools/do.js";
import { renderFrameTool } from "../src/tools/render-frame.js";
// Importing the operation registry for its registration side effects.
import "../src/operations/index.js";
import { nullTransport } from "./helpers/null-transport.js";

interface DoResponse {
  isError?: boolean;
  structuredContent?: { error?: { code: string; message: string } };
}

describe("keyframe.apply", () => {
  const base = { comp: "Main", layer: 1, property: ["Transform", "Opacity"] };

  it("refuses malformed key specs before AE", () => {
    const op = getOp("keyframe.apply")!;
    expect(op.toJsx({ ...base, keys: [] })).toContain("non-empty array");
    expect(op.toJsx({ ...base, keys: [{ value: 1 }] })).toContain("keys[0] must be");
    expect(op.toJsx({ ...base, keys: [{ time: 0 }] })).toContain("keys[0] must be");
    expect(op.toJsx({ ...base, keys: [{ time: 0, value: 1 }], spatialTangents: "x" })).toContain(
      "auto|linear",
    );
  });

  it("hands the whole list to AE.applyKeySpecs with the per-key interp intact", () => {
    const jsx = getOp("keyframe.apply")!.toJsx({
      ...base,
      keys: [
        { time: 0, value: 0 },
        { time: 1, value: 100, interp: "hold" },
      ],
      replace: true,
      interp: "ease",
    });
    expect(jsx).toContain("AE.applyKeySpecs(_node, _specs, _opts)");
    expect(jsx).toContain('"interp":"hold"');
    expect(jsx).toContain('replace: true, interp: "ease", spatialTangents: "auto"');
    // Multi-layer targets, like transform.set.
    expect(jsx).toContain("AE.resolveLayers(_comp, 1)");
  });

  it("is validated by ae_do like any other op (keys must be an array)", async () => {
    const transport = nullTransport();
    const res = (await doTool.handler(
      { operation: "keyframe.apply", args: { ...base, keys: "nope" } },
      transport,
    )) as DoResponse;
    expect(res.isError).toBe(true);
    expect(res.structuredContent?.error?.code).toBe("INVALID_ARGS");
    expect(transport.calls).toHaveLength(0);
  });
});

describe("separated-dimension routing", () => {
  const target = { comp: "Main", layer: 1, property: ["Transform", "Position"] };

  it("keyframe.add / property.set / transform.set write through AE.writeValue", () => {
    expect(getOp("keyframe.add")!.toJsx({ ...target, time: 1, value: [1, 2] })).toContain(
      "AE.writeValue(_node, [1,2], 1)",
    );
    expect(getOp("property.set")!.toJsx({ ...target, value: [1, 2] })).toContain(
      "AE.writeValue(_node, [1,2])",
    );
    const xf = getOp("transform.set")!.toJsx({ comp: "Main", layer: 1, position: [1, 2] });
    expect(xf).toContain("AE.writeValue(_xf.position, [1,2])");
    expect(xf).not.toContain("_xf.position.setValue");
  });

  it("keyframe.set_batch feeds each follower its own component", () => {
    const jsx = getOp("keyframe.set_batch")!.toJsx({
      ...target,
      times: [0, 1],
      values: [
        [0, 0],
        [10, 20],
      ],
    });
    expect(jsx).toContain("AE.separationFollowers(_node)");
    expect(jsx).toContain("AE._componentFor(_values[_vi], _fi, _followers.length)");
  });
});

describe("mask geometry", () => {
  const target = { comp: "Main", layer: 1 };

  it("mask.add builds an ellipse path in the same call and sets mode/inverted", () => {
    const jsx = getOp("mask.add")!.toJsx({
      ...target,
      shape: "ellipse",
      size: [200, 100],
      mode: "Subtract",
      inverted: true,
    });
    expect(jsx).toContain('AE.geometryShape("ellipse", _center, [200,100], 0)');
    expect(jsx).toContain("AE.defaultMaskCenter(_layer)");
    expect(jsx).toContain('_mask.property("ADBE Mask Shape").setValue(_shape)');
    expect(jsx).toContain("MaskMode.SUBTRACT");
    expect(jsx).toContain("_mask.inverted = true");
  });

  it("mask.add without geometry stays a bare mask", () => {
    const jsx = getOp("mask.add")!.toJsx({ ...target, name: "m" });
    expect(jsx).not.toContain("AE.geometryShape");
    expect(jsx).toContain('_mask.name = "m"');
  });

  it("mask.set_path keys the path when time is given, and validates the two addressing modes", () => {
    const op = getOp("mask.set_path")!;
    const keyed = op.toJsx({ ...target, maskIndex: 1, shape: "rect", size: [10, 10], time: 1.5 });
    expect(keyed).toContain('AE.geometryShape("rect", _center, [10,10], 0)');
    expect(keyed).toContain("_pathProp.setValueAtTime(1.5, _shape)");
    const vertices = op.toJsx({ ...target, maskIndex: 1, vertices: [[0, 0]] });
    expect(vertices).toContain("new Shape()");
    expect(vertices).toContain("_pathProp.setValue(_shape)");
    expect(op.toJsx({ ...target, maskIndex: 1 })).toContain("give vertices, or shape + size");
    expect(op.toJsx({ ...target, maskIndex: 1, vertices: [[0, 0]], shape: "rect" })).toContain(
      "not both",
    );
    expect(op.toJsx({ ...target, maskIndex: 1, shape: "blob", size: [1, 1] })).toContain(
      "ellipse|rect",
    );
  });
});

describe("layer.set_anchor", () => {
  it("takes exactly one addressing mode and compensates through AE.moveAnchor", () => {
    const op = getOp("layer.set_anchor")!;
    expect(op.toJsx({ comp: "Main", layer: 1 })).toContain(
      "exactly one of preset, point, or offset",
    );
    expect(op.toJsx({ comp: "Main", layer: 1, preset: "center", point: [0, 0] })).toContain(
      "exactly one of",
    );
    const jsx = op.toJsx({ comp: "Main", layer: "all", preset: "bottomCenter" });
    expect(jsx).toContain("AE.layerRect(_l, _t)");
    expect(jsx).toContain("AE.pointInRect(_rect, _preset)");
    expect(jsx).toContain("AE.moveAnchor(_l, _target)");
  });
});

describe("layer.set_timing", () => {
  it("expands the 'comp' sentinel and applies in the documented order", () => {
    const op = getOp("layer.set_timing")!;
    const jsx = op.toJsx({ comp: "Main", layer: 1, shift: 1, inPoint: "comp", outPoint: "comp" });
    expect(jsx).toContain("_l.startTime = _l.startTime + 1;");
    expect(jsx).toContain('_l.inPoint = ("comp" === "comp") ? 0 : "comp";');
    expect(jsx).toContain('_l.outPoint = ("comp" === "comp") ? _comp.duration : "comp";');
    expect(jsx.indexOf("_l.startTime")).toBeLessThan(jsx.indexOf("_l.inPoint"));
    expect(op.toJsx({ comp: "Main", layer: 1 })).toContain("give at least one of");
    expect(op.toJsx({ comp: "Main", layer: 1, outPoint: "end" })).toContain("number or 'comp'");
  });
});

describe("layer.set_visibility_schedule", () => {
  it("validates entries and writes hold keys through AE.applyKeySpecs", () => {
    const op = getOp("layer.set_visibility_schedule")!;
    expect(op.toJsx({ comp: "Main", entries: [{ layer: 1 }] })).toContain("entries[0] must be");
    expect(op.toJsx({ comp: "Main", entries: [{ layer: 1, ranges: [[2, 1]] }] })).toContain(
      "end > start",
    );
    expect(
      op.toJsx({
        comp: "Main",
        mode: "inOut",
        entries: [
          {
            layer: 1,
            ranges: [
              [0, 1],
              [2, 3],
            ],
          },
        ],
      }),
    ).toContain("exactly one range");
    const jsx = op.toJsx({ comp: "Main", entries: [{ layer: "all", ranges: [[1, 2]] }] });
    expect(jsx).toContain('interp: "hold"');
    expect(jsx).toContain("AE.applyKeySpecs(_op, _specs, { replace: true })");
  });
});

describe("comp.set_layer_order / comp.resize", () => {
  it("set_layer_order moves each listed layer to startIndex + i", () => {
    const jsx = getOp("comp.set_layer_order")!.toJsx({
      comp: "Main",
      layers: ["B", "A", { id: 3 }],
      startIndex: 2,
    });
    expect(jsx).toContain("AE.moveLayerToIndex(_targets[_ti], _start + _ti)");
    expect(jsx).toContain("listed twice");
  });

  it("resize offsets unparented positions by the anchored delta", () => {
    const op = getOp("comp.resize")!;
    expect(op.toJsx({ comp: "Main" })).toContain("give width and/or height");
    const jsx = op.toJsx({ comp: "shot_*", width: 1440, anchor: "topLeft" });
    expect(jsx).toContain('AE.findComps("shot_*")');
    expect(jsx).toContain("if (_l.parent) continue;");
    expect(jsx).toContain("AE.offsetValue(_pos, [_d[0], _d[1]])");
    expect(jsx).toContain("pointOfInterest");
  });
});

describe("project.rename", () => {
  it("takes map XOR pattern and compiles the regex on the Node side", () => {
    const op = getOp("project.rename")!;
    expect(op.toJsx({})).toContain("exactly one of map or pattern");
    expect(op.toJsx({ map: { a: "b" }, pattern: "x", replacement: "y" })).toContain(
      "exactly one of map or pattern",
    );
    expect(op.toJsx({ pattern: "(", replacement: "" })).toContain("invalid pattern");
    expect(op.toJsx({ pattern: "a", replacement: "b", flags: "gx" })).toContain("g, i, m");
    expect(op.toJsx({ pattern: "a" })).toContain("needs a replacement");
    const jsx = op.toJsx({
      pattern: "^(\\w+) Outlines$",
      replacement: "$1",
      scope: "layers",
      dryRun: true,
    });
    expect(jsx).toContain('new RegExp("^(\\\\w+) Outlines$", "g")');
    expect(jsx).toContain("var _dry = true");
    // Layers only: no item pass; all comps by default.
    expect(jsx).toContain('AE.findComps("*")');
  });
});

describe("comp.sample", () => {
  it("validates times and defaults to the five transform properties", () => {
    const op = getOp("comp.sample")!;
    expect(op.readOnly).toBe(true);
    expect(op.toJsx({ comp: "Main", times: [] })).toContain("non-empty array of numbers");
    const jsx = op.toJsx({ comp: ["A", "B"], times: [0, 1] });
    expect(jsx).toContain('AE.findComps(["A","B"])');
    expect(jsx).toContain('["Transform","Opacity"]');
    expect(jsx).toContain("AE.readValue(_p, _t)");
    expect(jsx).toContain("_t >= _l.inPoint && _t < _l.outPoint");
  });
});

describe("shape contents ops", () => {
  it("group_bounds and signature are read-only and accept multi-layer targets", () => {
    const bounds = getOp("shape.group_bounds")!;
    expect(bounds.readOnly).toBe(true);
    const jsx = bounds.toJsx({ comp: "Main", layer: ["a", "b"] });
    expect(jsx).toContain('AE.resolveLayers(_comp, ["a","b"])');
    expect(jsx).toContain("AE.shapeGroupBounds(_g, _opts)");
    const sig = getOp("shape.signature")!;
    expect(sig.readOnly).toBe(true);
    expect(sig.toJsx({ comp: "Main", layer: "all" })).toContain("AE.hashString(AE.canonicalGroup(");
  });

  it("recolor needs color or map and routes through AE.recolorContents", () => {
    const op = getOp("shape.recolor")!;
    expect(op.toJsx({ comp: "Main", layer: 1 })).toContain("give either color");
    const jsx = op.toJsx({
      comp: "Main",
      layer: 1,
      map: [{ from: [1, 0, 0], to: [0, 0, 1] }],
      target: "fill",
    });
    expect(jsx).toContain('AE.recolorContents(_l.property("Contents"), _opts)');
    expect(jsx).toContain('"from":[1,0,0]');
  });

  it("split_groups duplicates bottom-up, strips the other groups, and can re-anchor", () => {
    const jsx = getOp("layer.split_groups")!.toJsx({
      comp: "Main",
      layer: "Word",
      anchor: "center",
      nameTemplate: "{layer}-{group}",
    });
    expect(jsx).toContain("_layer.duplicate()");
    expect(jsx).toContain("if (_ri !== _keep) _dc.property(_ri).remove();");
    expect(jsx).toContain("AE.moveAnchor(_dup, _pt)");
    expect(jsx).toContain("_layer.remove()");
  });

  it("convert_to_shapes falls back to the fixed command id and restores selection", () => {
    const jsx = getOp("layer.convert_to_shapes")!.toJsx({
      comp: "Main",
      layer: "all",
      removeSource: true,
      removeFootage: true,
    });
    expect(jsx).toContain('app.findMenuCommandId("Create Shapes from Vector Layer")');
    expect(jsx).toContain("if (!_cmd) _cmd = 3973;");
    expect(jsx).toContain(
      "AE.withSelection(_comp, [_src], function () { app.executeCommand(_cmd); })",
    );
    expect(jsx).toContain("AE.layersSince(_comp, _snap)");
    expect(jsx).toContain("Outlines$");
  });
});

describe("render.variants", () => {
  const variants = [
    {
      name: "A",
      sets: [{ layer: "Ctrl", property: ["Effects", "Slider Control", "Slider"], value: 1 }],
    },
  ];

  it("validates the variant shapes and the path template", () => {
    const op = getOp("render.variants")!;
    expect(op.toJsx({ comp: "Main", variants: [], outputPath: "x" })).toContain("non-empty array");
    expect(op.toJsx({ comp: "Main", variants: [{ sets: [] }], outputPath: "x" })).toContain(
      "needs a string name",
    );
    expect(
      op.toJsx({ comp: "Main", variants: [{ name: "A", sets: [{ layer: 1 }] }], outputPath: "x" }),
    ).toContain("sets[0] must be");
    expect(
      op.toJsx({
        comp: "Main",
        variants: [...variants, { name: "B", sets: [] }],
        outputPath: "C:/out/x.mov",
      }),
    ).toContain("must contain {name} or {index}");
  });

  it("parks the other queue items, restores values, and substitutes the name", () => {
    const jsx = getOp("render.variants")!.toJsx({
      comp: "Main",
      variants,
      outputPath: "C:/out/{name}.mov",
      renderTemplate: "Best Settings",
    });
    expect(jsx).toContain("_ex.render = false");
    expect(jsx).toContain("rq.item(_ui + 1).render = true");
    expect(jsx).toContain("AE.hasKeys(_prop)");
    expect(jsx).toContain("AE.writeValue(_restore[_ri].prop, _restore[_ri].value)");
    expect(jsx).toContain('AE.applyTemplate(_rqi, "Best Settings", "renderTemplate")');
    expect(jsx).toContain("_rqi.remove()");
  });
});

describe("layer.copy_to_comp / layer.create_adjustment", () => {
  it("copy_to_comp finds the copy by identity and can bake keys", () => {
    const jsx = getOp("layer.copy_to_comp")!.toJsx({
      comp: "A",
      layer: 1,
      targetComp: "B",
      bakeAtTime: 2,
      timeOffset: 1,
      name: "copy",
    });
    expect(jsx).toContain("AE.layerIdSnapshot(_target)");
    expect(jsx).toContain("AE.layersSince(_target, _snap)");
    expect(jsx).not.toContain("_target.layer(1)");
    expect(jsx).toContain("AE.bakeKeysAtTime(_newLayer, _bakeT)");
    expect(jsx).toContain('_newLayer.name = "copy"');
  });

  it("create_adjustment is a comp-sized solid with the flag on", () => {
    const jsx = getOp("layer.create_adjustment")!.toJsx({ comp: "Main" });
    expect(jsx).toContain("_layer.adjustmentLayer = true");
    expect(jsx).toContain('"Adjustment Layer"');
  });
});

describe("ae_render_frame contactSheet / analyze", () => {
  it("refuses a sheet path inside the mailbox before contacting AE", async () => {
    const transport = nullTransport();
    const res = (await renderFrameTool.handler(
      {
        compNameOrId: "Main",
        times: [0, 1],
        outPath: path.join(process.cwd(), "out", "f.png"),
        contactSheet: { outPath: path.join(RUNTIME_DIR, "sheet.png") },
      },
      transport,
    )) as DoResponse;
    expect(res.isError).toBe(true);
    expect(res.structuredContent?.error?.code).toBe("IO");
    expect(transport.calls).toHaveLength(0);
  });
});
