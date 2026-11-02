# Installation auf dem zweiten PC

Diese Fassung ist eine experimentelle Windows-Beta für das Stream Deck MK.2 mit 15 Tasten. Die Installation auf einem zweiten echten PC ist noch kein bestätigter Nachweis. Genau dafür ist dieser Test gedacht.

1. [Aktuelles Release](https://github.com/Giugiu8/kadea-deck/releases) öffnen und **Kadea-Deck-0.6.0-windows.zip** herunterladen. Alles in einen dauerhaften Ordner entpacken, beispielsweise unter Dokumente. Keine lokalen Zustände oder Anmeldedaten vom ersten PC mitnehmen.
2. Stream Deck 7.1 oder neuer und Node.js 22 oder neuer installieren. Claude und Codex lokal anmelden. Elgatos offizielles Codex-Plugin über dessen Marketplace installieren. Das MK.2 anschließen und Stream Deck einmal öffnen.
3. Im entpackten Ordner `Install.cmd` starten. Alternativ ein Terminal dort öffnen und `node setup.mjs --check`, danach `node setup.mjs` ausführen. Das erste Kommando prüft nur. Setup startet ausschließlich Stream Deck neu; bestehende Agenten bleiben offen.
4. Im Stream-Deck-Editor das neue Profil **Kadea Deck** wählen. Unten stehen **Claude, Codex, Aktionen, Apps**. Die Apps-Seite enthält neutrale Lesezeichen und fünf freie Programm-Tasten. Der Chat am Ziel-PC kann diese über den Editor auf die tatsächlich installierten Arbeitsprogramme anpassen.
5. Eine neue echte Claude-Unterhaltung starten. Bereits offene Unterhaltungen können alte Hooks behalten. Codex muss offen sein, damit dessen Statusquelle erreichbar ist. Nicht geladene Chats bleiben ehrlich grau/UNKLAR.

## Kurzer Auftrag für den Chat am Ziel-PC

> Richte das öffentliche Kadea Deck aus github.com/Giugiu8/kadea-deck auf diesem PC ein. Lies README und docs/INSTALL-DE.md. Verwende das Windows-Release mit Setup, prüfe zuerst mit --check und erhalte vorhandene Claude-Hooks/Statusline. Passe nur die Apps-Seite an die hier installierten Arbeitsprogramme an. Teste Navigation, echte Chatsprünge, leeren neuen Chat und Diktat. Nutze für Freigaben/Stop ausschließlich einen ausdrücklich vereinbarten harmlosen Testauftrag. Nenne konkret, was wirklich getestet wurde.

## Funktionstest

- Claude links, Codex daneben: beide öffnen die passende Seite.
- Eine echte laufende Unterhaltung wird blau; eine Rückfrage gelb; eine neue ungelesene Antwort grün. Rot benötigt einen wirklich gemeldeten Fehler. Fehlende Daten bleiben UNKLAR.
- Chat drücken öffnet die richtige Unterhaltung. Freier Platz öffnet einen leeren Composer. Diktat kommt vom offiziellen Codex-Plugin.
- Kontingent wird ausschließlich aus echten Quellen gezeigt. Bei fremder Claude-Statusline bleibt diese erhalten; unser Verbrauchsknopf kann deshalb nur die echte Verbrauchsseite öffnen.
- Diagnose: `node doctor.mjs`. Keine Zustandsdateien oder Tokens an GitHub-Issues anhängen.

Updates erhalten angepasste Apps. `Uninstall.cmd` oder `node setup.mjs --uninstall` entfernt unsere Hooks und archiviert nur unser Plugin/Profil. Zustände und Sicherungen bleiben lokal erhalten. Ein vorhandener Entwicklungs-Link wird von Setup nicht überschrieben.
