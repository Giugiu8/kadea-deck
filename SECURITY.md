# Security and privacy

Report vulnerabilities using GitHub's private vulnerability reporting when available. For ordinary bugs use Issues with a redacted Doctor report. Never upload credentials, connection tokens, state files or chats.

This is a local, experimental desktop integration. It provides no isolation from other programs running under the same Windows account. The collector binds only loopback, uses a random per-run token and rejects browser-origin writes. HTTP cannot submit an approval: `/permission` holds a hook request until an exact selected Stream Deck decision or cancellation resolves it.

Version 0.8 includes the 0.7.1 fix, which authenticates the receiver before hooks send any token, event or quota metadata. A fresh challenge and HMAC-SHA256 proof use a separate per-start key that is never sent over HTTP. The subsequent request must reuse the proven TCP socket; a reconnect is refused. Permission replies carry another proof binding a fresh challenge, the request metadata, HTTP status and complete response body. Missing, modified or replayed proofs produce no hook decision. Identity checks have an absolute 900 ms deadline. The connection format is schema 2, so old hooks reject it instead of retaining the vulnerable transport. The local connection file contains both keys and must remain private; this does not protect against software that can read or change files under the same Windows account. Windows isolation relies on the directory's existing ACLs, not POSIX file mode bits.

The published Windows release `v0.7.0-beta.1` does not authenticate the receiver's permission replies. After a receiver crash, a local process can reuse its abandoned port and return a forged approval to the old hook. Keep Cardea's `PermissionRequest` hook disabled on unpatched installations. Both the plugin and the hook must be updated together; restarting only an old plugin is insufficient. Cross-Windows-account exploitation has not been practically verified, and no final severity rating is claimed.

Claude hooks forward only allowed metadata. Codex's local desktop pipe transmits full states; the streaming projection discards history/tool arguments and retains only bounded metadata. A missing source is unknown, never a fabricated success or inferred crash.

Approvals require the selected exact supported request. Ambiguous send outcomes remain locked across restarts; continue in the provider's chat. Stop checks a fresh matching turn marker, but the desktop interrupt RPC has no atomic turn-ID argument. Do not use the controls as a safety boundary for unattended high-impact work.

The normal plugin is installed by Stream Deck. Its explicit local setup changes only exact owned Claude hook commands; arbitrary paths and commands from the Property Inspector are rejected. Setup uses the bundled Node runtime, preserves foreign hooks and custom status lines, and requires the currently selected native inspector. Codex executables are resolved from the official Store package rather than a user-provided command path. The optional portable installer modifies only its own plugin/profile plus its own entries in Claude settings. It checks changed settings and refuses junction-based development installs. Local backups can contain the user's original settings and must stay private. Download hashes detect corruption; they are not a code-signing certificate.

## Runtime dependencies

The SDK's transitive Zod version is pinned to 4.6.6 for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). The SDK uses the `zod/v4-mini` API; the bundled real-SDK tests are run with this override. Production dependency audit has no known vulnerabilities at preparation time.

The development-only Elgato CLI dependency chain reports moderate minimatch-related audit findings ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). The CLI/template generator is not included in the installed runtime and is used only with this repository's fixed local source paths. No unsupported major minimatch override or forced SDK downgrade is applied to hide the report. Recheck with `npm audit`; no claim of an entirely clean development dependency audit.

Supported beta scope: Windows + MK.2 + installed Claude/Codex desktop apps. The undocumented Codex pipe and desktop deep links may break after upstream updates. Unknown protocol versions fail closed.
