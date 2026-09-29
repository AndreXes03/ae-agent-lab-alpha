# Local macOS AE 2026 quickstart

This public alpha has been tested on one Mac with After Effects 2026 (26.5). Keep the checkout in a stable location: the Codex connection and AE startup stub refer to files inside it. [Node.js 24 or newer](https://nodejs.org/en/download) and Codex CLI are required for the documented route.

## Start the named demo

From this checkout, double-click `Start Demo.command`. It checks the local tools, installs locked npm dependencies if missing, builds the server, registers this checkout as Codex MCP server `ae-agent-lab-demo`, and starts a separate AE worker with a unique copy of the bundled project. It does not choose the AE project already open in your normal session. Keep the Terminal window open to read the copied project path and ready-to-paste chat prompt.

The equivalent Terminal steps from the repository root are:

```bash
npm ci --ignore-scripts
npm run build
npm run connect:codex
npm run demo:start
npm run demo:status
```

If dependencies are already installed, `npm ci` is unnecessary. Start a fresh Codex chat if the registered MCP tools do not appear in an existing one. In AE, enable **Preferences → Scripting & Expressions → Allow Scripts to Write Files and Access Network**. macOS may request Automation access for the app or terminal that launches the client.

Use only the named worker `ae-agent-lab-demo` and the copied `.aep` path printed by `demo:start`. The connection fixes `AE_MCP_RUNTIME_DIR` to this checkout's `runtime/demo-session`, `AE_MCP_INSTANCE=ae-agent-lab-demo`, `AE_MCP_READONLY=0`, and `AE_MCP_ENABLE_EVAL=0`. Inspect the composition and layers before editing; save the copy and review actual rendered frames. See [the demo session guide](DEMO-SESSION.md) for resuming a session or trying another saved project.

When finished, double-click `Stop Demo.command` or run `npm run demo:stop`. This saves and stops only the named worker. The Codex connection and startup stub remain installed for reuse; see [disconnect and uninstall](UNINSTALL.md) if you want to remove them.

## Inspect a connection problem

Run these from the repository root so diagnostics use the same mailbox as the named demo:

```bash
AE_MCP_RUNTIME_DIR="$PWD/runtime/demo-session" node scripts/doctor-local.mjs
AE_MCP_RUNTIME_DIR="$PWD/runtime/demo-session" node dist/index.js agent-status
AE_MCP_RUNTIME_DIR="$PWD/runtime/demo-session" node dist/index.js instances
npm run demo:status
```

The commands do not edit an AE project or launch a worker. The built CLI loads the local transport, so `agent-status` and `instances` may initialize mailbox files even though their diagnostic results inspect local state. The doctor may invoke those CLI commands after a build. `agent-status` compares the startup stub against this checkout **and this demo runtime**; an unscoped invocation can incorrectly call the installed demo stub stale by comparing it with the default temporary mailbox. A stale or differing stub does not establish that this demo owns it. Inspect the file and current AE session before changing any startup script; `demo:start` refuses to replace a differing stub.

If `demo:start` times out or `demo:status` shows a partial session, inspect the AE windows, the named worker heartbeat, and `runtime/demo-session/session.json` before another action. The `/usr/bin/open` launch and AE registration are separate steps; a launcher PID alone does not prove an AE worker is running. Leave unrelated AE sessions and projects untouched.

## Other MCP clients

Other MCP clients have not been verified on this Mac. For an advanced trial, configure a stdio server using an absolute path to this checkout's `dist/index.js` and the **same four environment variables** listed above. Point it at the named worker and copied project; do not let it fall back to an unnamed single AE instance or switch projects automatically. Check that client's own registration syntax and restart its session after adding the server. Native evidence covers this Mac and AE version only; other clients, hosts, and versions need separate validation.
