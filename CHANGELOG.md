# Changelog

## 0.6.0 — 2026-11-02

First public experimental Windows release; GitHub tag `v0.6.0-beta.1`, Stream Deck version `0.6.0.0`.

### Added
- Prebuilt download with a fresh four-page MK.2 profile, local device binding and configurable neutral Apps page.
- Setup/check-only, backups, concurrent-settings guards, install rollback, targeted uninstall and private diagnostics.
- Property Inspector controls for chat slots, approval decision and Claude usage window.
- Isolated installer tests, release integrity hashes, license notices and Windows build checks.

### Changed
- Claude is the left navigation key, Codex follows it, on all pages.
- Discover Claude metadata directories instead of requiring one machine's package-family name.
- Preserve any existing custom Claude status line; do not execute a saved command or replace another plugin's hooks.
- Public artwork uses original vector symbols; no extracted application logos or private profiles.

### Fixed
- Codex catalog initialization failure closes its own child process so the next attempt can recover.
- Pin the patched Zod mini API dependency used by Elgato's SDK.

The existing working/unread/input/error colors, request-bound decisions and durable hashed approval journal are retained. No simulated security tasks are installed.
