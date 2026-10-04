#!/usr/bin/env node
// Installs a self-contained KYNEM runtime and a dedicated Codex plugin.
// Deliberately does not launch After Effects or write its Startup folder.
import { spawnSync } from "node:child_process";
import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const source = dirname(dirname(fileURLToPath(import.meta.url)));
const testing = process.env.KYNEM_TEST_MODE === "1";
const node = resolve(process.argv[2] || process.execPath);
const support =
  testing && process.env.KYNEM_INSTALL_ROOT
    ? resolve(process.env.KYNEM_INSTALL_ROOT)
    : join(homedir(), "Library", "Application Support", "KYNEM");
const pluginName = "kynem";
const marketplaceName = "kynem-local";
const marketplace = join(support, "marketplace");
const plugin = join(marketplace, "plugins", pluginName);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${basename(command)} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  return result.stdout;
}
function codexCli() {
  if (testing && process.env.KYNEM_CODEX_BIN) return resolve(process.env.KYNEM_CODEX_BIN);
  const candidates = [
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    "/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    join(homedir(), ".codex", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
  const pathCommand = spawnSync("/usr/bin/which", ["codex"], { encoding: "utf8" });
  if (pathCommand.status === 0) candidates.push(pathCommand.stdout.trim());
  return candidates.find((path) => path && spawnSync("/usr/bin/test", ["-x", path]).status === 0);
}
async function writeJson(path, value) {
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}
const requiredAppFiles = [
  "dist/index.js",
  "dist/cli.js",
  "dist/local-review.js",
  "dist/storyboard.js",
  "dist/review-session.js",
  "jsx/agent.jsx",
  "node_modules/@modelcontextprotocol/sdk/package.json",
  "node_modules/zod/package.json",
  "scripts/demo-session.mjs",
  "docs/AGENT-WORKFLOW.md",
  "assets/review.html",
  "assets/storyboard.html",
  "assets/codex-feedback.js",
  "examples/storyboard/kynem-demo.json",
];
async function missingAppFile(app) {
  for (const needed of requiredAppFiles) if (!(await exists(join(app, needed)))) return needed;
  return null;
}
async function ensureApp(version) {
  const versionDir = join(support, "versions", version);
  const app = join(versionDir, "app");
  if (await exists(app)) {
    const installed = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
    const missing = await missingAppFile(app);
    if (installed.version !== version || missing) {
      throw new Error(
        `Existing ${version} installation is incomplete${missing ? ` (missing ${missing})` : ""}: ${app}. Inspect it before retrying.`,
      );
    }
    return app;
  }
  await mkdir(join(support, "versions"), { recursive: true, mode: 0o700 });
  const stage = join(support, "versions", `.stage-${version}-${process.pid}`);
  await mkdir(join(stage, "app"), { recursive: true, mode: 0o700 });
  try {
    for (const name of [
      "dist",
      "jsx",
      "docs",
      "assets",
      "examples",
      "demo",
      "scripts",
      "node_modules",
      "fixtures",
      "package.json",
      "LICENSE",
      "README.md",
      "PROVENANCE.md",
    ]) {
      if (await exists(join(source, name)))
        await cp(join(source, name), join(stage, "app", name), { recursive: true });
    }
    const missing = await missingAppFile(join(stage, "app"));
    if (missing)
      throw new Error(
        `The ZIP is missing ${missing}. Extract the complete release ZIP and try again.`,
      );
    await rename(stage, versionDir);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  return app;
}
async function ensureMarketplace(app, version) {
  const template = join(source, "codex-plugin");
  if (!(await exists(join(template, ".codex-plugin", "plugin.json")))) {
    throw new Error(
      "The ZIP is missing codex-plugin/.codex-plugin/plugin.json. Extract the complete release ZIP.",
    );
  }
  await mkdir(marketplace, { recursive: true, mode: 0o700 });
  await mkdir(join(marketplace, ".agents", "plugins"), { recursive: true, mode: 0o700 });
  await mkdir(join(marketplace, "plugins"), { recursive: true, mode: 0o700 });
  // The app is versioned, while this marketplace is a stable local Codex source.
  // Replacing only KYNEM's own plugin does not touch other marketplaces/plugins.
  const stage = join(marketplace, "plugins", `.kynem-stage-${process.pid}`);
  await cp(template, stage, { recursive: true });
  const manifestPath = join(stage, ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version = `${version}+codex.${Date.now()}`;
  manifest.mcpServers = "./.mcp.json";
  await writeJson(manifestPath, manifest);
  const config = {
    checkout: app,
    node,
    worker: "ae-agent-lab-demo",
    workflow: join(app, "docs", "AGENT-WORKFLOW.md"),
    runtime: join(app, "runtime", "demo-session"),
    projects: join(app, "demo", "runs"),
    version,
  };
  await writeJson(join(stage, "local-runtime.json"), config);
  await writeJson(join(stage, ".mcp.json"), {
    mcpServers: {
      kynem: {
        command: node,
        args: [join(app, "dist", "index.js")],
        env: {
          AE_MCP_RUNTIME_DIR: config.runtime,
          AE_MCP_INSTANCE: config.worker,
          AE_MCP_ENABLE_EVAL: "0",
          AE_MCP_READONLY: "0",
        },
      },
    },
  });
  await writeJson(join(marketplace, ".agents", "plugins", "marketplace.json"), {
    name: marketplaceName,
    interface: { displayName: "KYNEM" },
    plugins: [
      {
        name: pluginName,
        source: { source: "local", path: "./plugins/kynem" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      },
    ],
  });
  const previous = join(marketplace, "plugins", `.kynem-previous-${process.pid}`);
  if (await exists(plugin)) await rename(plugin, previous);
  try {
    await rename(stage, plugin);
  } catch (error) {
    if (await exists(previous)) await rename(previous, plugin);
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
  await writeJson(join(support, "local-runtime.json"), config);
  return config;
}
function marketplaceState(codex) {
  return JSON.parse(run(codex, ["plugin", "marketplace", "list", "--json"])).marketplaces || [];
}
function pluginState(codex) {
  return JSON.parse(run(codex, ["plugin", "list", "--json"])).installed || [];
}
async function main() {
  if (process.platform !== "darwin" && !testing)
    throw new Error("KYNEM currently installs on macOS only.");
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Node.js 24 or newer is required.");
  const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    throw new Error(`Invalid package version: ${pkg.version}`);
  }
  const codex = codexCli();
  if (!codex)
    throw new Error(
      "Codex desktop or Codex CLI was not found. Install Codex, then run this installer again.",
    );
  if (!testing) {
    const ae = "/Applications/Adobe After Effects 2026/Adobe After Effects 2026.app";
    if (!(await exists(ae)))
      throw new Error(
        "Adobe After Effects 2026 was not found in Applications. Install it first, then run this installer again.",
      );
  }
  const markets = marketplaceState(codex);
  const previousMarket = markets.find((item) => item.name === marketplaceName);
  if (previousMarket && resolve(previousMarket.root) !== marketplace) {
    throw new Error(
      `Codex already has a different ${marketplaceName} marketplace at ${previousMarket.root}. Inspect it before installing.`,
    );
  }
  const priorConfigPath = join(support, "local-runtime.json");
  if (await exists(priorConfigPath)) {
    const prior = JSON.parse(await readFile(priorConfigPath, "utf8"));
    if (prior.version !== pkg.version && typeof prior.checkout === "string") {
      const sessionPath = join(prior.checkout, "runtime", "demo-session", "session.json");
      if (await exists(sessionPath)) {
        const session = JSON.parse(await readFile(sessionPath, "utf8"));
        if (session.phase !== "stopped") {
          throw new Error(
            `KYNEM ${prior.version} has a ${session.phase} project session. Finish or inspect it before upgrading.`,
          );
        }
      }
    }
  }
  const app = await ensureApp(pkg.version);
  await ensureMarketplace(app, pkg.version);
  if (!previousMarket) run(codex, ["plugin", "marketplace", "add", marketplace]);
  const installed = pluginState(codex).find(
    (item) => item.pluginId === `${pluginName}@${marketplaceName}`,
  );
  if (installed && !installed.enabled) {
    throw new Error(
      `KYNEM is disabled in Codex. Enable ${pluginName}@${marketplaceName} in Codex, then rerun this installer.`,
    );
  }
  run(codex, ["plugin", "add", `${pluginName}@${marketplaceName}`]);
  const registered = pluginState(codex).find(
    (item) => item.pluginId === `${pluginName}@${marketplaceName}`,
  );
  if (!registered?.installed || !registered.enabled)
    throw new Error(
      "Codex did not confirm the KYNEM plugin installation. Check Codex plugins and retry.",
    );
  console.log(`KYNEM ${pkg.version} installed at ${app}`);
  console.log(`Codex plugin: ${pluginName}@${marketplaceName}`);
  console.log("Open a new Codex chat and type @KYNEM to follow the setup guide.");
  console.log("After Effects and your current project were not opened or changed.");
  console.log(`Runtime details: ${join(support, "local-runtime.json")}`);
}

main().catch((error) => {
  console.error(`KYNEM install failed: ${error.message}`);
  process.exitCode = 1;
});
