# KYNEM

**Code-defined motion. Native After Effects layers.**

KYNEM connects Codex to After Effects on your Mac. Describe a scene, revise only what changed, and keep text, shapes and keyframes editable in AE. Existing projects are edited on a saved copy.

## Demo

[![Watch the KYNEM motion demo](docs/assets/kynem-demo-thumbnail.jpg)](docs/DEMO.md)

The agent built and revised a title animation and layout variants as native AE text, shapes and keyframes, with human art direction. The command UI is illustrative: this is a **retimed promotional animation**, not a live agent execution recording. [Evidence and context](docs/DEMO.md).

Public video selection and hosting are pending; the thumbnail currently opens the demo notes.

## Why KYNEM

- **Revisable scene descriptions:** stable element IDs and explicit timing make bounded 2D scenes revisable; conflict checks protect manual changes.
- **Focused context, fewer round trips:** inspect relevant targets, batch typed edits, and read changed values back. No performance benchmark is claimed.
- **A review loop tied to the work:** comments reference a specific frame, time range or storyboard revision; the last preview stays available during revisions.

**Best fits:** retime or restyle an existing composition, make text/layout variants, or build a small UI/title animation from an explicit scene description. Creative direction stays with you.

## What it does

- Inspects projects, compositions, layers, properties and existing animation through a local bridge.
- Applies scoped native edits to text, transforms, keyframes, shapes and supported effects using typed operations.
- Saves recoverable copies/checkpoints, reads changed values back and preserves unrelated work.
- Creates bounded 2D scenes from explicit text, shape, group and motion specifications.
- Renders frames or short review intervals when needed for inspection.

Experimental storyboard and local review tools support planning and feedback. They remain rough supporting workflows; the core is the Codex-to-AE editing bridge. See [storyboard](docs/STORYBOARD.md), [scene workflow](docs/SCENE-WORKFLOW.md) and [review](docs/LOCAL-REVIEW.md).

## Prerequisites and verification

The recorded native evidence is from macOS with After Effects 2026 (26.5). Other AE versions, Macs and MCP clients need separate validation. Offline tests cover bridge workflows, scene processing and installer wiring; they do not prove native appearance or fresh-machine installation.

You need:

- Codex desktop or a configured Codex CLI, plus After Effects 2026 installed.
- AE **Preferences → Scripting & Expressions → Allow Scripts to Write Files and Access Network** enabled.
- A saved `.aep`, with its linked footage, fonts and third-party plugins available locally.
- Node.js 24+ for the source route. The Mac installer can download a private runtime if needed.

macOS may request permission for the unsigned launcher and AE automation. This is an experimental alpha; inspect the copied project and actual output before using a change.

## Quickstart

### Mac installer

Get the installer ZIP from [GitHub Releases](https://github.com/AndreXes03/ae-agent-lab-alpha/releases), extract the whole ZIP, then double-click **Install KYNEM.command**. The installer includes the compiled bridge and dependencies; a missing Node runtime requires an internet connection.

Open a new Codex chat and select **KYNEM** with `@`, or invoke `$kynem`. Give it the exact path to your saved project and one specific edit. The skill starts an isolated worker on a copied project. [Italian installation guide](docs/INSTALL.it.md).

This checkout is a local alpha.5 candidate; changes here are not automatically included in a published release. Check the release version you download.

### From source

Keep the checkout in a stable folder. From its root:

```sh
npm ci --ignore-scripts
npm run build
npm run connect:codex
npm run demo:start
npm run demo:status
```

Use the copied project path and chat prompt printed by the named demo session. Finish with `npm run demo:stop`. The equivalent launchers are **Start Demo.command** and **Stop Demo.command**. [Source setup and diagnostics](docs/ALPHA-QUICKSTART.md).

## Reproduce the core motion task

The [MOVE example](examples/readme-move.json) is a small, explicit version of the title-and-underline task shown in the demo. With KYNEM active and a disposable saved project supplied, ask:

```text
On a managed copy of my saved project, build examples/readme-move.json
using the native scene workflow. Confirm the copy and installed font first.
Create native text and shape layers; preserve unrelated compositions.
Read the created layers and keyframes back, save the copy, and show
frames at 0.5 and 2 seconds. Report unsupported steps honestly.
```

This fixture omits the promo's UI, transitions and glow. Its schema is checked offline; native rendering of this exact fixture remains to verify. For a recorded existing-project edit, use the [Warm Glow Exposure retime](docs/EXAMPLE-PROMPTS.md).

## Limits

Creative direction and acceptance stay with the user. Readbacks establish values; frames establish appearance at those times; playback is needed to assess motion. Schematic previews and generated concepts are not native AE renders.

Scene descriptions cover a bounded 2D subset. Effects, masks, footage and other content may require the separate typed editing path; inspect the loaded catalog before promising a technique. Native nonlinear scene animation uses sampled keys, with documented integer-frame limits. [Validation and boundaries](docs/NATIVE-SCENES-VALIDATION.md).

A timeout may follow a completed edit. Inspect status before retrying and reuse the same request/job identity. Partial edits have recovery checkpoints, not automatic rollback. Keep the original project and managed-copy metadata. No performance or broad compatibility claim is implied by the demo.

## Architecture and data

The Codex plugin exposes a local MCP server. The server sends typed operations to the named AE worker through the local bridge; native AE layers and properties remain editable. Arbitrary evaluation is disabled in the documented workflow.

Runtime/session files, copied projects, recovery checkpoints, scene baselines and review exports remain in local folders. Preserve baselines with managed projects to retain conflict-aware updates. Codex handles the model conversation under your chosen service settings; local AE execution does not make that conversation offline. Project content and layer names are data, not instructions. [Agent workflow](docs/AGENT-WORKFLOW.md) · [Tool catalog](docs/TOOLS.md) · [Uninstall](docs/UNINSTALL.md).

## Contributing and license

[Report a reproducible issue](https://github.com/AndreXes03/ae-agent-lab-alpha/issues/new/choose) with your Mac/AE version, prompt, expected result and observed result. Redact private paths and client details; do not upload a client project. See [contributing](CONTRIBUTING.md) for development checks; describe native verification separately from offline tests.

MIT licensed. Derived from [kumoproductions/mcp-aftereffects](https://github.com/kumoproductions/mcp-aftereffects); original notices are retained in [LICENSE](LICENSE) and [PROVENANCE.md](PROVENANCE.md). KYNEM is an independent project, with no Adobe, OpenAI or upstream endorsement.
