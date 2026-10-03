# Studio.4 validation — 2026-10-03

Offline replay of the four-operation Cooldent lookup (`footage.replace`, `item.set_props`, `render.add_to_queue`, `render.set_output`):

| Text representation                             | UTF-8 bytes |
| ----------------------------------------------- | ----------: |
| Previous pretty JSON payload                    |        5656 |
| New compact payload, including schema cache key |        3852 |
| Same lookup with matching cache key             |         108 |

Compact response is 31.9% smaller in this case. Unchanged refresh is 97.2% smaller than the new full lookup. These are text-response bytes, **not billed tokens**, not total-context measurements, and not native AE speed measurements. Both MCP text and structured forms remain available; client presentation determines what reaches a model. Reusing schemas already held in context is preferable to sending even a cache refresh when nothing requires it.

## Checks

- Build, TypeScript application/test checks, lint, formatting, generated ExtendScript checks, server metadata and generated tool documentation pass.
- 50 test files: 422 passing, 113 skipped. Skipped suites are native/session-mutating AE tests and a platform-specific case; no native acceptance claimed.
- New cases execute generated readback/review code in an offline AE-shaped fixture: actual key mutation versus cursor movement, missing/ambiguous properties, identity/dimension guards, baseline lifecycle, compact cached schemas, explicit context, isolated render-queue state restoration, and directed motion timing/waypoints.
- Sandboxed installer smoke verifies installation, a repeated run, paths containing spaces, and existing session preservation. It does not install into the user's live environment.

## Remaining native verification

Measure time to first approved motion on a disposable copied project; record AE version, exact input/output projects, calls and rendered review movie. Verify local output templates, output FPS, easing/waypoint playback and actual review-queue restoration. Scoped verification baselines are local and bounded, and deliberately expire on server restart. No speedup, aesthetic success or professional-motion quality is inferred from offline test success.
