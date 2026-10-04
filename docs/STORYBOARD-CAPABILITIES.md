# Storyboard capability evidence

“Verified” must name its evidence scope. The repository's scene tests establish offline schema/compiler/runtime behavior; they do not establish native AE appearance. [NATIVE-SCENES-VALIDATION.md](NATIVE-SCENES-VALIDATION.md) records that the alpha.4 checks had no resident native instance. Refresh this map against the loaded catalog before production.

| Technique | Implementation and evidence | Storyboard use |
| --- | --- | --- |
| Text, rectangular shape, line, null/group hierarchy | `src/scenes/model.ts`, compiler/runtime and scene tests; supported and verified offline, native appearance still to verify | Default simple 2D artwork; explicit text dimensions/font, stable IDs, common-parent transforms. |
| Position, scale, rotation, opacity; linear/hold/cubic easing | `src/scenes/model.ts`, `motion.ts`; evaluator and sampling tested offline | Default frame timing. Groups require opacity 100; avoid animated connectors outside compiler constraints. Native nonlinear samples have integer-frame tolerance, not subframe equivalence. |
| Frame-local sequence composition | `src/tools/scene-compose.ts`; offline tests | Concatenates frame offsets; joins must be authored explicitly. It does not create precomps or design transitions. |
| Masks and track mattes | `src/operations/mask.ts`, `layer-advanced.ts` typed operations | Supported separate editing path, outside scene JSON/player. Native execution and exact reveal must be verified for the target. |
| Native precompositions and parenting | Layer/comp typed catalog; scene groups create null hierarchies | Supported separate path. Do not label a scene group as a precomp. Verify the intended target hierarchy in AE. |
| Rectangle Path Size and Trim Paths | `shape.add_rect`, `shape.add_trim_paths` in `src/operations/shape.ts`, generic typed property/keyframe path | Supported separate path after discovering actual property paths. No size/Trim Paths tracks in scene schema; target behavior remains to verify. Use scale for the default scene fixture. |
| Glow/blur, gradients, styles, adjustment and blending | Effect/property/layer typed path; `shape.add_gradient_fill`, `layer.set_blend_mode` exist | Supported only when the exact loaded operation/effect/property can be resolved. Schematic previews do not reproduce them; native recipe needs target verification. Never guess effect dropdown enum values. |
| Images generated from prompts | No image generator in the storyboard product | Not available in this feature. Optional external dependency/specification only; never report generated frames. |
| Volumetric materials, reflections, complex morphs; scene footage/3D/expressions | Outside current declarative scene schema/player | Not available through that path; do not make default production promises. Only use a separate supported workflow after capability inspection. |

For a glow recipe, plan an adjustment beneath protected typography; narrow high-threshold core, broader lower-intensity halos, original colors and Screen only after verifying native names/enums. Record desired radius/intensity/threshold plus unresolved bindings in the package. Schematic styleframes omit the effect and state that limitation. Do not pretend a flat blue panel proves native glow. Inner shadow remains optional and barely perceptible after native verification.

Default production techniques are those with verified offline implementations and a plausible native path. Native acceptance stays pending until the copied-project execution, readback, representative frames and affected playback are checked. Native mocks, browser frames and passing tests never upgrade a technique to visually verified AE behavior.

## Target-specific AE 26.5 observations

A current session exercised native glow property edits and readbacks. Color-input and original-color choices worked in that inspected effect; one compositing choice blacked out the graphics and another preserved them. These observations do not establish universal dropdown enum labels. Keep binding discovery and native frame review explicit, especially after changing AE/effect versions.

The inner-shadow `property.add` approach failed for `innerShadow/enabled`; the obsolete `ADBE PSL Inner Shadow` path was visually unusable and removed. The session instead activated the target comp, cleared selected properties, selected the target layer, used the inspected AE command ID 9001, and then listed the resulting `ADBE LayerStyles/innerShadow` properties. Opacity 7, distance 1, blur 3 and chokeMatte 0 were written through typed properties. The resulting v14 export was inspected at representative frames and preserved white typography and the blue palette; native inner-shadow readbacks and rendered frames were verified for this target. Actual playback aesthetics were not established by those frames. Do not use it as an automatically verified appearance recipe or a universal command mapping. The default fixture omits inner shadow.

## Isolated native static proof

All five fixture styleframes were constructed as simple rectangle/text compositions with existing typed operations in a separate local project copy. The variants composition was rendered at 0 seconds in AE 26.5 build 89, 16 bpc, at 1280×720; the rendered still was inspected and its layout, text and shapes matched the planned static frame. This is native static-frame evidence for those simple elements. It does not verify fixture animation, transitions or the glow recipe. User approval of the storyboard remains pending; this isolated static proof is not video production or approval.
