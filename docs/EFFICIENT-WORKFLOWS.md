# Efficient project edits

KYNEM can reduce repeated context and mechanical planning work. Smaller tool responses do not directly establish a credit saving: model choice, conversation length, images and correction attempts also affect usage. Measure successful edits, not just call count.

## Keep discovery scoped

- Inspect project identity once per edit/session boundary, then only the target comp and relevant layers. Recheck identity after opening a project, switching instances, or reconnecting.
- Ask `ae_catalog({ operations: ["keyframe.shift", "layer.info"] })` for the exact schemas needed. Use `detail: "summary"` to browse a category without every parameter description. Do not fetch the same schema repeatedly within a session.
- Use layer summaries or omit property trees until a property is relevant. Full readback remains necessary to preserve keyframes, interpolation or expressions being edited.
- Reuse documentation and stable IDs in the conversation. Reread mutable values before planning a dependent change; never use a stale cached project snapshot as mutation authority.

## Fast interactive edits

For a known target, prefer `ae_edit`. It accepts up to 12 supported typed operations in one request and performs current-value reads, recovery checkpoint, edits and post-edit readback in **one AE dispatch**. Supported operations include text changes, transforms, layer properties/timing, effect parameters through `property.set`, work-area changes and keyframe edits. Unsupported operations use the existing scoped tools; raw code, render, project switching and process management are excluded.

At session start use `ae_context({detail:"compact",residentOnly:true})`. This confirms the selected resident worker actually answers. An unavailable resident fails before a push launch; return to the existing activation flow, preserving session conflicts. Keep that worker running and reuse it rather than restarting setup per edit.

For follow-up edits, `ae_inspect_targets` reads up to 16 requested layer/property targets in one call and returns short `target:` references. Example property path:

```json
{
  "compId": 42,
  "targets": [
    {
      "layerIndex": 2,
      "propertyPath": [{ "matchName": "ADBE Transform Group" }, { "matchName": "ADBE Opacity" }]
    }
  ]
}
```

Use a returned reference in a fast edit:

```json
{
  "request": {
    "action": "edit",
    "requestId": "4b0a4cd1-572d-4e82-9992-9ca6c584910a",
    "copyPath": "/absolute/managed/run/copy.aep",
    "edits": [
      {
        "operation": "property.set",
        "targetRef": "target:<returned UUID>",
        "args": { "value": 65 }
      }
    ]
  }
}
```

Generate a **new UUID for each intended edit**, not each network attempt. On retry or timeout, reuse the request ID or call `ae_edit({request:{action:"status",requestId:"<same UUID>"}})`. Status and repeated IDs do not dispatch a second edit. The stored result and checkpoint allow recovery; partial failure is not rolled back automatically.

References preserve identity, not cached values: AE rechecks the project, comp, stable layer ID/order, and property identity inside the edit call. Reordered/deleted or ambiguous targets are rejected. Duplicate sibling property match names are unsupported for reusable property references even with an explicit index; inspect again or use a separately verified explicit edit. No claim of mutable-value caching is made.

Responses are compact. `verification:"asserted"` means implemented postconditions passed; `readback_only` means the bridge read the result but did not assert every intended value. Neither establishes visual quality. The local receipt retains bounded readbacks; omitted values are explicitly marked as truncated. Fallback `ae_do` omits ambient context by default. Establish identity with `ae_context` first; request `includeContext:true` only when project/selection context must be refreshed.

Transport diagnostics separate `queueWaitMs` (local serialization wait) from `executionMs` (the entire transport call after dequeuing, including AE wait). These are not measurements of model reasoning. The fast-edit result also records AE-side elapsed time and call count. Current resident polling intervals are unchanged; first measure before tuning them.

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

## Scoped preservation checks and compact catalog caching

Use `ae_verify_targets` to capture only explicitly named canonical property paths before a change and compare the returned baseline ID afterwards. Supply a fixed `sampleTime`; the playhead is never used. Full selected keys, interpolation, easing, spatial tangents, expressions and source/timing data stay in server memory. Only fingerprints and changed fields reach the model. Missing/ambiguous properties and separated leaders fail. Baselines are bounded to 64 and do not survive a server restart; capture again before the next edit. `allowChanges:["sourcePath"]` permits a planned footage path replacement, never changed dimensions, source IDs, animation or layer identity. It is a preservation check, not a check that the new source was the requested file and not proof of visual quality.

Catalog responses return `cacheKey`. Reuse known schemas in the conversation; when refreshing the same lookup, send `ifNoneMatch` with its key. The key covers the full response including current policy. `notModified:true` means reuse the schema already acquired, not that AE/project state is unchanged. `query` is literal name/description filtering. Do not print complete tool-return wrappers twice; extract one representation. JSON whitespace is removed without truncating evidence or errors.

## Direction, temporal review and approved decisions

Work on one short movement/transition under the user's direction before extending a whole sequence. In `ae_motion_plan`, each fresh item may supply `motion` with `startFrame`, `durationFrames`, `positionOffset`, `scaleFrom`, `outInfluence`, `inInfluence`, Position speeds (px/s), and up to eight `positionWaypoints` with local `frameOffset`/relative `offset`/optional speed. Select these for the actual shot; do not mechanically apply a uniform ease to all layers. Defaults preserve the earlier simple reveals. Nonzero arrival speed followed by a static hold is not continuous motion: inspect the join and playback. Never replace existing animation using this fresh-layer planner.

Retain a short shot-specific direction note in the conversation: approved movement and interval, rejected behavior, intended change, and layers/properties that must remain unchanged. Preserve the user's decision instead of regenerating the whole treatment. This is conversational direction, not model training or a reusable preset.

For necessary temporal review, use `ae_do` operation `render.review` with comp, startFrame, exclusive endFrame, a new absolute movie outputPath and exact outputTemplate (optional renderTemplate) from `render.list_templates`. It renders only that <=10-second interval, keeps existing queue items out of the render and restores their flags, then removes its temporary item. Never claim quality from the completed flag: inspect the actual movie and verify its output fps/resolution. This version does not retrieve cached RAM previews or guarantee draft-resolution savings. Do not invoke it automatically after each edit.

Measure time to an approved movement as well as AE-side time, bridge call count and response bytes. Response bytes are not billed tokens. Report unverified native behavior separately from offline proof.
