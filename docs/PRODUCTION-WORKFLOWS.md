# Production workflows (development branch)

These additions close the gap between editing properties and checking the actual delivered motion. They are not included in the published alpha.7 download. Technical verification, visual frame review, playback review and listening are separate evidence.

## Runtime requirements

Build this checkout with `npm ci --ignore-scripts` and `npm run build`. Media tools require **both FFmpeg and ffprobe** on the bridge process PATH, or absolute `KYNEM_FFMPEG` / `KYNEM_FFPROBE` executable paths in its environment. No binary is downloaded automatically. Background rendering also requires Adobe `aerender`; macOS installation discovery is supported, or set `KYNEM_AERENDER`. Start the bridge from this checkout to expose the new tools. The installed plugin is not updated by building source.

Native evidence and untested boundaries are recorded in [PRODUCTION-VALIDATION.md](PRODUCTION-VALIDATION.md). Windows cloud recall flags and fresh-machine deployment of these additions have not been validated.

## Preflight before opening or copying

Call `ae_media_preflight` with `{ "project": "/absolute/project.aep" }`, or run `node dist/cli.js media-preflight /absolute/project.aep`. The project launcher runs the same check **before copying or opening** the source. It uses file metadata, macOS dataless flags and adjacent `.icloud` placeholders; it does not read media content or trigger a deliberate download.

Each file is `local`, `cloud-placeholder`, `missing` or `unknown`. A known nonlocal file or invalid inventory blocks launch. A binary AEP without a current inventory has **unknown dependencies**, not a clean dependency bill; opening may still encounter unknown media. No offline binary AEP parser, automatic hydration or guessed download duration is provided.

After a managed project is open and saved, `ae_dependency_manifest` with its `copyPath` exports `<copyPath>.kynem-media.json`. It inventories footage and proxies, records project path/size/mtime, and declares expression-generated dependencies unknown. An existing sidecar is preserved; archive it explicitly before regenerating after a save. Sidecars are bounded and rejected if stale. Source manifests must refer to that exact source file, not a differently located copy.

## Persistent background rendering

Use `ae_render_job` with `request.action: "start"`. Generate **one UUID for each intended job**, then retain it for retries and reconnection:

```json
{
  "instance": "ae-agent-lab-demo",
  "request": {
    "action": "start",
    "requestId": "11111111-1111-4111-8111-111111111111",
    "copyPath": "/absolute/managed-copy.aep",
    "items": [
      {
        "compId": 42,
        "startFrame": 0,
        "endFrame": 180,
        "outputPath": "/absolute/renders/main-v2.mov",
        "outputTemplate": "Lossless",
        "renderTemplate": "Best Settings",
        "audio": "required",
        "reviewWindows": [
          { "startFrame": 0, "endFrame": 180, "stepFrames": 30 },
          { "startFrame": 75, "endFrame": 95, "stepFrames": 1 }
        ]
      }
    ]
  }
}
```

IDs and templates above are examples: inspect the actual project and locally installed render/output templates. The composition name must be unique because aerender selects by name. Frames are composition-relative, zero-based, with **exclusive endFrame**. Display start is applied only when converting to aerender's inclusive range. Review windows are relative to the rendered movie.

The project must be the current saved, clean managed copy. KYNEM snapshots and hashes the AEP, inventories the selected compositions' direct layer-source graph (including nested compositions and proxies), and hashes those local dependencies. Expression-generated paths, plugin-managed assets and implicit image-sequence members remain unknown. The snapshot uses original source links; no automatic relinking is claimed.

A detached supervisor starts a separate Adobe process without `-reuse`, serializes up to eight items, saves progress and logs, verifies every produced movie, and optionally creates motion review packages. Starting the same request UUID reads its existing record instead of rendering again; changed arguments with the same UUID are refused. Use:

```json
{ "request": { "action": "status", "requestId": "11111111-1111-4111-8111-111111111111" } }
```

