# Security and privacy

Report vulnerabilities using GitHub's private vulnerability reporting when available. For ordinary bugs use Issues with a redacted Doctor report. Never upload credentials, connection tokens, state files or chats.

This is a local, experimental desktop integration. It provides no isolation from other programs running under the same Windows account. The collector binds only loopback, uses a random per-run token, rejects browser-origin writes and does not expose an HTTP approval endpoint.

Claude hooks forward only allowed metadata. Codex's local desktop pipe transmits full states; the streaming projection discards history/tool arguments and retains only bounded metadata. A missing source is unknown, never a fabricated success or inferred crash.

Approvals require the selected exact supported request. Ambiguous send outcomes remain locked across restarts; continue in the provider's chat. Stop checks a fresh matching turn marker, but the desktop interrupt RPC has no atomic turn-ID argument. Do not use the controls as a safety boundary for unattended high-impact work.

Setup modifies only its own plugin/profile plus its own entries in Claude settings. It checks changed settings and refuses junction-based development installs. Local backups can contain the user's original settings and must stay private. Download hashes detect corruption; they are not a code-signing certificate.

## Runtime dependencies

The SDK's transitive Zod version is pinned to 4.6.6 for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). The SDK uses the `zod/v4-mini` API; the bundled real-SDK tests are run with this override. Production dependency audit has no known vulnerabilities at preparation time.

The development-only Elgato CLI dependency chain reports moderate minimatch-related audit findings ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). The CLI/template generator is not included in the installed runtime and is used only with this repository's fixed local source paths. No unsupported major minimatch override or forced SDK downgrade is applied to hide the report. Recheck with `npm audit`; no claim of an entirely clean development dependency audit.

Supported beta scope: Windows + MK.2 + installed Claude/Codex desktop apps. The undocumented Codex pipe and desktop deep links may break after upstream updates. Unknown protocol versions fail closed.
