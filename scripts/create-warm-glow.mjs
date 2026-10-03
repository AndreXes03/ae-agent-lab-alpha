#!/usr/bin/env node
// Builds an expendable static scene in a named AE worker. It never addresses
// the user's default AE instance. Run only after worker-smoke succeeds.
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const instance = process.argv[2] || "ae-warm-glow";
const evidence = join(root, "demo", "warm-glow");
const project = join(root, "demo", "warm-glow-input.aep");
await mkdir(evidence, { recursive: true });

const client = new Client({ name: "ae-agent-lab-fixture", version: "0.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  env: { ...process.env, AE_MCP_INSTANCE: instance, AE_MCP_READONLY: "0", AE_MCP_ENABLE_EVAL: "0" },
});

function unpack(response, label) {
  const raw =
    response.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") || "";
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label}: non-JSON response: ${raw}`);
  }
  if (response.isError || value.ok === false || value.result?.ok === false) {
    throw new Error(
      `${label}: ${value.errorCode || "AE"} ${value.error || value.result?.error || raw}`,
    );
  }
  console.log(`OK ${label}`);
  return value;
}

async function call(tool, args, label) {
  return unpack(
    await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 180000 }),
    label,
  );
}
async function op(operation, args) {
  return call("ae_do", { operation, args }, operation);
}

try {
  await client.connect(transport);
  const info = await call("ae_project_info", {}, "inspect isolated worker");
  if (info.result?.file || info.result?.numItems > 0)
    throw new Error("Fresh empty worker required");
  const comp = "Warm Glow";
  await op("comp.create", {
    name: comp,
    width: 1600,
    height: 900,
    fps: 30,
    duration: 4,
    bgColor: [0.018, 0.014, 0.012],
  });
  await op("layer.create_solid", { comp, name: "Background", color: [0.018, 0.014, 0.012] });
  async function ellipse(name, size, color, position) {
    await op("layer.create_shape", { comp, name });
    await op("shape.add_group", { comp, layer: name, name: "Form" });
    await op("shape.add_ellipse", { comp, layer: name, groupIndex: 1, size });
    await op("shape.add_fill", { comp, layer: name, groupIndex: 1, color: [...color, 1] });
    await op("transform.set", { comp, layer: name, position });
  }
  await ellipse("Orange atmosphere", [660, 660], [1, 0.24, 0.025], [1120, 490]);
  await op("effect.add", { comp, layer: "Orange atmosphere", matchName: "ADBE Gaussian Blur 2" });
  await op("effect.set_property", {
    comp,
    layer: "Orange atmosphere",
    effectIndex: 1,
    property: [1],
    value: 190,
  });
  await op("transform.set", { comp, layer: "Orange atmosphere", opacity: 60 });
  await ellipse("Solar core", [530, 530], [1, 0.68, 0.12], [1120, 450]);
  await op("effect.add", { comp, layer: "Solar core", matchName: "ADBE Ramp" });
  await op("effect.set_property", {
    comp,
    layer: "Solar core",
    effectIndex: 1,
    property: [1],
    value: [1080, 190],
  });
  await op("effect.set_property", {
    comp,
    layer: "Solar core",
    effectIndex: 1,
    property: [2],
    value: [1, 0.87, 0.38, 1],
  });
  await op("effect.set_property", {
    comp,
    layer: "Solar core",
    effectIndex: 1,
    property: [3],
    value: [1160, 715],
  });
  await op("effect.set_property", {
    comp,
    layer: "Solar core",
    effectIndex: 1,
    property: [4],
    value: [1, 0.24, 0.035, 1],
  });
  await op("effect.add", { comp, layer: "Solar core", matchName: "ADBE Glo2" });
  await call(
    "ae_do",
    { operation: "effect.list_on_layer", args: { comp, layer: "Solar core" } },
    "inspect native glow controls",
  );
  await ellipse("Eclipse", [495, 495], [0.018, 0.014, 0.012], [1082, 402]);
  async function text(name, text, size, pos, color, tracking = 0) {
    await op("layer.create_text", { comp, name, text });
    await op("text.set_style", {
      comp,
      layer: name,
      font: "HelveticaNeue",
      fontSize: size,
      fillColor: color,
      applyFill: true,
      justification: "left",
      tracking,
    });
    await op("transform.set", { comp, layer: name, position: pos });
  }
  await text("Eyebrow", "MOTION STUDY   /   001", 20, [105, 115], [1, 0.36, 0.09], 110);
  await text("Headline", "Make it\rmove.", 120, [100, 365], [0.98, 0.95, 0.87], -35);
  await text(
    "Caption",
    "A little direction.\rA different kind of energy.",
    28,
    [108, 630],
    [0.58, 0.54, 0.48],
    0,
  );
  await text(
    "Footer",
    "AFTER EFFECTS  /  AGENT EXPERIMENT",
    16,
    [108, 817],
    [0.47, 0.43, 0.38],
    90,
  );
  await call("ae_save_project", { path: project }, "save static input");
  await call(
    "ae_render_frame",
    { compNameOrId: comp, time: 2, outPath: join(evidence, "before.png") },
    "render baseline",
  );
  console.log("Static scene ready");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
