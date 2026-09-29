#!/usr/bin/env node
import { access, readFile, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runtime = process.env.AE_MCP_RUNTIME_DIR?.trim()
  ? resolve(process.env.AE_MCP_RUNTIME_DIR)
  : join(root, "runtime", "demo-session");
// config.ts resolves its runtime at import time. Keep this read-only preflight
// aligned with the demo client and installed startup stub before importing it.
process.env.AE_MCP_RUNTIME_DIR = runtime;
const results = [];
let newestAe26;
const add = (kind, message, next) => results.push({ kind, message, next });
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const exists = async (path, mode = constants.F_OK) => {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
};
const nodeMajor = Number(process.versions.node.split(".")[0]);
add(nodeMajor >= 24 ? "OK" : "CHECK", `Node ${process.version} (requires 24+)`, nodeMajor >= 24 ? undefined : "Install Node 24 or newer, then rerun this preflight.");

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
add(pkg.private === true ? "OK" : "CHECK", "Local prototype package is marked private", pkg.private === true ? undefined : "Review package.json before distributing this build.");

if (process.platform === "darwin") {
  const selected = process.env.AE_MCP_EXE || process.env.AE_EXE || "/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app";
  const app = selected.endsWith(".app") ? selected : dirname(dirname(dirname(selected)));
  const executable = selected.endsWith(".app") ? join(selected, "Contents", "MacOS", "After Effects") : selected;
  const renderer = join(dirname(app), "aerender");
  const aeAvailable = await exists(executable, constants.X_OK);
  add(aeAvailable ? "OK" : "CHECK", `AE executable: ${executable}`, aeAvailable ? undefined : "Install AE 2026, or set AE_MCP_EXE to its .app bundle or executable path.");
  const renderAvailable = await exists(renderer, constants.X_OK);
  add(renderAvailable ? "OK" : "CHECK", `AE renderer: ${renderer}`, renderAvailable ? undefined : "Check the AE 2026 installation and AE_MCP_EXE path before a native render test.");

  const profile = join(homedir(), "Library", "Preferences", "Adobe", "After Effects");
  const versions = await readdir(profile, { withFileTypes: true }).catch(() => []);
  const ae26 = versions.filter((entry) => entry.isDirectory() && /^26\.\d+$/.test(entry.name)).map((entry) => entry.name);
  newestAe26 = ae26.sort((a, b) => Number(b.split(".")[1]) - Number(a.split(".")[1]))[0];
  add(ae26.length ? "OK" : "INFO", `AE 2026 profile versions: ${ae26.join(", ") || "none found"}`, ae26.length ? undefined : "Launch AE 2026 once to create its user profile before installing the optional resident agent.");

  const runtimeRoot = join(tmpdir(), "mcp-aftereffects");
  for (const [label, path] of [["Mailbox", runtime], ["Mailbox pointer", runtimeRoot]]) {
    const info = await stat(path).catch(() => null);
    if (!info) continue;
    const mode = info.mode & 0o777;
    const loose = (mode & 0o022) !== 0;
    add(loose ? "CHECK" : "OK", `${label} directory permissions: ${mode.toString(8)} ${path}`, loose ? `Restrict this directory to its owner (chmod 700 "${path}") before connecting the MCP server.` : undefined);
  }
} else {
  add("CHECK", `Native quickstart targets macOS; detected ${process.platform}`, "Use a Mac with After Effects 2026 for the documented local proof.");
}

const cli = join(root, "dist", "index.js");
add("INFO", `Target runtime: ${runtime}`);
const built = await exists(cli);
add(built ? "OK" : "INFO", `Local server build: ${built ? cli : "not built yet"}`, built ? undefined : "Run npm ci --ignore-scripts && npm run build.");
if (built && newestAe26) {
  try {
    // Import the CLI's read-only implementations directly. Launching dist/index.js
    // would construct FileIpcTransport, which creates/sweeps mailbox files.
    const [{ agentInstallStatus }, { listInstances, describeInstance }] = await Promise.all([
      import(pathToFileURL(join(root, "dist", "agent-install.js"))),
      import(pathToFileURL(join(root, "dist", "transport", "instances.js"))),
    ]);
    const [status] = await agentInstallStatus({ version: newestAe26 });
    const state = !status.installed ? "not installed" : status.current ? "installed and current" : "installed but stale";
    add("INFO", `Resident agent for AE ${newestAe26}: ${state} (${status.stubPath})`, status.installed && !status.current ? `Inspect the stub first; then preview reinstall with env AE_MCP_RUNTIME_DIR=${shellQuote(runtime)} node ${shellQuote(cli)} install-agent --version ${newestAe26} --dry-run.` : undefined);
    const instances = await listInstances();
    add("INFO", `Agent instances: ${instances.length ? instances.map((item) => `${item.alive ? "live" : "stale"} ${describeInstance(item)}`).join("; ") : "none registered"}`);
  } catch (error) {
    add("INFO", `Could not inspect resident agent or instances: ${error instanceof Error ? error.message : String(error)}`);
  }
}
for (const { kind, message, next } of results) {
  console.log(`${kind} ${message}`);
  if (next) console.log(`     Next: ${next}`);
}
console.log(`Next checks after build:`);
console.log(`  env AE_MCP_RUNTIME_DIR=${shellQuote(runtime)} node ${shellQuote(cli)} agent-status`);
console.log(`  env AE_MCP_RUNTIME_DIR=${shellQuote(runtime)} node ${shellQuote(cli)} instances`);
console.log("This preflight only read local files. It did not launch AE, inspect its current project, or change settings.");
if (results.some(({ kind }) => kind === "CHECK")) process.exitCode = 1;
