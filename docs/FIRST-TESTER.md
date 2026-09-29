# First tester guide

AE Agent Lab is a public local alpha. Native evidence covers one Mac running After Effects 2026 (26.5); other hosts and versions need their own validation. See the [README](../README.md) for the demo image and setup overview.

## Try the bundled demo

Use the included starter project. The runner makes a timestamped copy of `demo/warm-glow-heavy-grain.aep` and targets only the named worker `ae-agent-lab-demo`.

```bash
npm ci --ignore-scripts
npm run build
npm run connect:codex
npm run demo:start
npm run demo:status
```

You can also double-click `Start Demo.command`. Use the project path and ready-to-paste Codex prompt printed by the launcher. Confirm Codex is connected to the named worker and AE shows that copied project. Ask for one small edit, such as the [Exposure timing example](EXAMPLE-PROMPTS.md). Save a new variant, read the changed values back, and inspect completed rendered frames. Keep arbitrary eval disabled. When finished, run `npm run demo:stop` or double-click `Stop Demo.command`.

If a command times out or leaves status uncertain, inspect `npm run demo:status` and the AE window before retrying. The original project and any unrelated AE sessions should remain untouched.

## Share feedback

Use the [GitHub issue form](https://github.com/AndreXes03/ae-agent-lab-alpha/issues/new/choose) for a bug, missing capability, or tester result. Tell us what task you tried, the AE, macOS, Node, and Codex versions, the exact prompt and operations used, expected and observed results, and any error. Say whether a project variant was saved and whether you inspected the rendered images.

Redact personal paths and client information. Do not upload client projects, private footage, or credentials. A screenshot or rendered frame is useful when it is safe to share. The other [example prompts](EXAMPLE-PROMPTS.md) are trials, not verified compatibility claims.
