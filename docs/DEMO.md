# KYNEM motion demo

**Publication pending:** the revised video is awaiting the maintainer's selection. The thumbnail is a draft frame; a public playback URL has not been added yet.

## What the film shows

A directed motion sequence: “Animate MOVE”, a title and underline, an illustrative timeline, three animated layouts, and the KYNEM closing card. The command cards and timeline are designed graphics, not an actual Codex or After Effects interface recording.

The agent created and revised native text, shapes, keyframes, effect controls and parenting through the local KYNEM bridge, following repeated human art direction. Native layers and properties were inspected in After Effects 26.5 on one Mac. The export is an authored promotional animation, **not evidence of a fully autonomous prompt-to-video run**.

The current candidate is 1920×1080, 30 fps, approximately 14.37 seconds, without audio. Sections are deliberately retimed in the master composition. No agent execution recording or execution speed benchmark is presented.

## Reproduce a bounded part

Use [examples/readme-move.json](../examples/readme-move.json) and the [README instructions](../README.md#reproduce-the-core-motion-task). This creates the title/underline task, not the entire promotional film. The fixture has offline schema verification; its exact native output still needs acceptance.

## Hosting handoff

Keep the MP4 out of Git history. After the maintainer selects the final video, upload the sanitized MP4 as a GitHub release asset on this repository, then replace the README thumbnail target with the asset's verified playback/download URL. GitHub renders the Markdown thumbnail; no HTML video element is required.

Before publishing: confirm the chosen version, verify the asset is accessible without authentication, check frame rate/duration, scan metadata for local paths, and confirm that the poster matches the uploaded version. The existing public installer release is separate from this unpublished demo update.
