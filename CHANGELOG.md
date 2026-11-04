# Changelog

## 0.8.0 — 2026-11-04

### Added
- Install the complete plugin with one `.streamDeckPlugin`: bundled editable four-page MK.2 profile and local setup in Stream Deck's Property Inspector. The normal installation uses Stream Deck's Node runtime; no source folder, npm or separate Node installation is required.
- Explicit Claude setup/removal and Codex connection buttons, settings backups, concurrent-change checks, a bounded native setup protocol and a standalone hook-removal recovery script.
- Codex discovery verifies the official Microsoft Store package and its canonical installation location, including secondary drives and Stream Deck's Node 20 runtime.

### Fixed
- Rebuild generated profiles in isolation and replace obsolete pages. Repeated builds no longer accumulate unused pages and hundreds of images.
- Keep the existing default profile when importing the bundled layout; customized existing layouts can be retained.
- Match only exact owned Node hook commands, preserving foreign wrappers that mention Cardea paths.
- Cache bounded metadata for unchanged files; archive/unarchive updates still refresh.

### Security
- Includes the authenticated receiver and request-bound permission-response fix developed in 0.7.1. Updating both plugin and hooks closes the confirmed impersonation flaw in `v0.7.0-beta.1`.
- Setup is available only through the selected native Property Inspector, with a fresh per-inspector token and single-flight operations. It is never an HTTP endpoint or a hardware approval action.

## 0.7.1 — Unreleased

### Security
- Authenticate Claude permission responses using a separate per-start key and a fresh request challenge. A substitute process on an abandoned receiver port can no longer return an unsigned approval. Replayed or modified responses leave the decision in Claude.
- Refuse permission transport through legacy connection files without the response key. Update both the plugin and its bundled hooks together and restart Stream Deck.
- Prove the receiver's identity before sending hook metadata, keep the proven TCP connection, and enforce an absolute identity-check deadline. Connection schema 2 also makes old hooks refuse the new connection file. Clear only the receiver's own connection file on orderly shutdown, and keep partial hook installations silent.
- Doctor uses the authenticated client and reports whether the receiver was authenticated without printing either key.

## 0.7.0 — 2026-11-02

- Use **Cardea Deck** throughout, including plugin identity `de.cardea.deck`, local directory `.cardeadeck`, and `CARDEA_DECK_HOME`.
- Migrate managed installations with backups, preserved app bindings and approval journals, updated hooks, and a new connection token.
- Translate the interface, status labels, example layout and screenshots to English.
- Add the project credit: Powered by Claude, Codex, and my electricity bill.

GitHub tag: `v0.7.0-beta.1`; Stream Deck version: `0.7.0.0`.

## 0.6.1 — 2026-11-02

### Fixed
- Correct the product name to **Cardea Deck** in the UI, profile, docs, package and downloads.
- Move the public repository to `Giugiu8/cardea-deck`.
- Rename an existing factory profile title during upgrade, preserving custom profile names and Apps edits.

GitHub tag: `v0.6.1-beta.1`; Stream Deck version: `0.6.1.0`.

## 0.6.0 — 2026-11-02

First public experimental Windows release; GitHub tag `v0.6.0-beta.1`, Stream Deck version `0.6.0.0`.

### Added
- Prebuilt download with a fresh four-page MK.2 profile, local device binding and configurable neutral Apps page.
- Setup/check-only, backups, concurrent-settings guards, install rollback, targeted uninstall and private diagnostics.
- Property Inspector controls for chat slots, approval decision and Claude usage window.
- Isolated installer tests, release integrity hashes, license notices and Windows build checks.

### Changed
- Claude is the left navigation key, Codex follows it, on all pages.
- Discover Claude metadata directories instead of requiring one machine's package-family name.
- Preserve any existing custom Claude status line; do not execute a saved command or replace another plugin's hooks.
- Public artwork uses original vector symbols; no extracted application logos or private profiles.

### Fixed
- Codex catalog initialization failure closes its own child process so the next attempt can recover.
- Pin the patched Zod mini API dependency used by Elgato's SDK.

The existing working/unread/input/error colors, request-bound decisions and durable hashed approval journal are retained. No simulated security tasks are installed.
