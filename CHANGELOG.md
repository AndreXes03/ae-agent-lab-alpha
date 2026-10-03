## 0.1.0-alpha.3-studio.4 — focused context and directed motion

- Compact, lossless tool JSON retains both MCP content forms; no claim of billed-token savings.
- `ae_do` omits ambient context by default (opt in with `includeContext:true`) and reports queue/execution timing.
- Catalog lookups accept literal `query` and policy-sensitive `ifNoneMatch`/`cacheKey`; unchanged schemas are not reprinted.
- `ae_verify_targets` keeps bounded snapshots local and compares source identity/dimensions/path, layer timing, expressions, full selected key state, and samples at one explicit time. Missing/ambiguous properties fail; intentional source-path changes cannot hide animation/dimension changes. Baselines expire on server restart or after 64 newer captures.
- Fresh-layer motion planning accepts individual timing, offsets, initial scale, temporal influences, Position endpoint speeds, and intermediate anticipation/overshoot positions. Existing-animation guards remain active.
- `render.review` isolates a <=10-second frame-aligned interval in a temporary queue item and restores other queue flags on success/failure; it never saves the project or runs automatically. Discover exact local templates first. Native render/FPS/template fidelity and aesthetic results remain unverified for this release.
- Session status identifies stale/mismatched records without restarting or closing a worker.
- Agent guidance validates one short motion interval under user direction before expanding the treatment, retains approved/rejected decisions per shot, and avoids whole-project exports for scoped verification.

Validation: 422 offline tests pass; build, checks and isolated installer smoke pass. Four-operation catalog text falls from 5,656 to 3,852 bytes; unchanged refresh is 108 bytes. These are response bytes, not billed tokens. See docs/STUDIO4-VALIDATION.md. Native AE acceptance is not claimed.

## 0.1.0-alpha.3-studio.3 — fast interactive editing

- Add `ae_edit`: bounded registered edits, current-value reads, checkpoints and readback in one AE dispatch, without automatic rendering.
- Reuse caller request IDs across retries; status reads durable receipts without replaying edits.
- Add `ae_inspect_targets` for compact, reusable references validated inside the edit call.
- Default session context to compact output and add resident-only readiness checks; skip redundant ambient context on explicit `ae_do` calls.
- Measure local queue wait separately from transport elapsed time. These source changes have offline checks; no native speedup claim. The Mac installer includes these changes.

### Included efficient workflows

- Select exact operation schemas with `ae_catalog.operations` or browse category summaries.
- Add offline `ae_workflow_plan` for bounded multi-property retiming, with explicit live readback requirements and verification steps.
- Update agent guidance to reduce repeated discovery and reuse deterministic plans.
- Add local prepare/apply/status workflows for bounded retiming and isolated text/logo variants, with stale-state checks, recovery checkpoints and durable no-replay job claims.
- Verify changed properties inside the edit call; keep visual previews optional and avoid automatic video exports.
- Included in the alpha.3-studio.3 installer; offline checks do not establish native acceptance or credit savings.

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
