# Threat model

Applies to version 0.9. Cardea Deck is a local Windows desktop integration between Claude Code, the Codex desktop app and a Stream Deck. This document states what it protects, what it does not, and how to remove it. It is no certification and no claim that the software is free of vulnerabilities.

## What is protected

| Asset | Threat | Protection |
|---|---|---|
| A Claude permission decision | A process that took over the receiver's port forges an approval | Challenge-response identity (HMAC-SHA256, separate per-start key that never crosses the socket) before any data is sent. Follow-up only on the proven TCP connection. Replies signed over nonce, request, status and body. |
| A Claude permission decision | HTTP clients or the Property Inspector create an approval | Approvals come only from the exact bound Stream Deck key event, for the exact pending request. HTTP and inspector cannot answer. |
| The user's attention | Approval fatigue, one accidental press | Key approvals are off by default and need explicit consent. Approve needs a one-second hold. The key shows tool and shortened content. |
| Commands, file changes, network access | A prompt-injected request approved by reflex | Risky tools cannot be answered by key at all, even if configured. They go to Claude's own dialog. Only allowlisted tools with displayable content wait for a key. |
| The display | A request looks different from what it does | Requests with control or direction-override characters stay in Claude's dialog. Paths are shown as they resolve, keeping their end; search folders come before the pattern; cut text always shows `…`. Unknown tools must fit whole on the key, or they stay in the dialog. |
| Windows credentials | A "read-only" tool reaches another machine | UNC, device and `file:` paths never wait for a key, for any tool. |
| Connection keys, state | Other Windows accounts read them | Runtime folder and `connection.json` get exactly one ACL entry for the current user, set with `icacls` and verified by reading it back. If that fails, no keys are published and no hooks are served. |
| Installed plugin files | Damage, partial updates, casual edits | Files are checked against `integrity.json` at start and every five minutes. On a mismatch: no hook service, a warning on every key. |
| The user's Claude settings | Loss or overwriting | Only exact own commands are changed. Foreign hooks and status lines stay. Backups are made; concurrent changes and invalid UTF-8 abort. With managed settings the file is not written at all. |
| The published release | Altered or unverifiable build | Built by GitHub Actions from a tag, with build attestation and SBOM. Code can be rebuilt byte for byte. See [docs/REPRODUCE.md](docs/REPRODUCE.md). |

**Failure behavior:** whenever something is wrong (no receiver, failed proof, timeout, unknown tool, damaged file), a hook returns no decision. Claude Code then applies its normal permission flow. Cardea Deck never fails toward "allow".

## What is not protected

- **Programs running under the same Windows account.** They can read the keys, change `integrity.json` together with the files, edit `config.json` and press nothing at all. Isolation within one account is outside this design. Use a separate account or endpoint controls for that.
- **Administrators and SYSTEM** can reset any ACL. They are also removed from the runtime folder's ACL, so backup tools running as SYSTEM may skip it.
- **The integrity check is no signature.** It detects damage and casual edits, not a deliberate attacker with write access to the same folder. Managed deployment with hooks under `Program Files` puts the hook files out of the user's reach; see [docs/MANAGED-SETTINGS.md](docs/MANAGED-SETTINGS.md).
- **A person approving what the key shows.** A long path shows only its end on the key; the Property Inspector shows up to 240 characters. An allowlisted read of a sensitive file remains possible when approved. Mapped network drives (`Z:\`) and symbolic links cannot be told from local paths by looking at the text. Do not rely on the key as a safety boundary for unattended high-impact work.
- **Authenticode signatures.** Neither the plugin nor the recovery script is signed; see [docs/REPRODUCE.md](docs/REPRODUCE.md).
- **Codex controls.** The local Codex desktop pipe is not a public API. Stop checks a fresh turn marker, but the interrupt has no atomic turn ID. Ambiguous sends remain locked across restarts.
- **Cross-account port takeover and the physical key pass** have test fixtures only; a practical attack across Windows accounts and a complete hardware run on a second PC have not been carried out.

## Data

**Nothing leaves the computer through Cardea Deck.** It has no telemetry and no account keys. It opens only loopback connections, the local Codex pipe and allowlisted links through Windows' shell (`claude://`, `codex://` and the Claude usage page, which opens in the browser).

| Local flow | Content | Stored |
|---|---|---|
| Hook → receiver (`127.0.0.1`) | Event, time, session ID, working directory, tool name, IDs. Quota percentages from the status line. | `state.json`: session metadata, no prompts or tool data |
| Pending approval → receiver → key | A redacted summary of at most 240 characters; the key image goes to the local Stream Deck app | In the plugin: memory only, discarded with the request. Stream Deck's own handling of key images is outside this project; on the test PC it wrote no new image files during use. |
| Codex pipe → plugin | The desktop sends full state frames; the parser discards history and tool arguments while reading | Bounded metadata; `codex-attempts.json` holds a hashed send journal |
| Claude desktop metadata | Titles and IDs from local session files | Title and link in `state.json` |
| Decisions | Time, session ID, tool, outcome (`allow`, `deny`, `timeout`, `deferred`, `cancelled`) | `decisions.jsonl`, 256 KiB plus three rotated files; no prompts, inputs or summaries |
| Settings changes | The previous `settings.json` | `backups/`, private; can contain whatever the user keeps in that file |

Files live in `%USERPROFILE%\.cardeadeck`. `powershell.exe` runs only to locate the Codex Store package, with bounded runtime and a fixed command. `icacls.exe` and `whoami.exe` set and verify permissions. A link inside the runtime folder, or a runtime path pointing at a system or user folder, is refused before anything changes.

## Trust boundaries

1. **Windows account.** Everything inside is trusted equally. This is the main boundary.
2. **Loopback.** Other local accounts can reach the port, but not the keys. Browser requests carrying an `Origin` header are rejected.
3. **Upstream.** Claude Code hook behavior, Stream Deck and the Codex pipe can change. Unknown versions fail closed.

A hook's `allow` does not override Claude Code's own deny and ask rules. Organizations can restrict further with managed settings and `%ProgramData%\CardeaDeck\policy.json`.

## Removal

1. Select a Cardea chat key and click **Remove all Claude hooks** (or remove each group alone), then uninstall the plugin in Stream Deck.
2. If the plugin is already gone: `powershell.exe -NoProfile -File .\Remove-Claude-Hooks.ps1`, optionally with `-Group Status` or `-Group Approval`. If policy blocks it, remove only the Cardea entries from `%USERPROFILE%\.claude\settings.json` by hand.
3. Managed deployment: remove the Cardea block from the managed settings and delete the hook folder.
4. Delete `%USERPROFILE%\.cardeadeck` to remove state, decisions and backups. Uninstalling leaves it in place on purpose.

## Reporting

Use GitHub's private vulnerability reporting. Details on earlier versions: [SECURITY.md](SECURITY.md).
