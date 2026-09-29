#!/usr/bin/env node
// First agent-designed edit pass on the real fixture in the named AE worker.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const instance = process.argv[2] || "ae-agent-lab-demo";
const comp = "Card Study — Static Input";
const project = join(root, "demo", "edited-first-pass.aep");
const evidence = join(root, "demo", "evidence");
const client = new Client({ name: "ae-agent-lab-edit", version: "0.0.0" }, { capabilities: {} });
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
  return value.result || value;
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
  const info = await call("ae_comp_info", { nameOrId: comp }, "read comp");
  const names = new Set(info.layers.map((layer) => layer.name));
  for (const name of [
    "Card 01",
    "Card 02",
    "Card 03",
    "Card 01 Label",
    "Card 02 Label",
    "Card 03 Label",
    "Title",
  ]) {
    if (!names.has(name)) throw new Error(`Expected fixture layer missing: ${name}`);
  }
  await call("ae_save_project", { path: project }, "save working copy");
  await op("text.set_style", { comp, layer: "Title", justification: "left" });

  const cards = [
    { index: 1, x: 350, at: 0.08 },
    { index: 2, x: 800, at: 0.36 },
    { index: 3, x: 1250, at: 0.64 },
  ];
  for (const card of cards) {
    const number = String(card.index).padStart(2, "0");
    for (const [layer, targetY] of [
      [`Card ${number}`, 470],
      [`Card ${number} Label`, 500],
    ]) {
      const keys = [
        { time: card.at, value: [card.x, 1200], interp: "easeOut" },
        { time: card.at + 0.58, value: [card.x, targetY - 18], interp: "ease" },
        { time: card.at + 0.78, value: [card.x, targetY], interp: "easeIn" },
      ];
      await op("keyframe.apply", {
        comp,
        layer,
        property: ["Transform", "Position"],
        keys,
        replace: true,
      });
    }
  }
  await call("ae_save_project", {}, "save first pass");
  await call(
    "ae_render_frame",
    {
      compNameOrId: comp,
      times: [0, 0.4, 0.8, 1.2, 1.6, 2.5],
      outPath: join(evidence, "first-pass.png"),
      contactSheet: {},
      analyze: true,
    },
    "render first-pass motion check",
  );
  console.log(`First pass: ${project}`);
  console.log(`Motion check: ${join(evidence, "first-pass_sheet.png")}`);
} catch (error) {
  console.error(`Edit failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
