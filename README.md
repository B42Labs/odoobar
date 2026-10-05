# OdooBar

> Arbeitstitel. Status: Konzept. Dieses Repository enthält noch keinen Code, die README beschreibt den geplanten Funktionsumfang.

OdooBar ist eine kleine macOS-App, die einzelne Odoo-Apps (z. B. Discuss, CRM, Kalender) als Symbole in die Menüleiste oben rechts legt. Ein Klick oder ein globales Tastenkürzel holt die jeweilige App in einem eigenen Fenster nach vorn. Die Seiten laufen in einer eingebetteten Chromium-Engine, es wird kein Safari, Chrome oder anderer installierter Browser geöffnet.

## Funktionen

- **Menüleisten-Symbole**: Jede konfigurierte Odoo-App kann ein eigenes Symbol in der macOS-Menüleiste bekommen. Ein Klick zeigt die App an.
- **Globale Tastenkürzel**: Pro App ein frei wählbares Kürzel, das systemweit funktioniert, auch wenn gerade ein anderes Programm im Vordergrund ist.
- **Einmal anmelden**: Alle Apps teilen sich eine Sitzung. Der Login bleibt über Neustarts hinweg erhalten.
- **Konfigurierbare Odoo-URL**: Die Basis-URL der Odoo-Instanz wird einmal eingestellt.
- **Konfigurierbare App-URLs**: Jede App hat eine eigene URL, relativ zur Basis-URL oder absolut.
- **App-Leiste im Fenster**: Am oberen Fensterrand stehen alle konfigurierten Apps zum Umschalten.
- **Eingebetteter Browser**: Die Darstellung übernimmt Chromium über Electron.

## Bedienung

### Menüleiste

Für jede App mit aktivierter Option „In Menüleiste anzeigen“ erscheint ein Symbol oben rechts.

| Aktion | Wirkung |
| --- | --- |
| Linksklick auf ein Symbol | Fenster nach vorn holen und diese App anzeigen |
| Linksklick, während die App schon im Vordergrund ist | Fenster ausblenden |
| Rechtsklick | Menü mit „Neu laden“, „Einstellungen …“ und „Beenden“ |

Die Symbole stehen in der Reihenfolge der Konfiguration, die erste App ganz links, und der Tooltip nennt die App. Liegt das Fenster hinter einem anderen Programm, holt der Klick es nach vorn. „Neu laden“ lädt die App dieses Symbols neu, auch wenn das Fenster verborgen ist oder eine andere App zeigt. Solange die App noch nicht geöffnet wurde, ist der Eintrag ausgegraut. Hat keine App die Option, zeigt OdooBar kein Symbol, und das Fenster öffnet nur ein erneuter Start von OdooBar.

Die App hat kein Dock-Symbol und startet auf Wunsch automatisch bei der Anmeldung am Mac.

### Fenster

Alle Apps teilen sich ein Fenster. Die Leiste am oberen Rand zeigt die konfigurierten Apps, die aktive ist hervorgehoben.

