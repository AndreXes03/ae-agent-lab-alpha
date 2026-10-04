# Declarative scene workflow

Describe a small 2D scene once with stable scene and node IDs, integer frames, explicit geometry and directed motion. Compile the description before applying it to a disposable copied After Effects project. The scene tools do not turn a schematic preview into native visual acceptance.

## Local preview

Call `ae_scene_preview` with `spec` (id, name, width, height, fps, durationFrames and nodes), or use `specPath` to read a local scene JSON artifact directly. Supply exactly one input. Local files must be absolute regular files, not symlinks, and at most 512 KiB. Groups, rectangles, connector lines and text use local top-left coordinates. Parent group translation, rotation and scale propagate through the hierarchy. Group opacity must remain 100 with no opacity tracks; ancestor lifetimes are intersected into child lifetimes by compilation. Static connector endpoints must share a parent and use unrotated, unscaled geometry. Text needs explicit width/height or measured `textBounds` keyed by node ID. The preview applies the same `evaluateNode` motion evaluator used by scene compilation, sampled at every integer frame. Linear, hold and directed cubic easing therefore share their original frame values.

The result includes `artifactPath`, `hash`, `cacheHit` and `reusable`. Open the local `index.html` artifact in a browser. Play and Pause control playback; drag the frame slider to scrub. The hierarchy panel identifies parent relationships. The player is self-contained and performs no network requests, reads no remote assets and needs no CDN or installed video framework. Preview generation never contacts After Effects and is available in read-only mode.

Every player prominently says **SCHEMATIC NOT AE RENDER**. Browser fonts, glyphs and text metrics can differ from native AE. Font files are not embedded. Effects, masks, blending, 3D, footage, audio, expressions and native motion blur are unsupported. Multiline typography and native text alignment are not reproduced. This player verifies planned geometry and integer-frame motion; inspect native rendered frames and playback before visual acceptance. Preview generation has a 250,000 node-frame budget to bound local output size.

## Cache and identity

This cache stores schematic HTML previews only. Native After Effects render caching is not implemented.

The cache hashes the normalized compiled scene (including measured text bounds), asset fingerprints, font versions, configuration and the schematic renderer version. An existing artifact is immutable and its bytes are checked against a SHA-256 integrity manifest before reporting a cache hit. Cache hits skip all frame evaluation and HTML generation. Changed node content, keyframes or dependency fingerprints creates a new path. `expectedHash` rejects stale scene/dependency identity before artifact creation.

Set `dependencies.complete: true` only after enumerating all dependencies affecting the preview, for example `assets: {}`, `fonts: {"Arial": "installed-font-version"}`, and `config: {"browser": "tested-version"}`. Unknown dependencies disable reuse by default; each request receives a fresh scoped artifact. Asset fingerprints are caller-supplied identity metadata, never paths or URLs fetched by the player. Native application identity and native scene stale-state checks remain the responsibility of the native scene tools.

## Native delivery

Use `ae_scene` on a verified managed copied project. Prepare with `request: {action: "prepare", spec, copyPath, requestId}` where `requestId` is a fresh UUID for the intended scene update. Review the compact changes/conflicts summary, then apply with `request: {action: "apply", jobId}`. Read `request: {action: "status", jobId}` after a timeout; reuse the same request ID rather than creating duplicate work. The native workflow saves a recoverable checkpoint before mutation. Native prepare requires explicit dimensions for text; schematic caller-supplied bounds are not native measurement evidence.

For multiple scenes, `ae_scene_compose` accepts `id`, `name`, and `scenes` plus optional prefixed `textBounds`. It writes a validated scene JSON artifact with stable `s0_`, `s1_` node IDs and concatenated frame offsets. Dimensions and fps must match. It creates a declarative sequence, not native AE precompositions.

Preserve the scene ID and stable node IDs when updating managed layers. Reread the managed scene after application and render representative frames plus actual playback. Native compilation uses bounded motion sampling; its tolerance and limits should be included in the review evidence. Offline preview and tests are not native AE acceptance.
