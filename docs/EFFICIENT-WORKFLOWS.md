# Efficient project edits

KYNEM can reduce repeated context and mechanical planning work. Smaller tool responses do not directly establish a credit saving: model choice, conversation length, images and correction attempts also affect usage. Measure successful edits, not just call count.

## Keep discovery scoped

- Inspect project identity once per edit/session boundary, then only the target comp and relevant layers. Recheck identity after opening a project, switching instances, or reconnecting.
- Ask `ae_catalog({ operations: ["keyframe.shift", "layer.info"] })` for the exact schemas needed. Use `detail: "summary"` to browse a category without every parameter description. Do not fetch the same schema repeatedly within a session.
- Use layer summaries or omit property trees until a property is relevant. Full readback remains necessary to preserve keyframes, interpolation or expressions being edited.
- Reuse documentation and stable IDs in the conversation. Reread mutable values before planning a dependent change; never use a stale cached project snapshot as mutation authority.

## Local stateful edits

Prefer `ae_workflow` for supported edits on the managed copied project. A retime request names only a numeric comp ID, layer indices, canonical property paths and the timing change. The bridge captures complete key state locally; the model does not need to copy key arrays back into a second tool call.

```json
{
  "request": {
    "action": "prepare",
    "recipe": "retime_properties",
    "copyPath": "/absolute/managed/run/copy.aep",
    "spec": {
      "comp": 42,
      "offsetFrames": 8,
      "tracks": [{ "layer": 2, "property": ["ADBE Transform Group", "ADBE Opacity"] }]
    }
  }
}
```

Review the returned summary, then call `ae_workflow` with `{"request":{"action":"apply","jobId":"<returned id>"}}`. Apply rechecks the captured state inside AE, saves a recovery checkpoint, edits and reads the changed properties back in one dispatch. A changed snapshot is rejected. These steps do not prove visual quality.

For text/logo variants use recipe `variants`, with `spec.compId`, `fields:[{key,kind:"text"|"logo",layerPath:[1-based indices]}]`, and `variants:[{name,values:{fieldKey:"text or absolute logo path"}}]`. Each output duplicates its reachable precomps; unrelated originals stay intact. Expressions, animated Source Text, mixed character styling and multiline source text are rejected; character-style inspection requires AE 24.3 or later. This is bounded substitution in an existing composition, not a motion-design template.

After a timeout call `status` with the **same job ID**. A permanent claim prevents that job from executing twice. `running` or `uncertain` is not permission to prepare and replay another job. The operation may have partially changed the copied project; inspect it and the recovery checkpoint. A journal prevents replay but does not provide transactional rollback.

## Preview before export

- Property-only verification needs no render. Do not automatically export a movie after a keyframe adjustment.
- When appearance matters, start with one or two representative frames in a single `ae_render_frame` call. Use a contact sheet when comparing several times; recapture only changed times.
- `preview:"half"` or `preview:"quarter"` experimentally requests lower resolution (maximum six frames). The tool restores the composition setting and reports actual PNG dimensions. AE may ignore this setting for PNG capture; inspect `previewWarning`. It can dirty the project and is disabled in read-only mode. Native speed savings are not yet verified.
- Keep the default color-managed conversion; raw output is not a reliable shortcut for judging color.
- Review motion through AE playback where available. The bridge does not currently retrieve AE's cached RAM preview. If playback cannot be inspected, report that limitation or render only the short affected interval for review.
- Export at delivery quality when requested. Draft stills are not proof of temporal smoothness, fine grain or final color quality.

## Reuse a deterministic recipe

The older, offline fallback `ae_workflow_plan` supports **retime_properties**: plan an offset or a time-scale around a pivot for several explicitly identified property tracks. Inputs must include `numKeys` and ALL key times from the same live readback; partial lists are rejected. Inputs must come from live readback; the planner does not contact AE and cannot prove the project is a copy.

Use it for whole-frame keyed properties without expressions. Do not round existing subframe key times to fit this recipe. Unsupported or unsafe inputs must be handled as a scoped manual operation or left unchanged.

The output contains expected key times and one `batch.run` with `stopOnError: true`, plus readback instructions. Apply it only to the verified saved copy after capturing the baseline. A batch reduces transport calls; it is **not a transaction** and does not automatically roll back a partial failure. Inspect results before retrying. Preserve interpolation and validate actual playback; native retiming preserves easing best-effort.

## Spend effort on the result

- Execute dependent AE operations sequentially in a batch; do not send parallel writes to one worker.
- Inspect representative before/after frames rather than a large frame dump. Timing, speed curves and transitions still need playback review.
- Stop when the requested edit is met; do not add unsolicited visual polish. At most two focused correction passes before reporting the remaining defect.
- End with the saved variant, concise change summary, preview and unresolved issue. Do not paste entire project dumps into the final answer.

## Evidence

Catalog response sizes are measured in `tests/catalog-efficiency.test.ts`. Recipe tests cover offline arithmetic and invalid inputs. These checks are not native AE acceptance and do not guarantee a percentage reduction in billed tokens or credits.
