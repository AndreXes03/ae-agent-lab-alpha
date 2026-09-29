# Contributing to AE Agent Lab

Start with the [README](README.md) and [agent safety rules](AGENTS.md). The public alpha's native proof covers one Mac with After Effects 2026 (26.5).

Install dependencies with `npm ci --ignore-scripts` and build with `npm run build`. Current CI runs TypeScript typechecking, the build, and selected offline policy, schema, and instance tests. Those checks do not launch After Effects or establish native compatibility. For a live test, identify the exact AE instance, use a disposable project copy, preserve other sessions, and inspect rendered images before reporting success.

Open an issue or pull request with a small reproducible brief, expected and observed results, and redacted errors. Do not upload client projects, private footage, or credentials. The runtime derives from an MIT-licensed kumo.productions project: retain the inherited copyright and [LICENSE](LICENSE) notices and describe new capabilities accurately.

Distribution is through GitHub source and the [v0.1.0-alpha.2 release ZIP](https://github.com/AndreXes03/ae-agent-lab-alpha/releases/tag/v0.1.0-alpha.2). There is no npm, MCP Registry, or automated publish workflow.
