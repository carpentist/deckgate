# Security Policy

## Supported versions

Security fixes target the latest `0.1.x` release.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem. Use the repository's
GitHub Security Advisories ("Report a vulnerability" under the Security tab) so the
report can be handled privately.

Useful details: affected version, Windows version, reproduction steps, and whether
auto-approval or in-app approval was enabled.

## Threat model

Deckgate is a local-only companion, not a sandbox.

- It reads Claude Code hook events and session metadata from the current user's
  profile and stores summaries in a local SQLite database.
- The optional approval gate runs as the current user and communicates over a
  per-user named pipe guarded by a local token file. It deliberately falls back to
  the original terminal if the app is closed, unresponsive, or fails its heartbeat.
- In-app approval and auto-approval can allow tool calls that Claude Code would
  otherwise prompt for. Auto-approval is off by default and is a privileged mode.
- The command blacklist is a safety net, not a command sandbox. It cannot make an
  untrusted prompt or repository safe.
- The app does not send network requests and does not store prompts, full tool
  arguments, tool output, assistant replies, or credentials.

## Hardening recommendations

- Leave auto-approval off unless you fully trust the current project and task.
- Prefer per-project auto-approval over "all projects".
- Keep the app running and the heartbeat healthy; otherwise requests safely return
  to the terminal.
- Use a dedicated Windows user account for experiments with untrusted code.
- Treat the installer as unsigned software and verify the source/release you use.
