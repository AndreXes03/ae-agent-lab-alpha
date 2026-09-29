# KYNEM Codex plugin template

This directory is the portable plugin source. The installer must generate `local-runtime.json` at this directory's root with absolute `checkout`, `node`, and `workflow` paths and `worker: "ae-agent-lab-demo"`. Do not commit machine-specific values.

The installer also generates the host MCP configuration for server `kynem`, using the installed checkout's `dist/index.js` and `runtime/demo-session` with `AE_MCP_INSTANCE=ae-agent-lab-demo`, `AE_MCP_READONLY=0`, and `AE_MCP_ENABLE_EVAL=0`. The server and helper must resolve to the same dedicated installed checkout and runtime. No checked-in `.mcp.json` is shipped because a path-free placeholder would not be a valid ready-to-install configuration. The installer may add the corresponding MCP server entry to the installed plugin manifest.

The skill starts sessions through this installer's generated helper and edits only the copied project created by `scripts/demo-session.mjs`.
