#!/usr/bin/env node
// First agent-designed edit pass on the real fixture in the named AE worker.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const instance = process.argv[2] || "ae-heavy-grain";
const comp = "Warm Glow";
const evidence = join(root, "demo", "warm-glow");
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
  const state = await call("ae_project_info", {}, "verify heavy grain copy");
  if (!state.file?.endsWith("warm-glow-heavy-grain.aep")) throw new Error("Wrong project");
  await op("keyframe.apply", {
    comp,
    layer: "Finish - exposure bloom",
    property: ["Effects", "ADBE Exposure2", "ADBE Exposure2-0003"],
    keys: [
      { time: 0, value: 0, interp: "ease" },
      { time: 1.2, value: 0.5, interp: "ease" },
      { time: 1.8, value: 2.5, interp: "ease" },
      { time: 2.6, value: 0.6, interp: "ease" },
      { time: 4, value: 1.5, interp: "ease" },
    ],
    replace: true,
  });
  for (const [index, value] of [
    [11, 2.4],
    [12, 1.5],
    [34, 0.12],
  ])
    await op("effect.set_property", {
      comp,
      layer: "Finish - heavy film grain",
      effectIndex: 1,
      property: [index],
      value,
    });
  await call("ae_save_project", {}, "save heavy grain and exposure");
  await call(
    "ae_render_frame",
    { compNameOrId: comp, time: 1.8, outPath: join(evidence, "heavy-grain-hero.png") },
    "render photographic finish",
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
