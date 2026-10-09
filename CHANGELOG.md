## 0.1.0-alpha.7

- Fix macOS Codex discovery using native executable access checks instead of a nonportable test binary.
- Add bounded hierarchy inspection for parents, mattes and expression flags.
- Add an offline delivery evidence check for duration, text, organization and audio intent; it does not independently inspect AE or media.
- Preserve valid catalog results with optional partial discovery, and expose actionable property-group errors.
- Attach actual composition identity and unreviewed playback/audio status to short review renders.
- Guide agents to use compact inspection, grouped edits and organized Project-panel folders without changing existing rigs.

Validation: offline tests and compilation; these additions have not received native AE acceptance.

## 0.1.0-alpha.6 — review reliability and demo polish
- Keep feedback and native Codex handoff tied to the current video and latest comment edits; hide obsolete handoff actions.
- Preserve comment targets while typing by suspending playback/navigation shortcuts in the comment composer.
- Give comment overlays a local backdrop blur, with a solid reduced-transparency fallback.
- Write feedback receipts atomically and validate source-frame references against the reviewed video timing.
- Preserve the omitted layer trim bound when AE changes it as a side effect of setting the other bound.
- Check the full required runtime/review files before reusing an existing installation.
- Clarify storyboard approval export and local agent status messages.
- Refine the native promotional demo: closer scene handoffs, measured typewriter cursor placement, text spacing and closing readability.

Validation and remaining native/platform limits are listed in the release notes. The promotional film is not a recording of autonomous execution.

## 0.1.0-alpha.5 — native AE workflow and local review

- Add a local browser review for already rendered videos, with playback and user notes returned to the agent.
- Keep review scoped to existing output files and validate requests before opening media or returning feedback.
- Add optional draft motion direction for fresh animations, with explicit user choices and preservation of approved motion.
- Add a separate storyboard skill, production specifications, capability guidance and reusable local examples.
- Direct the host Codex/GPT image tool to generate storyboard artwork from supported AE recipes; schematic fixtures remain technical checks, and generated concepts are not native AE evidence.
- Include the review player and both skills in the Mac installer.
- Add a context-bound local feedback inbox with explicit agent acknowledgements and nonblocking review.
- Refine the video and storyboard review with a restrained macOS material interface, persistent feedback and visible Codex handoff.
- Fix installer copying of review assets and storyboard examples; include the shared feedback helper.
- Present the core Codex-to-AE workflow and a native promotional demo with clear evidence boundaries.
- Add a visible native Codex feedback handoff shared by video and storyboard review, with feedback tied to the exact reviewed artifact.

Validation: offline checks and installer verification are recorded in the release notes. Native AE visual acceptance and measured performance gains are not claimed.

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

## 0.1.0-alpha.4 — declarative native scene foundation

- New `ae_scene` prepare/apply/status path compiles bounded 2D scene descriptions into native AE layers on the verified managed project copy. Stable IDs, per-property baselines and stale-state checks preserve unrelated manual edits and reject conflicts. Durable claims prevent replay after timeout; pre-edit checkpoints support recovery from partial failure.
- Original layout/motion engine supports groups, text, rectangles and constrained line connectors, stack/grid/padding/alignment, frame timing and cubic curves sampled into bounded editable native keys. `ae_scene_compose` concatenates compatible scenes into a local specification artifact.
- `ae_scene_preview` creates a self-contained schematic HTML player with scrub/play/pause, shared motion evaluation and a dependency-aware immutable cache. Cached previews skip frame evaluation. This is not an AE render or a cache of native RAM previews.
- Scene files can be passed by local `specPath`, avoiding repeated scene JSON in model/tool messages. Input is bounded and validated; arbitrary script evaluation remains disabled.
- `property.adjust` performs relative numeric operations locally inside AE, including bounded offsets of existing keys, with preflight and readback. Available through the guarded single-dispatch editing path.
- Includes studio.4 focused context and verification improvements. No Remotion code or dependency was incorporated.

Validation and known boundaries are recorded in `docs/NATIVE-SCENES-VALIDATION.md`. New native AE execution and visual acceptance are not claimed by offline tests.
