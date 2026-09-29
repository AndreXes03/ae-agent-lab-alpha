# Local normal-chat demo session

Build the local server once (`npm run build`), then from this repository run:

```bash
node scripts/demo-session.mjs start
node scripts/demo-session.mjs status
node scripts/demo-session.mjs stop
```

`start` uses the dedicated owner-only mailbox at `runtime/demo-session`, launches the named worker `ae-agent-lab-demo`, confirms its project is empty, and opens a unique copy of `demo/warm-glow-heavy-grain.aep` under `demo/runs/<timestamp>/project.aep`. It prints the absolute paths and a short prompt for the normal chat. Repeating `start` while that ready session is live checks the named worker's heartbeat. If AE has saved a new `.aep` variant inside the same run folder, it reads the active project from AE and updates the session record only when both paths agree; it does not reopen or edit AE. The chat's MCP connection must use this repository's `dist/index.js` with `AE_MCP_RUNTIME_DIR` set to the printed runtime, `AE_MCP_INSTANCE=ae-agent-lab-demo`, `AE_MCP_READONLY=0`, and `AE_MCP_ENABLE_EVAL=0`.

## Use your own saved project

For a generic chat workflow, pass an **absolute path** to an existing `.aep` file from Terminal:

```bash
node scripts/demo-session.mjs start --project "/absolute/path/to/your-project.aep"
```

The runner checks the input, copies it to a new `demo/runs/<timestamp>-<pid>/project.aep`, and opens only that copy in the named worker. It records both original and copy paths. An active ready session can be resumed with `start` or the same `--project` source; it will refuse a different source until that session is stopped. A partial or uncertain session must be inspected with `status` before proceeding.

Use the printed prompt in a normal connected chat, tailored to your specific brief, and follow [AGENT-WORKFLOW.md](AGENT-WORKFLOW.md). **Do not run `npm run demo:agent` on a custom project**: that automated prompt is a specific warm-glow Exposure edit, and the runner refuses other inputs. The `--project` path has not yet been verified in a native AE run.

Copying the `.aep` does not bundle linked footage, fonts, plugins, or other dependencies. Inspect missing-media warnings and the actual composition before editing. Relink or repair only in the copied project, and keep the original untouched.

The resident AE startup stub must point at this demo runtime. If the AE 2026 stub is absent, `start` installs it for the selected 26.x profile. If an existing stub differs, `start` refuses to replace it; inspect that stub and the current AE setup manually. Restart AE when a newly installed stub needs to load in an existing process. The script never changes the default user's project.

`status` reads the saved session and worker heartbeat. `stop` verifies the worker has an `.aep` inside this session's run folder, records its current path, saves it, then stops only this named worker. This permits a reviewed Save As variant in that run folder. It leaves the resident startup stub installed. If a command times out or reports an uncertain result, inspect `status`, the worker window, and `runtime/demo-session/session.json` before taking another action; do not retry a mutation blindly.
