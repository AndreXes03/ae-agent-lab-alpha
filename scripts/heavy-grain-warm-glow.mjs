#!/usr/bin/env node
// First agent-designed edit pass on the real fixture in the named AE worker.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const instance = process.argv[2] || "ae-heavy-grain";
const comp = "Warm Glow";
const project = join(root, "demo", "warm-glow-textured.aep");
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
  const state = await call("ae_project_info", {}, "inspect isolated worker");
  if (state.file || state.numItems > 0) throw new Error("Fresh worker required");
  await op("project.open", { path: project });
  await call("ae_comp_info", { nameOrId: comp }, "inspect saved composition");
  await call(
    "ae_save_project",
    { path: join(root, "demo", "warm-glow-heavy-grain.aep") },
    "save heavy grain copy",
  );
  await op("effect.set_property", {
    comp,
    layer: "Finish - optical softness",
    effectIndex: 1,
    property: [1],
    value: 24,
  });
  await op("effect.remove", { comp, layer: "Finish - fine monochrome grain", effectIndex: 1 });
  await op("effect.add", {
    comp,
    layer: "Finish - fine monochrome grain",
    matchName: "VISINF Grain Implant",
  });
  const fx = await op("effect.list_on_layer", { comp, layer: "Finish - fine monochrome grain" });
  console.log(JSON.stringify(fx));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
