> **KYNEM Mac installer — 0.1.0-alpha.3-studio.2.** The installer ZIP includes the compiled bridge and production dependencies, installs the KYNEM Codex plugin, and downloads a private Node runtime if needed. See [Install KYNEM](docs/INSTALL.it.md). Native behavior on other Macs still needs tester validation.

# AE Agent Lab

AE Agent Lab is an experimental local bridge between a **Codex chat** and Adobe After Effects. Codex uses MCP tools to inspect a project, make a scoped edit, and render frames for review. The bridge runs on your Mac. There is no After Effects panel or separate chat app.

The previous public alpha [v0.1.0-alpha.2](https://github.com/AndreXes03/ae-agent-lab-alpha/releases/tag/v0.1.0-alpha.2) remains available. The new installer is distributed as a separate prerelease for testing on other Macs. The documented native proof covers **one Mac running After Effects 2026 (26.5)**; other setups and projects need their own validation.

![A frame rendered from the editable Warm Glow After Effects demo project](demo/warm-glow/heavy-grain-hero.png)

*Native rendered example from the included [editable After Effects project](demo/warm-glow-heavy-grain.aep). A [motion preview](demo/warm-glow/heavy-grain-preview.mp4) is also included.*

## Recommended: install KYNEM for Codex

Use the **KYNEM-Mac ZIP asset**, not GitHub’s automatic source archive. Extract it and double-click `Install KYNEM.command`. After installation, open a new Codex chat, select KYNEM from `@`, attach or identify a saved `.aep`, and describe your edit. The skill starts the bridge on a project copy. `$kynem` is the skill invocation fallback if the plugin menu has not refreshed.

Codex must already be installed and signed in; After Effects 2026 must be installed and initialized. macOS may require approval to open the unsigned launcher and control AE. Enable AE’s scripting file/network preference. The installer does not bypass these controls, start AE, or change your projects. On machines without a suitable Node runtime, installation needs internet; no manual npm setup is required for this ZIP.

The installer uses a stable folder under `~/Library/Application Support/KYNEM`; the extracted ZIP can be removed after successful installation. The native bridge has been tested on one Mac; the installer and plugin configuration receive offline checks, not a claim of clean-machine native acceptance.

## Developer / source installation

### What you need

- macOS with After Effects 2026 installed.
- [Node.js 24 or newer](https://nodejs.org/en/download) and Codex CLI installed and configured.
- In After Effects, enable **Preferences → Scripting & Expressions → Allow Scripts to Write Files and Access Network**. macOS may ask for Automation access.

Download the complete source ZIP from the [alpha release](https://github.com/AndreXes03/ae-agent-lab-alpha/releases/tag/v0.1.0-alpha.2), unpack it in a stable folder, and keep that folder in place while using the demo.

## Start the demo

Double-click `Start Demo.command` in the unpacked folder. It installs the locked local dependencies if needed, builds the MCP server, connects it to Codex as `ae-agent-lab-demo`, and starts a named After Effects worker with a fresh copy of the included project. Keep its Terminal window open. When it says the session is ready, open a new Codex chat and paste the prompt printed there. The prompt contains the exact worker and project paths for your session.

Codex should inspect that copied project before changing it. Ask for one small edit, then have Codex read the changed property back and render frames for you to inspect. The [Italian beginner guide](docs/FRIENDS-TUTORIAL.it.md) walks through a first Exposure timing edit.

When finished, double-click `Stop Demo.command`. It saves the project copy and stops the named worker. Your run files remain under `demo/runs/`.

The equivalent Terminal commands are:

```bash
npm ci --ignore-scripts
npm run build
npm run connect:codex
npm run demo:start
npm run demo:status
npm run demo:stop
```

`npm run demo:agent` runs the included Warm Glow prompt through Codex CLI and saves a transcript. The normal Codex chat uses the prompt printed by `demo:start`.

## Scope and next steps

The included [project](demo/warm-glow-heavy-grain.aep) and [rendered proof](demo/client-proof/client-flash_sheet.png) demonstrate a native edit and visual check on the tested Mac. The source is distributed as a GitHub ZIP, not an npm package. Trying your own saved `.aep` is experimental: `npm run demo:start -- --project /absolute/path/to/project.aep` opens a copy, but linked media, fonts, and plugins are not bundled. See the [session guide](docs/DEMO-SESSION.md).

- [Quickstart and connection help](docs/ALPHA-QUICKSTART.md)
- [First tester tasks and feedback](docs/FIRST-TESTER.md)
- [Example prompts](docs/EXAMPLE-PROMPTS.md) and [agent workflow](docs/AGENT-WORKFLOW.md)
- [Motion reveal planner and verification workflow](docs/MOTION-QUALITY.md)
- [Disconnect and uninstall](docs/UNINSTALL.md)

The runtime derives from the MIT-licensed kumo.productions MCP After Effects project. Its copyright and license notices are retained in [LICENSE](LICENSE).
