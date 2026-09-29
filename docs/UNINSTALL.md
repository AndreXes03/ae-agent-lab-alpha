# Installed KYNEM plugin

If you used `Install KYNEM.command`, ask KYNEM to save and stop only its own copied-project session first. Remove **kynem@kynem-local** in Codex’s plugin settings (or `codex plugin remove kynem@kynem-local`). This disconnects the plugin without deleting your project copies.

Installed files and copied projects are under `~/Library/Application Support/KYNEM`. Keep this folder until you have recovered any copies and renders you need. Do not remove an AE startup script belonging to another bridge; inspect its actual target first. The source/manual installation instructions below apply only if you used the older launchers.

# Disconnect the local demo

The demo uses a named AE worker, a Codex MCP entry, and, when needed, a user-level AE startup stub. Stopping the demo leaves the Codex entry and startup stub in place so the local bridge can be used again. Remove either only when you no longer want that connection.

## Stop the demo worker

Run `Stop Demo.command` from this checkout, or from Terminal in the repository root:

```bash
node scripts/demo-session.mjs stop
```

This saves the demo copy before stopping the named worker. If stop reports a mismatch or an unavailable worker, inspect `node scripts/demo-session.mjs status` and the AE window before trying again. Do not close or alter an unrelated AE session. The created project and evidence under `demo/runs/` remain available.

## Remove the Codex connection

First check that the entry named `ae-agent-lab-demo` points to this checkout's `dist/index.js`:

```bash
codex mcp get ae-agent-lab-demo --json
```

If it is this demo's entry, remove it with the verified Codex CLI command:

```bash
codex mcp remove ae-agent-lab-demo
```

This removes only that named Codex server entry. Leave any differently configured entry in place. Restart Codex or start a fresh chat to clear tools already loaded into a session.

## Remove the optional AE startup stub

The demo may have installed `mcp-aftereffects-agent.jsx` in the **user-level** folder for the selected AE 2026 profile. For AE 26.5, the exact path is:

```text
~/Library/Preferences/Adobe/After Effects/26.5/Scripts/Startup/mcp-aftereffects-agent.jsx
```

If your profile is another 26.x version, replace `26.5` below with the version shown by `node scripts/doctor-local.mjs`. Run these commands from the repository root. The `AE_MCP_RUNTIME_DIR` value matches the demo's dedicated mailbox, so `agent-status` compares the stub against the correct configuration. Check the file before removing it, especially if it was already present before you tried the demo:

```bash
AE_MCP_RUNTIME_DIR="$(pwd)/runtime/demo-session" node dist/index.js agent-status --version 26.5
sed -n '1,12p' "$HOME/Library/Preferences/Adobe/After Effects/26.5/Scripts/Startup/mcp-aftereffects-agent.jsx"
AE_MCP_RUNTIME_DIR="$(pwd)/runtime/demo-session" node dist/index.js uninstall-agent --version 26.5 --dry-run
```

The demo's stub begins with `// mcp-aftereffects resident agent bootstrap.` and loads `jsx/agent.jsx` from this checkout. `agent-status` may call a previously installed stub “stale” if its path or mailbox differs; stale does **not** prove the demo owns it. If the file points elsewhere, or you want the bridge for other AE work, leave it installed. The uninstall command removes whatever file is at that exact stub path; it does not check ownership.

After confirming this is the stub you intend to remove:

```bash
AE_MCP_RUNTIME_DIR="$(pwd)/runtime/demo-session" node dist/index.js uninstall-agent --version 26.5
```

The startup change takes effect on AE's next launch. A running AE process can continue using an agent it already loaded until it quits. This command does not touch AE projects, other version folders, or a different startup script name.
