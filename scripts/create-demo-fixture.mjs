#!/usr/bin/env node
// Builds an expendable static scene in a named AE worker. It never addresses
// the user's default AE instance. Run only after worker-smoke succeeds.
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const instance = process.argv[2] || "ae-agent-lab-demo";
const evidence = join(root, "demo", "evidence");
const project = join(root, "demo", "fixture.aep");
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
  const info = await call("ae_project_info", {}, "worker inspection");
  if (info.result?.file || info.result?.numItems > 0) {
    throw new Error(
      "Worker is not empty. Choose a fresh worker; fixture creation will not clear existing work.",
    );
  }
  const comp = "Card Study — Static Input";
  await op("comp.create", {
    name: comp,
    width: 1600,
    height: 900,
    fps: 30,
    duration: 4,
    bgColor: [0.035, 0.047, 0.07],
  });
  const cards = [
    { name: "Card 01", number: "01", x: 350, color: [0.51, 0.81, 0.69] },
    { name: "Card 02", number: "02", x: 800, color: [0.54, 0.65, 0.97] },
    { name: "Card 03", number: "03", x: 1250, color: [1, 0.66, 0.51] },
  ];
  for (const card of cards) {
    await op("layer.create_solid", {
      comp,
      name: card.name,
      color: card.color,
      width: 360,
      height: 450,
    });
    await op("transform.set", { comp, layer: card.name, position: [card.x, 470] });
    await op("layer.create_text", { comp, name: `${card.name} Label`, text: card.number });
    await op("text.set_style", {
      comp,
      layer: `${card.name} Label`,
      fontSize: 84,
      fillColor: [0.03, 0.04, 0.07],
      applyFill: true,
    });
    await op("transform.set", { comp, layer: `${card.name} Label`, position: [card.x - 65, 500] });
  }
  await op("layer.create_text", { comp, name: "Title", text: "A SIMPLE STUDY IN RHYTHM" });
  await op("text.set_style", {
    comp,
    layer: "Title",
    fontSize: 38,
    fillColor: [0.94, 0.95, 0.96],
    applyFill: true,
  });
  await op("transform.set", { comp, layer: "Title", position: [140, 130] });
  await call("ae_save_project", { path: project }, "save fixture");
  await call(
    "ae_render_frame",
    {
      compNameOrId: comp,
      times: [0, 0.5, 1, 1.5, 2, 3],
      outPath: join(evidence, "before.png"),
      contactSheet: {},
      analyze: true,
    },
    "render static baseline",
  );
  console.log(`Fixture: ${project}`);
  console.log(`Baseline: ${join(evidence, "before_sheet.png")}`);
} catch (error) {
  console.error(`Fixture failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
