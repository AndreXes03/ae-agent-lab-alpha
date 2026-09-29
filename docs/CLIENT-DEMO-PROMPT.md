# Codex client demo prompt

This prompt is filled by `scripts/run-client-demo.mjs` from the active demo session. It is for a single, disposable After Effects worker.

Use the MCP server `ae-agent-lab-demo` to control only the After Effects worker `{{WORKER}}`. The worker must already have `{{PROJECT}}` open. The input fixture is `{{INPUT}}`; all new projects and rendered frames belong under `{{RUN_DIR}}`. Do not open, edit, save, stop, or switch any other After Effects instance or project.

Perform this edit as an After Effects agent, using the MCP tools directly:

1. Read the live project, its main composition, and its layers. Report the AE version, active project path, composition name, and the layer or property that controls the brief exposure flash. If the live project path differs from `{{PROJECT}}`, stop without editing.
2. Save a new variant at `{{VARIANT}}` **before** any edit. Preserve the visual design, layer structure, colors, texture, and all non-flash motion.
3. Use `ae_catalog` for the relevant typed operation and inspect the flash property and its existing keyframes with `ae_layer_info` or `property.get`. Change only the flash timing so its peak is at 2.2 seconds and it settles by 3.0 seconds. Preserve the existing peak and settled values. Apply appropriate easing. Use typed MCP operations; do not use arbitrary ExtendScript, `ae_eval`, shell scripts, or direct project-file editing for the change.
4. Read the edited property back from After Effects. Verify the actual keyframe times and values, save the variant, and render at least two frames around the peak and settle into `{{RUN_DIR}}` with `analyze: true`. Inspect the render results and report any visible issue honestly. Never infer a completed image from a queued render.
5. Finish with a concise report listing the input project, variant project, AE version, target composition and property, before and after keyframe times and values, and rendered image paths. If any step is blocked, give the exact observed error and the last confirmed state; do not blindly repeat a timed-out mutation.
