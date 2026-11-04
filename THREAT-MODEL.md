# Threat model

Applies to version 0.9. Cardea Deck is a local Windows desktop integration between Claude Code, the Codex desktop app and a Stream Deck. This document states what it protects, what it does not, and how to remove it. It is no certification and no claim that the software is free of vulnerabilities.

## What is protected

| Asset | Threat | Protection |
|---|---|---|
| A Claude permission decision | A process that took over the receiver's port forges an approval | Challenge-response identity (HMAC-SHA256, separate per-start key that never crosses the socket) before any data is sent. Follow-up only on the proven TCP connection. Replies signed over nonce, request, status and body. |
| A Claude permission decision | HTTP clients or the Property Inspector create an approval | Approvals come only from the exact bound Stream Deck key event, for the exact pending request. HTTP and inspector cannot answer. |
| The user's attention | Approval fatigue, an accidental press | Key approvals are off by default and need explicit consent. Approve needs a one-second hold. Multi Actions are refused. A press within 0.6 s of a new request's image does not count. |
| Commands, file changes, network access | A prompt-injected request approved by reflex | Only named tools can be answered by key: `Read`, `Grep`, `Glob`, `LS`, plus exact MCP tool names a user or administrator added. Every other tool goes to Claude's own dialog, including tools unknown to this version. The hook checks this again itself before it prints an allow, and it prints only a decision it composed itself, whatever else a reply contains. |
| Codex requests | A hold approves a command nobody can see | Codex tells the key only the kind of request, so Codex Approve is off until a separate opt-in, shows a marker and the kind, and needs the hold. A machine policy can lock it off. Decline always works. |
| Windows credentials | A read-only tool reaches another machine | UNC, device, `file:` and URL targets never wait for a key. Mapped drives are a limit; see below. |
| The display | A request looks different from what it does | Paths are shown as they resolve. The searched folder comes before the pattern. A request stays in the dialog if it or its session folder contains anything outside plain Western characters, double or surrounding spaces, or a path form whose target cannot be told from the text (trailing dots, streams, `~`, `%`, `$`, device names). So does input with fields the key would not show, a search that does not fit whole or would be redacted, and oversized input. Unknown tools must fit whole, or they stay in the dialog. Each request has its own marker on the key, so a new one cannot slip in under an identical image. |
| Revoked consent | A waiting request survives "off" | The policy is checked again when the key is answered and every five seconds while a request waits. A request waits only if its chat is selected and an Approve key is on the current page. |
| Connection keys, state | Other Windows accounts read them | Runtime folder and `connection.json` carry one ACL entry for the current user, verified by reading it back. If that fails, no keys are published and no hooks are served. The folder must lie inside the user's profile. A link inside it is refused before anything changes, as is a folder holding other content, unless it carries the name `.cardeadeck`. The plugin always uses `%USERPROFILE%\.cardeadeck`. |
| Installed plugin code | Damage, partial updates, casual edits | Code files are checked against `integrity.json` at start and every five minutes. On a mismatch: no hook service, a warning on every key. Unknown extra files are logged; nothing loads them. Images and the profile are not checked. |
| The user's Claude settings | Loss or overwriting | Only hook entries running a `de.cardea.deck.sdPlugin` hook file are changed. Foreign hooks and status lines stay. Backups are made; concurrent changes and invalid UTF-8 abort. Setup writes nothing into this file when hooks are managed. |
| The published release | Altered or unverifiable build | Built by GitHub Actions from a tag, with build attestation and SBOM. Signing rights sit in a job that runs no repository code. Code can be rebuilt byte for byte. See [docs/REPRODUCE.md](docs/REPRODUCE.md). |

**Failure behavior:** when something is wrong (no receiver, failed proof, timeout, unknown tool, damaged plugin code, damaged machine policy), a hook returns no decision. Claude Code then applies its normal permission flow. Cardea Deck never fails toward "allow". A session that cannot show a dialog, such as a background subagent, is denied by Claude Code in that case.

## What is not protected

