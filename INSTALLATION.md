# Installation

This setup has four independently versioned runtime pieces:

| # | Piece | Version/source | Installation role |
|---|---|---|---|
| 1 | Custom OpenCode | `1.18.31-internetisalie.2` | Headless OpenCode server with authenticated plugin HTTP routes |
| 2 | `opencode-pty` | `@internetisalie/opencode-pty@0.4.1` | PTY tools and process ownership |
| 3 | OpenCode PTY bridge | `@internetisalie/opencode-pty-bridge@0.1.0` | Loads piece 2 and exposes its read-only HTTP API |
| 4 | OpenChamber | `1.24.3-internetisalie.2` | Web/desktop host with built-in read-only **Agent PTYs** output |

Piece 2 is installed as a dependency of piece 3. Do not also register it in
OpenCode's plugin list; doing so creates duplicate `pty_*` tools.

## Requirements

- Linux x86-64.
- `gh`, `git`, `tar`, and `sha256sum`.
- Node.js 22 or newer and npm when installing the optional web server.
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
mkdir -p "$HOME/.local/lib/openchamber-internetisalie.2"
gh release download v1.24.3-internetisalie.2 \
  --repo internetisalie/openchamber \
  --pattern 'OpenChamber-1.24.3-internetisalie.2-linux-x86_64.tar.gz*' \
  --dir "$HOME/.local/lib/openchamber-internetisalie.2"
cd "$HOME/.local/lib/openchamber-internetisalie.2"
sha256sum -c OpenChamber-1.24.3-internetisalie.2-linux-x86_64.tar.gz.sha256
tar -xzf OpenChamber-1.24.3-internetisalie.2-linux-x86_64.tar.gz
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
exec "$HOME/.local/lib/openchamber-internetisalie.2/OpenChamber-1.24.3-internetisalie.2-linux-x86_64/openchamber" --disable-setuid-sandbox "$@"
EOF
chmod 755 "$HOME/.local/bin/openchamber-internetisalie"
```

`--disable-setuid-sandbox` disables only the setuid bootstrap layer. Chromium's
user-namespace and seccomp sandboxes remain active. Do not use `--no-sandbox`,
which disables Chromium's sandbox entirely.

### OpenChamber web service

The desktop tarball does not install the separately runnable web server.
Download the matching custom web package and SDK from the release, then install
both tarballs in one npm transaction. Installing only the web tarball makes npm
try to fetch the unpublished custom SDK version from the public registry.

```bash
mkdir -p "$HOME/.local/lib/openchamber-web-internetisalie.2"
gh release download v1.24.3-internetisalie.2 \
  --repo internetisalie/openchamber \
  --pattern 'openchamber-sdk-1.24.3-internetisalie.2.tgz' \
  --pattern 'openchamber-web-1.24.3-internetisalie.2.tgz' \
  --pattern 'openchamber-npm-packages-1.24.3-internetisalie.2.sha256' \
  --dir "$HOME/.local/lib/openchamber-web-internetisalie.2"
cd "$HOME/.local/lib/openchamber-web-internetisalie.2"
sha256sum -c openchamber-npm-packages-1.24.3-internetisalie.2.sha256
npm install --global --prefix "$HOME/.npm-global" \
  "$PWD/openchamber-sdk-1.24.3-internetisalie.2.tgz" \
  "$PWD/openchamber-web-1.24.3-internetisalie.2.tgz"
"$HOME/.npm-global/bin/openchamber" --version
```

The expected version is `1.24.3-internetisalie.2`. The release job packs both
packages with Bun so the web package's `workspace:*` SDK dependency is rewritten
to that exact version.

Set the same external OpenCode runtime used by the desktop launcher in
`~/.config/openchamber/startup.env`:

```ini
OPENCODE_HOST="http://127.0.0.1:4096"
OPENCODE_SKIP_START="true"
```

Create `~/.config/systemd/user/openchamber-internetisalie.service`:

```ini
[Unit]
Wants=opencode.service
After=opencode.service
Description=OpenChamber web server
After=network-online.target

[Service]
Type=simple
EnvironmentFile=-%h/.config/openchamber/startup.env
ExecStart=/usr/bin/node %h/.npm-global/lib/node_modules/@openchamber/web/bin/cli.js serve --foreground --port 3030
WorkingDirectory=%h
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

If a legacy `openchamber.service` is already enabled on this machine, stop and
disable it first so that only one process owns port 3030:

```bash
systemctl --user disable --now openchamber.service
```

Enable the custom service:

```bash
systemctl --user daemon-reload
systemctl --user enable --now openchamber-internetisalie.service
systemctl --user status openchamber-internetisalie.service --no-pager
curl --fail-with-body http://127.0.0.1:3030/health
```

If OpenChamber should manage its own OpenCode process instead, omit the two
variables from `startup.env` and select
`~/.local/bin/opencode-internetisalie` in OpenChamber's OpenCode CLI settings.
Do not use both modes simultaneously.

### Built-in Agent PTYs

OpenChamber `1.24.3-internetisalie.2` includes **Agent PTYs** in the work-status
panel, so no separate OpenChamber extension is required. Start OpenChamber, open
an OpenCode session, and create a PTY through the normal `pty_spawn` tool. The
section appears when the OpenCode PTY bridge is available. It can be reordered
or hidden with the other work-status sections.

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
session. The **Agent PTYs** work-status section should:

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
directory and updating the corresponding launcher or symlink. Download and
install the matching SDK and web release tarballs before restarting
`openchamber-internetisalie.service`. Upgrade pieces 2 and 3 with the one-shot
authenticated plugin command.

To hide the viewer, hide **Agent PTYs** in the work-status section settings. To
disable PTY tools and bridge routes, remove
`@internetisalie/opencode-pty-bridge` from OpenCode's plugin list and restart
OpenCode. The viewer owns no PTY process or persisted PTY data, so rollback
requires no migration.
