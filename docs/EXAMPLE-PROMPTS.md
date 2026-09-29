# Example prompts for testers

Use these only with a saved copy opened in the named demo worker. Start with project and instance readback, discover operations with `ae_catalog`, and use typed operations. Save a new variant before changing anything, read values back from AE, render representative frames, and inspect the actual images. Do not use arbitrary eval, ExtendScript, shell, or direct project-file edits.

## 1. Retiming the Exposure pulse — native evidence exists

The local warm glow heavy-grain project has a native evidence run on this Mac that moved the Exposure peak to 2.2 seconds and its settle point to 3.0 seconds, then read back the property and rendered frames. This evidence is not cross-version support.

```text
Use only the `ae-agent-lab-demo` worker. Confirm its open project path, then inspect the project, main composition, layers, and AE version. Stop if the project is not the disposable copy under this run's `demo/runs/` folder. Save a new variant before editing. Find the local Exposure pulse and inspect its existing property path, keyframe times, values, and easing. Retiming only, move the peak to 2.2 seconds and settle to 3.0 seconds; preserve the values and the rest of the design. Use the relevant typed keyframe operation discovered with `ae_catalog`; do not use eval or scripts. Read the property back, save, render frames at 2.2 and 3.0 seconds, inspect both images, and report the exact project and render paths plus any issue.
```

## 2. Inspect the composition and render a visual set — unverified example

This is a read-only inspection and render request. It uses existing project, comp, layer, and frame inspection tools; this end-to-end Codex workflow has not been recorded as a tester result.

```text
Use only `ae-agent-lab-demo`. Confirm the open project path and report the AE version. Inspect the project and main composition, then list the layers and identify the warm glow, typography, and finishing layers from their actual names and effects. Do not change or save the project. Render PNGs at 0, 2, and 3.5 seconds to absolute paths inside this run's `demo/runs/` folder, inspect the returned images, and summarize visible clipping, contrast, and text legibility. Report render paths and any failure exactly.
```

## 3. Adjust glow softness — unverified example

This tries the existing typed effect/property operations. Do not proceed if the effect or its numeric control cannot be identified unambiguously.

```text
Use only `ae-agent-lab-demo`. First confirm the copied project path and inspect the composition and all layers. Save a new variant before editing. Identify the existing Gaussian Blur on the warm glow finishing layer and read its current value and full property path. If there is not exactly one matching effect with an unambiguous blur amount, stop and explain. Otherwise render a baseline frame at 2 seconds to a new before PNG, then change only that blur amount to 8 pixels using the typed property operation. Read the value back, save the variant, render 2 seconds to a different after PNG, inspect both actual images, and report their paths. Never overwrite or regenerate the before frame after editing. Do not use eval, ExtendScript, shell, or direct file edits.
```
