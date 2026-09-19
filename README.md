# openchamber-pty-bridge

Read-only OpenChamber integration for PTYs created by [`opencode-pty`](https://www.npmjs.com/package/opencode-pty).

## Installation boundary

Two separate integrations are required:

```text
OpenCode side:    opencode-pty-bridge
OpenChamber side: openchamber-pty-bridge
```

Install `opencode-pty-bridge` in OpenCode. It already loads `opencode-pty`, so do not register `opencode-pty` separately.

OpenChamber does not install or inject the OpenCode plugin. It detects the plugin through the authenticated OpenCode capability endpoint and uses the same configured runtime transport for managed and external OpenCode servers.

## Current host status

OpenChamber does not yet expose a third-party UI plugin host. The integration is therefore implemented as first-party code in the sibling `openchamber` checkout. This repository remains the package home, but it cannot provide an independently installable package until OpenChamber defines a versioned plugin-loading contract.

The first-party integration adds a **PTYs** section to the current session's Work Status panel. It filters sessions by the authoritative `parentSessionId` field and opens output in a read-only terminal viewer. It does not expose spawn, input, resize, kill, or cleanup controls.

## API contract

The integration consumes schema version 1 from:

```text
GET /api/plugins/opencode-pty-bridge
GET /api/plugins/opencode-pty-bridge/sessions
GET /api/plugins/opencode-pty-bridge/sessions/:id/output?after=<revision>
```

Only a `404` from the capability endpoint means the bridge is absent. Authentication, network, malformed-response, and server failures remain distinct from a successful empty PTY list.

The OpenCode-side bridge currently needs a release of `opencode-pty` containing `PTYSessionInfo.parentSessionId` before its published dependency can expose this contract.

## Installation

See [INSTALLATION.md](./INSTALLATION.md) for the local development stack, release order, end-user installation, verification, and rollback process. The runbook distinguishes commands that work from sibling checkouts today from the package installation path that becomes available after the required releases.
