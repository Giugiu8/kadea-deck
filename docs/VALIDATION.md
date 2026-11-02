# Validation scope

The private predecessor was used on a real Windows Stream Deck MK.2. Its user confirmed provider navigation, the correct Claude chat, a blank Claude composer, the correct working Codex chat and Codex dictation. Those confirmations are not a blanket hardware approval of all commands.

The public beta retains that runtime and adds isolated coverage for:

- Fresh installation without copying an existing source profile or physical device ID.
- Preserving foreign Claude hooks/settings/statusline and keeping setup idempotent.
- Request/owner/revision/selection guards, durable ambiguous-send lockout, fresh snapshot and matching turn checks.
- Settings changes during preparation, rollback on partial copy failure, preserved Apps edits on upgrade, safe uninstall and junction refusal.
- Real SDK WebSocket rendering, real local hook/HTTP and protocol socket fixtures, bounded streaming history rejection and deep-link allowlists.

Installer fixtures use temporary synthetic profiles and a fake host lifecycle. They do not install into the real user's AppData or fabricate active agent sessions. The release ZIP is also extracted and exercised through fresh install, upgrade and uninstall in a temporary Windows profile. Release verification includes the official Elgato validator and a production dependency audit without known vulnerabilities at preparation time.

Version 0.7 additionally covers the complete Cardea namespace migration: managed-install receipts, dual installation locks, rollback, preservation of the ambiguous-send journal, fresh connection tokens, old-hook removal, and refusal of mixed or source-linked installations. English artwork is checked visually. Customized actions and images are preserved during migration.

The 0.7.0 candidate passes 74 tests. Its SDK integration also passes under Stream Deck's actual bundled Node.js 20.20.2. The existing development installation on the original MK.2 PC was migrated to 0.7.0: the receiver is healthy, Claude state is retained, the Codex pipe is connected, and Apps bindings and the personal status line are preserved. A cross-drive development-junction startup failure was reproduced, then fixed by creating the SDK log directory through the real build path. Release packaging uses an explicit plugin-file allowlist to exclude runtime logs and diagnostics.

A separate read-only reviewer reproduced and helped close exact-directory rollback, partial uninstall, shared-lock and failed-backup recovery defects. A bounded Opus consultation timed out without a verdict; it is not counted as approval.

An installation on a second physical PC and a complete hardware pass for approvals/Stop remain outstanding at first publication. There is no claim of macOS/Linux, every Stream Deck model, every desktop version or complete Micro parity. The release is explicitly a beta.
