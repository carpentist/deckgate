# Changelog

## 0.3.0 — 2026-11-25

Final scope for personal use.

- Replaced project-level auto-approval with a global approval master switch plus per-session auto-approval.
- Added per-session tool/command blacklists that can only tighten the global blacklist.
- Added permission-mode awareness: `auto`, `dontAsk`, `plan`, and `bypassPermissions` are left to Claude Code instead of being answered by Deckgate.
- Added a session-level auto badge, session policy controls in the detail view, and a tray action to stop all session auto-approval.
- Fixed permission notifications being suppressed for sessions that had not enabled auto-approval.
- Bumped the installed Hooks marker so existing installations are prompted to update the gate.

## 0.2.0 — 2026-11-11

First public release.

- Multi-session monitor for Claude Code CLI on Windows.
- Transparent, frameless mini deck: one card at a time, wheel switching, inline approvals.
- Optional in-app permission handling through a synchronous `PermissionRequest` gate.
- Local named-pipe bridge with heartbeat watchdog and fallback to the original terminal.
- Optional per-project or all-project auto-approval with tool/command blacklists and a tray kill switch.
- SQLite history, desktop notifications, sounds, tray menu, and hide-to-tray behavior.
- NSIS installer, data-preserving upgrades, and local data cleanup on real uninstall.
