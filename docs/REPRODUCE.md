# Verifying a release

Official releases are built by the [Release workflow](../.github/workflows/release.yml) from a Git tag. A second job rebuilds the code on Linux and must match before anything is published.

The first release made this way is still to come. Version `v0.8.0-beta.1` was built locally and is not covered.

## 1. Check the origin

Requires the [GitHub CLI](https://cli.github.com/).

```powershell
gh attestation verify .\Cardea-Deck-0.9.0.streamDeckPlugin --repo Giugiu8/cardea-deck
```

This shows that the file came from this repository's workflow, and from which commit. The SBOM is the release file `Cardea-Deck-<version>.cdx.json` (CycloneDX, runtime dependencies only) and is attested as well.

## 2. Rebuild and compare

Needs Node.js 22 or later and Git, no ImageMagick. Use the commit the attestation names.

```powershell
git clone https://github.com/Giugiu8/cardea-deck.git
cd cardea-deck
git checkout v0.9.0-beta.1
npm ci --ignore-scripts
node reproduce.mjs ..\Cardea-Deck-0.9.0.streamDeckPlugin
```

`reproduce.mjs` rebuilds everything that executes into a temporary folder and compares it byte for byte: `bin/plugin.mjs`, all `hooks/`, all `pi/`, `manifest.json` and `package.json`. Exit code 0 means identical, 1 a difference, 2 a failed rebuild. It also accepts an unpacked folder, such as an installed plugin:

```powershell
node reproduce.mjs "$env:APPDATA\Elgato\StreamDeck\Plugins\de.cardea.deck.sdPlugin"
```

To compare by hand:

```powershell
node build.mjs --code-only --out ..\rebuild
Get-FileHash ..\rebuild\bin\plugin.mjs -Algorithm SHA256
Get-FileHash "$env:APPDATA\Elgato\StreamDeck\Plugins\de.cardea.deck.sdPlugin\bin\plugin.mjs" -Algorithm SHA256
```

What makes this work: exact dependencies from `package-lock.json`, a pinned esbuild, LF line endings for every checkout through `.gitattributes`, and no build path, time or random value in the code. To read the bundle against `src/`, `bin/plugin.mjs` is not minified and marks each source file with a comment.

## What is not byte-reproducible

The key images and the zipped default profile (`imgs/`, `profiles/`). Their bytes depend on the ImageMagick version and on zip timestamps, and the profile gets new random page IDs. They are data and do not execute. They are listed in the plugin's `integrity.json` and covered by the attestation, but not by the rebuild comparison. The same goes for the `.streamDeckPlugin` archive as a whole: compare its contents, not the file's own hash.

## Signing

**Nothing is signed with Authenticode, for these reasons:**

- The plugin no longer contains an executable. The former `bin/open.exe` was removed in 0.9; links now open through Windows' own signed `explorer.exe`.
- A `.streamDeckPlugin` file is a zip archive, and its JavaScript files cannot carry an Authenticode signature. Stream Deck does not check one.
- `Remove-Claude-Hooks.ps1` could be signed, but that needs a code-signing certificate, which this project does not currently have.

The build attestation takes the place of a signature for origin. It does not show a publisher name in Windows dialogs and is not checked at installation, so run the commands above yourself. An organization can sign the recovery script with its own certificate or allow it by hash.

## Maintainer checklist

Publishing means pushing a tag such as `v0.9.0-beta.1` whose version matches `package.json`. A repository rule protecting `v*` tags and a required review for the workflow files are recommended. `node release.mjs` on a local PC remains useful as a dry run; its output is marked `local-not-a-release` and must not be uploaded.
