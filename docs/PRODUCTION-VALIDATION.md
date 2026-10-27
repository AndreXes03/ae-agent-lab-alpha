# Production workflow validation

Development branch based on alpha.7. Test date: 2026-10-27. Do not interpret mock/synthetic checks as native acceptance.

## Native render smoke test

- Host: macOS arm64; Adobe After Effects 2026, `aerender 26.5x89`.
- Input: a disposable copy of repository `demo/warm-glow-heavy-grain.aep`; SHA-256 `97e2db8ac8bbf266742a309ea62ef4c6a530abbe9dbcc5c5ea4c3bfabb5729d8`.
- Composition: `Warm Glow`, frames 0–5 inclusive, Best Settings / Lossless. Launched without `-reuse`, with `-close DO_NOT_SAVE_CHANGES`; the editing project was not changed.
- Native log: six progress entries and `Finished composition “Warm Glow”`; output independently decoded by FFmpeg/ffprobe.
- Measured output: 1600×900, 30 FPS, six frames, PTS 0 through 0.166667 seconds, duration 0.2 seconds, no audio as explicitly intended. Full decode passed; no reported blockers.
- Scope: this checks Adobe rendering plus the media verifier on a real native result. It does **not** establish full managed-session background-job acceptance, native source replacement, native retime tangent behavior, audio playback, aesthetic approval or fresh-machine installation.

Adobe documents separate-instance rendering and the inclusive CLI frame range in [Automated rendering and network rendering](https://helpx.adobe.com/my_en/after-effects/desktop/render-and-export/automate-rendering/automated-rendering-network-rendering.html). The installed executable's own help was checked for flags used by this implementation.

## Automated coverage

Final local offline run: **58 files passed, 519 tests passed, one existing platform-specific test skipped on macOS**. All six real-media integration tests ran with FFmpeg/ffprobe available. The excluded `tests/e2e/**` native suite was not run against the user's editing instance.

The offline suite includes bounded ExtendScript VM tests, schemas/policy/instance tests and real local subprocess/media tests:

- render queue distinguishes previous completion, newly completed items, skipped, failed and cancelled states;
- non-hydrating metadata preflight detects dataless/adjacent placeholders, unknown flags and stale inventory;
- real FFmpeg-generated video/audio checks full decode, wrong counts, corrupt media, sample boundaries and exact packet comparisons;
- motion review mixes coarse/fine windows and binds sampled frames to measured PTS and the copied artifact;
- durable supervisor simulation launches a job once across concurrent claims/reconnection, rejects successful process exit without output and preserves source/output identity;
- delivery preserves unowned WIP content, verifies collected copies, retains versions, and rejects stale evidence;
- source replacement VM tests preserve unselected usages, verify normalized framing, reject masked/3D ambiguity and report partial failure;
- retime VM tests check nonzero tangent speeds/influences and protected/time-remap policy;
- local HTTP review tests serve frame PNGs while rejecting unexpected files and symlinks.

Media integration tests require FFmpeg/ffprobe and explicitly skip if unavailable. CI installs them before running the offline suite. Runtime binaries used locally were FFmpeg 7.1 and ffprobe 4.4.1; they are not bundled or installed by these changes.

## Browser integration

The local review server was opened in the Codex browser with a 1.2-second synthetic video. All nine mixed-density PNGs loaded; selecting frame 20 sought the player to measured PTS 0.666667 seconds. The link to contextual comments and back to the grid was present. Video metadata reported duration 1.2 seconds and ready state 4. This validates navigation/loading, not listening or perceptual sync.

## Repository checks

TypeScript production/test checks, build, lint (warnings only), generated JSX checks, generated tool docs and changed-file formatting pass. The aggregate `npm run check` stops at pre-existing formatting differences in ten unchanged files (including the review/storyboard HTML templates and existing documentation). Those unrelated files are deliberately preserved. The private-prototype server JSON check skips by repository design.

## Remaining native acceptance work

Test a disposable managed copy with actual footage/audio through start, disconnect, status and cancellation; test a deliberate render/template failure; inspect native text defaults, keyed normalized source replacement and curve-preserving retime; watch/listen to an entire representative sequence. Review 3D, mask resizing, expression-derived media and image sequences separately because the bounded workflows declare those unsupported/unknown. Until those checks are recorded, these additions remain a development candidate rather than a newly certified public release.
