# Installation

This setup has five independently versioned runtime pieces:

| # | Piece | Version/source | Installation role |
|---|---|---|---|
| 1 | Custom OpenCode | `1.18.31-internetisalie.2` | Headless OpenCode server with authenticated plugin HTTP routes |
| 2 | `opencode-pty` | `@internetisalie/opencode-pty@0.4.1` | PTY tools and process ownership |
| 3 | OpenCode PTY bridge | `@internetisalie/opencode-pty-bridge@0.1.0` | Loads piece 2 and exposes its read-only HTTP API |
| 4 | OpenChamber | `1.24.3-internetisalie.1` | Web/desktop extension host and scoped OpenCode proxy |
| 5 | OpenChamber PTY bridge | `git@github.com:internetisalie/openchamber-pty-bridge.git` | Read-only **Agent PTYs** panel |

Piece 2 is installed as a dependency of piece 3. Do not also register it in
OpenCode's plugin list; doing so creates duplicate `pty_*` tools.

## Requirements

- Linux x86-64.
- `gh`, `git`, `tar`, and `sha256sum`.
- GitHub SSH access from the machine running OpenChamber.
- A GitHub token with `read:packages`; the existing `gh` login may provide it.
- OpenChamber web or desktop. Native extensions are not available in VS Code or
  mobile.

## 1. Install custom OpenCode

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
"$HOME/.local/bin/opencode-internetisalie" --version
```

The expected version is `1.18.31-internetisalie.2`.

## 2-3. Install the OpenCode plugins

Configure the GitHub Packages registry in `~/.npmrc`. Keep the environment
variable reference literal; do not put the token value in this file.

```ini
@internetisalie:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

Use the token only in this one-shot installer process:

```bash
NODE_AUTH_TOKEN="$(gh auth token)" \
  "$HOME/.local/bin/opencode-internetisalie" \
  plugin @internetisalie/opencode-pty-bridge@0.1.0 --global
```

The command installs both packages into OpenCode's versioned package cache and
adds only the bridge to `~/.config/opencode/opencode.jsonc`. The resulting plugin
entry is:

```json
{
  "plugin": ["@internetisalie/opencode-pty-bridge@0.1.0"]
}
```

Remove any separate `opencode-pty` entry. Other existing plugins and settings
can remain.

### OpenCode systemd service

Create `~/.config/systemd/user/opencode.service`:

```ini
[Unit]
Description=OpenCode Headless Server
After=network-online.target

[Service]
Type=simple
ExecStart=%h/.local/bin/opencode-internetisalie serve --hostname 127.0.0.1 --port 4096 --print-logs
WorkingDirectory=%h
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Do not put `NODE_AUTH_TOKEN` in this service, an `Environment=` directive, or
an `EnvironmentFile=` loaded by it. OpenCode and agent-created subprocesses
inherit the service environment. The cached package loads without the token.

```bash
systemctl --user daemon-reload
systemctl --user enable opencode.service
systemctl --user restart opencode.service
systemctl --user status opencode.service --no-pager
```

Restarting OpenCode interrupts active sessions, so run the restart when that is
safe. Repeat the one-shot plugin command before restarting whenever the pinned
bridge version changes.

## 4. Install OpenChamber

```bash
mkdir -p "$HOME/.local/lib/openchamber-internetisalie.1"
gh release download v1.24.3-internetisalie.1 \
  --repo internetisalie/openchamber \
  --pattern 'OpenChamber-1.24.3-internetisalie.1-linux-x86_64.tar.gz*' \
  --dir "$HOME/.local/lib/openchamber-internetisalie.1"
