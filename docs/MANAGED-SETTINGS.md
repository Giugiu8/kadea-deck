# Deployment with managed settings

For IT administrators. Cardea Deck can run without changing any user's `~/.claude/settings.json`, including with `allowManagedHooksOnly`, where user hooks do not run. German summary: [INSTALL-DE.md](INSTALL-DE.md#verwaltete-einstellungen).

Read [THREAT-MODEL.md](../THREAT-MODEL.md) first. Claude Code's own reference: [managed settings](https://code.claude.com/docs/en/managed-settings), [hooks](https://code.claude.com/docs/en/hooks).

## Steps

1. **Check the release** as described in [REPRODUCE.md](REPRODUCE.md).
2. **Copy the hooks to a protected folder.** Take `de.cardea.deck.sdPlugin\hooks\` from the release and place all its files in, for example, `C:\Program Files\Cardea Deck\hooks\`. Users cannot change files there, unlike the plugin's copy under `%APPDATA%`. The path must contain the word `Cardea`, because the plugin recognizes its managed hooks by it. Plugin and hooks must have the same version, so update them together.
3. **Provide Node.js 20 or later** at a fixed machine-wide path, for example `C:\Program Files\nodejs\node.exe`.
4. **Create the settings block.** The template [managed-settings.template.json](managed-settings.template.json) contains the status hooks and `allowManagedHooksOnly`. For other paths or options, use the generator from the portable download, which only prints:

   ```powershell
   node managed-settings.mjs --node "C:\Program Files\nodejs\node.exe" --hooks "C:\Program Files\Cardea Deck\hooks"
   ```

   | Option | Effect |
   |---|---|
   | `--approvals` | Also adds the `PermissionRequest` hook. Leave it out unless key approvals are wanted. |
   | `--status-line` | Adds Cardea's status line for the usage key. Under `allowManagedHooksOnly`, Claude Code takes the status line from managed settings only. Without it, that key opens the usage page. |
   | `--allow-user-hooks` | Omits `allowManagedHooksOnly`. |
   | `--shell-form` | One command string instead of `command` plus `args`, for Claude Code versions without `args`. Needs Git Bash on Windows. |

5. **Deploy it** with your usual tooling, in one of these ways:
   - As `C:\Program Files\ClaudeCode\managed-settings.json`, merged with your existing content.
   - As its own file in `C:\Program Files\ClaudeCode\managed-settings.d\`.
   - As the JSON value `Settings` under `HKLM\SOFTWARE\Policies\ClaudeCode`. The plugin cannot detect this route; see below.
6. **Install the plugin** per user or by software distribution: the `.streamDeckPlugin` file. Users should not click **Set up Claude**; they do not need to.
7. **Test:** start a new Claude session. In it, `/hooks` lists the entries, and a chat key turns blue while Claude works.

## How the plugin behaves

If the managed files name Cardea's bridge or set `allowManagedHooksOnly`, the plugin reports "managed by your organization" and refuses to write hooks into the user's settings file. Key approvals stay off until the user opts in with the checkbox, even when `--approvals` deployed the hook. That choice is stored in `%USERPROFILE%\.cardeadeck\config.json`.

**Limit:** the plugin reads the files in `C:\Program Files\ClaudeCode\`, not the registry and not server-managed settings. With those routes it reports "not set up", and **Set up Claude** would still write to the user's file. Under `allowManagedHooksOnly` such entries do not run. Tell users not to use the button, or also deploy a small `managed-settings.d` file naming the bridge.

## Limiting key approvals centrally

Optional `%ProgramData%\CardeaDeck\policy.json`. A template is in [policy.template.json](policy.template.json). Standard users can create folders under `ProgramData` by default, so create this folder yourself and allow only administrators to change it. The file can only narrow what a user chose:

```json
{ "approvalsAllowed": false }
```

Or limit the tools:

```json
{ "allowlist": ["Read", "Grep"] }
```

`approvalsAllowed: false` turns key approvals off regardless of user settings. An `allowlist` here is intersected with the user's list. Tools that run commands, change files or use the network can never be approved by key, in any configuration.

The default list is `Read`, `Grep`, `Glob`, `LS`. Users can change it through `"allowlist"` in their `config.json`, for example to add one exact MCP tool name.

## What to look at

- `%USERPROFILE%\.cardeadeck\decisions.jsonl`: time, session, tool and outcome of each approval request. It stays on the PC and is readable only by that user, so collection is up to you.
- Stream Deck's plugin log: integrity and permission failures.

## Removal

Remove the block from the managed settings, delete the hook folder, then uninstall the plugin. `%USERPROFILE%\.cardeadeck` stays until deleted.