```
┌──────────────────────────────────────────────────────────┐
│  Discuss   CRM   Kalender   Projekte   Kontakte      ⚙   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                  Odoo-Ansicht der aktiven App            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Jede App behält ihren Zustand, solange OdooBar läuft. Wer von CRM zu Discuss und wieder zurück wechselt, landet im selben Datensatz wie zuvor.

Ein Klick auf die bereits aktive App in der Leiste lädt wieder ihre Startadresse. Kann eine Seite nicht geladen werden, stehen Adresse und Grund unter der Leiste, und „Erneut versuchen“ oder `⌘R` lädt sie neu.

Nach dem ersten Start öffnet sich das Fenster von selbst. Bei jedem späteren Start bleibt es verborgen. Wer OdooBar startet, während es schon läuft, holt das Fenster nach vorn. Der rote Schließen-Knopf blendet das Fenster aus, genau wie `⌘W`.

### Tastenkürzel

| Kürzel | Wirkung |
| --- | --- |
| Frei konfigurierbar pro App | App systemweit nach vorn holen, erneutes Drücken blendet das Fenster aus |
| `⌘1` bis `⌘9` | Im Fenster zur ersten bis neunten App wechseln |
| `⌘R` | Aktive App neu laden |
| `⌘,` | Einstellungen öffnen |
| `⌘W` | Fenster ausblenden, OdooBar läuft in der Menüleiste weiter |

Ist ein globales Kürzel bereits von einem anderen Programm belegt, zeigen die Einstellungen einen Hinweis an.

Solange es das Einstellungsfenster noch nicht gibt, zeigen `⌘,`, das Zahnrad in der App-Leiste und „Einstellungen …“ im Menü eines Symbols die Datei `config.json` im Finder.

### Anmeldung

Beim ersten Start fragt OdooBar nach der Odoo-URL und zeigt danach die normale Odoo-Anmeldeseite. Zwei-Faktor-Anmeldung und Single Sign-on funktionieren deshalb wie im Browser.

OdooBar speichert kein Passwort. Erhalten bleibt nur das Sitzungs-Cookie im eigenen Chromium-Profil der App, im Ordner `Partitions/odoo` neben `config.json`. Läuft die Sitzung serverseitig ab, erscheint im Fenster wieder die Anmeldeseite. Nach dem Login gilt die Sitzung sofort für alle Apps. Zeigt eine andere App noch die Anmeldeseite, lädt `⌘R` oder ein Klick auf die bereits aktive App in der Leiste sie neu.

„Abmelden“ in den Einstellungen löscht das Profil mit allen Cookies, also alles, was die Odoo-Seiten gespeichert haben. Die Konfiguration bleibt erhalten. Die Sitzung auf dem Odoo-Server beendet das nicht, sie läuft dort von selbst ab. Wer sie sofort beenden will, meldet sich vorher in Odoo ab.

Solange es das Einstellungsfenster noch nicht gibt, meldet nur „Abmelden“ im Benutzermenü von Odoo ab.

## Konfiguration

Alle Einstellungen lassen sich im Einstellungsfenster ändern. Gespeichert werden sie in:

```
~/Library/Application Support/OdooBar/config.json
```

Beispiel:

```json
{
  "baseUrl": "https://odoo.example.com",
  "launchAtLogin": true,
  "apps": [
    {
      "id": "discuss",
      "name": "Discuss",
      "url": "/odoo/discuss",
      "icon": "message-circle",
      "shortcut": "Control+Alt+D",
      "menuBar": true
    },
    {
      "id": "crm",
      "name": "CRM",
      "url": "/odoo/crm",
      "icon": "handshake",
      "shortcut": "Control+Alt+C",
      "menuBar": true
    },
    {
      "id": "calendar",
      "name": "Kalender",
      "url": "/odoo/calendar",
      "icon": "calendar",
      "shortcut": "",
      "menuBar": false
    }
  ]
}
```

### Globale Felder

| Feld | Bedeutung |
| --- | --- |
| `baseUrl` | Adresse der Odoo-Instanz. OdooBar ergänzt ein fehlendes `https://` und entfernt einen abschließenden Schrägstrich |
| `launchAtLogin` | OdooBar bei der Anmeldung am Mac starten |
| `apps` | Liste der Apps. Die Reihenfolge bestimmt die Reihenfolge in Menüleiste und App-Leiste |

### Felder pro App

