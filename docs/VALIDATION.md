# Validation scope

## 0.9 (not released yet)

The test suite covers separate hook groups and consent, status-only operation, key-approval gating through real hook processes, the one-second hold through the real SDK socket, summaries and redaction, the decision log and its rotation, integrity failure through the real plugin process, exact ACLs on real NTFS folders read back from Windows, the managed-settings block and its behavior, byte-identical rebuilds from another path, and pinned workflows.

A real Claude Code run (headless, isolated folder) passed through the hooks in `args` form: status changes arrived, a `Read` outside the working folder reached the receiver with its path, and a `Bash` command returned no decision. Approval-key layouts were rendered in a browser engine at full and device size; the font on real hardware was not checked.

An earlier 0.9 build ran under real Stream Deck 7 on the development PC, through its development link: the plugin started under Stream Deck's Node 20, passed the integrity check, made its folder private and received real hook events. That was not a clean install of a release.

Three independent reviews (Codex and two fresh Claude instances) tested the candidate adversarially and for locked-down PCs; their findings were fixed. No allow without a held press on a bound request was found.

Not yet demonstrated: a run of the release workflow (it needs a pushed tag), the Linux rebuild job, a physical key pass with the hold, opening custom `claude://` links through `explorer.exe` on real hardware, an update by Stream Deck itself, and any run on a domain-joined, AppLocker or managed PC.

## 0.8 plugin installation

Version 0.8 packages the editable four-page MK.2 layout inside the normal `.streamDeckPlugin` and uses Stream Deck's Node runtime for local hook setup. The artifact verifier checks the exact public plugin allowlist, every packaged build-file hash, the standalone recovery helper and release checksums, a small file/image budget and absence of local state/logs. Profile-generation tests reproduce repeated-build accumulation and verify that a failed render retains the previous complete build.

On 2026-11-04 all 136 tests pass under the source-build Node.js runtime and Stream Deck's actual Node.js 20.20.2 executable. The added regression checks cover rapid inspector changes, completion after a selection change, invalid UTF-8 preservation and independent Codex setup with a custom Claude configuration. Claude Opus 5.5 at high effort independently reviewed the preceding 132-test candidate through the CLI and found no blocking security issue; its setup/recovery recommendations led to these additional fixes.

The native Property Inspector was opened in Stream Deck 7.6.0 on the original PC, and the generated profile was imported there with all four pages while the pre-existing Cardea profile remained present. That import exposed an unwanted default-profile flag; the generated profile now uses the null app assignment observed after clearing it in Stream Deck. The native SDK fixture exercises setup and removal through a selected inspector, preserving foreign settings, then tests the built hook's exact approval roundtrip. Separate tests reject stale inspector tokens, extra payload paths, approval-card setup and concurrent settings edits. These fixtures never approve a real Claude action.

Codex discovery was checked with Stream Deck's actual Node 20.20.2. Its native Windows canonical-path API is used because the JavaScript realpath walk returns EPERM inside WindowsApps on that runtime. After a complete host restart the original PC reports an authenticated receiver and connected Codex source. The new metadata cache is checked for one read of unchanged files and refresh after archive/title changes. This is not a measurement of the separate work PC's general responsiveness.

The standalone recovery helper is tested without a separate Node invocation. A second physical PC, a full physical approval/Stop pass and every Windows/Stream Deck update path remain outside the demonstrated scope.

## 0.7.1 security fix (included in 0.8)

The unreleased 0.7.1 candidate adds an actual receiver-subprocess crash and abandoned-port takeover fixture, response-authentication/replay/tampering tests against source and built hooks, per-start key rotation and legacy-key refusal. Identity tests cover metadata withholding, socket replacement after a valid identity proof, a trickling peer and a missing packaged helper. The SDK fixture sends a real built hook through the bundled receiver and an exact simulated Stream Deck key press. These tests never approve a real Claude action. Cross-Windows-account exploitation and a physical approval-button pass remain separate outstanding checks.

On 2026-11-04 the candidate passed 119 tests under the source-build Node.js runtime and all 119 under Stream Deck's bundled Node.js 20.20.2. Claude Opus 5.5 at high effort reviewed two iterations through the CLI, independently ran the then-current 118-test suite, and found no remaining blocking security issue in the second iteration. A subsequent Doctor regression brings the local total to 119. The ZIP passes isolated fresh install, upgrade and uninstall plus the official Elgato validator. These checks do not establish performance on a separate work PC.

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
