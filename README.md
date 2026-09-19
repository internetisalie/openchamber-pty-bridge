# OpenChamber PTY Bridge

A native, read-only OpenChamber extension for viewing PTYs created by
[`@internetisalie/opencode-pty`](https://github.com/internetisalie/opencode-pty).

The extension is installed from Git. It ships its browser bundle in
`panel/main.js` because OpenChamber does not install dependencies or compile an
extension during installation.

## Install

1. In OpenChamber `>=1.24.3`, open **Settings -> Extensions**.
2. Install `git@github.com:internetisalie/openchamber-pty-bridge.git`.
3. Review and approve its read-only OpenCode access.
4. Configure the separate OpenCode plugin in `opencode.json`:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["@internetisalie/opencode-pty-bridge@0.1.0"]
   }
   ```

`@internetisalie/opencode-pty-bridge` transitively loads
`@internetisalie/opencode-pty`. Do not register both packages, or OpenCode will
receive duplicate `pty_*` tools.

See [INSTALLATION.md](./INSTALLATION.md) for compatibility, verification, and
upgrade details.

## Security boundary

The manifest grants one OpenCode plugin ID, `opencode-pty-bridge`, and only the
`GET` method. OpenChamber supplies the configured runtime transport and
authentication to the host-side request; this extension never receives
credentials and never contacts a guessed localhost URL.

The UI can read only:

- bridge capability metadata;
- PTYs whose `parentSessionId` exactly matches the current OpenChamber session;
- output for the selected PTY.

It cannot spawn, write to, resize, kill, or clean up a PTY. Commands, arguments,
working directories, and output are never logged.

## Development

Requirements: Bun 1.3.14 and Node.js 22 or newer.

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run build
bun run validate:manifest
git diff --exit-code -- panel/main.js
```

The source intentionally uses `@openchamber/sdk` 1.24.2. That public SDK has
the UI kit and `connectHost`, but predates `openCodeRequest`. `src/protocol.ts`
therefore implements only the additive `opencode-request` call with the SDK's
exported channel, API version, timeout, path validation, and error semantics.

## Runtime behavior

The extension consumes OpenCode bridge schema version 1. It polls only while
its panel is visible, keeps the last successful data through transient errors,
and clears data when the current host session changes or the frame unloads.
Output is kept separately per PTY and bounded to a UTF-8-safe 512 KiB suffix.

Native OpenChamber extensions are currently supported by the web and desktop
applications only.

## License

MIT