| Feld | Bedeutung |
| --- | --- |
| `id` | Eindeutiger interner Name |
| `name` | Anzeigename in der App-Leiste und als Tooltip in der Menüleiste |
| `url` | Startadresse der App. Ein Pfad wie `/odoo/crm` wird an `baseUrl` angehängt, eine vollständige URL wird unverändert verwendet |
| `icon` | Name eines [Lucide](https://lucide.dev/icons/)-Symbols für die Menüleiste, etwa `house` oder `message-circle`. Ein leerer oder unbekannter Name zeigt das Ersatzsymbol `app-window` |
| `shortcut` | Globales Tastenkürzel im [Electron-Accelerator-Format](https://www.electronjs.org/docs/latest/api/accelerator), leer für kein Kürzel |
| `menuBar` | `true` zeigt die App als Symbol in der Menüleiste. Bei `false` ist sie nur über App-Leiste und Kürzel erreichbar |

### Erster Start und fehlerhafte Datei

Beim ersten Start fragt OdooBar nach der Odoo-URL und legt die Datei mit zwei Apps an: „Home“ (`/odoo`) und „Zeiterfassung“ (`/odoo/timesheets`), beide mit Symbol in der Menüleiste und ohne Tastenkürzel. Wer die Abfrage schließt, beendet OdooBar, und der nächste Start fragt erneut.

Nur `baseUrl` ist Pflicht. Fehlt `launchAtLogin` oder `menuBar`, gilt `false`. Fehlt `apps`, ist die Liste leer. Fehlt `icon` oder `shortcut`, gilt der leere Text. Jede App braucht `id`, `name` und `url`, und jede `id` darf nur einmal vorkommen.

`launchAtLogin` und `menuBar` sind `true` oder `false`, `apps` ist eine Liste, alle anderen Felder sind Texte. `id` und `name` dürfen nicht leer sein. `baseUrl` verwendet `http://` oder `https://` und enthält weder Benutzername noch Passwort, `?` oder `#`. Die `url` einer App ist ein Pfad, der mit `/` beginnt, oder eine vollständige Adresse mit `http://` oder `https://`.

OdooBar liest die Datei beim Start. Änderungen von Hand wirken nach einem Neustart. Ist die Datei kein gültiges JSON oder verletzt sie eine dieser Regeln, nennt ein Dialog die Stelle und bietet zwei Wege an: „Beenden“ lässt die Datei unverändert, „Zurücksetzen“ benennt sie in `config.invalid-<Datum>-<Uhrzeit>.json` um und fragt erneut nach der Odoo-URL.

Die Oberfläche ist deutsch, wenn macOS OdooBar auf Deutsch startet, und sonst englisch. Auf einem englischen System heißt die zweite App „Timesheets“.

Der Start bei der Anmeldung gilt nur für die gebaute App, nicht für `npm start`.

### Odoo-URLs

Welche Pfade gültig sind, hängt von der Odoo-Version ab:

- Ab Odoo 18 haben viele Apps sprechende Pfade wie `/odoo/discuss` oder `/odoo/crm`.
- Ältere Versionen verwenden Adressen der Form `/web#action=123&menu_id=45`.

Am einfachsten ist es, die gewünschte Ansicht in Odoo zu öffnen und die Adresse aus der Adresszeile zu kopieren. So lassen sich auch gefilterte Listen oder einzelne Datensätze als eigene „App“ anlegen.

## Technik

OdooBar basiert auf [Electron](https://www.electronjs.org/) und bringt damit eine eigene Chromium-Engine mit. Die Wahl fiel auf Electron, weil es alle benötigten Bausteine fertig mitliefert:

| Anforderung | Electron-Baustein |
| --- | --- |
| Symbole in der Menüleiste | `Tray`, ein Exemplar pro App |
| Systemweite Tastenkürzel | `globalShortcut` |
| Eingebettete Odoo-Ansichten | `WebContentsView`, eine Ansicht pro App in einem gemeinsamen `BrowserWindow` |
| Gemeinsamer, dauerhafter Login | Eine persistente Session-Partition (`persist:odoo`) für alle Ansichten |
| Autostart | `app.setLoginItemSettings` |

Die App-Leiste ist eine eigene kleine Ansicht oberhalb der Odoo-Ansichten. Die Odoo-Seiten selbst werden nicht verändert.

Die Symbole der Menüleiste stammen aus [Lucide](https://lucide.dev) 1.52.0 (ISC-Lizenz). Der Build rendert jedes Symbol als Vorlagenbild in 18 Punkt, das macOS passend zur Menüleiste einfärbt.

Links, die einen neuen Tab oder ein neues Fenster verlangen, öffnen sich im Standardbrowser des Systems, wenn sie aus der Odoo-Instanz hinausführen, und in derselben Ansicht, wenn sie unterhalb von `baseUrl` liegen. Ein Seitenwechsel innerhalb einer Ansicht bleibt in der Ansicht, auch wenn er zu einer fremden Adresse führt. Nur so funktioniert die Anmeldung über einen externen Identitätsanbieter. Adressen, die keine Webseiten sind, lädt keine Ansicht: `mailto:`- und `tel:`-Links gehen an das System, alles andere, etwa eine ins Fenster gezogene Datei, wird verworfen.

### Bekannte Einschränkungen

- macOS blendet Menüleisten-Symbole aus, wenn der Platz nicht reicht, vor allem auf MacBooks mit Notch. Bei vielen Apps lohnt es sich, nur die wichtigsten in die Menüleiste zu legen und den Rest über Kürzel und App-Leiste zu erreichen.
- Jede geöffnete App ist eine eigene Chromium-Ansicht und belegt entsprechend Arbeitsspeicher. Ansichten werden deshalb erst beim ersten Aufruf geladen.
- Electron hat keinen Push-Dienst. OdooBar bietet Odoo die Push-Schnittstelle deshalb nicht an, sonst meldete Odoo bei jedem Start „Push-Benachrichtigungen konnten nicht aktiviert werden“. Benachrichtigungen zeigt Odoo trotzdem, aber nur, solange OdooBar läuft und mindestens eine App geladen ist.
- OdooBar gibt sich Webseiten gegenüber als OdooBar auf Electron zu erkennen. Identitätsanbieter, die eingebettete Browser ablehnen, etwa Google, können die Anmeldung deshalb verweigern.

## Entwicklung

Voraussetzungen: macOS 13 oder neuer auf Apple Silicon, Node.js 22.12 oder neuer.

```sh
git clone git@github.com:B42Labs/odoobar.git
cd odoobar
npm install
npm start            # App im Entwicklungsmodus starten, Strg+C beendet sie
npm test             # Unit-Tests und Starttest
npm run dist         # .app und .dmg in dist/ bauen
npm run test:dist    # Ergebnis von npm run dist prüfen
```

Der erste Aufruf von `npm start`, `npm test` oder `npm run dist` lädt Electron herunter und braucht eine Netzwerkverbindung.

### Bauen mit Docker

Wer kein Node.js installieren möchte, baut die App in einem Container. Dafür genügen Docker und `make`.

```sh
make build           # dist/mac-arm64/OdooBar.app im Container bauen
make run             # bei Bedarf bauen, dann die App mit einem Testprofil starten, Strg+C beendet sie
make reset           # Testprofil löschen, der nächste Start ist wieder ein erster Start
make clean           # gebaute App und Testprofil löschen
```

Der Container übersetzt und paketiert, signiert wird danach auf dem Mac. Eine `.dmg` entsteht dabei nicht, die baut nur `npm run dist`.

`make run` legt Konfiguration und Anmeldung in `.test-profile/` im Repository ab und lässt das Profil unter `~/Library/Application Support/OdooBar` und den Start bei der Anmeldung unberührt. Weitere Argumente reicht `ARGS` durch, etwa `make run ARGS=--lang=en`.

## Offene Punkte

- Endgültiger Name der App
- Eigene Symbole für die Menüleiste
- Zähler für ungelesene Discuss-Nachrichten am Menüleisten-Symbol
- Unterstützung mehrerer Odoo-Instanzen
- Signierung und Notarisierung für die Verteilung außerhalb des App Store
- Lizenz

## Hinweis

Odoo ist eine Marke der Odoo S.A. Dieses Projekt steht in keiner Verbindung zu Odoo S.A.
