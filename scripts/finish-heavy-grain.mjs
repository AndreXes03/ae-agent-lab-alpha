#!/usr/bin/env node
// First agent-designed edit pass on the real fixture in the named AE worker.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const instance = process.argv[2] || "ae-heavy-grain";
const comp = "Warm Glow";
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
  const state = await call("ae_project_info", {}, "inspect heavy grain copy");
  if (!state.file?.endsWith("warm-glow-heavy-grain.aep")) throw new Error("Wrong project");
  for (const [index, value] of [
    [1, 3],
    [11, 5],
    [12, 2.2],
    [13, 0.65],
    [27, true],
  ])
    await op("effect.set_property", {
      comp,
      layer: "Finish - fine monochrome grain",
      effectIndex: 1,
      property: [index],
      value,
    });
  await op("layer.set_props", {
    comp,
    layer: "Finish - fine monochrome grain",
    props: { name: "Finish - heavy film grain" },
  });
  const name = "Finish - exposure bloom";
  await op("layer.create_adjustment", { comp, name });
  await op("layer.move", { comp, layer: name, toIndex: 6 });
  await op("mask.add", {
    comp,
    layer: name,
    name: "Local highlight",
    shape: "ellipse",
    center: [1325, 400],
    size: [230, 270],
  });
  await op("mask.set_props", { comp, layer: name, maskIndex: 1, feather: [130, 130] });
  await op("effect.add", { comp, layer: name, matchName: "ADBE Exposure2" });
  console.log(JSON.stringify(await op("effect.list_on_layer", { comp, layer: name })));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
