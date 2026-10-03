#!/usr/bin/env node
// First agent-designed edit pass on the real fixture in the named AE worker.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const instance = process.argv[2] || "ae-glow-texture";
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
  const state = await call("ae_project_info", {}, "inspect texture project");
  if (!state.file?.endsWith("warm-glow-textured.aep")) throw new Error("Expected texture copy");
  const name = "Finish - breathing bloom";
  await op("layer.create_adjustment", { comp, name });
  await op("layer.move", { comp, layer: name, toIndex: 6 });
  await op("effect.add", { comp, layer: name, matchName: "ADBE Glo2" });
  for (const [index, value] of [
    [2, 65],
    [3, 65],
  ])
    await op("effect.set_property", {
      comp,
      layer: name,
      effectIndex: 1,
      property: [index],
      value,
    });
  await op("keyframe.apply", {
    comp,
    layer: name,
    property: ["Effects", "ADBE Glo2", "ADBE Glo2-0004"],
    keys: [
      { time: 0, value: 0.12, interp: "ease" },
      { time: 1.8, value: 0.5, interp: "ease" },
      { time: 2.6, value: 0.18, interp: "ease" },
      { time: 4, value: 0.38, interp: "ease" },
    ],
    replace: true,
  });
  await call("ae_save_project", {}, "save three-effect finish");
  await call(
    "ae_render_frame",
    { compNameOrId: comp, time: 1.8, outPath: join(evidence, "textured-hero.png") },
    "review bloom peak",
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
