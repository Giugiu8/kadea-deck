# Design comparison

Sources inspected read-only on 2026-11-02. These are engineering references, not an endorsement or claim that Cardea Deck outperforms them. No source code or vendor artwork was copied from these repositories.

| Project and inspected commit | Lesson adopted | Boundary |
|---|---|---|
| [Agent Vitals](https://github.com/tapparello/agent-vitals), `803cba0222891477ac5fb30a0e51abdac048f26b` | Preserve existing Claude settings; distinguish input from approval; bounded permission handling; useful setup diagnostics. | We retain our existing per-session metadata collector and request-bound decisions. No transcript/token credential reading was added for usage gauges. |
| [CodexDeck](https://github.com/dada2623/CodexDeck), `7cda7a6e6e14389d7069a0afa23d54b85a92ad51` | Ship a ready profile and prebuilt download; let the plugin own dynamic key images; explain native-control dependencies. | No physical device ID or extracted app artwork is published. Bind the real MK.2 locally during installation. No simulated approval hotkeys. |
| [Elgato SDK distribution](https://docs.elgato.com/streamdeck/sdk/introduction/distribution/) | Validate and package the plugin with the official CLI; direct distribution is supported. | Official Codex plugin remains a separately installed dependency and is not redistributed or modified. |

The implementation keeps a single status renderer, explicit unknown states, bounded local data parsing and fresh target checks. The first public release focuses on installation/recovery rather than adding more agent providers.
