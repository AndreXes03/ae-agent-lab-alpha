# Alpha.4 validation and boundaries

## Implemented

- Original strict declarative scene schema and compiler, frame-local scene concatenation, stack/grid/padding/alignment and constrained static connectors.
- Shared cubic/linear/hold motion evaluator, reduced frame samples, bounded native key counts and explicit limits on compilation work.
- Native text, shape and null-layer generation with stable identities; differential per-property updates; conflicts for changed manual values, parenting, keys and expressions; stale-state refusal; independent managed-copy validation, checkpoint, durable claim and status recovery.
- Immutable local baselines beside the copied project. AE comments contain only compact scene/node identities. Preserve baseline files with the project to retain managed updates; the native layers remain editable without KYNEM.
- Self-contained schematic HTML player, scrubbing/playback, no network assets, safe embedded scene data, immutable integrity-checked cache and cache hits that skip frame generation.
- Bounded scene JSON file input (`specPath`) and compact result receipts; local numeric property adjustment without model-side value arithmetic.

## Verification

Release checks: **457 tests passed, 113 skipped, 57 test files passed**. The skipped suites require native AE or platform-specific behavior. Source and test typechecks, build, lint (warnings only), formatting, and isolated installer/reinstall smoke checks passed.

TypeScript source/test checks, emitted-runtime VM tests, offline MCP registration/policy tests, player-script execution and shared-frame parity tests are exercised. Runtime tests cover creation, scoped update, manual conflicts, expression/key changes, stale snapshots and durable timeout recovery. The installer is tested in an isolated temporary home with a mock Codex executable; this verifies packaging and install wiring, not a new Mac's permissions or AE behavior.

No new native AE visual acceptance is claimed. The resident readiness probe returned `NO_INSTANCE`; no existing project was changed and no application was launched for these checks. Offline mocks cannot establish AE font fidelity, real property API behavior, motion blur or measured native speed/token savings.

## Explicit boundaries

- This is a bounded 2D compiler, not a React/CSS importer or a universal AE project round-trip format.
- Groups create native null hierarchies, not precompositions. Group opacity is unsupported. Sequence composition concatenates frame ranges and does not create native precomps or automatically design transitions.
- New managed scenes do not adopt or delete arbitrary existing layers. Existing projects continue to use the scoped editing tools. Removing managed nodes or changing an existing scene's FPS is refused rather than silently rewriting user work.
- Text uses explicit dimensions or supplied measured bounds; there is no automatic native text-measurement pass. Browser text metrics differ. Existing manual anchor adjustments are preserved.
- Connectors require compatible static endpoints in the same parent coordinate space. Animated or transformed endpoints outside these bounds are refused.
- Effects, masks, footage, 3D and expressions are outside the scene description. Existing typed AE operations can still edit them separately; the schematic player does not reproduce them.
- Native nonlinear motion uses reduced linear samples with 0.1 absolute component tolerance at integer frames, not guaranteed subframe/motion-blur equivalence or hand-authored Bézier handles.
- The cache is for schematic artifacts only. It does not capture AE RAM previews or cache native renders. Unknown dependency fingerprints disable reuse.
- Partial native failures have a checkpoint, not automatic rollback. Inspect status and project state before recovery; do not issue a new request ID to replay uncertain work.

No Remotion code or dependency is included. This implementation uses original code for general scene composition, timing and incremental update concepts.