cd "$HOME/.local/lib/openchamber-internetisalie.1"
sha256sum -c OpenChamber-1.24.3-internetisalie.1-linux-x86_64.tar.gz.sha256
tar -xzf OpenChamber-1.24.3-internetisalie.1-linux-x86_64.tar.gz
```

### Linux sandbox and launcher

The tarball's `chrome-sandbox` cannot retain root ownership when extracted by
an ordinary user. This installation uses Chromium's user-namespace sandbox
instead of its setuid bootstrap helper. Confirm that user namespaces work:

```bash
sysctl kernel.apparmor_restrict_unprivileged_userns
sysctl kernel.unprivileged_userns_clone
unshare --user --map-root-user true
```

The first value must be `0`, the second must be `1`, and `unshare` must exit
successfully. Then install a launcher that also connects OpenChamber to the
systemd-managed OpenCode server:

```bash
mkdir -p "$HOME/.local/bin"
test ! -L "$HOME/.local/bin/openchamber-internetisalie" || \
  unlink "$HOME/.local/bin/openchamber-internetisalie"
cat > "$HOME/.local/bin/openchamber-internetisalie" <<'EOF'
#!/bin/sh
export OPENCODE_HOST="${OPENCODE_HOST:-http://127.0.0.1:4096}"
export OPENCODE_SKIP_START="${OPENCODE_SKIP_START:-true}"
exec "$HOME/.local/lib/openchamber-internetisalie.1/OpenChamber-1.24.3-internetisalie.1-linux-x86_64/openchamber" --disable-setuid-sandbox "$@"
EOF
chmod 755 "$HOME/.local/bin/openchamber-internetisalie"
```

`--disable-setuid-sandbox` disables only the setuid bootstrap layer. Chromium's
user-namespace and seccomp sandboxes remain active. Do not use `--no-sandbox`,
which disables Chromium's sandbox entirely.

For OpenChamber web/server, set the same external runtime in
`~/.config/openchamber/startup.env`:

```ini
OPENCODE_HOST="http://127.0.0.1:4096"
OPENCODE_SKIP_START="true"
```

If OpenChamber should manage its own OpenCode process instead, omit those two
variables and select `~/.local/bin/opencode-internetisalie` in OpenChamber's
OpenCode CLI settings. Do not use both modes simultaneously.

## 5. Install the OpenChamber extension

1. Start OpenChamber with `openchamber-internetisalie`.
2. Open **Settings -> Extensions**.
3. Choose the Git/SSH installation option.
4. Enter `git@github.com:internetisalie/openchamber-pty-bridge.git`.
5. Confirm the extension identity **Agent PTYs**.
6. Approve the requested `opencode` capability. Its scope is exactly plugin ID
   `opencode-pty-bridge` with method `GET`.
7. Open an OpenCode session and select **Agent PTYs** from the right-hand context
   rail.

The Git repository is the installation unit. OpenChamber does not run
`bun install` or build the extension source.

## Verify

Verify the custom runtime and bridge directly:

```bash
curl --fail-with-body http://127.0.0.1:4096/global/health
curl --fail-with-body http://127.0.0.1:4096/api/plugins/opencode-pty-bridge/
curl --fail-with-body http://127.0.0.1:4096/api/plugins/opencode-pty-bridge/sessions
```

If the OpenCode server has password authentication enabled, add its normal
Basic authentication options to these requests rather than disabling auth.

Create a PTY through the normal `pty_spawn` OpenCode tool in the current
session. The **Agent PTYs** panel should:

- show only PTYs whose `parentSessionId` exactly equals the current session ID;
- place running and killing PTYs before exited and killed PTYs;
- stream only the selected PTY's output;
- expose no input, resize, kill, cleanup, or spawn control.

Capability outcomes are deliberately distinct:

| Result | Meaning |
|---|---|
| `200` with schema version 1 | Bridge available |
| `404` | OpenCode bridge absent |
| `401` or `403` | OpenCode authentication or authorization failure |
| malformed response, network failure, or `5xx` | Availability unknown |

## Upgrade and rollback

Upgrade pieces 1 and 4 by installing their new release into a new versioned
directory and updating the corresponding launcher or symlink. Upgrade pieces 2
and 3 with the one-shot authenticated plugin command. Upgrade piece 5 from
**Settings -> Extensions**.

To disable the viewer, disable or remove the Git extension in OpenChamber. To
disable PTY tools and bridge routes, remove
`@internetisalie/opencode-pty-bridge` from OpenCode's plugin list and restart
OpenCode. The viewer owns no PTY process or persisted PTY data, so rollback
requires no migration.