Status is read from disk without contacting busy AE. Records live in the configured runtime's `render-jobs/<UUID>/`: manifest, immutable-intent project snapshot, status, per-item logs, permanent launch claim and review folders. A stale heartbeat becomes `unknown`; reconnecting never guesses that the render is safe to replay. Cancellation writes a durable request and signals the owned aerender process. Adobe may continue shutting down after its launcher exits; cancelled outputs are never accepted for delivery. Interrupted output reservations are preserved for explicit inspection, not silently stolen.

A zero exit code or existing output path is insufficient: completion requires full decode, expected dimensions/FPS/frame count, monotonic PTS, explicit audio intent and boundary/continuity checks. Source hashes are checked again. No playback/listening approval is generated.

The older synchronous `render.start` now reports newly completed, previously completed, skipped, failed, cancelled and unknown queue items separately. `rendered` counts only newly completed selected items; it does not certify media quality (`mediaVerified: false`). Prefer background jobs for recoverable production renders.

## Measured motion review

`ae_motion_review` accepts `request` with `video`, a new `outputDir`, `context` and `windows`. Context requires actual `compId`, `compName`, source `fps`, `startFrame` and `version`; optional `mainStartSeconds` and `precompMapping: { offsetSeconds, rate }` must come from inspected timing. Optional `targets` list stable `layerId`, name, inPoint and outPoint.

The tool copies and hashes the movie, decodes actual timestamps, extracts up to 120 thumbnails across up to eight variable-density windows, and returns:

- `index.html`: existing contextual feedback player with audio controls and a link to the grid;
- `grid.html`: clickable measured frames, video playback, actual PTS, composition time, supplied targets and explicit Main/precomp mapping;
- `motion-review.json`: exact artifact identity and machine-readable sample times;
- `frames/`: PNG samples from the copied video.

Use `node dist/cli.js motion-review /absolute/request.json` as the local route. Serve through the existing loopback `review-serve --dir <outputDir>` command when browser file access is unsuitable. The server permits only specifically named frame PNGs inside a regular `frames` directory, without following symlinks. Unknown Main/precomp mappings remain unbound. The composition binding is caller-supplied; PTS is measured. Dense grids help locate a problem but do not replace watching/listening to the entire cut. Codec support in a browser may differ from FFmpeg; choose a browser-playable render template when needed.

## Media and audio verification

`ae_media_verify` takes `path` and `expected` (`frames`, `fps`, `width`, `height`, explicit `audio: "required" | "intentional-none"`, optional `referenceAudio`). It measures decoded audio samples, PTS gaps/overlaps and start/end boundaries; optional reference comparison includes encoded audio payload and timestamps. Hashes before and after analysis prevent binding a successful check to a changed artifact. VFR and discontinuities are reported. Analysis is bounded to 300,000 decoded records and 64 MiB of probe output. Boundary tolerance is one video frame, not a perceived-sync judgment.

For a visual-only revision, `ae_audio_master` takes `video`, `referenceAudio`, `referenceSha256`, and a new `outputPath`. It copies streams, applies **zero offset**, verifies full decoding, counts, boundaries, and packet payload/timestamps for both copied video and reference audio. It returns `passed: false` if verification fails; preserve the failed output for diagnosis. Remuxed timebases/codecs that do not preserve the required packet identity are refused. There is no universal AAC/1024-sample correction and no automatic listening approval. A mastered artifact has a different hash and needs new review; delivery publication currently accepts artifacts from verified render jobs, not a remux substituted into a prior job.

## Safe retiming and selective still replacement

Use existing `ae_workflow` prepare/apply/status. Each prepared job binds the managed project and persistent target snapshot; keep its job ID after timeouts. Existing checkpoints/receipts and single-writer guards remain in force. A batch error can leave partial changes; neither an undo group nor a checkpoint is described as automatic rollback. `ae_edit` now exposes per-operation `not_started`, `started`, `applied` or `failed_may_have_changed` states.

