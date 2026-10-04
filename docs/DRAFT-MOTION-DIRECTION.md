# Optional direction for a first draft

Use these tendencies when the user asks for a first draft or leaves style and transitions open. User direction, approved references and existing animation take precedence. Choose one coherent tendency for the bounded draft and record it briefly; the user can change or remove it. These are planning choices, not mandatory templates or new bridge operations. Work on the verified copied project and preserve the original.

| Tendency | Useful for | Starting direction |
| --- | --- | --- |
| Quiet editorial | Typography and information | Strong hierarchy, a small number of entrances, readable holds, restrained movement. |
| Luminous interface | Cards, diagrams and product graphics | Shared card/text transforms, restrained glow beneath typography, staggered arrivals and one deliberate zoom. |
| Graphic match | A short sequence of related scenes | Carry a shape, position or movement into the next scene; reuse its visual language and settle for reading. |

Do not introduce repeated pans or zooms to fill empty time. A few independently animated native AE elements make timing easier to direct and maintain. If an element is already visible at the scene start, preserve that continuity instead of adding another entrance. Keep motion blur off for newly authored draft motion unless the brief requests it; preserve an existing project's setting outside the edit scope.

## Author the movement

Write explicit frame timing, focal point, travel and final readable hold before applying. For fresh reveal layers, three frames between related arrivals is a starting stagger, subject to the brief and actual fps. Give each entrance a clear main movement and a short settling tail. Keep residual motion small and deliberate; avoid long drifting tails that make a finished layout feel unsettled.

For a coherent zoom or dezoom, place related card and text elements under one inspected parent/group and animate that common transform. Keep independent motion only where it explains the content. For a user-requested bell-shaped speed profile, place the speed peak near the middle of the travel, with slow departure and arrival. A symmetric cubic easing such as `[0.42, 0, 0.58, 1]` is a starting approximation, not a guarantee of the requested velocity in the native result. Confirm the actual speed and duration in playback. Use a quicker settling curve for a reveal when that is the user's direction; do not apply the dezoom curve indiscriminately.

At a scene join, record the outgoing and incoming frame, position, scale, anchor/focal point and direction in a consistent coordinate space. Match those values where the brief calls for continuous movement, or make a deliberate cut. An incoming element must not disappear or jump merely because its scene begins. `ae_scene_compose` concatenates scenes and offsets timing; author the handoff in the scene tracks yourself.

## Keep finishing legible

For a luminous draft, protect the typography: use the glow adjustment beneath the text so sharp glyphs remain above it. Inspect the real adjustment scope and layer order. Start with original colors and Screen compositing where the installed native effect supports them. Discover the actual property names/enums through typed effect operations before setting them; do not guess numeric enum values.

Build glow across a few scales: a narrow core with a high threshold, then broader radii with lower intensity. As radius increases, reduce intensity so the large halo does not wash out the frame. Keep an inner shadow barely perceptible if the direction calls for depth. Tune on native frames at the intended size and preserve the approved layout, colors and typography. These finishing choices are optional and reversible; do not add unsupported effects to a scene JSON specification.

## Use the available workflow

For supported new 2D graphics, use `ae_scene` with stable IDs, explicit geometry, parent groups and integer-frame tracks; see [SCENE-WORKFLOW.md](SCENE-WORKFLOW.md). Its easing supports linear, hold and cubic controls on the outgoing key of a segment. Effects, adjustment layers and blending need the existing typed editing path supported by the loaded catalog. The schematic player cannot verify their appearance.

For inspected fresh layers through `ae_motion_plan`, use explicit per-item `motion` timing and curves and keep its existing-animation guards; see [MOTION-QUALITY.md](MOTION-QUALITY.md). For an existing rig or animation, inspect its parenting, keys and expressions and use scoped edits. Do not flatten or replace it with a draft preset.

Review the affected short interval before propagating a choice across the sequence. Readbacks establish changed values; native frames establish appearance at those frames; actual playback at the intended fps establishes observed timing and continuity. Screenshots and schematic previews cannot establish native motion quality. Retain a concise record of the chosen tendency, user overrides, protected properties and what was actually reviewed.
