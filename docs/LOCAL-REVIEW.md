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

## Send feedback to a local agent inbox

After creating a video review or storyboard, serve its generated directory:

```sh
node dist/index.js review-serve --dir /absolute/path/new-review
```

Keep that process running and open its printed loopback URL. **Send feedback** writes a context-validated receipt into that directory. It preserves the current preview and shows actual queued/processing/completed/failed status. Opening the HTML directly as a file still supports JSON export, but cannot submit to the local server. The generated session metadata and inbox are private files; the HTTP server serves supported preview assets only.

Sending queues feedback locally. It does not wake Codex or start AE automatically. In the user's Codex chat, invoke `$kynem` or `$kynem-storyboard` and ask it to process feedback from the exact review directory. The plugin agent uses its configured Node/checkout to read the inbox:

```sh
node dist/index.js review-inbox --dir /absolute/path/new-review
node dist/index.js review-ack --dir /absolute/path/new-review --id FEEDBACK_UUID --state processing --message "Inspecting requested change"
node dist/index.js review-ack --dir /absolute/path/new-review --id FEEDBACK_UUID --state completed --message "Saved reviewed variant" --preview latest.html
```

The inbox returns at most ten pending receipts by default (`--limit 1–50`), their exact source context/hash and pending count. `--id <receipt UUID>` reads one exact receipt, including its terminal state, for a native annotation handoff. Acknowledge each processed receipt and reread when `hasMore` is true. Use `failed` only for a real failure and describe it. `--preview` must be an existing supported filename directly inside the same directory; a new preview opens separately and does not silently replace the current feedback binding. Status is an agent acknowledgement, not automatic visual acceptance or a progress estimate. Pending new feedback remains queued even if an older receipt completes.

The listener binds only to 127.0.0.1. Writes require the matching origin, a per-process session token and exact package/video identity; notes and body size are bounded. No arbitrary output paths, HTTP AE mutation endpoints, external messages or cloud uploads are provided. Inbox/status writes use a bounded local lock. After a crashed writer, inspect a leftover `.review-lock` only once writers are stopped. Stop the server process when finished. Existing review directories created before session metadata was added must be regenerated into a new directory.

Repeated sends are incremental: exact retries return the existing receipt, and unchanged notes with the same stable note ID/content already queued, processing or completed are omitted from a new batch. Edited notes are new work. Failed notes are eligible for resubmission and are not silently discarded. Deduplication is scoped to this exact review context; it does not approve or apply changes.

## Handoff in the Codex browser

Open the loopback review URL in Codex's built-in browser. After **Send feedback** saves the local receipt, **Open in Codex** appears when the native annotation API is available. This second user action requests a native annotation attached to the visible preview, with the exact receipt, review directory and version identity. Review it and submit it from the native composer into the current conversation. The preview remains available while working.

KYNEM feature-detects `document.oai.annotation.request` and follows the [official Browser Annotation API](https://learn.chatgpt.com/docs/annotations-extensibility). Its accepted result acknowledges a request, not editor opening, message delivery or processing. A network save and native request use separate user actions to preserve the required live gesture. Changed notes require a new local save. Unsupported browsers retain local inbox/export; no extra authentication, thread creation, automatic message send or model turn is initiated by the page.