- **Programs running under the same Windows account.** They can read the keys, change `integrity.json` together with the files, and edit `config.json`. Isolation within one account is outside this design. Use a separate account or endpoint controls for that.
- **Administrators and SYSTEM** can reset any ACL. They are also removed from the runtime folder's ACL, so backup tools running as SYSTEM may skip it.
- **The integrity check is no signature.** It detects damage and casual edits, not a deliberate attacker with write access to the same folder. With managed deployment under `Program Files`, hook files are out of the user's reach and the hook applies the machine policy itself. A policy cannot stop a same-account program from answering Claude by other means; the firm control is not to deploy the `PermissionRequest` hook at all.
- **A person approving what the key shows.** A long path shows only its end on the key; the Property Inspector shows up to 240 characters. An allowlisted read of a sensitive file remains possible when approved. Mapped network drives (`Z:\`), symbolic links and short 8.3 names cannot be told apart from local paths by looking at the text.
- **MCP tools a person adds to the allowlist.** Their effect is unknown to this software, whatever their name says. Adding one is that person's decision.
- **A custom key image.** If a user assigns their own image to an Approve key, Stream Deck ignores the plugin's image, and the key shows no request. The Property Inspector still does.
- **Timing at the edge.** The hold is measured when events reach the plugin, so a stall of about a second could count a shorter press as held. Stream Deck's Key Logic has not been tested.
- **Authenticode signatures.** Neither the plugin nor the recovery script is signed; see [docs/REPRODUCE.md](docs/REPRODUCE.md).
- **Codex controls.** The local Codex desktop pipe is not a public API. After opting in, a held Approve key answers a command or file change whose content it cannot show. Stop checks a fresh turn marker, but the interrupt has no atomic turn ID. Ambiguous sends remain locked across restarts.
- **Cross-account port takeover and a second PC** have test fixtures only; a practical attack across Windows accounts and a run on a second PC have not been carried out.

## Data

**The plugin sends nothing over the network by itself.** It has no telemetry and no account keys. It opens only loopback connections, the local Codex pipe and allowlisted links through Windows' shell (`claude://`, `codex://` and the Claude usage page in the browser), each on a key press. The bundled profile's Apps page also holds website shortcuts (Google, GitHub, Microsoft Learn, Bitwarden, YouTube Music). Stream Deck opens them in the browser when pressed, and users can replace them.

| Local flow | Content | Stored |
|---|---|---|
| Hook → receiver (`127.0.0.1`) | Event, time, session ID, working directory, tool name, IDs. Quota percentages from the status line. | `state.json`: session metadata, no prompts or tool data |
| Pending approval → receiver → key | A summary of at most 240 characters; the key image goes to the local Stream Deck app | In the plugin: memory only, discarded with the request. Stream Deck's own handling of key images is outside this project; on the test PC it wrote no new image files during use. |
| Codex pipe → plugin | The desktop sends full state frames; the parser discards history and tool arguments while reading | Bounded metadata; `codex-attempts.json` holds a hashed send journal |
| Claude desktop metadata | Titles and IDs from local session files | Title and link in `state.json` |
| Decisions | Time, session ID, tool, outcome (`allow`, `deny`, `timeout`, `deferred`, `cancelled`) | `decisions.jsonl`, 256 KiB plus three rotated files; no prompts, inputs or summaries |
| Settings changes | The previous `settings.json` | `backups/`, private; can contain whatever the user keeps in that file |

Files live in `%USERPROFILE%\.cardeadeck`. **With a roaming profile that folder can copy to the profile server**, including keys of a running plugin, decisions and backups. Exclude it from roaming in that case. Keys from another PC fail the identity proof and produce no decision.

`powershell.exe` runs only to locate the Codex Store package, with bounded runtime and a fixed command. `icacls.exe` and `whoami.exe` read permissions at every start and change them only when they are not private yet.

## Trust boundaries

1. **Windows account.** Everything inside is trusted equally. This is the main boundary.
2. **Loopback.** Other local accounts can reach the port, but not the keys. Requests carrying an `Origin` header are rejected on every route.
3. **Upstream.** Claude Code hook behavior, Stream Deck and the Codex pipe can change. Unknown versions fail closed.

Claude Code's documentation says a hook's `allow` does not override its deny rules. Organizations can restrict further with managed settings and `%ProgramData%\CardeaDeck\policy.json`. A damaged policy file turns key approvals off.

## Removal

1. Select a Cardea chat key and click **Remove all Claude hooks** (or remove each group alone), then uninstall the plugin in Stream Deck.
2. If the plugin is already gone: `powershell.exe -NoProfile -File .\Remove-Claude-Hooks.ps1`, optionally with `-Group Status` or `-Group Approval`. If policy or Constrained Language Mode blocks it, remove only the Cardea entries from `%USERPROFILE%\.claude\settings.json` by hand.
3. Managed deployment: remove the Cardea block from the managed settings and delete the hook folder.
4. Delete `%USERPROFILE%\.cardeadeck` to remove state, decisions and backups. Uninstalling leaves it in place on purpose.

## Reporting

Use GitHub's private vulnerability reporting. Details on earlier versions: [SECURITY.md](SECURITY.md).
