import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = await mkdtemp(join(tmpdir(), "kynem-installer-test-"));
const fakeCodex = join(scratch, "codex");
const state = join(scratch, "state.json");
await writeFile(state, JSON.stringify({ marketplace: false, plugin: false, adds: 0, removes: 0 }));
await writeFile(
  fakeCodex,
  `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const path = process.env.KYNEM_MOCK_STATE;
const state = JSON.parse(fs.readFileSync(path));
if (args.join(' ') === 'plugin marketplace list --json') console.log(JSON.stringify({marketplaces: state.marketplace ? [{name:'kynem-local',root:process.env.KYNEM_INSTALL_ROOT+'/marketplace'}] : []}));
else if (args.join(' ') === 'plugin list --json') console.log(JSON.stringify({installed: state.plugin ? [{pluginId:'kynem@kynem-local',installed:true,enabled:true}] : []}));
else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') state.marketplace = true;
else if (args[0] === 'plugin' && args[1] === 'add') { state.plugin = true; state.adds++; }
else if (args[0] === 'plugin' && args[1] === 'remove') { state.plugin = false; state.removes++; }
else process.exit(2);
fs.writeFileSync(path, JSON.stringify(state));
`,
);
await chmod(fakeCodex, 0o755);
try {
  const env = {
    ...process.env,
    KYNEM_TEST_MODE: "1",
    KYNEM_INSTALL_ROOT: join(scratch, "installed"),
    KYNEM_CODEX_BIN: fakeCodex,
    KYNEM_MOCK_STATE: state,
  };
  env.KYNEM_INSTALL_ROOT = join(scratch, "installed path with spaces");
  const sourceManifest = await readFile(
    join(root, "codex-plugin", ".codex-plugin", "plugin.json"),
    "utf8",
  );
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const app = join(env.KYNEM_INSTALL_ROOT, "versions", pkg.version, "app");
  for (let n = 0; n < 2; n++) {
    const command = n === 0 ? "/bin/zsh" : process.execPath;
    const args =
      n === 0
        ? [join(root, "Install KYNEM.command")]
        : [join(root, "scripts", "install-kynem.mjs"), process.execPath];
    const run = spawnSync(command, args, { env, encoding: "utf8", maxBuffer: 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    if (n === 0) {
      await mkdir(join(app, "runtime", "demo-session"), { recursive: true });
      await writeFile(join(app, "runtime", "demo-session", "keep.txt"), "existing runtime");
    }
  }
  const plugin = join(env.KYNEM_INSTALL_ROOT, "marketplace", "plugins", "kynem");
  const [config, mcp, manifest, market, actions] = await Promise.all([
    readFile(join(plugin, "local-runtime.json"), "utf8").then(JSON.parse),
    readFile(join(plugin, ".mcp.json"), "utf8").then(JSON.parse),
    readFile(join(plugin, ".codex-plugin", "plugin.json"), "utf8").then(JSON.parse),
    readFile(
      join(env.KYNEM_INSTALL_ROOT, "marketplace", ".agents", "plugins", "marketplace.json"),
      "utf8",
    ).then(JSON.parse),
    readFile(state, "utf8").then(JSON.parse),
  ]);
  assert.equal(config.checkout, app);
  assert.equal(config.worker, "ae-agent-lab-demo");
  assert.equal(mcp.mcpServers.kynem.args[0], join(app, "dist", "index.js"));
  assert.ok(manifest.version.startsWith(`${pkg.version}+codex.`));
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(market.plugins[0].source.path, "./plugins/kynem");
  assert.deepEqual([actions.adds, actions.removes], [2, 0]);
  assert.equal(
    await readFile(join(app, "runtime", "demo-session", "keep.txt"), "utf8"),
    "existing runtime",
  );
  assert.equal(
    await readFile(join(root, "codex-plugin", ".codex-plugin", "plugin.json"), "utf8"),
    sourceManifest,
  );
  // A recorded unfinished session in an older release must block an upgrade.
  await writeFile(
    join(env.KYNEM_INSTALL_ROOT, "local-runtime.json"),
    JSON.stringify({ version: "0.0.1", checkout: app }),
  );
  await writeFile(
    join(app, "runtime", "demo-session", "session.json"),
    JSON.stringify({ phase: "ready" }),
  );
  const blocked = spawnSync(
    process.execPath,
    [join(root, "scripts", "install-kynem.mjs"), process.execPath],
    { env, encoding: "utf8" },
  );
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /project session/);
  console.log("KYNEM installer smoke passed (sandboxed install and repeat run).");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
