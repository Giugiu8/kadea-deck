# Validation scope

The private predecessor was used on a real Windows Stream Deck MK.2. Its user confirmed provider navigation, the correct Claude chat, a blank Claude composer, the correct working Codex chat and Codex dictation. Those confirmations are not a blanket hardware approval of all commands.

The public 0.6.0 candidate retains that runtime and adds isolated coverage for:

- Fresh installation without copying an existing source profile or physical device ID.
- Preserving foreign Claude hooks/settings/statusline and keeping setup idempotent.
- Request/owner/revision/selection guards, durable ambiguous-send lockout, fresh snapshot and matching turn checks.
- Settings changes during preparation, rollback on partial copy failure, preserved Apps edits on upgrade, safe uninstall and junction refusal.
- Real SDK WebSocket rendering, real local hook/HTTP and protocol socket fixtures, bounded streaming history rejection and deep-link allowlists.

The 0.6.1 candidate passes 62 tests, including 13 installer cases. Installer fixtures use temporary synthetic profiles and a fake host lifecycle. They do not install into the real user's AppData or fabricate active agent sessions. The real release ZIP was also extracted and exercised through fresh install, upgrade and uninstall in a temporary Windows profile. Release verification includes the official Elgato validator and a production dependency audit without known vulnerabilities at preparation time.

A separate read-only reviewer reproduced and helped close exact-directory rollback, partial uninstall, shared-lock and failed-backup recovery defects. A bounded Opus consultation timed out without a verdict; it is not counted as approval.

An installation on a second physical PC and a complete hardware pass for approvals/Stop remain outstanding at first publication. There is no claim of macOS/Linux, every Stream Deck model, every desktop version or complete Micro parity. The release is explicitly a beta.
