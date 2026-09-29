// End-to-end coverage for the 2026-09 field-feedback operations against a
// live After Effects: the composite ops (keyframe.apply, layer.set_anchor,
// layer.split_groups, comp.resize, render.variants, …), separated-dimension
// routing, mask geometry, vector-layer conversion, and the render tool's
// contact sheet / analysis.
//
// SESSION-MUTATING: swaps the open project for a disposable one and restores
// it afterwards. Requires AE_MCP_E2E=1 on top of AE being reachable.

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import "../../src/operations/index.js"; // side-effect import: fills the operation registry
import { renderFrameTool } from "../../src/tools/render-frame.js";
import type { FileIpcTransport } from "../../src/transport/FileIpcTransport.js";
import type { SavedProjectState } from "./harness.js";
import {
  backupAndOpenTestProject,
  E2E_SCRATCH_DIR,
  opRunner,
  printSkipBanner,
  probeAe,
  restoreUserProject,
} from "./harness.js";

const E2E_ENABLED = process.env.AE_MCP_E2E === "1";

let ready = false;
let transport: FileIpcTransport | null = null;
let saved: SavedProjectState | null = null;
let ops: ReturnType<typeof opRunner> | null = null;

function o(): ReturnType<typeof opRunner> {
  if (!ops) throw new Error("suite not ready");
  return ops;
}

interface LayerRow {
  index: number;
  name: string;
  active: boolean;
  values: Record<string, unknown>;
}
interface SampleResult {
  comps: Array<{ comp: string; samples: Array<{ time: number; layers: LayerRow[] }> }>;
}

async function sampleAt(comp: string, layer: string, time: number): Promise<LayerRow> {
  const res = await o().run<SampleResult>("comp.sample", { comp, times: [time], layer });
  const row = res.comps[0].samples[0].layers[0];
  if (!row) throw new Error(`no row for ${layer} at ${time}`);
  return row;
}

/**
 * A minimal one-page PDF with a filled red rectangle — After Effects imports
 * PDF as vector footage, which is what "Create Shapes from Vector Layer"
 * consumes. Offsets in the xref table are computed, not guessed.
 */
function minimalPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Contents 4 0 R >>",
  ];
  const content = "1 0 0 rg 100 100 200 100 re f";
  objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("e2e field ops", () => {
  beforeAll(async () => {
    if (!E2E_ENABLED) {
      printSkipBanner("field-ops", "SKIPPING — AE_MCP_E2E not set", [
        " This suite closes the project currently open in After Effects and",
        " restores it afterwards (session-mutating). Opt in explicitly:",
        "   PowerShell : $env:AE_MCP_E2E = '1'; npm test",
      ]);
      return;
    }
    const probe = await probeAe("field-ops");
    if (!probe.ready || !probe.transport) return;
    transport = probe.transport;
    saved = await backupAndOpenTestProject(transport);
    const res = await transport.execute({
      code: `
        var comp = app.project.items.addComp("fo_comp", 1920, 1080, 1, 5, 30);
        var solid = comp.layers.addSolid([0, 0.5, 1], "fo_solid", 400, 200, 1, 5);
        solid.name = "fo_solid";
        var text = comp.layers.addText("fo text");
        text.name = "fo_text";
        var shape = comp.layers.addShape();
        shape.name = "fo_shape";
        AE.rect(shape, [200, 100], [100, 50], { name: "box", fill: [1, 0, 0] });
        AE.ellipse(shape, [100, 100], [-300, 0], { name: "dot", fill: [1, 0, 0] });
        var other = app.project.items.addComp("fo_other", 1920, 1080, 1, 2, 30);
        return { ok: true, numLayers: comp.numLayers };
      `,
      label: "fo_fixture",
    });
    if (!res.ok) throw new Error("fixture setup failed: " + res.error);
    ops = opRunner(transport);
    ready = true;
  }, 120_000);

  afterAll(async () => {
    if (transport && saved) await restoreUserProject(transport, saved);
  });

  it("keyframe.apply: 'hold' holds the OUT side only, so the fade before it still fades", async (ctx) => {
    if (!ready) return ctx.skip();
    const res = await o().run<{ layers: Array<{ numKeys: number; warnings: string[] }> }>(
      "keyframe.apply",
      {
        comp: "fo_comp",
        layer: "fo_solid",
        property: ["Transform", "Opacity"],
        keys: [
          { time: 0, value: 0 },
          { time: 1, value: 100, interp: "hold" },
          { time: 2, value: 40, interp: "ease" },
        ],
        replace: true,
      },
    );
    expect(res.layers[0].numKeys).toBe(3);
    expect(res.layers[0].warnings).toEqual([]);
    // Mid-fade: linear 0→100 must read 50, not the held 0 that a symmetric
    // HOLD on key 2 would produce.
    const mid = await sampleAt("fo_comp", "fo_solid", 0.5);
    expect(mid.values["Transform/Opacity"]).toBeCloseTo(50, 3);
    // After the hold key: stays 100 until key 3.
    const held = await sampleAt("fo_comp", "fo_solid", 1.5);
    expect(held.values["Transform/Opacity"]).toBeCloseTo(100, 3);
    const info = await o().run<{
      transformGroup: {
        properties: Array<{
          matchName: string;
          keyframes?: Array<{ inInterpName: string; outInterpName: string }>;
        }>;
      };
    }>("layer.info", { comp: "fo_comp", layer: "fo_solid" });
    const op = info.transformGroup.properties.find((p) => p.matchName === "ADBE Opacity");
    expect(op?.keyframes?.[1]).toMatchObject({ inInterpName: "linear", outInterpName: "hold" });
    expect(op?.keyframes?.[2]).toMatchObject({ inInterpName: "bezier", outInterpName: "bezier" });
  });

  it("separated Position: transform.set, keyframe.apply and comp.sample all route through the followers", async (ctx) => {
    if (!ready) return ctx.skip();
    const sep = await o().run<{ dimensionsSeparated: boolean }>("property.separate_dimensions", {
      comp: "fo_comp",
      layer: "fo_solid",
      property: ["Transform", "Position"],
      separated: true,
    });
    expect(sep.dimensionsSeparated).toBe(true);
    const set = await o().run<{ layers: Array<{ warnings: string[] }> }>("transform.set", {
      comp: "fo_comp",
      layer: "fo_solid",
      position: [100, 200],
    });
    expect(set.layers[0].warnings).toEqual([]);
    const staticRow = await sampleAt("fo_comp", "fo_solid", 0);
    expect(staticRow.values["Transform/Position"]).toEqual([100, 200]);
    const keyed = await o().run<{ layers: Array<{ separated: boolean; numKeys: number }> }>(
      "keyframe.apply",
      {
        comp: "fo_comp",
        layer: "fo_solid",
        property: ["Transform", "Position"],
        keys: [
          { time: 0, value: [0, 0] },
          { time: 1, value: [100, 300] },
        ],
        replace: true,
      },
    );
    expect(keyed.layers[0].separated).toBe(true);
    expect(keyed.layers[0].numKeys).toBe(2);
    const half = await sampleAt("fo_comp", "fo_solid", 0.5);
    const pos = half.values["Transform/Position"] as number[];
    expect(pos[0]).toBeCloseTo(50, 3);
    expect(pos[1]).toBeCloseTo(150, 3);
    await o().run("property.separate_dimensions", {
      comp: "fo_comp",
      layer: "fo_solid",
      property: ["Transform", "Position"],
      separated: false,
    });
  });

  it("shape.group_bounds measures each group in layer space", async (ctx) => {
    if (!ready) return ctx.skip();
    const res = await o().run<{
      layers: Array<{
        layer: { left: number; top: number; width: number; height: number };
        groups: Array<{
          name: string;
          left: number;
          top: number;
          width: number;
          height: number;
          center: number[];
        }>;
      }>;
    }>("shape.group_bounds", { comp: "fo_comp", layer: "fo_shape", includeStroke: false });
    const [box, dot] = res.layers[0].groups;
    expect(box.name).toBe("box");
    expect(box).toMatchObject({ left: 0, top: 0, width: 200, height: 100 });
    expect(box.center).toEqual([100, 50]);
    expect(dot.name).toBe("dot");
    expect(dot).toMatchObject({ left: -350, top: -50, width: 100, height: 100 });
    expect(res.layers[0].layer).toMatchObject({ left: -350, top: -50, width: 550, height: 150 });
  });

  it("shape.recolor and shape.signature: paint everything, then substitute by map", async (ctx) => {
    if (!ready) return ctx.skip();
    const before = await o().run<{
      layers: Array<{ signature: string; groups: Array<{ signature: string }> }>;
    }>("shape.signature", { comp: "fo_comp", layer: "fo_shape" });
    const dup = await o().run<{ name: string }>("layer.duplicate", {
      comp: "fo_comp",
      layer: "fo_shape",
      newName: "fo_shape_copy",
    });
    const copySig = await o().run<{ layers: Array<{ signature: string }> }>("shape.signature", {
      comp: "fo_comp",
      layer: dup.name,
    });
    expect(copySig.layers[0].signature, "an untouched duplicate hashes the same").toBe(
      before.layers[0].signature,
    );
    const all = await o().run<{ changed: number }>("shape.recolor", {
      comp: "fo_comp",
      layer: "fo_shape_copy",
      color: [0, 0, 0],
    });
    expect(all.changed).toBe(2);
    const mapped = await o().run<{ changed: number }>("shape.recolor", {
      comp: "fo_comp",
      layer: "fo_shape_copy",
      map: [{ from: [0, 0, 0], to: [0, 1, 0] }],
      target: "fill",
    });
    expect(mapped.changed).toBe(2);
    const miss = await o().run<{ changed: number }>("shape.recolor", {
      comp: "fo_comp",
      layer: "fo_shape_copy",
      map: [{ from: [1, 0, 0], to: [0, 0, 1] }],
    });
    expect(miss.changed, "no fill is red any more").toBe(0);
    const after = await o().run<{ layers: Array<{ signature: string }> }>("shape.signature", {
      comp: "fo_comp",
      layer: "fo_shape_copy",
    });
    expect(after.layers[0].signature).not.toBe(before.layers[0].signature);
    const fill = await o().run<{ value: number[] }>("property.get", {
      comp: "fo_comp",
      layer: "fo_shape_copy",
      property: ["Contents", "box", "Contents", "Fill 1", "Color"],
    });
    expect(fill.value.slice(0, 3)).toEqual([0, 1, 0]);
    await o().run("layer.delete", { comp: "fo_comp", layer: "fo_shape_copy" });
  });

  it("layer.split_groups: one layer per group, anchored on its own artwork, original removed", async (ctx) => {
    if (!ready) return ctx.skip();
    await o().run("layer.duplicate", { comp: "fo_comp", layer: "fo_shape", newName: "fo_word" });
    const res = await o().run<{
      created: number;
      layers: Array<{ name: string; group: string; anchorPoint: number[]; index: number }>;
    }>("layer.split_groups", { comp: "fo_comp", layer: "fo_word", anchor: "center" });
    expect(res.created).toBe(2);
    expect(res.layers.map((l) => l.name)).toEqual(["box", "dot"]);
    // Shape layers report a 3-component anchor ([x, y, 0]).
    expect(res.layers[0].anchorPoint.slice(0, 2)).toEqual([100, 50]);
    expect(res.layers[1].anchorPoint.slice(0, 2)).toEqual([-300, 0]);
    // Group 1 stacks above group 2.
    expect(res.layers[0].index).toBeLessThan(res.layers[1].index);
    const gone = await o().run<{ matches: unknown[] }>("project.find_layers", {
      comp: "fo_comp",
      namePattern: "fo_word",
    });
    expect(gone.matches).toHaveLength(0);
    // Each new layer holds exactly one group, and the visual position is unchanged:
    // position moved by exactly the anchor delta (scale 100, rotation 0).
    const boxRow = await sampleAt("fo_comp", "box", 0);
    expect((boxRow.values["Transform/Position"] as number[]).slice(0, 2)).toEqual([
      960 + 100,
      540 + 50,
    ]);
    await o().run("layer.delete", { comp: "fo_comp", layer: "box" });
    await o().run("layer.delete", { comp: "fo_comp", layer: "dot" });
  });

  it("layer.set_anchor preset keeps the layer where it was", async (ctx) => {
    if (!ready) return ctx.skip();
    const before = await sampleAt("fo_comp", "fo_text", 0);
    const bounds = await o().run<{
      layerSpace: { left: number; top: number; width: number; height: number };
    }>("layer.bounds", { comp: "fo_comp", layer: "fo_text", time: 0 });
    const res = await o().run<{
      layers: Array<{ anchorPoint: number[]; positionDelta: number[]; warnings: string[] }>;
    }>("layer.set_anchor", { comp: "fo_comp", layer: "fo_text", preset: "bottomCenter", time: 0 });
    const r = bounds.layerSpace;
    expect(res.layers[0].anchorPoint[0]).toBeCloseTo(r.left + r.width / 2, 3);
    expect(res.layers[0].anchorPoint[1]).toBeCloseTo(r.top + r.height, 3);
    const after = await sampleAt("fo_comp", "fo_text", 0);
    const p0 = before.values["Transform/Position"] as number[];
    const p1 = after.values["Transform/Position"] as number[];
    const a0 = before.values["Transform/Anchor Point"] as number[];
    const a1 = after.values["Transform/Anchor Point"] as number[];
    expect(p1[0] - p0[0]).toBeCloseTo(a1[0] - a0[0], 3);
    expect(p1[1] - p0[1]).toBeCloseTo(a1[1] - a0[1], 3);
  });

  it("mask.add + mask.set_path { time }: a circular wipe is two calls", async (ctx) => {
    if (!ready) return ctx.skip();
    const added = await o().run<{ maskIndex: number }>("mask.add", {
      comp: "fo_comp",
      layer: "fo_solid",
      shape: "ellipse",
      size: [0, 0],
      name: "wipe",
    });
    await o().run("mask.set_path", {
      comp: "fo_comp",
      layer: "fo_solid",
      maskIndex: added.maskIndex,
      shape: "ellipse",
      size: [10, 10],
      time: 0,
    });
    const keyed = await o().run<{ numKeys: number }>("mask.set_path", {
      comp: "fo_comp",
      layer: "fo_solid",
      maskIndex: added.maskIndex,
      shape: "ellipse",
      size: [3000, 3000],
      time: 1,
    });
    expect(keyed.numKeys).toBe(2);
    const shape = await o().run<{ value: { vertices: number[][] } }>("property.get", {
      comp: "fo_comp",
      layer: "fo_solid",
      property: ["Masks", "wipe", "Mask Path"],
      time: 1,
    });
    expect(shape.value.vertices).toHaveLength(4);
    // Default center for a 400×200 solid is its middle; the right vertex sits at x = 200 + 1500.
    expect(shape.value.vertices[1][0]).toBeCloseTo(1700, 2);
    await o().run("mask.remove", {
      comp: "fo_comp",
      layer: "fo_solid",
      maskIndex: added.maskIndex,
    });
  });

  it("layer.set_visibility_schedule writes hold opacity keys", async (ctx) => {
    if (!ready) return ctx.skip();
    const res = await o().run<{ layers: Array<{ numKeys: number }> }>(
      "layer.set_visibility_schedule",
      {
        comp: "fo_comp",
        entries: [{ layer: "fo_text", ranges: [[1, 2]] }],
      },
    );
    expect(res.layers[0].numKeys).toBe(3);
    expect((await sampleAt("fo_comp", "fo_text", 0.5)).values["Transform/Opacity"]).toBe(0);
    expect((await sampleAt("fo_comp", "fo_text", 1.5)).values["Transform/Opacity"]).toBe(100);
    expect((await sampleAt("fo_comp", "fo_text", 2.5)).values["Transform/Opacity"]).toBe(0);
  });

  it("comp.set_layer_order, layer.set_timing, layer.create_adjustment", async (ctx) => {
    if (!ready) return ctx.skip();
    const order = await o().run<{ order: string[] }>("comp.set_layer_order", {
      comp: "fo_comp",
      layers: ["fo_solid", "fo_shape", "fo_text"],
    });
    expect(order.order.slice(0, 3)).toEqual(["fo_solid", "fo_shape", "fo_text"]);
    const timing = await o().run<{
      layers: Array<{ inPoint: number; outPoint: number; startTime: number }>;
    }>("layer.set_timing", { comp: "fo_comp", layer: "fo_text", shift: 1, outPoint: "comp" });
    expect(timing.layers[0].startTime).toBeCloseTo(1, 3);
    expect(timing.layers[0].outPoint).toBeCloseTo(5, 3);
    const adj = await o().run<{ adjustmentLayer: boolean; name: string }>(
      "layer.create_adjustment",
      {
        comp: "fo_comp",
        name: "fo_adj",
      },
    );
    expect(adj.adjustmentLayer).toBe(true);
    await o().run("layer.delete", { comp: "fo_comp", layer: "fo_adj" });
  });

  it("comp.resize keeps centred content centred (keys included)", async (ctx) => {
    if (!ready) return ctx.skip();
    await o().run("keyframe.apply", {
      comp: "fo_comp",
      layer: "fo_shape",
      property: ["Transform", "Position"],
      keys: [
        { time: 0, value: [960, 540] },
        { time: 1, value: [1200, 540] },
      ],
      replace: true,
    });
    const res = await o().run<{
      comps: Array<{ offset: number[]; layersMoved: number; to: number[] }>;
    }>("comp.resize", { comp: "fo_comp", width: 1440, anchor: "center" });
    expect(res.comps[0].to).toEqual([1440, 1080]);
    expect(res.comps[0].offset).toEqual([-240, 0]);
    const k0 = await sampleAt("fo_comp", "fo_shape", 0);
    const k1 = await sampleAt("fo_comp", "fo_shape", 1);
    expect((k0.values["Transform/Position"] as number[]).slice(0, 2)).toEqual([720, 540]);
    expect((k1.values["Transform/Position"] as number[]).slice(0, 2)).toEqual([960, 540]);
    await o().run("comp.resize", { comp: "fo_comp", width: 1920, anchor: "center" });
  });

  it("project.rename: dry run, map, and regex", async (ctx) => {
    if (!ready) return ctx.skip();
    const dry = await o().run<{
      dryRun: boolean;
      changes: Array<{ kind: string; from: string; to: string; applied?: boolean }>;
    }>("project.rename", { pattern: "^fo_(\\w+)$", replacement: "FO-$1", dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(
      dry.changes.some((c) => c.kind === "item" && c.from === "fo_comp" && c.to === "FO-comp"),
    ).toBe(true);
    expect(dry.changes.some((c) => c.kind === "layer" && c.from === "fo_solid")).toBe(true);
    expect(dry.changes.every((c) => c.applied === undefined)).toBe(true);
    const still = await o().run<{ matches: unknown[] }>("project.find_layers", {
      comp: "fo_comp",
      namePattern: "fo_solid",
    });
    expect(still.matches).toHaveLength(1);
    const mapped = await o().run<{ count: number }>("project.rename", {
      scope: "layers",
      comp: "fo_comp",
      map: { fo_text: "fo_text_renamed" },
    });
    expect(mapped.count).toBe(1);
    const back = await o().run<{ count: number }>("project.rename", {
      scope: "layers",
      pattern: "_renamed$",
      replacement: "",
    });
    expect(back.count).toBe(1);
  });

  it("layer.copy_to_comp finds the copy by id and bakes keys", async (ctx) => {
    if (!ready) return ctx.skip();
    // A layer already on top of the target makes "the copy is layer 1" wrong.
    await o().run("layer.create_null", { comp: "fo_other", name: "fo_top_null" });
    const sourceAt1 = (await sampleAt("fo_comp", "fo_shape", 1)).values["Transform/Position"];
    const res = await o().run<{
      newName: string;
      newId: number | null;
      bakedProperties: number;
      startTime: number;
    }>("layer.copy_to_comp", {
      comp: "fo_comp",
      layer: "fo_shape",
      targetComp: "fo_other",
      bakeAtTime: 1,
      timeOffset: 0.5,
      name: "fo_baked",
    });
    expect(res.newName).toBe("fo_baked");
    expect(res.bakedProperties).toBeGreaterThanOrEqual(1);
    expect(res.startTime).toBeCloseTo(0.5, 3);
    const info = await o().run<{ numKeys: number; value: number[] }>("property.get", {
      comp: "fo_other",
      layer: "fo_baked",
      property: ["Transform", "Position"],
    });
    expect(info.numKeys).toBe(0);
    // Frozen at source time 1: the static value equals what the source showed there.
    expect(info.value).toEqual(sourceAt1);
  });

  it("layer.convert_to_shapes turns an imported PDF into a shape layer", async (ctx) => {
    if (!ready) return ctx.skip();
    await fs.mkdir(E2E_SCRATCH_DIR, { recursive: true });
    const pdfPath = path.join(E2E_SCRATCH_DIR, `fo_vector_${Date.now()}.pdf`).replace(/\\/g, "/");
    await fs.writeFile(pdfPath, minimalPdf());
    const imported = await o().run<{ id: number }>("project.import_file", {
      path: pdfPath,
      name: "fo_vector",
    });
    await o().run("layer.create_footage", {
      comp: "fo_comp",
      sourceItemId: imported.id,
      name: "fo_vector",
    });
    const res = await o().run<{
      converted: number;
      layers: Array<{
        ok: boolean;
        name: string;
        originalName: string;
        sourceRemoved?: boolean;
        footageRemoved?: boolean;
      }>;
    }>("layer.convert_to_shapes", {
      comp: "fo_comp",
      layer: "fo_vector",
      removeSource: true,
      removeFootage: true,
    });
    expect(res.converted).toBe(1);
    expect(res.layers[0].name).toBe("fo_vector");
    expect(res.layers[0].originalName).not.toBe("fo_vector");
    expect(res.layers[0].sourceRemoved).toBe(true);
    expect(res.layers[0].footageRemoved).toBe(true);
    const found = await o().run<{ matches: Array<{ type: string }> }>("project.find_layers", {
      comp: "fo_comp",
      namePattern: "fo_vector",
    });
    expect(found.matches).toHaveLength(1);
    expect(found.matches[0].type).toBe("ShapeLayer");
    // Converted layers sometimes arrive with separated Position; writes work either way.
    const moved = await o().run<{ layers: Array<{ separated: boolean; numKeys: number }> }>(
      "keyframe.apply",
      {
        comp: "fo_comp",
        layer: "fo_vector",
        property: ["Transform", "Position"],
        keys: [{ time: 0, value: [100, 100] }],
      },
    );
    expect(moved.layers[0].numKeys).toBe(1);
    expect(typeof moved.layers[0].separated).toBe("boolean");
  });

  it("render.variants renders one file per variant and restores the value", async (ctx) => {
    if (!ready) return ctx.skip();
    await o().run("effect.add", {
      comp: "fo_comp",
      layer: "fo_solid",
      matchName: "ADBE Slider Control",
      name: "State",
    });
    const dir = path.join(E2E_SCRATCH_DIR, `variants_${Date.now()}`).replace(/\\/g, "/");
    const res = await o().run<{
      rendered: number;
      variants: Array<{ name: string; ok: boolean; outputPath: string }>;
    }>("render.variants", {
      comp: "fo_comp",
      variants: [
        {
          name: "A",
          sets: [{ layer: "fo_solid", property: ["Effects", "State", "Slider"], value: 1 }],
        },
        {
          name: "B",
          sets: [{ layer: "fo_solid", property: ["Effects", "State", "Slider"], value: 2 }],
        },
      ],
      outputPath: `${dir}/{name}.avi`,
      timeSpanStart: 0,
      timeSpanDuration: 1 / 30,
    });
    expect(res.rendered).toBe(2);
    const files = await fs.readdir(dir);
    expect(files.some((f) => f.startsWith("A"))).toBe(true);
    expect(files.some((f) => f.startsWith("B"))).toBe(true);
    const slider = await o().run<{ value: number }>("property.get", {
      comp: "fo_comp",
      layer: "fo_solid",
      property: ["Effects", "State", "Slider"],
    });
    expect(slider.value).toBe(0);
    const queue = await o().run<{ numItems: number }>("render.status", {});
    expect(queue.numItems).toBe(0);
  }, 240_000);

  it("ae_render_frame: contactSheet tiles the frames, analyze measures them", async (ctx) => {
    if (!ready || !transport) return ctx.skip();
    const base = path.join(E2E_SCRATCH_DIR, `sheet_${Date.now()}`, "f.png").replace(/\\/g, "/");
    const res = (await renderFrameTool.handler(
      {
        compNameOrId: "fo_comp",
        times: [0, 0.5, 1],
        outPath: base,
        contactSheet: { columns: 3, thumbWidth: 240 },
        analyze: true,
      },
      transport,
    )) as { isError?: boolean; structuredContent?: { result?: Record<string, unknown> } };
    expect(res.isError, JSON.stringify(res.structuredContent)).toBeFalsy();
    const result = res.structuredContent?.result as {
      frames: Array<{
        analysis?: { width: number; edges: { top: { kind: string } }; contentBounds: unknown };
      }>;
      contactSheet?: { writtenTo: string; columns: number; frames: number; size: number[] };
      contactSheetWarning?: string;
      analysisWarning?: string;
    };
    expect(result.analysisWarning).toBeUndefined();
    expect(result.contactSheetWarning).toBeUndefined();
    expect(result.frames[0].analysis?.width).toBe(1920);
    expect(result.frames[0].analysis?.contentBounds).not.toBeNull();
    expect(result.contactSheet?.columns).toBe(3);
    expect(result.contactSheet?.frames).toBe(3);
    const stat = await fs.stat(result.contactSheet?.writtenTo as string);
    expect(stat.size).toBeGreaterThan(0);
  });
});
