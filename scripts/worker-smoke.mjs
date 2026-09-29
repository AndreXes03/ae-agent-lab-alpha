#!/usr/bin/env node
// Launch an isolated AE instance through the local MCP bridge.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const name = process.argv[2] || "ae-agent-lab-demo";
const client = new Client(
  { name: "ae-agent-lab-worker-smoke", version: "0.0.0" },
  { capabilities: {} },
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  env: { ...process.env, AE_MCP_READONLY: "0", AE_MCP_ENABLE_EVAL: "0" },
});

function parsed(result) {
  const text =
    result.content
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n") || "";
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text };
  }
}

try {
  await client.connect(transport);
  const start = parsed(
    await client.callTool(
      {
        name: "ae_do",
        arguments: { operation: "instance.start", args: { name, timeoutMs: 90000 } },
      },
      undefined,
      { timeout: 100000 },
    ),
  );
  if (start.ok === false) throw new Error(`${start.errorCode || "AE"}: ${start.error}`);
  console.log(`Worker start: ${JSON.stringify(start)}`);
  const info = parsed(
    await client.callTool(
      {
        name: "ae_project_info",
        arguments: { instance: name },
      },
      undefined,
      { timeout: 30000 },
    ),
  );
  if (info.ok === false) throw new Error(`${info.errorCode || "AE"}: ${info.error}`);
  console.log(`Worker project read succeeded: ${name}`);
} catch (error) {
  console.error(`Worker smoke failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
