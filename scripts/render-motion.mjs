#!/usr/bin/env node
// Render actual AE frames at 15 fps for an honest short motion preview.
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const instance = process.argv[2] || "ae-agent-lab-demo";
const out = join(root, "demo", "evidence", "motion-frames");
await mkdir(out, { recursive: true });
const client = new Client({ name: "ae-agent-lab-motion", version: "0.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist", "index.js")],
  env: { ...process.env, AE_MCP_INSTANCE: instance, AE_MCP_READONLY: "1", AE_MCP_ENABLE_EVAL: "0" },
});

try {
  await client.connect(transport);
  for (let batch = 0; batch < 2; batch++) {
    const times = Array.from({ length: 30 }, (_, i) => (batch * 30 + i) / 15);
    const result = await client.callTool(
      {
        name: "ae_render_frame",
        arguments: {
          compNameOrId: "Card Study — Static Input",
          times,
          outPath: join(out, `batch-${batch}.png`),
        },
      },
      undefined,
      { timeout: 300000 },
    );
    const raw =
      result.content
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n") || "";
    const payload = JSON.parse(raw);
    if (result.isError || payload.ok === false || payload.result?.ok === false) {
      throw new Error(`Batch ${batch} failed: ${payload.error || payload.result?.error || raw}`);
    }
    console.log(`Rendered AE frames ${batch * 30}–${batch * 30 + 29}`);
  }
  console.log(out);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
}
