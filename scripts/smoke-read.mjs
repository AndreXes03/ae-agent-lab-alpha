#!/usr/bin/env node
// Read-only native connection check. Prints no comp, layer or footage names.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const client = new Client({ name: "ae-agent-lab-smoke", version: "0.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  env: { ...process.env, AE_MCP_READONLY: "1", AE_MCP_ENABLE_EVAL: "0" },
});

try {
  await client.connect(transport);
  const tools = await client.listTools();
  console.log(`MCP connected; ${tools.tools.length} tools visible in read-only mode.`);
  const result = await client.callTool({ name: "ae_project_info", arguments: {} }, undefined, {
    timeout: 30000,
  });
  const content =
    result.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") || "";
  let payload;
  try {
    payload = JSON.parse(content);
  } catch {
    payload = null;
  }
  if (result.isError || payload?.ok === false) {
    console.error(
      `Native read failed: ${payload?.errorCode || "UNKNOWN"} ${payload?.error || "See AE permissions and open project."}`,
    );
    process.exitCode = 1;
  } else {
    console.log("Native AE project read succeeded. Project details intentionally omitted.");
  }
} catch (error) {
  console.error(`Native read failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
