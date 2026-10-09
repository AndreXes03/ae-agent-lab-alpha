# Tool reference

Generated from `src/tools/**` via `npm run docs:tools` — do not edit by hand. For a grouped summary and example prompts, see the main [README](../README.md).

`ae_do`'s operation registry (`layer.*`, `keyframe.*`, …) is discoverable at runtime via `ae_catalog` and is **not** listed in this file.

21 tools across 4 groups.

## Inspect

Read-only project/comp/layer introspection.

| Tool                 | Description                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ae_project_info`    | Project-level info: file path, dirty flag, all items with type/summary, active item.                                                    |
| `ae_comp_info`       | Detailed comp info: size, fps, duration, work area, motion blur, layer summaries.                                                       |
| `ae_layer_info`      | Full layer info: transform, effects, masks, text, shape contents, keyframes (incl.                                                      |
| `ae_version_info`    | AE version, build, capabilities (saveFrameToPng, app.effects, Socket).                                                                  |
| `ae_delivery_check`  | Bounded offline preflight comparing a delivery manifest with supplied readback and artifact-specific frame, playback and audio reviews. |
| `ae_inspect_targets` | Inspect up to 16 explicit layer or property targets in one read.                                                                        |
| `ae_verify_targets`  | Capture/compare explicit source, timing and property animation invariants in one AE read per action.                                    |
| `ae_context`         | Ambient context: project state, active comp, selected layers, and resident readiness.                                                   |

## Document

Save, JSON export, and JSON import of the whole project.

| Tool                     | Description                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ae_save_project`        | Save the project.                                                                                                                  |
| `ae_project_export_json` | Serialize the entire project to JSON (folders, comps, layers, keyframes, effects, shapes, markers, time remap, solids, file refs). |
| `ae_project_import_json` | Rebuild the project from JSON (produced by ae_project_export_json).                                                                |
| `ae_scene_compose`       | Concatenate declarative scenes offline at exact integer frame offsets.                                                             |

## Render

Single-frame rendering for visual verification.

| Tool               | Description                                                                           |
| ------------------ | ------------------------------------------------------------------------------------- |
| `ae_render_frame`  | Render one or more frames to PNG.                                                     |
| `ae_scene_preview` | Create a self-contained local schematic HTML player without contacting After Effects. |

## Operations

Atomic operation dispatch — discover with `ae_catalog`, execute with `ae_do`.

| Tool               | Description                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ae_catalog`       | Discover available atomic operations for ae_do.                                                                                                      |
| `ae_motion_plan`   | Offline motion planner with per-layer timing, easing, Position speeds and anticipation/overshoot waypoints.                                          |
| `ae_workflow_plan` | Offline recipe for retiming several inspected property tracks in one AE batch.                                                                       |
| `ae_workflow`      | Prepare a typed retime or text/logo variants recipe against an existing active managed .aep copy and persist a guarded job.                          |
| `ae_edit`          | Apply up to 12 typed, registered edits to the active managed .aep copy in one AE call.                                                               |
| `ae_scene`         | Compile a bounded native comp, text, rectangle, connector and group scene, inspect its differential preflight, then apply to the managed saved copy. |
| `ae_do`            | Execute an atomic operation by name (from ae_catalog).                                                                                               |
