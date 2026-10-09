# Offline delivery preflight

`ae_delivery_check` compares a bounded delivery contract with caller-supplied observations. It never opens AE, reads an output file, renders, renames or reparents compositions. `actualAeVerified` is always false. `suppliedEvidencePassed` means only that the supplied evidence satisfies this contract.

Call with `{ spec: { outputs: [...], observations: [...] } }`. Each output specifies `identity: { compId, sourceVersion, artifactId }`, expected `name`, `folder`, integer `durationFrames`, `fps`, `requiredText`, and `audioDecision` (`required`, `intentional-none`, or `unknown`). Use the saved copied project's revision for `sourceVersion` and an immutable exact rendered file identity, preferably SHA-256, for `artifactId`. A 15 second output at 25 fps requires 375 frames; a 500 frame observation is blocked.

Gather fresh readback for the final delivery compositions through existing inspection tools. Each observation carries the same identity, actual name/folder/duration/fps, `textLabels`, and explicit `audioPresent`. Optional protected ranges use `startFrame`, exclusive `endFrame`, and a caller-produced content `signature`; corresponding readback must match. This tool does not compute signatures.

Supply separate `frameReview`, `playbackReview`, and `audioReview`, each with the exact same identity, `passed`, and nonempty `notes`. Inspect rendered frames for required text, layout and protected material; inspect playback for timing, holds, cuts and final duration; listen to the exact output for audio edits and sync. Intentional silence still requires an audio review confirming silence. An AAC stream or matching metadata cannot satisfy these reviews. Missing/unknown audio intent is a blocker.

All names, folder paths, versions and artifact identities are exact comparisons. Each composition must occur once in the manifest and have one observation matching its full identity. Arrays are capped at 50 outputs/observations and 100 labels/ranges per output. Frame counts are bounded to 10 million, fps to 1–240, and strings to 512 characters.

Read `outputs[].blockers` and the separate structural/review fields. Refresh observations and all reviews after any source or rendered artifact changes. `notVerified` remains explicit even when the supplied evidence passes: freshness, actual AE state, file identity and review truth require external verification. This is an offline evidence checklist, not a delivery approval or native acceptance test.
