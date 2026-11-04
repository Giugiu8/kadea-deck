<div align="center">

# Cardea Deck

### Your agents. One place.

Claude and Codex on your Stream Deck — see who is working, who needs you, and who has an answer.

[![Windows beta](https://img.shields.io/badge/Windows-beta_0.7.0-59b5ff?style=flat-square)](https://github.com/Giugiu8/cardea-deck/releases/tag/v0.7.0-beta.1)
[![Build and tests](https://github.com/Giugiu8/cardea-deck/actions/workflows/check.yml/badge.svg)](https://github.com/Giugiu8/cardea-deck/actions/workflows/check.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-4de398?style=flat-square)](LICENSE)

**[Download Windows beta](https://github.com/Giugiu8/cardea-deck/releases/tag/v0.7.0-beta.1)** · **[German installation guide](docs/INSTALL-DE.md)** · [How it works](#controls)

</div>

Experimental Windows beta for the **15-key Stream Deck MK.2**. Independent community project; not affiliated with Anthropic, OpenAI, Elgato or Work Louder. [German guide for installation on a second PC](docs/INSTALL-DE.md).

**Why it exists:** Inspired by [Codex Micro](https://learn.chatgpt.com/docs/features/codex-micro). Buying another device wasn't in my budget, so I built this for the Stream Deck I already owned.

<p align="center">
  <img src="docs/images/cardea-deck-hardware.jpg" width="520" alt="Cardea Deck on a physical Stream Deck MK.2, showing the English security demonstration layout">
  <br>
  <sub>Real hardware: English demonstration layout with sample security tasks. Codex usage was live when photographed.</sub>
</p>

<details>
<summary>Explore the key layout and status colors</summary>

![Illustrative layout with sample tasks, not live sessions](docs/preview.png)

*Illustrative layout with English sample tasks. The installed plugin uses real local sources or an explicit unknown state.*

</details>

| See it | Open it | Decide |
|---|---|---|
| Large status labels show work, questions and new answers. | Press a chat key to jump to the conversation. | Answer a supported request for the selected chat. |

Same positions for both providers. Six chats per page. Navigation stays **Claude · Codex · Controls · Apps**. Your app shortcuts live on their own page.

No cloud telemetry or account keys required by Cardea Deck. Setup preserves existing Claude hooks and custom status lines; local state stays on its PC. [Privacy and limitations](#privacy-and-limitations).

**Security notice:** The published `v0.7.0-beta.1` Windows release has a Claude permission-response impersonation flaw. Keep Cardea's `PermissionRequest` hook disabled on unpatched installations. The fix in this working tree is an unreleased 0.7.1 candidate; update both the plugin and bundled hooks together. See [SECURITY.md](SECURITY.md).

## Quick start

1. Download **Cardea-Deck-0.7.0-windows.zip** from [Releases](https://github.com/Giugiu8/cardea-deck/releases), then extract the entire archive to a permanent folder.
2. Have **Stream Deck 7.1+**, **Node.js 22+**, and your signed-in Claude/Codex desktop apps installed. Install the official Elgato Codex plugin separately for dictation, model selection, new chat and usage. Connect the MK.2 and open Stream Deck once so its device profile exists.
3. In the extracted folder run:

   ```powershell
   node setup.mjs --check
   node setup.mjs
   ```

   Or double-click `Install.cmd`. Setup restarts **Stream Deck only**, adds its own profile, and preserves unrelated Claude hooks and custom status lines. No admin rights, API key, npm, ImageMagick or source build required for the download.
4. Select **Cardea Deck** in Stream Deck. Start a new Claude chat to load its hooks. On **Apps**, change the generic bookmarks and assign the five **Choose app** keys to your local programs.
5. Run `Doctor.ps1` or `node doctor.mjs` for a report without chat titles, IDs, tokens or credentials.

The currently supported installer expects the standard Windows Stream Deck location. If multiple MK.2 devices are configured, use `node setup.mjs --device-id "<local device ID>"`. A source-linked development install is deliberately preserved and refused as an automatic upgrade target.

## Controls

Navigation on every page: **Claude · Codex · Controls · Apps**.

| Signal | Meaning |
|---|---|
| Blue · WORKING | Working |
| Yellow · INPUT | Input or approval needed |
| Green · NEW | New unread response |
| Red · ERROR | Reported error |
| Gray · READY | Confirmed idle |
| Gray · UNKNOWN | Missing, unsupported or stale signal |
| Gray · EMPTY | No chat assigned |

Six chat keys per provider, with the same positions and renderer. Press a chat to select/open it. Empty chat slots open a blank composer. A white corner marks selection. Choosing/opening alone does not acknowledge a Claude result; **Read** does.

**Approve/Decline** act only on the selected supported pending request, once. Codex uses a fresh owner snapshot and a durable hashed send journal. Ambiguous sends remain locked; continue in the chat instead of deleting the journal. Unsupported or multiple requests stay in the chat. No permanent blanket approval.

**Stop** is on Controls: hold for one second. It checks the selected Codex chat and the same turn marker against a fresh snapshot. The desktop interrupt API does not accept a turn ID, so the final check-to-processing interval cannot be made atomic. The official model selector targets the foreground Codex chat.

Claude usage is shown only when real `rate_limits` arrive through our status line. A pre-existing custom status line is kept, so that button may open the provider usage page instead of displaying a percentage. We do not read account credentials to estimate usage. Codex usage/dictation/model selection come from the separately installed official plugin.

## Privacy and limitations

- Local metadata only. Claude hooks drop prompts, tool arguments, outputs and transcript paths. The Codex desktop pipe sends full state frames; our bounded streaming parser discards history/tool arguments while reading and retains only selected metadata. No transcript logging or cloud telemetry.
- Metadata, the random per-start loopback connection token and the separate receiver identity key live under `%USERPROFILE%/.cardeadeck`. This directory stays on its PC. In the 0.7.1 candidate, hooks authenticate the receiver before sending metadata and verify each permission response. Other applications under the same Windows user are inside the local trust boundary.
- The Codex desktop pipe is not a publicly stable API. Observed stream version: 11; unknown newer versions fail closed. Desktop updates can require maintenance or rerunning Setup to refresh the bundled executable path.
- Hook collection is not proof of every open Claude chat. Desktop deep links can change. No Gemini, macOS/Linux support, remote PC control or full Micro/VibeDeck feature parity is promised.
- The private predecessor was tested on a real MK.2, including chat switching, Claude new chat and Codex dictation. The original PC now runs 0.7.0 with a healthy collector after migration. The portable installer is tested in isolated fresh-profile fixtures; a second physical PC remains an independent installation test. Real approval/stop hardware coverage is limited. See [release validation](docs/VALIDATION.md).

## Update, remove, recover

Extract the next release and run Setup again. Your existing Apps/profile edits are preserved. Setup checks download hashes, backs up affected files, checks concurrent Claude-setting changes and rolls back a failed install. Backup copies and location records stay under `.cardeadeck/backups`; retired directories remain beside their original paths with a `.cardea-backup-*` suffix so redirected AppData works across volumes. These are recovery copies, not active plugins/profiles.

Run `node setup.mjs --uninstall` or `Uninstall.cmd` to remove only our hooks and archive our plugin/profile. Other settings, your local state and backups are retained. Do not restore an old entire Claude settings file over newer user changes. For an older plugin version, install its release archive after uninstalling; local state formats remain at schema 1 in this release.

## Build and contribute

Windows, Node 22+, ImageMagick `magick`, the Windows .NET C# compiler and Git are needed **only for source builds**:

```powershell
npm ci --ignore-scripts
node build.mjs
node --test tests/*.test.mjs
node profile.mjs
node node_modules/@elgato/cli/bin/streamdeck.mjs validate dist/de.cardea.deck.sdPlugin
node release.mjs
```

Pinned dependencies, own vector artwork and MIT license. Extracted application logos and manufacturer plugin code are not distributed. The Zod override pins a patched version of the mini API used by Elgato's SDK; SDK integration tests cover that combination. CLI-only audit findings are documented in [SECURITY.md](SECURITY.md).

Read [the comparison and design decisions](docs/COMPARISON.md), [CHANGELOG.md](CHANGELOG.md) and [SECURITY.md](SECURITY.md). Bug reports should include the version, Windows/Stream Deck/app versions and a redacted diagnostic report. Do not attach local state, connection files, account tokens or conversations.

<div align="center">Powered by Claude, Codex, and my electricity bill.</div>
