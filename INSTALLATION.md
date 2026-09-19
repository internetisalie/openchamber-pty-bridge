# Installation process

The integration crosses four separately released components. Installing only
one package is not sufficient:

```text
OpenCode -> loads opencode-pty-bridge -> loads opencode-pty
        -> exposes authenticated HTTP -> consumed by OpenChamber
```

`opencode-pty-bridge` runs inside OpenCode. The OpenChamber viewer currently
runs as first-party OpenChamber code because OpenChamber has no third-party UI
plugin host. There is no separate `openchamber-pty-bridge` package to install
yet.

## Compatibility gates

The published installation path must not be advertised as ready until all of
these versions exist:

| Component | Required capability | Current status |
|---|---|---|
| `opencode-pty` | `PTYSessionInfo.parentSessionId` in its public and runtime session records | Present in the sibling checkout; newer than published `0.4.0` |
| OpenCode | Plugin `http.fetch` hook and authenticated `/api/plugins/:id/*` routing | Unreleased; the final minimum version is not known yet |
| `opencode-pty-bridge` | Dependency on the released `opencode-pty` version and the final OpenCode engine requirement | Package `0.1.0` is not published yet |
| OpenChamber | First-party PTY viewer and a bundled or external compatible OpenCode server | Present in the sibling checkout; not released yet |
| `openchamber-pty-bridge` | Versioned OpenChamber UI plugin host | Not available; this repository is documentation/package ownership only |

The current `opencode-pty-bridge` metadata says OpenCode `>=1.18.31`, but that
release does not contain the HTTP plugin host. Replace that constraint with the
actual host release before publishing.

## Local development stack

This workflow is for validating all sibling checkouts before the packages and
applications are released. It assumes Bun `1.3.14` and Node.js 22 or newer.

### 1. Build and link `opencode-pty`

```bash
cd /path/to/opencode-pty
bun install --frozen-lockfile
bun run typecheck
bun run unittest
bun run build:prod
bun link
```

`bun link` registers the checkout under its package name. It does not publish
anything.

### 2. Build `opencode-pty-bridge` against the checkout

```bash
cd /path/to/opencode-pty-bridge
bun install --frozen-lockfile
bun link --no-save opencode-pty
bun run typecheck
bun run test
bun run build
```

Run `bun link --no-save opencode-pty` after `bun install`; `--no-save` keeps the
local path out of the publishable manifest and lockfile. A later install can
replace the link with the registry dependency from the lockfile.

### 3. Start a compatible OpenCode checkout

The OpenCode checkout must already contain the plugin HTTP host. Point it at the
built bridge module:

```bash
cd /path/to/opencode
bun install --frozen-lockfile
OPENCODE_CONFIG_CONTENT='{"plugin":["file:///absolute/path/to/opencode-pty-bridge/dist/index.js"]}' \
  bun dev serve --port 4096
```

Use an absolute `file://` URL. Do not also configure `opencode-pty`; the bridge
loads it and duplicate registration would create duplicate `pty_*` tools.

### 4. Start OpenChamber against that server

In another terminal:

```bash
cd /path/to/openchamber
bun install --frozen-lockfile
OPENCODE_HOST=http://127.0.0.1:4096 \
OPENCODE_SKIP_START=true \
  bun run dev
```

This external-server mode is required until OpenChamber bundles a compatible
OpenCode release. It also ensures the OpenChamber proxy and the UI observe the
same OpenCode process that loaded the local bridge.

### 5. Verify the stack

For an unauthenticated localhost development server, the capability probe
should return schema version 1:

```bash
curl --fail --show-error http://127.0.0.1:4096/api/plugins/opencode-pty-bridge
```

Then create a PTY through the `opencode-pty` tools in an OpenCode session and
check that OpenChamber shows it under **Work Status -> Agent PTYs** for that
session. Opening the row must show output but must not allow terminal input,
resize, kill, or cleanup.

When authentication is enabled, use the runtime's normal authenticated client
instead of placing credentials in the URL or shell history.

## Release process

The release owner should complete these gates in order:

1. Release `opencode-pty` with `parentSessionId` in `PTYSessionInfo` and in the
   runtime value returned by `manager.list()`.
2. Release OpenCode with the typed plugin HTTP hook and authenticated plugin
   route dispatch.
3. Update `opencode-pty-bridge` to the released `opencode-pty` version and the
   actual minimum OpenCode version. Regenerate its lockfile.
4. Run `bun install --frozen-lockfile`, `bun run typecheck`, `bun run test`, and
   `bun run build` in `opencode-pty-bridge`.
5. Inspect the bridge package with `npm pack --dry-run`. The archive must contain
   `dist/index.js`, declarations, source maps if intended, `package.json`, and
   the README, but no source checkout or local link.
6. Publish `opencode-pty-bridge` and verify installation from the registry in a
   clean OpenCode configuration.
7. Update OpenChamber's SDK and bundled OpenCode CLI to the compatible OpenCode
   version, then run its cross-runtime test, type-check, lint, and build gates.
8. Release the applicable OpenChamber applications: Web/CLI, Desktop, and any
   other surface that should expose the first-party viewer.
9. Repeat the capability, session filtering, output, authentication failure,
   runtime switch, and read-only UI checks against release artifacts rather
   than sibling source trees.

Do not publish `openchamber-pty-bridge` as an empty or pass-through package. A
package becomes meaningful only after OpenChamber defines a versioned UI plugin
loading contract.

## End-user installation

After the compatibility gates are released:

End users install two applications, OpenCode and OpenChamber, but configure
only one plugin package. OpenCode installs `opencode-pty` transitively through
`opencode-pty-bridge`.

1. Install a compatible OpenCode application using its official installer:

   ```bash
   curl -fsSL https://opencode.ai/install | bash
   ```

   A package-manager installation such as `npm install -g opencode-ai@latest`
   is also supported. Confirm that the installed release meets the bridge's
   final OpenCode requirement.
2. Add the bridge to `opencode.json` or `opencode.jsonc`, preferably pinned to a
   known compatible version:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["opencode-pty-bridge@0.1.0"]
   }
   ```

3. Restart OpenCode so it installs and loads the plugin.
4. Install a compatible OpenChamber application. For the Web/CLI release:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/openchamber/openchamber/main/scripts/install.sh | bash
   ```

   The equivalent package-manager installation is `bun add -g @openchamber/web`.
   Desktop users should install a release that bundles the compatible OpenCode
   version or connect it to a compatible external OpenCode server.

5. Start OpenChamber and verify the capability and UI behavior described above.

There is no second OpenChamber-side package command. Installing
`openchamber-pty-bridge` would imply a plugin host that does not exist.

## Upgrade and rollback

- Upgrade in dependency order: `opencode-pty`, OpenCode,
  `opencode-pty-bridge`, then OpenChamber.
- Pin the bridge version in `opencode.json` when reproducibility matters.
- To disable the integration, remove `opencode-pty-bridge` from the OpenCode
  plugin list and restart OpenCode. OpenChamber treats the capability `404` as
  absence and hides the PTY section.
- A bridge failure does not own PTY lifecycle or persisted application data, so
  rollback requires no data migration. PTY tools remain unavailable if the
  bridge was the component registering `opencode-pty`.
- Authentication, network, server, and malformed-response failures are not
  absence. Resolve or roll back the failing component instead of interpreting
  an error as an empty PTY list.
