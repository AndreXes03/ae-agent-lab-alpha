# Motion reveal planning

`ae_motion_plan` is an offline planner for four small reveal patterns: typography, panel, icon, and bar. It emits `layer.set_anchor` and `keyframe.apply` arguments for `ae_do`; it does not edit a project. Typography, panels, and icons combine movement and scale with opacity. Bars grow horizontally from a left pivot without an opacity fade. The patterns stagger by whole frames and use stronger zero-speed endpoint easing. Text never receives an arbitrary rotation. The planner does not judge whether the result looks good.

## Before planning

1. Identify the named After Effects instance and confirm the copied project path with `ae_project_info`.
2. Inspect the target comp with `ae_comp_info` and each target layer with `ae_layer_info`, `property.get`, and `layer.bounds`. Read actual comp id, frame rate, duration, layer id, in/out points, position, scale, anchor, opacity, expressions, parenting, dimension separation, and keyframe counts. Convert timings to frame numbers. Never invent ids or geometry. This preset only accepts fresh unanimated, unparented 2D layers with unseparated Position; plan a manual edit for other layers.
3. Render representative **before** frames and, for motion quality, a playback preview. Save a new project variant before edits.

Call `ae_motion_plan` with `phase: "prepare"` and the measured values. Apply only its pivot operations to the saved copy. Finish text content and styling before this step. Then read Position and bounds again: `layer.set_anchor` compensates Position, so the pre-pivot value is stale. Call the planner again with `phase: "reveal"`, `pivotPrepared: true`, and the **post-pivot** Position as `targetPosition`. Set `visibleAtSceneStart` to true when an object is already visible at the first scene frame, including when a camera move reveals it. The planner blocks an entrance in that case. `measuredBounds` and `expectedCenter` allow a measured alignment warning; without both, alignment is explicitly unverified. Camera samples and transition velocities can flag a reversal, stop, or abrupt direction change when those measurements are available. Mark a reversal, stop, or cut intentional only after reviewing playback.

## Apply and inspect

Review the returned schedule and findings. When `ready` is false, no operations are returned. When ready, submit the reveal operations through `ae_do` or one `batch.run` with `stopOnError: true`. Confirm each result, especially any warnings from `keyframe.apply`. Read the edited position, scale, opacity and anchor back from AE. Re-measure bounds after the edit. Render matching **after** frames, inspect them alongside the baseline, and check the actual playback for pacing, clipping, legibility, brand assets, and continuous transitions. A still frame or passing geometry check cannot establish these.

The reveal operations replace keys on position, scale, and opacity. Existing keys or expressions fail the preflight, so use them only on inspected fresh layers in the intended copied project. Track mattes are available through a separate typed `layer.set_track_matte` operation, but this planner does not build a directional typography matte: that needs a measured matte layer and its intended compositing relationship. Keep comp and precomp names meaningful and stage main composition, scene precomps, typography, and finishing layers in a readable order. A logo needs the real supplied asset; the planner never creates one.

These checks are deterministic safeguards for measured layout and timing. They do not replace visual direction or a before/after render review.

## Audit existing motion without edits

Call `ae_motion_plan` with `phase: "audit"`, `items: []`, and `cameraSamples` read from the actual camera/null rig. Each sample has a frame number, Position and optionally Scale. Supply samples in strictly increasing frame order. The audit checks translation and zoom reversals and optional `transitionJoins`; its operations list is always empty. It does not sample AE by itself or evaluate expressions. Keep samples in a consistent coordinate space; parent transforms and time remapping must be accounted for by the caller. An audit of a nested source does not establish motion in the master.

The shared input schema still requires the real `comp`, `fps`, `compDurationFrames`, `sceneStartFrame`, `sceneEndFrame`, `staggerFrames` and `minHoldFrames` fields; the audit does not author a reveal schedule. Set the last two to zero when irrelevant. `ready` means no checked error was found in the supplied data, not approval of visual quality. Missing measurements cannot establish correctness. Use a new Codex session after rebuilding so the client discovers the added tool.
