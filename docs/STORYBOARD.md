# Storyboard and clean styleframes

Invoke the `kynem-storyboard` skill with a motion brief, “crea uno storyboard”, “genera solo questa scena” or “rifai il finale e raccordalo”. It plans a local production package before any AE video production. Present the local storyboard interface before production; approval must identify the inspected package revision and may be recorded there or given explicitly by the user in chat. No publication is part of this workflow.

The package uses `schemaVersion: 1`, stable `id`, `revision`, `mode`, `format`, `style`, `scenes` and `transitions`. Scene artwork is an `elements` list in absolute canvas pixels; IDs identify the same component across frames. Transition notes remain outside the artwork. Optional `frame` transition artwork is hidden/skippable by default. `mode: "styleframe"` supplies one clean scene image without grids or annotations. Local `image` paths are optional; the default fixture uses native schematic/vector artwork and no external image dependency.

Each scene records absolute `startFrame`, duration and representative key frame. Each transition records source/destination, retained IDs, frame duration, stagger, curve, recipe, AE properties and handoff. Effects, assets and limitations carry their native verification requirements. `production.sceneSpec` can carry an executable supported scene description, separate from display artwork. The interface never renders these recipes into AE or authorizes arbitrary scripts.

## Local invocation

From the built checkout, generate and open the local interface with:

```sh
node dist/index.js storyboard --manifest examples/storyboard/kynem-demo.json --out /absolute/new-dir
```

Use a new output directory and open its generated HTML. For a single clean frame, set package `mode` to `styleframe` and include the selected scene. The approval action exports the revision and manifest/scene hashes; an explicit user go-ahead naming that revision is also valid. Neither action silently starts AE.

## Concrete demo

[examples/storyboard/kynem-demo.json](../examples/storyboard/kynem-demo.json) contains the requested 1280×720, 30fps, 360-frame (12-second) demo:

| Scene | Frames | Join to next scene |
| --- | --- | --- |
| Command | 0–59 | Last 18 frames expand the persistent command panel into the title container. |
| Animated title | 60–131 | Last 18 frames compress that container into the request bar. |
| Request three variants | 132–191 | Last 24 frames expand the container for previews. |
| Variant previews | 192–299 | Last 18 frames move/scale the retained middle card into the closing. |
| Closing | 300–359 | Readable final hold. |

Transitions are included in scene durations. The native `production.sceneSpec` uses persistent `commandPanel`, `accentLine` and `variant2Panel` IDs; all other content has scoped lifetimes and opacity tracks. Position/scale/opacity tracks use integer frames and directed cubic controls. Three-frame card arrivals provide a starting stagger. The curved travel is a schematic starting choice; native playback still decides timing quality. The default panels have zero corner radius, so no unsupported roundness field is injected into the scene schema.

The dark UI palette is #07101f, #12243e, #247bff and white; Arial and explicit dimensions keep the implementation bounded. Glow is a separate optional native adjustment/effect recipe below typography. It is omitted from the schematic frames and remains unverified until native effect bindings and actual output are inspected. See [STORYBOARD-CAPABILITIES.md](STORYBOARD-CAPABILITIES.md) for evidence and boundaries.

## Targeted revision

[kynem-demo-ending-revision.json](../examples/storyboard/kynem-demo-ending-revision.json) changes only the ending line to “Scegli. Affina. Anima.” and its adjacent transition note. Earlier scene objects remain byte-for-byte equivalent as data, with stable IDs and timing. The native production description changes only `closingText.text`. This fixture is a draft revision, not a fabricated approval record.

For a real approved revision, carry the `approvedScenes` IDs/hashes from the interface approval export. The renderer validates hashes of protected scenes and their dependencies (format, shared style/effects and supplied image bytes). A global style or effect revision therefore requires reconsidering those scene approvals. Keep earlier scenes approved and present the revised ending plus dependent join for approval. The approval export or explicit human go-ahead must identify the final package revision before the AE agent builds video.

## Verification and handoff

Validate package fields and embedded scene specs offline, render schematic artwork and inspect the interface, then approve the intended revision. Give the AE agent the approved package, supported native scene spec, requested asset/effect bindings and exact outstanding native checks. Use the existing KYNEM copied-project workflow; inspect the resident worker rather than launching or mutating an unrelated project.

Offline schema/preview tests prove package processing and supported geometry. Native font metrics, effect property bindings, AE creation/readback, final layer order, native rendered appearance and playback remain unverified until an actual copied-project run. A screenshot cannot establish motion. No integrated image generator exists: supply optional prompts/specifications when requested, and never claim AI frames or native effects were rendered.

## Isolated native static proof

All five fixture styleframes were constructed as simple rectangle/text compositions with existing typed operations in a separate local project copy. The variants composition was rendered at 0 seconds in AE 26.5 build 89, 16 bpc, at 1280×720; the rendered still was inspected and its layout, text and shapes matched the planned static frame. This is native static-frame evidence for those simple elements. It does not verify fixture animation, transitions or the glow recipe. User approval of the storyboard remains pending; this isolated static proof is not video production or approval.
