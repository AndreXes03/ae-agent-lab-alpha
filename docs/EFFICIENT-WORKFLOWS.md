# Efficient project edits

KYNEM can reduce repeated context and mechanical planning work. Smaller tool responses do not directly establish a credit saving: model choice, conversation length, images and correction attempts also affect usage. Measure successful edits, not just call count.

## Keep discovery scoped

- Inspect project identity once per edit/session boundary, then only the target comp and relevant layers. Recheck identity after opening a project, switching instances, or reconnecting.
- Ask `ae_catalog({ operations: ["keyframe.shift", "layer.info"] })` for the exact schemas needed. Use `detail: "summary"` to browse a category without every parameter description. Do not fetch the same schema repeatedly within a session.
- Use layer summaries or omit property trees until a property is relevant. Full readback remains necessary to preserve keyframes, interpolation or expressions being edited.
- Reuse documentation and stable IDs in the conversation. Reread mutable values before planning a dependent change; never use a stale cached project snapshot as mutation authority.

## Reuse a deterministic recipe

`ae_workflow_plan` currently supports **retime_properties**: plan an offset or a time-scale around a pivot for several explicitly identified property tracks. Inputs must include `numKeys` and ALL key times from the same live readback; partial lists are rejected. Inputs must come from live readback; the planner does not contact AE and cannot prove the project is a copy.

Use it for whole-frame keyed properties without expressions. Do not round existing subframe key times to fit this recipe. Unsupported or unsafe inputs must be handled as a scoped manual operation or left unchanged.

The output contains expected key times and one `batch.run` with `stopOnError: true`, plus readback instructions. Apply it only to the verified saved copy after capturing the baseline. A batch reduces transport calls; it is **not a transaction** and does not automatically roll back a partial failure. Inspect results before retrying. Preserve interpolation and validate actual playback; native retiming preserves easing best-effort.

## Spend effort on the result

- Execute dependent AE operations sequentially in a batch; do not send parallel writes to one worker.
- Inspect representative before/after frames rather than a large frame dump. Timing, speed curves and transitions still need playback review.
- Stop when the requested edit is met; do not add unsolicited visual polish. At most two focused correction passes before reporting the remaining defect.
- End with the saved variant, concise change summary, preview and unresolved issue. Do not paste entire project dumps into the final answer.

## Evidence

Catalog response sizes are measured in `tests/catalog-efficiency.test.ts`. Recipe tests cover offline arithmetic and invalid inputs. These checks are not native AE acceptance and do not guarantee a percentage reduction in billed tokens or credits.
