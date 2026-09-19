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

## Linux binaries

Install the custom OpenCode binary independently:

```bash
mkdir -p "$HOME/.local/lib/opencode-internetisalie.2" "$HOME/.local/bin"
gh release download v1.18.31-internetisalie.2 \
  --repo internetisalie/opencode \
  --pattern opencode-linux-x64-baseline.tar.gz \
  --dir "$HOME/.local/lib/opencode-internetisalie.2"
tar -xzf "$HOME/.local/lib/opencode-internetisalie.2/opencode-linux-x64-baseline.tar.gz" \
  -C "$HOME/.local/lib/opencode-internetisalie.2"
ln -sfn "$HOME/.local/lib/opencode-internetisalie.2/opencode" \
  "$HOME/.local/bin/opencode-internetisalie"
```

Install OpenChamber independently from its GitHub-built tarball:

```bash
mkdir -p "$HOME/.local/lib/openchamber-internetisalie.1"
gh release download v1.24.3-internetisalie.1 \
  --repo internetisalie/openchamber \
  --pattern 'OpenChamber-1.24.3-internetisalie.1-linux-x86_64.tar.gz*' \
  --dir "$HOME/.local/lib/openchamber-internetisalie.1"
cd "$HOME/.local/lib/openchamber-internetisalie.1"
sha256sum -c OpenChamber-1.24.3-internetisalie.1-linux-x86_64.tar.gz.sha256
tar -xzf OpenChamber-1.24.3-internetisalie.1-linux-x86_64.tar.gz
mkdir -p "$HOME/.local/bin"
test ! -L "$HOME/.local/bin/openchamber-internetisalie" || \
  unlink "$HOME/.local/bin/openchamber-internetisalie"
cat > "$HOME/.local/bin/openchamber-internetisalie" <<'EOF'
#!/bin/sh
exec "$HOME/.local/lib/openchamber-internetisalie.1/OpenChamber-1.24.3-internetisalie.1-linux-x86_64/openchamber" --disable-setuid-sandbox "$@"
EOF
chmod 755 "$HOME/.local/bin/openchamber-internetisalie"
```

The launcher disables only Chromium's setuid bootstrap sandbox and uses the
kernel's unprivileged user-namespace and seccomp sandboxes instead. Verify that
`unshare --user --map-root-user true` succeeds before using it. On Ubuntu,
`kernel.apparmor_restrict_unprivileged_userns` must be `0` or an appropriate
AppArmor profile must permit the application. Do not use `--no-sandbox`, which
disables Chromium's sandbox entirely.

In OpenChamber's OpenCode CLI settings, select
`~/.local/bin/opencode-internetisalie`. The packaged stock OpenCode CLI remains
only as a fallback and does not override this explicit setting.

## OpenCode

Configure npm for GitHub Packages:

```ini
@internetisalie:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Use the token only for a one-shot package installation. This command installs
the package into OpenCode's versioned cache and adds it to the global config:

```bash
NODE_AUTH_TOKEN="$(gh auth token)" \
  opencode-internetisalie plugin @internetisalie/opencode-pty-bridge@0.1.0 --global
```

Do not set `NODE_AUTH_TOKEN` in a long-running OpenCode systemd service. Once
the package is cached, start OpenCode normally without the token so agents and
their subprocesses cannot inherit it. Repeat the one-shot command when changing
the pinned bridge version.

The resulting `opencode.json` or `opencode.jsonc` entry is:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@internetisalie/opencode-pty-bridge@0.1.0"]
}
```

Restart OpenCode after installation. The bridge
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
