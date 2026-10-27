# Session recovery and edit verification

The production.2 local update addresses the startup/readback observations from 2026-10-27. It does not claim to have identified the cause of a resident scheduler stopping after its first tick.

## Official reconciliation

Run the configured plugin helper with `status`, then `reconcile` when recovery is needed:

```text
node <plugin-root>/scripts/bridge.mjs status
node <plugin-root>/scripts/bridge.mjs reconcile
```

The maintenance route is `node scripts/demo-session.mjs reconcile` from the configured checkout. Reconciliation never launches AE, opens a project, saves changes or automatically starts a second worker. Before updating a record it archives its exact old contents under `runtime/demo-session/session-history/`.

- A responding resident is adopted only after a nonce round-trip, a later advancing heartbeat, unchanged identity and an inspected project inside the recorded managed run folder. Unsaved project contents are preserved.
- An absent/stale resident is marked stopped only when the OS process list is available and no After Effects/aerender process is observed, checked twice. Starting a replacement remains a separate explicit action.
- A stale heartbeat with any running or unknown AE process preserves the record and refuses automatic reset. Process presence cannot safely identify which process belongs to an old registration. Busy/mismatched projects and concurrent record changes are also refused.

Do not delete or rewrite session.json to force a launch. If reconciliation refuses because AE is still present, inspect its windows and projects. A modal dialog or unrelated user instance must be handled in its actual context; stale metadata alone is insufficient.

## Readiness and diagnostics

`instance.start` waits for recurring heartbeats, performs a read-only nonce probe of the named resident, then requires another advancing heartbeat after the reply. The reply must match the instance ID and resident start time. A first tick alone is insufficient; failed startup leaves the managed session `startup-unconfirmed` with its failed phase and error. Do not start again on uncertainty.

`instance.probe` verifies an existing named resident with the same gate and never reconnects or launches it. `instance.list` and failed `ae_context(residentOnly:true)` include diagnostics that separate heartbeat state from OS process evidence. On macOS/Linux, a bounded process-name/PID scan can report AE/aerender processes without contacting AE. Window title, current project of an unregistered process, modal state and association to an old instance remain explicitly unknown. Heartbeat project paths are labeled as last observed, or stale rather than current. On macOS the launcher PID is no longer presented as the AE process PID.

The resident heartbeat adds its engine name and scheduler-armed state; tick exceptions also attempt a diagnostic heartbeat. These fields assist diagnosis, but are not proof that a modal/scheduler fault has been repaired. No automatic scripting-engine change or forced reconnection is introduced.

## Exact visibility readback

`ae_edit` now retains `enabled` in compact before/after results and asserts the requested boolean for `layer.set_enabled`. A native write silently leaving a different value produces failure, not verified success. Text and visibility edits on the same layer are verified independently. Every available result lists `verifiedEditIndexes` and `unverifiedEditIndexes`; failed readbacks preserve preceding verification and partial-operation evidence. Other unsupported exact assertions remain explicitly unverified rather than being counted as verified merely because the command returned.

## Validation boundary

Local regression run: **59 test files passed, 527 tests passed, one existing platform-specific test skipped**. Production/test typechecks and build passed; lint completed with warnings only.

Automated tests simulate a one-tick stall, a successful probe followed by a stalled heartbeat, process-list failure, a stale registration with a still-running AE process, safe archival/reconciliation and eight mixed text/visibility changes. An ignored enabled write fails its readback. These are offline/VM tests, not native acceptance. The installed plugin is checked through a fresh MCP connection and read-only process observations; client projects and active AE state are not changed by deployment or validation. The original scheduler/modal failure remains unconfirmed until reproduced on a disposable native session.
