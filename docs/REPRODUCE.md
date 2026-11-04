# Verifying a release

Official releases are built by the [Release workflow](../.github/workflows/release.yml) from a Git tag. A second job rebuilds the code on Linux and must match. Only then does a separate job, which runs no repository code, attest the files, and only then are they published.

The first release made this way is still to come. Version `v0.8.0-beta.1` was built locally and is not covered.

## 1. Check the origin

Requires the [GitHub CLI](https://cli.github.com/).

```powershell
gh attestation verify .\Cardea-Deck-0.9.0.streamDeckPlugin --repo Giugiu8/cardea-deck --signer-workflow Giugiu8/cardea-deck/.github/workflows/release.yml
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
node reproduce.mjs ..\Cardea-Deck-0.9.0-advanced-portable.zip
node reproduce.mjs ..\Remove-Claude-Hooks.ps1
node reproduce.mjs ..\Cardea-Deck-0.9.0.cdx.json
```

`reproduce.mjs` rebuilds the plugin code into a temporary folder and compares, byte for byte, `bin/plugin.mjs`, all `hooks/`, all `pi/`, `manifest.json`, `package.json` and `integrity.json`. Any file the release does not account for counts as a difference, and an archive with ambiguous names (differing only in case, odd path forms, duplicate entries) is refused. It also compares what each key of the bundled profile does (see below). For the portable download it checks every file in it against this checkout as well, except the release's own generated lists. For an SBOM it compares the named components with the lockfile. Give it one file at a time. Exit code 0 means identical, 1 a difference, 2 a failed rebuild. It also accepts an unpacked folder, such as an installed plugin:

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

The key images and the zipped default profile (`imgs/`, `profiles/`), and so the `.streamDeckPlugin` archive as a whole: compare its contents, not the file's own hash. Image bytes depend on the ImageMagick version, zip files carry timestamps, and the profile gets new random IDs.

A profile is no plain picture: its keys can open websites and programs. So the comparison reads the whole profile, leaving out only random IDs and image bytes, and fails if anything differs from the source or if the archive holds anything but the images its keys name. Images are data and do not execute. They and the archive are covered by the attestation only.

ImageMagick comes from Chocolatey without a pinned version and runs in the build job. That job has no signing rights, and the code it produces must match the independent rebuild, but the image bytes are not checked this way.

## Signing

**Nothing is signed with Authenticode, for these reasons:**

- The plugin no longer contains an executable. The former `bin/open.exe` was removed in 0.9; links now open through Windows' own signed `explorer.exe`.
- A `.streamDeckPlugin` file is a zip archive, and its JavaScript files cannot carry an Authenticode signature. Stream Deck does not check one.
- `Remove-Claude-Hooks.ps1` could be signed, but that needs a code-signing certificate, which this project does not currently have. Under an `AllSigned` policy it therefore does not run.

The build attestation takes the place of a signature for origin. It does not show a publisher name in Windows dialogs and is not checked at installation, so run the commands above yourself. An organization can sign the recovery script with its own certificate or allow it by hash.

## Maintainer checklist

Publishing means pushing a tag such as `v0.9.0-beta.1` whose version matches `package.json`. A repository rule protecting `v*` tags and a required review for the workflow files are recommended. `node release.mjs` on a local PC remains useful as a dry run; its output is marked `local-not-a-release` and must not be uploaded.
