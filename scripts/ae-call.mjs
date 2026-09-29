#!/usr/bin/env node
// Small development client for a single typed MCP call. Never persists results.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [tool, rawArgs = "{}"] = process.argv.slice(2);
if (!tool) {
  console.error("Usage: node scripts/ae-call.mjs <tool> '<JSON args>'");
  process.exit(2);
}
const args = JSON.parse(rawArgs);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const client = new Client({ name: "ae-agent-lab-cli", version: "0.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  env: { ...process.env, AE_MCP_ENABLE_EVAL: "0" },
});

try {
  await client.connect(transport);
  const result = await client.callTool({ name: tool, arguments: args }, undefined, {
    timeout: 180000,
  });
  for (const part of result.content || []) if (part.type === "text") console.log(part.text);
  if (result.isError) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
