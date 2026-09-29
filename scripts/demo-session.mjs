#!/usr/bin/env node
// One disposable AE worker and one copied project for the normal-chat demo.
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const worker = "ae-agent-lab-demo";
const runtime = join(root, "runtime", "demo-session");
const sessionFile = join(runtime, "session.json");
const defaultSource = join(root, "demo", "warm-glow-heavy-grain.aep");
const server = join(root, "dist", "index.js");
const env = {
  ...process.env,
  AE_MCP_RUNTIME_DIR: runtime,
  AE_MCP_INSTANCE: worker,
  AE_MCP_READONLY: "0",
  AE_MCP_ENABLE_EVAL: "0",
};
// The imported build computes its mailbox and expected startup stub at import time.
process.env.AE_MCP_RUNTIME_DIR = runtime;

async function built() {
  try {
    await stat(server);
  } catch {
    throw new Error(`Build first: npm run build (missing ${server})`);
  }
  const [{ agentInstallStatus, installAgent }, { readInstance }, { instanceDirFor }] =
    await Promise.all([
      import("../dist/agent-install.js"),
      import("../dist/transport/instances.js"),
      import("../dist/config.js"),
    ]);
  return { agentInstallStatus, installAgent, readInstance, instanceDirFor };
}

async function readSession() {
  try {
    return JSON.parse(await readFile(sessionFile, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function saveSession(session, exclusive = false) {
  await writeFile(sessionFile, `${JSON.stringify(session, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: exclusive ? "wx" : "w",
  });
}

async function secureRuntime() {
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const info = await stat(runtime);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) {
    throw new Error(`Runtime must be an owner-only directory: ${runtime}`);
  }
}

function resultOf(response, label) {
  const raw = response.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n") || "";
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label}: unexpected response: ${raw}`);
  }
  if (response.isError || value.ok === false || value.result?.ok === false) {
    throw new Error(`${label}: ${value.errorCode || "AE"}: ${value.error || value.result?.error || raw}`);
  }
  return value.result ?? value;
}

async function withClient(fn) {
  const client = new Client({ name: "ae-agent-lab-demo-session", version: "0.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: [server], env });
  try {
    await client.connect(transport);
    const call = async (name, args = {}, timeout = 180000) =>
      resultOf(await client.callTool({ name, arguments: args }, undefined, { timeout }), name);
    return await fn(call);
  } finally {
    await client.close().catch(() => {});
  }
}

async function workerState(modules) {
  return modules.readInstance(modules.instanceDirFor(worker));
}

async function validatedSource(file) {
  if (!isAbsolute(file) || extname(file).toLowerCase() !== ".aep") {
    throw new Error(`Project must be an absolute .aep path: ${file}`);
  }
  const canonical = await realpath(file);
  const info = await stat(canonical);
  if (!info.isFile()) throw new Error(`Project is not a file: ${file}`);
  return canonical;
}

function show(session, live) {
  console.log(`Session: ${session?.phase || "none"}`);
  console.log(`Worker: ${worker} (${live.alive ? "live" : "not live"})`);
  console.log(`Runtime: ${runtime}`);
  if (session) {
    console.log(`Input: ${session.input}`);
    console.log(`Project: ${session.project}`);
    console.log(`Run: ${session.runDir}`);
    console.log(`Session record: ${sessionFile}`);
  }
  if (live.alive) {
    console.log(`Worker project: ${live.heartbeat?.project ?? "untitled"}`);
    console.log(`Unsaved changes: ${live.heartbeat?.dirty ?? "unknown"}`);
  }
}

function showReadyPrompt(session) {
  console.log("\nReady-to-paste prompt:");
  console.log(`Read the local workflow at '${join(root, "docs", "AGENT-WORKFLOW.md")}' before editing. Validate the actual delivery/main composition and preserve existing animation outside my brief; use offline motion audit only on measured data. If my brief is already provided, proceed with that scoped edit without asking for it again.`);
  if (session.customSource) {
    console.log(`Use only the After Effects worker '${worker}' and copied project '${session.project}'. Inspect and confirm the project path, composition, layers, and any missing footage. Tell me what you found; if I have not supplied a specific edit brief, ask for it before changing anything. For the supplied brief, save a new variant inside '${session.runDir}' before editing, use typed MCP operations, render representative frames and inspect the images, then save and report the actual paths. Do not open or modify the original '${session.input}' or any other AE instance. Do not use arbitrary ExtendScript.`);
    return;
  }
  console.log(`Use only the After Effects worker '${worker}' and project '${session.project}'. Inspect the project and layers, confirm this exact copied project, and report what you found. If I have not supplied an edit brief, wait for it before changing anything. For the requested edit, save a new variant inside the session run folder first, use typed MCP operations, read back the result, render representative frames and inspect them, then save and report all output paths. Do not touch any other AE instance or project.`);
}

function projectInRun(session, file) {
  if (typeof file !== "string" || !isAbsolute(file) || extname(file).toLowerCase() !== ".aep") return false;
  const within = relative(resolve(session.runDir), resolve(file));
  return within !== "" && within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within);
}

async function start(modules, requestedSource) {
  const previous = await readSession();
  if (previous && previous.phase !== "stopped") {
    if (previous.phase !== "ready") {
      throw new Error(`Session is ${previous.phase}; inspect with 'status' before any new start: ${sessionFile}`);
    }
    const live = await workerState(modules);
    if (previous.worker !== worker || previous.runtime !== runtime ||
        !projectInRun(previous, previous.project) || !live.alive ||
        !projectInRun(previous, live.heartbeat?.project)) {
      throw new Error(`Saved session and live worker do not match; inspect with 'status': ${sessionFile}`);
    }
    if (requestedSource) {
      const previousSource = await realpath(previous.input).catch(() => resolve(previous.input));
      if (requestedSource !== previousSource) {
        throw new Error(`An active demo uses ${previous.input}; stop it before starting a different project.`);
      }
    }
    const workerProject = resolve(live.heartbeat.project);
    if (!projectInRun(previous, await realpath(workerProject))) {
      throw new Error(`Worker project resolves outside this session's run folder: ${workerProject}`);
    }
    await secureRuntime();
    if (workerProject !== previous.project) {
      const info = await withClient((call) => call("ae_project_info"));
      if (!projectInRun(previous, info.file) || resolve(info.file) !== workerProject) {
        throw new Error(`Worker heartbeat and AE project differ; refusing to adopt variant: ${info.file}`);
      }
      previous.project = workerProject;
      await saveSession(previous);
    }
    show(previous, live);
    showReadyPrompt(previous);
    return;
  }
  const live = await workerState(modules);
  if (live.alive) throw new Error(`Worker name is already live; inspect it before proceeding: ${worker}`);
  const source = requestedSource ?? await validatedSource(defaultSource);
  await secureRuntime();
  const statuses = (await modules.agentInstallStatus()).filter((s) => /^26\./.test(s.version));
  if (!statuses.length) throw new Error("No AE 2026 profile found. Launch AE 2026 once, then inspect agent-status.");
  const target = statuses[0];
  if (target.installed && !target.current) {
    throw new Error(`Existing resident stub differs from this demo; inspect it manually: ${target.stubPath}`);
  }
  if (!target.installed) {
    const report = await modules.installAgent({ version: target.version });
    console.log(`Installed demo resident stub: ${report.written.join(", ")}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(root, "demo", "runs", `${stamp}-${process.pid}`);
  const project = join(runDir, "project.aep");
  await mkdir(dirname(runDir), { recursive: true });
  await mkdir(runDir, { recursive: false });
  await copyFile(source, project, constants.COPYFILE_EXCL);
  const session = { phase: "prepared", worker, runtime, input: source, project, runDir, customSource: Boolean(requestedSource), createdAt: new Date().toISOString() };
  await saveSession(session, !previous);
  await withClient(async (call) => {
    await call("ae_do", { operation: "instance.start", args: { name: worker, timeoutMs: 90000 } }, 110000);
    session.phase = "worker-started";
    await saveSession(session);
    const empty = await call("ae_project_info");
    if (empty.file || empty.numItems !== 0 || empty.dirty) {
      throw new Error(`New worker is not empty: ${JSON.stringify({ file: empty.file, numItems: empty.numItems, dirty: empty.dirty })}`);
    }
    await call("ae_do", { operation: "project.open", args: { path: project, save: false } });
    const opened = await call("ae_project_info");
    if (resolve(opened.file || "") !== project) throw new Error(`Worker opened unexpected project: ${opened.file}`);
    session.phase = "ready";
    await saveSession(session);
  });
  show(session, await workerState(modules));
  showReadyPrompt(session);
}

async function stop(modules) {
  const session = await readSession();
  if (!session || session.phase === "stopped") throw new Error(`No active demo session in ${sessionFile}`);
  if (session.worker !== worker || session.runtime !== runtime) throw new Error("Session record does not match this worker/runtime; inspect it manually.");
  const live = await workerState(modules);
  if (!live.alive) throw new Error(`Worker is not live; inspect ${sessionFile} and AE before changing the session record.`);
  const workerProject = live.heartbeat?.project;
  if (!projectInRun(session, workerProject)) {
    throw new Error(`Worker project is outside this session's run folder; refusing to save or stop: ${workerProject}`);
  }
  await withClient(async (call) => {
    const info = await call("ae_project_info");
    if (!projectInRun(session, info.file) || resolve(info.file) !== resolve(workerProject)) {
      throw new Error(`Worker project changed or is outside this session's run folder: ${info.file}`);
    }
    session.project = resolve(info.file);
    await saveSession(session);
    await call("ae_save_project");
    await call("ae_do", { operation: "instance.stop", args: { name: worker } }, 50000);
  });
  const after = await workerState(modules);
  if (after.alive) throw new Error(`Stop returned but worker is still live; inspect before retrying.`);
  session.phase = "stopped";
  session.stoppedAt = new Date().toISOString();
  await saveSession(session);
  show(session, after);
}

const [command, ...args] = process.argv.slice(2);
const valid = new Set(["start", "status", "stop"]).has(command) &&
  (command === "start" ? (args.length === 0 || (args.length === 2 && args[0] === "--project" && Boolean(args[1]))) : args.length === 0);
if (!valid) {
  console.error("Usage: node scripts/demo-session.mjs start [--project /absolute/file.aep]|status|stop");
  process.exitCode = 2;
} else {
  try {
    // Validate the caller's source before building, creating runtime files, or
    // touching AE. The bundled source is checked only for a new session.
    const requestedSource = args.length ? await validatedSource(args[1]) : undefined;
    const modules = await built();
    if (command === "start") {
      await start(modules, requestedSource);
    } else if (command === "status") {
      show(await readSession(), await workerState(modules));
    } else {
      await stop(modules);
    }
  } catch (error) {
    console.error(`Demo session ${command} stopped: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`Inspect the worker and ${sessionFile}; do not retry an uncertain AE action automatically.`);
    process.exitCode = 1;
  }
}
