# Cardea Deck

**Claude and Codex, one consistent Stream Deck.** Local chat status, direct chat switching, request-bound approvals and large, readable status labels.

Experimental Windows beta for the **15-key Stream Deck MK.2**. Independent community project; not affiliated with Anthropic, OpenAI, Elgato or Work Louder. [Deutsch: Installation und Arbeits-PC](docs/INSTALL-DE.md).

![Illustrative layout with sample tasks, not live sessions](docs/preview.png)

The illustration uses sample tasks. The installed plugin starts with real local sources or an explicit unknown state. It never adds example sessions to your agents.

## Install tomorrow

1. Download **Cardea-Deck-0.6.1-windows.zip** from [Releases](https://github.com/Giugiu8/cardea-deck/releases), then extract the entire archive to a permanent folder.
2. Have **Stream Deck 7.1+**, **Node.js 22+**, and your signed-in Claude/Codex desktop apps installed. Install the official Elgato Codex plugin separately for dictation, model selection, new chat and usage. Connect the MK.2 and open Stream Deck once so its device profile exists.
3. In the extracted folder run:

   ```powershell
   node setup.mjs --check
   node setup.mjs
   ```

   Or double-click `Install.cmd`. Setup restarts **Stream Deck only**, adds its own profile, and preserves unrelated Claude hooks and custom status lines. No admin rights, API key, npm, ImageMagick or source build required for the download.
4. Select **Cardea Deck** in Stream Deck. Start a new Claude chat to load its hooks. On **Apps**, change the generic bookmarks and assign the five **App wählen** keys to your local programs.
5. Run `Doctor.ps1` or `node doctor.mjs` for a report without chat titles, IDs, tokens or credentials.

The currently supported installer expects the standard Windows Stream Deck location. If multiple MK.2 devices are configured, use `node setup.mjs --device-id "<local device ID>"`. A source-linked development install is deliberately preserved and refused as an automatic upgrade target.

## Controls

Navigation on every page: **Claude · Codex · Aktionen · Apps**.

| Signal | Meaning |
|---|---|
| Blue · LÄUFT | Working |
| Yellow · FRAGE | Input or approval needed |
| Green · NEU | New unread response |
| Red · FEHLER | Reported error |
| Gray · BEREIT | Confirmed idle |
| Gray · UNKLAR | Missing, unsupported or stale signal |

Six chat keys per provider, with the same positions and renderer. Press a chat to select/open it. Free chat slots open a blank composer. A white corner marks selection. Choosing/opening alone does not acknowledge a Claude result; **Gelesen** does.

**Erlauben/Ablehnen** act only on the selected supported pending request, once. Codex uses a fresh owner snapshot and a durable hashed send journal. Ambiguous sends remain locked; continue in the chat instead of deleting the journal. Unsupported or multiple requests stay in the chat. No permanent blanket approval.

**Stop** is on Aktionen: hold for one second. It checks the selected Codex chat and the same turn marker against a fresh snapshot. The desktop interrupt API does not accept a turn ID, so the final check-to-processing interval cannot be made atomic. The official model selector targets the foreground Codex chat.

Claude usage is shown only when real `rate_limits` arrive through our status line. A pre-existing custom status line is kept, so that button may open the provider usage page instead of displaying a percentage. We do not read account credentials to estimate usage. Codex usage/dictation/model selection come from the separately installed official plugin.

## Privacy and limitations

- Local metadata only. Claude hooks drop prompts, tool arguments, outputs and transcript paths. The Codex desktop pipe sends full state frames; our bounded streaming parser discards history/tool arguments while reading and retains only selected metadata. No transcript logging or cloud telemetry.
- Metadata and the random per-start loopback connection token live under `%USERPROFILE%/.kadeadeck`. This directory stays on its PC. Other applications under the same Windows user are inside the local trust boundary.
- The Codex desktop pipe is not a publicly stable API. Observed stream version: 11; unknown newer versions fail closed. Desktop updates can require maintenance or rerunning Setup to refresh the bundled executable path.
- Hook collection is not proof of every open Claude chat. Desktop deep links can change. No Gemini, macOS/Linux support, remote PC control or full Micro/VibeDeck feature parity is promised.
- The private predecessor was tested on a real MK.2, including chat switching, Claude new chat and Codex dictation. The new portable installer is tested in isolated fresh-profile fixtures; a second physical PC remains an independent installation test. Real approval/stop hardware coverage is limited. See [release validation](docs/VALIDATION.md).

## Update, remove, recover

Extract the next release and run Setup again. Your existing Apps/profile edits are preserved. Setup checks download hashes, backs up affected files, checks concurrent Claude-setting changes and rolls back a failed install. Backup copies and location records stay under `.kadeadeck/backups`; retired directories remain beside their original paths with a `.kadea-backup-*` suffix so redirected AppData works across volumes. These are recovery copies, not active plugins/profiles.

Run `node setup.mjs --uninstall` or `Uninstall.cmd` to remove only our hooks and archive our plugin/profile. Other settings, your local state and backups are retained. Do not restore an old entire Claude settings file over newer user changes. For an older plugin version, install its release archive after uninstalling; local state formats remain at schema 1 in this release.

## Build and contribute

Windows, Node 22+, ImageMagick `magick`, the Windows .NET C# compiler and Git are needed **only for source builds**:

```powershell
npm ci --ignore-scripts
node build.mjs
node --test tests/*.test.mjs
node profile.mjs
node node_modules/@elgato/cli/bin/streamdeck.mjs validate dist/de.cardea.kadeadeck.sdPlugin
node release.mjs
```

Pinned dependencies, own vector artwork and MIT license. Extracted application logos and manufacturer plugin code are not distributed. The Zod override pins a patched version of the mini API used by Elgato's SDK; SDK integration tests cover that combination. CLI-only audit findings are documented in [SECURITY.md](SECURITY.md).

Read [the comparison and design decisions](docs/COMPARISON.md), [CHANGELOG.md](CHANGELOG.md) and [SECURITY.md](SECURITY.md). Bug reports should include the version, Windows/Stream Deck/app versions and a redacted diagnostic report. Do not attach local state, connection files, account tokens or conversations.

Compatibility identifiers (`de.cardea.kadeadeck`, `.kadeadeck`, `KADEA_DECK_HOME`) retain their legacy spelling so installed keys, hooks and local state continue to work. The product name is Cardea Deck.