For `retime_properties`, explicitly choose `timeDomain: "composition"`, `curvePolicy: "preserve-shape"` (default) or `"preserve-speed"`, `mediaTiming: "preserve"` (default) or `"retime-selected-media"`, and optional `protectedLayerIds`. Shape preservation scales temporal speeds inversely with duration while keeping influences. Roving/auto-Bezier shape scaling is refused. Media timing, start/stretch/in/out, source IDs and protected layer audio flags are checked. Time Remap tracks require the explicit media-retime policy; property retiming alone does not ripple source clips. Existing subframe/expression/separated-dimension restrictions still apply.

For `source_replace`, supply:

```json
{
  "sourceId": 123,
  "newPath": "/absolute/revised-portrait.png",
  "targets": [{ "compId": 42, "layerId": 567 }],
  "framing": "preserve-normalized",
  "semanticChange": true,
  "annotations": [{ "compId": 42, "layerId": 568, "role": "jaw contour" }]
}
```

Prepare inventories all usages and marks selected/preserved ones. Apply imports a separate still and changes only explicit stable layer IDs. `preserve-pixels` retains the pixel transform; `preserve-normalized` inversely adjusts Scale and proportionally adjusts Anchor, including supported keys/tangents. Aspect ratio changes, 3D normalized transforms, expression-driven Scale/Anchor and resized images with masks are refused before replacement. Mask-coordinate retargeting remains an explicit separate edit. Persistent effects, timing, parenting, mattes and key attributes are compared; errors include changed uses and imported source identity. A different face/landmark requires contour/callout review even with identical dimensions. Unknown semantic/expression relationships are never called preserved.

`ae_anchor_map` maps a supplied pixel/normalized point through inspected 2D anchor/position/scale/rotation chains at one sample time. It reports source, layer, precomp and Main coordinates according to supplied labels. It does not infer landmarks, sample AE itself or support 3D/perspective/unsampled expression geometry.

Compact target verification now separates `persistentFingerprint` from evaluated values: animation sampled at another time is not itself evidence that saved keys changed. New native text initializes explicit character/paragraph defaults instead of inheriting the user's last Character panel style. Existing text styles remain preserved by scoped scene edits.

## One current WIP delivery

After frame, full-sequence playback and audio review of the **exact output hash**, call `ae_delivery_publish` with `request` containing `renderJobId`, zero-based `itemIndex`, `wipDirectory`, safe `version`, `reviews`, optional `provisional` notes and `collectSources`.

`reviews` contains `artifactSha256` plus `frames`, `playback` and `audio`, each `{ "passed": true, "notes": "actual observed evidence" }`. These are supplied human/agent attestations; the tool independently repeats technical checks but cannot prove someone watched or listened. Never manufacture approval to pass this gate. An intentionally silent cut requires a review note confirming that intent.

The publisher writes a version directory with AEP snapshot, Main identity/range, source hashes, verified movie, review evidence and provisional items. Optional source copies are hash-checked; the AEP is **not automatically relinked**. It updates one `current.<ext>` only after verified copies exist, preserves `_versions`, and creates `_review/index.html`. Repeating the same completed publication is idempotent. Unowned WIP movies, externally changed current files or format changes require explicit organization; nothing is silently deleted. Current-movie rename is atomic; file plus manifest pointer are not a filesystem transaction. A crash between them is detected on retry and requires inspection, preserving the completed version.

## Native motion recipes and sequence review

`ae_scene_recipe` produces scene and production JSON for `locate-explain-recompose`, `comparison` and `split-screen`. Supply dimensions, FPS/duration, title, labels, font, spoken interval, optional external-material references, and a new output directory. Apply through `ae_scene` to a managed copy. Panels and labels share native parent motion; explanation stages are explicit. External pictures/3D material remain declared editable slots requiring separate insertion; these recipes are composition scaffolds, not automatic clinical illustration or proof of creative quality.

Review the complete native sequence for legibility, rhythm, entry/exit, safe area, density, voice alignment and continuity. Record provisional areas separately. Sparse initial concepts are a creative decision, not evidence of a bridge limitation.
