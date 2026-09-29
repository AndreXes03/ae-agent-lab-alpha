#!/usr/bin/env node
// Run one authentic Codex MCP edit against the prepared disposable AE worker.
import { createWriteStream } from "node:fs";
import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sessionPath = join(root, "runtime", "demo-session", "session.json");
const serverPath = join(root, "dist", "index.js");
const templatePath = join(root, "docs", "CLIENT-DEMO-PROMPT.md");
const expectedWorker = "ae-agent-lab-demo";
const fixture = join(root, "demo", "warm-glow-heavy-grain.aep");

function config(key, value) {
  return ["-c", `${key}=${JSON.stringify(value)}`];
}

function showLiveEvent(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  const item = event?.item;
  if (event?.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
    console.log(`\n[Codex]\n${item.text}`);
    return;
  }
  if ((event?.type === "item.started" || event?.type === "item.completed") && item?.type === "mcp_tool_call") {
    const tool = item.tool ?? item.tool_name ?? item.name ?? "MCP tool";
    const state = event.type === "item.started" ? "started" : (item.status ?? "completed");
    console.log(`[MCP ${state}] ${tool}`);
  }
}

async function main() {
  if (process.argv.length !== 2) throw new Error("Usage: node scripts/run-client-demo.mjs");
  const session = JSON.parse(await readFile(sessionPath, "utf8"));
  if (session.phase !== "ready" || session.worker !== expectedWorker) {
    throw new Error(`Expected ready ${expectedWorker} session; found ${session.phase}/${session.worker}`);
  }
  if (await realpath(session.input) !== await realpath(fixture)) {
    throw new Error("The bundled Exposure edit is only for the warm-glow fixture. For your own project, use the session's printed chat prompt and docs/AGENT-WORKFLOW.md.");
  }
  const runDir = resolve(session.runDir);
  const project = resolve(session.project);
  const runtime = resolve(session.runtime);
  if (!runDir.startsWith(join(root, "demo", "runs") + sep) || project !== join(runDir, "project.aep")) {
    throw new Error("Session project/run directory is outside the demo runs directory");
  }
  if (runtime !== join(root, "runtime", "demo-session")) {
    throw new Error("Session runtime differs from the registered demo runtime");
  }
  if (!(await stat(project)).isFile() || !(await stat(serverPath)).isFile()) {
    throw new Error("Prepared project or built MCP server is missing");
  }
  const variant = join(runDir, "client-variant.aep");
  const transcript = join(runDir, "codex-client-transcript.jsonl");
  const stderrPath = join(runDir, "codex-client-stderr.log");
  const finalPath = join(runDir, "codex-client-final.md");
  const resultPath = join(runDir, "codex-client-result.json");
  for (const path of [variant, transcript, stderrPath, finalPath, resultPath]) {
    try {
      await stat(path);
      throw new Error(`Refusing to overwrite previous demo evidence: ${path}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const template = await readFile(templatePath, "utf8");
  const prompt = template.replaceAll("{{WORKER}}", expectedWorker)
    .replaceAll("{{PROJECT}}", project)
    .replaceAll("{{INPUT}}", session.input)
    .replaceAll("{{RUN_DIR}}", runDir)
    .replaceAll("{{VARIANT}}", variant);
  const args = [
    "exec", "--ignore-user-config", "--ephemeral", "--json", "--color", "never",
    "--approve-for-me", "--skip-git-repo-check",
    "--cd", root, "--model", "gpt-6-sol",
    ...config("model_reasoning_effort", "medium"),
    ...config(`mcp_servers.${expectedWorker}.command`, process.execPath),
    ...config(`mcp_servers.${expectedWorker}.args`, [serverPath]),
    ...config(`mcp_servers.${expectedWorker}.env.AE_MCP_RUNTIME_DIR`, runtime),
    ...config(`mcp_servers.${expectedWorker}.env.AE_MCP_INSTANCE`, expectedWorker),
    ...config(`mcp_servers.${expectedWorker}.env.AE_MCP_READONLY`, "0"),
    ...config(`mcp_servers.${expectedWorker}.env.AE_MCP_ENABLE_EVAL`, "0"),
    "--output-last-message", finalPath, "-",
  ];
  const startedAt = new Date().toISOString();
  const transcriptStream = createWriteStream(transcript, { flags: "wx", mode: 0o600 });
  const stderrStream = createWriteStream(stderrPath, { flags: "wx", mode: 0o600 });
  console.log("\n--- Prompt sent to Codex ---\n");
  console.log(prompt);
  console.log("\n--- Live Codex events ---\n");
  const child = spawn("codex", args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.pipe(transcriptStream);
  const stdoutLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  stdoutLines.on("line", showLiveEvent);
  child.stderr.pipe(stderrStream);
  child.stdin.end(prompt);
  console.log(`Codex MCP demo started for ${project}`);
  console.log(`Evidence directory: ${runDir}`);
  const exit = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
  await Promise.all([
    new Promise((done) => transcriptStream.end(done)),
    new Promise((done) => stderrStream.end(done)),
  ]);
  const result = {
    startedAt, finishedAt: new Date().toISOString(), model: "gpt-6-sol",
    reasoningEffort: "medium", worker: expectedWorker, input: session.input,
    project, variant, transcript, stderr: stderrPath, final: finalPath, ...exit,
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(`Codex exit: ${exit.code ?? exit.signal}`);
  console.log(`Transcript: ${transcript}`);
  console.log(`Final report: ${finalPath}`);
  console.log(`Run result: ${resultPath}`);
  if (exit.code !== 0) process.exitCode = exit.code || 1;
}

main().catch((error) => {
  console.error(`Codex MCP demo did not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
