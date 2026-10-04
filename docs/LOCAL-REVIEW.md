# Local contextual review

Create a review from an existing rendered video:

```sh
node dist/index.js review --video /absolute/path/preview.mp4 --out /absolute/path/new-review --comp "Delivery" --fps 30 --version "v3"
```

Open the printed `index.html` in a browser. Pause and click the picture for a spatial comment, click the timeline for an instant, or drag the timeline for a range. The contextual composer focuses the note field. IN/OUT previews and **Play range** help review the selected motion. The comment sidebar can be hidden. Export JSON for reimport or text to paste into the agent conversation.

For an agent preparing a review, a manifest gives exact source context:

```json
{
  "video": "preview.mp4",
  "compId": "known-composition-id",
  "compName": "Delivery",
  "fps": 30,
  "startFrame": 60,
  "version": "v3"
}
```

```sh
node dist/index.js review --manifest /absolute/path/review.json --out /absolute/path/new-review
```

Relative video paths resolve beside the manifest. `startFrame` identifies the source composition frame at video time zero. Without known composition, FPS or version, those values stay unbound; do not infer them. Frame labels round to the nearest frame at the supplied composition FPS. Use a preview that preserves composition timing/FPS. The source video digest identifies the actual reviewed artifact.

The command copies an existing video and creates a new directory; it never launches After Effects, renders, edits, or saves a project. Existing output directories are rejected. JSON import replaces this review's notes only after checking the matching context and valid times/coordinates. Browser storage is a convenience; download feedback before closing or sharing. Opening another local video clears composition/version/FPS binding. Feedback expresses requested changes, not authorization to mutate an original project: inspect current AE targets, save a project variant and verify the actual delivery composition before applying it.
