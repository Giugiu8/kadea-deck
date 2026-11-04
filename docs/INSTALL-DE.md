# Installation auf dem Arbeits-PC

Cardea Deck ist eine experimentelle Windows-Beta für das Stream Deck MK.2 mit 15 Tasten. Der normale Download ist jetzt **eine `.streamDeckPlugin`-Datei** mit eingebautem Profil. Quellordner, `node_modules`, ein separates Node.js und lose Bilder werden dafür nicht gebraucht.

1. Stream Deck 7.1 oder neuer sowie Claude und Codex installieren und lokal anmelden. Das MK.2 anschließen. Elgatos offizielles Codex-Plugin zusätzlich installieren, wenn Dictate, Modellauswahl und Verbrauchstasten genutzt werden sollen.
2. Im [aktuellen Release](https://github.com/Giugiu8/cardea-deck/releases) **Cardea-Deck-0.9.0.streamDeckPlugin** herunterladen und doppelklicken. Die Installation in Stream Deck bestätigen.
3. Das angebotene vierseitige Profil importieren. Ein bestehendes Profil bleibt erhalten. Wer bereits ein angepasstes Cardea-Profil hat, kann dieses behalten und das zusätzliche Profilangebot ablehnen.
4. Im Stream-Deck-Editor eine Cardea-**Chat-Taste** auswählen. Unten unter **Local connections** erst **Set up Claude**, dann **Connect Codex** anklicken. **Set up Claude** richtet nur die Status-Hooks ein. Dafür wird Claude Code ab Mai 2026 gebraucht; Git Bash ist nicht nötig. Vorhandene fremde Hooks und eine eigene Statusline bleiben erhalten; geänderte Einstellungen werden lokal gesichert. Auf Freigabe-/Stop-Tasten wird keine Einrichtung angeboten.
5. Einen neuen Claude-Chat starten, damit die aktualisierten Hooks geladen werden. Codex geöffnet lassen. Auf **Apps** die fünf **Choose app**-Tasten den lokalen Arbeitsprogrammen zuweisen.

„Hooks installed“ bestätigt den Eintrag in den Einstellungen; „source active“ benötigt ein tatsächlich empfangenes Ereignis. Fehlende Statusquellen bleiben **UNKNOWN**. Bei einer fremden Claude-Statusline kann die Claude-Verbrauchstaste nur die echte Verbrauchsseite öffnen. Nach einem Stream-Deck-Runtime-Update lässt sich eine angezeigte nötige Reparatur mit **Set up Claude** durchführen.

## Freigaben per Taste (optional)

Standardmäßig aus. Wer sie möchte, setzt in **Approval by key** das Häkchen und klickt **Enable key approvals**. Danach gilt:

- Die Taste zeigt Werkzeug, Inhalt, Projekt und eine Kennung der Anfrage. **Approve** muss eine Sekunde gehalten werden, **Decline** reicht ein Druck. Wer eine neue Anfrage in den ersten 0,6 Sekunden trifft, löst nichts aus. In Multi Actions funktionieren diese Tasten nicht.
- Pfade ins Netz, ungewöhnliche Zeichen und alles, was die Taste nicht sicher zeigen kann, bleiben im Claude-Dialog.
- Freigeben lassen sich nur `Read`, `Grep`, `Glob` und `LS`. Alle anderen eingebauten Werkzeuge gehen immer in den normalen Claude-Dialog. Das lässt sich auch per Konfiguration nicht ändern; ergänzen lassen sich nur einzelne kurze MCP-Werkzeugnamen, auf eigene Verantwortung.
- Jede Entscheidung steht ohne Inhalte in `%USERPROFILE%\.cardeadeck\decisions.jsonl`: Zeit, Sitzung, Werkzeug, Ergebnis.

**Disable key approvals** nimmt nur diesen Hook wieder heraus, **Remove status hooks** nur die Status-Hooks, **Remove all Claude hooks** beide.

**Codex-Freigaben:** Die Approve-Taste für Codex ist ebenfalls aus und hat ein eigenes Häkchen, denn Codex meldet der Taste nur die Art der Anfrage, nicht den Befehl. Vor dem Halten also in den Chat schauen.

## Verwaltete Einstellungen

Für IT-Administration, wenn `~/.claude/settings.json` unverändert bleiben soll oder `allowManagedHooksOnly` gilt. Ausführlich: [MANAGED-SETTINGS.md](MANAGED-SETTINGS.md).

1. Release prüfen: [REPRODUCE.md](REPRODUCE.md).
2. Den Ordner `hooks` aus dem Release nach `C:\Program Files\Cardea Deck\hooks` kopieren und Node.js 20 oder neuer unter einem festen Pfad bereitstellen.
3. Die Vorlage [managed-settings.template.json](managed-settings.template.json) oder die Ausgabe von `node managed-settings.mjs` in `C:\Program Files\ClaudeCode\managed-settings.json` übernehmen. Der Freigabe-Hook ist nur mit `--approvals` enthalten.
4. Das Plugin verteilen. **Set up Claude** wird nicht gebraucht; das Plugin meldet die Verwaltung und schreibt nichts in die Benutzereinstellungen. Bei Verteilung über die Registry oder Server-Einstellungen erkennt es das nicht, siehe Anleitung. Dort steht auch, welche Programme das Plugin startet, falls die Sicherheitssoftware danach fragt.

Mit `%ProgramData%\CardeaDeck\policy.json` und `{ "approvalsAllowed": false }` lassen sich Freigaben per Taste zentral abschalten; den Ordner dafür selbst anlegen und nur für Administratoren beschreibbar machen. Eine beschädigte Datei schaltet die Freigaben ebenfalls ab. Ganz sicher ausgeschlossen sind sie nur, wenn der Freigabe-Hook gar nicht verteilt wird.

## Update und Entfernen

Ein neues `.streamDeckPlugin` per Doppelklick installieren. Das eigene angepasste Profil behalten; ein zusätzlich angebotenes Standardlayout ist optional. Eine alte Vorgängerinstallation wird gemeldet, statt sie mit einer zweiten Freigaberoute zu mischen. Deren Hooks vor der neuen Einrichtung mit dem bisherigen Uninstaller entfernen.

Vor dem Deinstallieren eine Cardea-Chat-Taste wählen und **Remove all Claude hooks** anklicken. Danach Cardea Deck in Stream Deck unter Einstellungen → Plugins deinstallieren. Eigene Einstellungen, Zustände und Sicherungen bleiben lokal.

Wenn das Plugin schon entfernt ist, kann **Remove-Claude-Hooks.ps1** aus dem Release ohne Node.js ausgeführt werden, z. B. mit `powershell.exe -NoProfile -File .\Remove-Claude-Hooks.ps1`. Mit `-Group Status` oder `-Group Approval` entfernt es nur eine Gruppe. Das Hilfsprogramm entfernt ausschließlich genaue Cardea-Node-Hook-Aufrufe und sichert die betroffene Einstellungsdatei. Es führt keine gespeicherten Befehle aus und ersetzt keine aktuellen Einstellungen durch eine alte Komplettsicherung.

PowerShell kann heruntergeladene Skripte aufgrund einer Firmen- oder Ausführungsrichtlinie blockieren. Die Datei lässt sich vorab mit `Get-FileHash .\Remove-Claude-Hooks.ps1 -Algorithm SHA256` gegen `SHA256SUMS.txt` prüfen. Wird sie trotzdem blockiert, ausschließlich Cardeas Hook-Einträge und gegebenenfalls Cardeas Statuszeilen-Befehl manuell aus `%USERPROFILE%\.claude\settings.json` oder über die von der IT freigegebene Einstellungsverwaltung entfernen; vorher die Datei sichern und fremde Einträge beibehalten. Claudes [`/hooks`-Menü](https://code.claude.com/docs/en/hooks#the-hooks-menu) zeigt Befehle und Speicherort nur an. Das Plugin und dieses Hilfsprogramm ändern keine Ausführungsrichtlinie; die normale Entfernung vor der Deinstallation läuft direkt in Stream Deck.

## Funktionstest

- Die vier Seiten heißen **Claude, Codex, Controls, Apps**. Die Navigation steht auf jeder Seite an denselben Positionen.
- Eine laufende Unterhaltung ist blau/**WORKING**, ein benötigter Nutzerentscheid gelb/**INPUT**, eine neue Antwort grün/**NEW**. Rot/**ERROR** braucht einen tatsächlich gemeldeten Fehler; fehlende Daten sind grau/**UNKNOWN**.
- Chat-Tasten öffnen die passende Unterhaltung; ein leerer Platz öffnet einen neuen Composer. Kontingente stammen ausschließlich aus echten Quellen.
- Freigaben und Stop nur mit einem ausdrücklich vereinbarten harmlosen Testauftrag ausprobieren. Die Einrichtung ist keine Freigabe einer Claude-Aktion.

Eine Installation auf einem zweiten physischen PC und alle Hardware-Tasten sind damit nicht automatisch getestet. Bei allgemeiner Trägheit zuerst CPU-/Datenträgerlast mit und ohne Stream Deck vergleichen; keine Chatinhalte, Zustandsdateien oder Schlüssel an Issues anhängen.

## Optionaler ZIP-Weg

Der als **advanced portable** bezeichnete ZIP-Download ist für Terminal-Installation und frühere verwaltete Installationen gedacht. Dafür Node.js 22+ installieren, das ZIP vollständig entpacken und `node setup.mjs --check`, anschließend `node setup.mjs` ausführen. `Doctor.ps1` bzw. `node doctor.mjs` liefern eine reduzierte Diagnose. Ein vorhandener Entwicklungs-Link wird nicht automatisch überschrieben. Für die normale Plugin-Installation ist dieser ZIP-Weg nicht nötig.
