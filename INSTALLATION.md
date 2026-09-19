# Installation

Two independently configured components are required:

```text
OpenCode:    @internetisalie/opencode-pty-bridge@0.1.0
OpenChamber: git@github.com:internetisalie/openchamber-pty-bridge.git
```

The OpenCode plugin owns the PTY integration and authenticated HTTP routes. The
OpenChamber extension is only a read-only viewer.

## Requirements

- OpenChamber `>=1.24.3` with native Git extension support and the
  `contributes.openCode` host API.
- An OpenCode runtime compatible with
  `@internetisalie/opencode-pty-bridge@0.1.0`.
- GitHub SSH access from the machine running OpenChamber.
- OpenChamber web or desktop. Native extensions are not currently available on
  the VS Code or mobile surfaces.

Managed and external OpenCode runtimes use the same host-provided authenticated
transport. No extra port, callback listener, or browser-visible credential is
needed.

## OpenCode

Add only the bridge package to `opencode.json` or `opencode.jsonc`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@internetisalie/opencode-pty-bridge@0.1.0"]
}
```

Restart OpenCode after changing its plugin configuration. The bridge
transitively loads `@internetisalie/opencode-pty`; registering that package as a
second plugin creates duplicate `pty_*` tools and must be avoided.

## OpenChamber

1. Open **Settings -> Extensions**.
2. Choose the Git/SSH installation option.
3. Enter:

   ```text
   git@github.com:internetisalie/openchamber-pty-bridge.git
   ```

4. Confirm the extension identity **Agent PTYs**.
5. Approve read-only OpenCode access. The requested manifest grant is exactly
   `opencode-pty-bridge` with method `GET`.
6. Open an OpenCode session and select **Agent PTYs** from the context rail.

The Git repository is the installation unit. There is no npm package to install
for the OpenChamber side, and OpenChamber does not run `bun install` or build
the TypeScript source.

## Verify

Create a PTY through the normal `pty_spawn` OpenCode tool in the current
session. The panel should:

- show only PTYs whose `parentSessionId` exactly equals the current session ID;
- place running and killing PTYs before exited and killed PTYs;
- stream only the selected PTY's output;
- expose no input, resize, kill, cleanup, or spawn control.

Capability outcomes are deliberately distinct:

| Result | Meaning |
|---|---|
| `200` with schema version 1 | Bridge available |
| `404` from the capability request | OpenCode bridge absent |
| `401` or `403` | OpenCode authentication/authorization failure |
| malformed response, network failure, or `5xx` | Availability unknown |

A transient polling failure leaves the most recent successful session and
output state visible with a warning. Switching the host session or runtime
clears that state as the native host callbacks/frame lifecycle permit.

## Upgrade and rollback

Use **Settings -> Extensions** to fetch extension updates from Git. Keep the
OpenCode plugin version pinned when reproducibility matters.

To disable the viewer, disable or remove the Git extension in OpenChamber. To
disable PTY tools and bridge routes, remove
`@internetisalie/opencode-pty-bridge` from OpenCode's plugin list and restart
OpenCode. The viewer owns no PTY process or persisted PTY data, so rollback
requires no migration.
