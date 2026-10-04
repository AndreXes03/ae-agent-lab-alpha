/* Native browser handoff: user submission remains inside the Codex annotation composer.
 * https://learn.chatgpt.com/docs/annotations-extensibility */
(function () {
  const stable = (value) =>
    Array.isArray(value)
      ? "[" + value.map(stable).join(",") + "]"
      : value && typeof value === "object"
        ? "{" +
          Object.keys(value)
            .sort()
            .map((key) => JSON.stringify(key) + ":" + stable(value[key]))
            .join(",") +
          "}"
        : JSON.stringify(value);
  function available() {
    return typeof document.oai?.annotation?.request === "function";
  }
  function request({ target, session, receipt, payload, submittedPayload }) {
    if (!available())
      return {
        accepted: false,
        reason: "Native annotations unavailable; local feedback remains queued",
      };
    if (!receipt?.feedbackId || !session?.sessionId || stable(payload) !== stable(submittedPayload))
      return { accepted: false, reason: "Save the current feedback before opening it in Codex" };
    if (!target || target.isConnected === false || target.ownerDocument !== document)
      return { accepted: false, reason: "Select a visible preview in this page" };
    const context = session.context;
    const metadata = {
      reviewDir: session.reviewDir,
      sessionId: session.sessionId,
      receiptId: receipt.feedbackId,
      contextHash: session.contextHash,
      sourceIdentity:
        context.kind === "storyboard" ? context.manifestHash : context.review?.videoDigest,
      plugin: context.kind === "storyboard" ? "kynem-storyboard" : "kynem",
    };
    if (
      Object.values(metadata).some(
        (value) => typeof value !== "string" || !value || value.length > 256,
      ) ||
      new TextEncoder().encode(JSON.stringify(metadata)).length > 2048
    )
      return {
        accepted: false,
        reason: "Native handoff context exceeds supported limits; use the local inbox",
      };
    try {
      const result = document.oai.annotation.request(target, {
        mode: "default",
        metadata,
        initialComment:
          "Process this KYNEM feedback receipt in the current chat. Confirm the reviewed version, preserve unrelated work, and keep required approval before AE video production.",
      });
      return {
        accepted: result?.accepted === true,
        reason:
          result?.accepted === true
            ? "Annotation requested. Review and send it from the Codex composer; delivery is not yet confirmed."
            : "Annotation request declined; feedback remains queued locally",
      };
    } catch {
      return {
        accepted: false,
        reason: "Native annotation request failed; feedback remains queued locally",
      };
    }
  }
  globalThis.KynemCodexFeedback = { available, request };
})();
