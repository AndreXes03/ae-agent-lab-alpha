## 0.1.0-alpha.3-studio.2

- Add a macOS installer for the compiled bridge and portable KYNEM Codex plugin.
- Install into a stable user directory and generate machine-local MCP paths.
- Bootstrap a private, checksum-verified Node runtime when necessary.
- Keep copies, session conflict protection, and existing-project review instructions.
- Bundle production dependencies in the installer ZIP; no manual npm install for recipients.
- Offline installer/package verification only; additional native Mac validation remains needed.

# Changelog

## 0.1.0-alpha.3-studio.1 — local studio candidate

Not published. Intended for a controlled macOS test on copied projects.

- Added offline motion planning and read-only camera Position/Scale auditing; neither applies changes automatically.
- Added fresh-layer and duplicate-target checks, two-phase pivot preparation/readback, and frame-order validation.
- Added a macOS project file picker launcher delegating to the existing isolated-copy workflow.
- Agent guidance now verifies the delivery master, scopes effects to intended components, and separates technical checks from visual judgement.
- Build and focused offline tests verified locally; no new native AE acceptance on another Mac or external project.

## 0.1.0-alpha.2 — 2026-09-29

Distribution process update; no new After Effects operations or interface.

- Public source ZIP is built from a clean commit and an explicit reviewed file list.
- Packaging rejects unapproved tracked files, local runtime paths, symlinks, and likely credentials; the ZIP records its source commit in a manifest.
- Release candidate preparation and verification are documented.

## 0.1.0-alpha.1 — 2026-09-29

First public experimental alpha.

- Codex connection and isolated After Effects demo on a copied project.
- Native project inspection, typed edits, keyframe readback and frame rendering.
- Local diagnostics and safe session resume after Save As.
- Experimental custom AEP copy workflow.
- Italian tester guide and feedback forms.

Native evidence covers one Mac with AE 26.5. Other-machine onboarding and external projects remain unverified. See PROVENANCE.md for upstream attribution.
