# Installation auf dem Arbeits-PC

Cardea Deck ist eine experimentelle Windows-Beta für das Stream Deck MK.2 mit 15 Tasten. Der normale Download ist jetzt **eine `.streamDeckPlugin`-Datei** mit eingebautem Profil. Quellordner, `node_modules`, ein separates Node.js und lose Bilder werden dafür nicht gebraucht.

1. Stream Deck 7.1 oder neuer sowie Claude und Codex installieren und lokal anmelden. Das MK.2 anschließen. Elgatos offizielles Codex-Plugin zusätzlich installieren, wenn Dictate, Modellauswahl und Verbrauchstasten genutzt werden sollen.
2. Im [aktuellen Release](https://github.com/Giugiu8/cardea-deck/releases) **Cardea-Deck-0.8.0.streamDeckPlugin** herunterladen und doppelklicken. Die Installation in Stream Deck bestätigen.
3. Das angebotene vierseitige Profil importieren. Ein bestehendes Profil bleibt erhalten. Wer bereits ein angepasstes Cardea-Profil hat, kann dieses behalten und das zusätzliche Profilangebot ablehnen.
4. Im Stream-Deck-Editor eine Cardea-**Chat-Taste** auswählen. Unten unter **Local connections** erst **Set up Claude**, dann **Connect Codex** anklicken. Vorhandene fremde Hooks und eine eigene Statusline bleiben erhalten; geänderte Einstellungen werden lokal gesichert. Auf Freigabe-/Stop-Tasten wird keine Einrichtung angeboten.
5. Einen neuen Claude-Chat starten, damit die aktualisierten Hooks geladen werden. Codex geöffnet lassen. Auf **Apps** die fünf **Choose app**-Tasten den lokalen Arbeitsprogrammen zuweisen.

„Hooks installed“ bestätigt den Eintrag in den Einstellungen; „source active“ benötigt ein tatsächlich empfangenes Ereignis. Fehlende Statusquellen bleiben **UNKNOWN**. Bei einer fremden Claude-Statusline kann die Claude-Verbrauchstaste nur die echte Verbrauchsseite öffnen. Nach einem Stream-Deck-Runtime-Update lässt sich eine angezeigte nötige Reparatur mit **Set up Claude** durchführen.

## Update und Entfernen

Ein neues `.streamDeckPlugin` per Doppelklick installieren. Das eigene angepasste Profil behalten; ein zusätzlich angebotenes Standardlayout ist optional. Eine alte Vorgängerinstallation wird gemeldet, statt sie mit einer zweiten Freigaberoute zu mischen. Deren Hooks vor der neuen Einrichtung mit dem bisherigen Uninstaller entfernen.

Vor dem Deinstallieren eine Cardea-Chat-Taste wählen und **Remove Claude hooks** anklicken. Danach Cardea Deck in Stream Deck unter Einstellungen → Plugins deinstallieren. Eigene Einstellungen, Zustände und Sicherungen bleiben lokal.

Wenn das Plugin schon entfernt ist, kann **Remove-Claude-Hooks.ps1** aus dem Release ohne Node.js ausgeführt werden, z. B. mit `powershell.exe -NoProfile -File .\Remove-Claude-Hooks.ps1`. Das Hilfsprogramm entfernt ausschließlich genaue Cardea-Node-Hook-Aufrufe und sichert die betroffene Einstellungsdatei. Es führt keine gespeicherten Befehle aus und ersetzt keine aktuellen Einstellungen durch eine alte Komplettsicherung.

## Funktionstest

- Die vier Seiten heißen **Claude, Codex, Controls, Apps**. Die Navigation steht auf jeder Seite an denselben Positionen.
- Eine laufende Unterhaltung ist blau/**WORKING**, ein benötigter Nutzerentscheid gelb/**INPUT**, eine neue Antwort grün/**NEW**. Rot/**ERROR** braucht einen tatsächlich gemeldeten Fehler; fehlende Daten sind grau/**UNKNOWN**.
- Chat-Tasten öffnen die passende Unterhaltung; ein leerer Platz öffnet einen neuen Composer. Kontingente stammen ausschließlich aus echten Quellen.
- Freigaben und Stop nur mit einem ausdrücklich vereinbarten harmlosen Testauftrag ausprobieren. Die Einrichtung ist keine Freigabe einer Claude-Aktion.

Eine Installation auf einem zweiten physischen PC und alle Hardware-Tasten sind damit nicht automatisch getestet. Bei allgemeiner Trägheit zuerst CPU-/Datenträgerlast mit und ohne Stream Deck vergleichen; keine Chatinhalte, Zustandsdateien oder Schlüssel an Issues anhängen.

## Optionaler ZIP-Weg

Der als **advanced portable** bezeichnete ZIP-Download ist für Terminal-Installation und frühere verwaltete Installationen gedacht. Dafür Node.js 22+ installieren, das ZIP vollständig entpacken und `node setup.mjs --check`, anschließend `node setup.mjs` ausführen. `Doctor.ps1` bzw. `node doctor.mjs` liefern eine reduzierte Diagnose. Ein vorhandener Entwicklungs-Link wird nicht automatisch überschrieben. Für die normale Plugin-Installation ist dieser ZIP-Weg nicht nötig.
