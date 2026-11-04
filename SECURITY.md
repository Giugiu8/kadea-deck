# Security and privacy

Report vulnerabilities using GitHub's private vulnerability reporting when available. For ordinary bugs use Issues with a redacted Doctor report. Never upload credentials, connection tokens, state files or chats.

**[THREAT-MODEL.md](THREAT-MODEL.md)** describes what is protected and what is not, which data flows where, and how to remove the software. [docs/REPRODUCE.md](docs/REPRODUCE.md) explains how to verify a release, [docs/MANAGED-SETTINGS.md](docs/MANAGED-SETTINGS.md) how to deploy it centrally. This is an experimental local desktop integration. It provides no isolation from other programs under the same Windows account.

## Affected versions

The published Windows release `v0.7.0-beta.1` does not authenticate the receiver's permission replies. After a receiver crash, a local process can reuse its abandoned port and return a forged approval to the old hook. Keep Cardea's `PermissionRequest` hook disabled on unpatched installations. Both the plugin and the hook must be updated together; restarting only an old plugin is insufficient. Cross-Windows-account exploitation has not been practically verified, and no final severity rating is claimed.

Version 0.8 authenticates the receiver before hooks send anything. The connection format is schema 2, so old hooks reject it instead of keeping the vulnerable transport.

Version 0.9 changes defaults. Key approvals are off until opted in, and an approval hook left by an earlier version stays inactive until then. **Set up Claude** removes it unless consent is on record.

## Runtime dependencies

The SDK's transitive Zod version is pinned to 4.6.6 for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). The SDK uses the `zod/v4-mini` API; the bundled real-SDK tests are run with this override. Production dependency audit has no known vulnerabilities at preparation time.

The development-only Elgato CLI dependency chain reports moderate minimatch-related audit findings ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). The CLI/template generator is not included in the installed runtime and is used only with this repository's fixed local source paths. No unsupported major minimatch override or forced SDK downgrade is applied to hide the report. Recheck with `npm audit`; no claim of an entirely clean development dependency audit.

Supported beta scope: Windows + MK.2 + installed Claude/Codex desktop apps. The undocumented Codex pipe and desktop deep links may break after upstream updates. Unknown protocol versions fail closed.
