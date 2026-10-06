# OdooBar

> Arbeitstitel. Status: Konzept. Dieses Repository enthält noch keinen Code, die README beschreibt den geplanten Funktionsumfang.

OdooBar ist eine kleine macOS-App, die einzelne Odoo-Apps (z. B. Discuss, CRM, Kalender) als Symbole in die Menüleiste oben rechts legt. Ein Klick oder ein globales Tastenkürzel holt die jeweilige App in einem eigenen Fenster nach vorn. Die Seiten laufen in einer eingebetteten Chromium-Engine, es wird kein Safari, Chrome oder anderer installierter Browser geöffnet.

## Funktionen

- **Menüleisten-Symbole**: Jede konfigurierte Odoo-App kann ein eigenes Symbol in der macOS-Menüleiste bekommen. Ein Klick zeigt die App an.
- **Globale Tastenkürzel**: Pro App ein frei wählbares Kürzel, das systemweit funktioniert, auch wenn gerade ein anderes Programm im Vordergrund ist.
- **Einmal anmelden**: Alle Apps teilen sich eine Sitzung. Der Login bleibt über Neustarts hinweg erhalten.
- **Konfigurierbare Odoo-URL**: Die Basis-URL der Odoo-Instanz wird einmal eingestellt.
- **Konfigurierbare App-URLs**: Jede App hat eine eigene URL, relativ zur Basis-URL oder absolut.
- **App-Leiste im Fenster**: Am oberen Fensterrand stehen alle konfigurierten Apps zum Umschalten, davor die Knöpfe für Zurück, Vorwärts und Neu laden.
- **Apps aus Odoo heraus öffnen**: Ein Klick auf eine App in Odoo, etwa auf der Startseite, wechselt zu ihrem Eintrag in der App-Leiste. Fehlt die App dort, bekommt sie einen Eintrag, der sich wieder schließen lässt.
- **Eingebetteter Browser**: Die Darstellung übernimmt Chromium über Electron.
- **Hinweis auf neue Versionen**: Gibt es eine neuere Version von OdooBar, nennt ein Knopf in der App-Leiste sie und führt zu ihrem Download.

## Bedienung

### Menüleiste

Für jede App mit aktivierter Option „In Menüleiste anzeigen“ erscheint ein Symbol oben rechts.

| Aktion | Wirkung |
| --- | --- |
| Linksklick auf ein Symbol | Fenster nach vorn holen und diese App anzeigen |
| Linksklick, während die App schon im Vordergrund ist | Fenster ausblenden |
| Rechtsklick | Menü mit „Neu laden“, „Einstellungen …“ und „Beenden“ |

Die Symbole stehen in der Reihenfolge der Konfiguration, die erste App ganz links, und der Tooltip nennt die App. Liegt das Fenster hinter einem anderen Programm, holt der Klick es nach vorn. „Neu laden“ lädt die App dieses Symbols neu, auch wenn das Fenster verborgen ist oder eine andere App zeigt. Solange die App noch nicht geöffnet wurde, ist der Eintrag ausgegraut. Hat keine App die Option, zeigt OdooBar kein Symbol, und das Fenster öffnet nur ein erneuter Start von OdooBar.

Die App startet auf Wunsch automatisch bei der Anmeldung am Mac. Dann bleibt das Fenster verborgen, bis ein Symbol, ein Tastenkürzel oder ein erneuter Start es öffnet.

### Menü und Dock

Solange ein Fenster von OdooBar offen ist, hat die App ein Dock-Symbol, und ist sie im Vordergrund, zeigt die macOS-Menüleiste links ihr Menü. macOS gibt nur einer App mit Dock-Symbol ein Menü. Ist kein Fenster mehr offen, verschwindet das Dock-Symbol wieder, und OdooBar läuft nur noch mit den Symbolen oben rechts weiter. Ein Klick auf das Dock-Symbol holt das Fenster nach vorn.

| Menü | Einträge |
| --- | --- |
| OdooBar | „Über OdooBar“, „Einstellungen …“ (`⌘,`), Ausblenden, „OdooBar beenden“ (`⌘Q`) |
| Bearbeiten | Widerrufen, Ausschneiden, Kopieren, Einsetzen, Alles auswählen |
| Darstellung | Seite vergrößern und verkleinern (`⌘+`, `⌘-`, `⌘0`), Entwicklertools |
| Fenster | Im Dock ablegen, Zoomen, Fenster schließen (`⌘W`) |

„Über OdooBar“ zeigt die Version der App und die Adresse des Quellcodes, <https://github.com/B42Labs/odoobar>. „Auf GitHub öffnen“ öffnet sie im Standardbrowser. Während der Abfrage beim ersten Start ist „Einstellungen …“ ausgegraut.

### Fenster

Alle Apps teilen sich ein Fenster. Die Leiste am oberen Rand zeigt die konfigurierten Apps, die aktive ist hervorgehoben. Links davon stehen die Knöpfe „Zurück“, „Vorwärts“ und „Neu laden“. Gibt es eine neuere Version von OdooBar, erscheint links vom Zahnrad ein Knopf, der sie nennt (siehe „Aktualisierung“).

```
┌──────────────────────────────────────────────────────────┐
│  ‹  ›  ↻   Discuss   CRM   Kalender   Projekte       ⚙   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                  Odoo-Ansicht der aktiven App            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Jede App behält ihren Zustand, solange OdooBar läuft. Wer von CRM zu Discuss und wieder zurück wechselt, landet im selben Datensatz wie zuvor.

Die Pfeile blättern durch die Seiten, die die aktive App gezeigt hat, und der Knopf daneben lädt ihre Seite neu, wie `⌘R`. Jede App hat ihren eigenen Verlauf. Ein Pfeil ist ausgegraut, solange es in seiner Richtung keine Seite gibt.

Wer in Odoo eine App öffnet, etwa mit einem Klick auf „Kalender“ auf der Startseite oder im App-Menü, landet beim Eintrag dieser App in der Leiste, mit der Seite, die sie dort zuletzt gezeigt hat. Die Ansicht, in der der Klick fiel, bleibt, wo sie war. Steht die App nicht in der Leiste, legt OdooBar hinter den konfigurierten Apps einen Eintrag für sie an und zeigt ihn an. Ein solcher Eintrag trägt ein „×“, das ihn mit seiner Ansicht wieder schließt. Danach ist die App rechts daneben aktiv oder, wenn es keine gibt, die links daneben. Er steht nur in der App-Leiste, nicht in der Menüleiste und nicht in `config.json`, und bleibt bis zum „×“, bis zum Abmelden oder bis OdooBar beendet wird. Konfigurierte Apps haben kein „×“, sie entfernt nur das Einstellungsfenster. Wer eine so geöffnete App in den Einstellungen hinzufügt, bekommt statt des Eintrags mit „×“ den konfigurierten.

OdooBar erkennt eine App an ihrer Startadresse: Der Klick muss auf einen Link fallen, der genau dorthin führt, wie ihn Odoo für jede App der Startseite und des App-Menüs zeichnet. Welche Apps es außer den konfigurierten gibt, fragt OdooBar nach jedem Laden einer Seite bei Odoo ab, aus derselben Menüliste wie die Auswahl hinter „App hinzufügen“. Ohne Anmeldung kennt OdooBar deshalb nur die konfigurierten Apps. Jeder andere Link bleibt in seiner Ansicht, auch der zur App der Ansicht selbst.

Ein Klick auf die bereits aktive App in der Leiste lädt wieder ihre Startadresse. Kann eine Seite nicht geladen werden, stehen Adresse und Grund unter der Leiste, und „Erneut versuchen“ oder `⌘R` lädt sie neu.

Jeder Start von OdooBar öffnet das Fenster. Nur wenn macOS OdooBar bei der Anmeldung startet, bleibt es verborgen. Wer OdooBar startet, während es schon läuft, holt das Fenster nach vorn. Der rote Schließen-Knopf blendet das Fenster aus, genau wie `⌘W`.

### Tastenkürzel

| Kürzel | Wirkung |
| --- | --- |
| Frei konfigurierbar pro App | App systemweit nach vorn holen, erneutes Drücken blendet das Fenster aus |
| `⌘1` bis `⌘9` | Im Fenster zur ersten bis neunten App der Leiste wechseln |
| `⌘R` | Aktive App neu laden |
| `⌘,` | Einstellungen öffnen |
| `⌘W` | Fenster ausblenden, OdooBar läuft in der Menüleiste weiter |

Ein globales Kürzel gilt, solange OdooBar läuft, auch bei verborgenem Fenster. Liegt das Fenster hinter einem anderen Programm, holt das Kürzel es nach vorn. Ein Kürzel ohne Modifikator, etwa `D`, nimmt diese Taste allen anderen Programmen weg.

macOS teilt einer App nicht mit, ob ein anderes Programm oder macOS selbst ein Kürzel schon verwendet. Reagiert ein Kürzel nicht wie erwartet, ist es vermutlich anderweitig belegt, und ein anderes Kürzel hilft. Zwei Fehler erkennt OdooBar selbst: einen Text, der kein gültiges Kürzel ist, und ein Kürzel, das zwei Apps von OdooBar haben. Ein ungültiges Kürzel bleibt ohne Wirkung, ein doppeltes gilt für die erste der beiden Apps in der Konfiguration. Die Einstellungen zeigen in beiden Fällen einen Hinweis an.

### Anmeldung

Beim ersten Start fragt OdooBar nach der Odoo-URL und zeigt danach die normale Odoo-Anmeldeseite. Zwei-Faktor-Anmeldung und Single Sign-on funktionieren deshalb wie im Browser.

OdooBar speichert kein Passwort. Erhalten bleibt nur das Sitzungs-Cookie im eigenen Chromium-Profil der App, im Ordner `Partitions/odoo` neben `config.json`. Läuft die Sitzung serverseitig ab, erscheint im Fenster wieder die Anmeldeseite. Nach dem Login gilt die Sitzung sofort für alle Apps. Zeigt eine andere App noch die Anmeldeseite, lädt `⌘R` oder ein Klick auf die bereits aktive App in der Leiste sie neu.

„Abmelden“ in den Einstellungen löscht das Profil mit allen Cookies, also alles, was die Odoo-Seiten gespeichert haben. Die Konfiguration bleibt erhalten. Die Einträge mit „×“ verschwinden aus der App-Leiste, denn die nächste Anmeldung kann ein anderes Konto mit anderen Apps sein. Die Sitzung auf dem Odoo-Server beendet das nicht, sie läuft dort von selbst ab. Wer sie sofort beenden will, meldet sich vorher in Odoo ab.

### Einstellungen

Das Einstellungsfenster öffnet sich über das Zahnrad in der App-Leiste, mit `⌘,`, über „Einstellungen …“ im Menü „OdooBar“ und über denselben Eintrag im Menü eines Symbols. Es erscheint mittig über dem Fenster von OdooBar, also auf dessen Bildschirm. Ist das Fenster ausgeblendet, erscheint es in der Mitte des Bildschirms, auf dem der Mauszeiger steht.

Änderungen wirken erst mit „Speichern“: OdooBar prüft alle Werte, schreibt `config.json`, und App-Leiste, Menüleiste, Tastenkürzel und der Start bei der Anmeldung übernehmen die neue Konfiguration ohne Neustart. Verletzt ein Wert eine Regel, nennt das Fenster den Fehler neben „Speichern“, markiert das Feld und lässt die Datei unverändert. Wer das Fenster mit ungespeicherten Änderungen schließt, etwa mit `⌘W` oder dem roten Knopf, wird gefragt, ob sie verworfen werden sollen.

Apps lassen sich hinzufügen, entfernen und mit den Pfeilen nach oben oder unten verschieben. „App hinzufügen“ öffnet eine Auswahl: „Leere App“ legt eine leere Zeile an, darunter stehen die Apps, die das angemeldete Odoo-Konto nutzen darf. Ein Klick auf eine davon legt eine Zeile mit Name, Adresse und Symbol an, die sich wie jede andere ändern lässt. Eine neue App bekommt beim Speichern eine `id` aus ihrem Namen.

Die Auswahl fragt bei jedem Öffnen die Menüliste ab, aus der auch die Odoo-Startseite ihre Apps liest, und zwar bei der gespeicherten Odoo-Adresse und mit der Anmeldung aus dem Fenster von OdooBar. Ohne Anmeldung steht dort ein Hinweis statt der Apps. Die Namen kommen in der Sprache des Odoo-Kontos. Ein Symbol bekommen die Apps, die OdooBar kennt, etwa Discuss, CRM oder Kalender. Jede andere App bleibt ohne Symbol und zeigt das Ersatzsymbol, bis eines gewählt ist. Ein Klick auf das Symbol einer App öffnet ein Raster aller Lucide-Symbole, das ein Suchfeld eingrenzt. „Kein Symbol“ lässt das Feld leer.

„Aufnehmen“ nimmt ein Tastenkürzel auf: danach die Tasten drücken, `Esc` beendet die Aufnahme ohne Änderung. Während der Aufnahme ruhen die globalen Kürzel von OdooBar. Ein aufgenommenes Kürzel braucht `⌘`, `⌃` oder `⌥`, außer bei einer Funktionstaste wie `F5`. Das Feld nimmt ein Kürzel auch als Text im Accelerator-Format an, etwa `Control+Alt+D`.

Die Aufnahme benennt eine Taste nach ihrer Lage auf der US-Tastatur, weil Electron globale Kürzel unter macOS so registriert. Auf einer deutschen Tastatur erscheint die Taste mit der Aufschrift Z deshalb als `Y` und wirkt trotzdem dort, wo sie gedrückt wurde.

Die Zeile einer App zeigt nach dem Speichern einen Hinweis, wenn ihr Kürzel kein gültiges Kürzel ist, wenn eine App weiter oben dasselbe Kürzel hat oder wenn macOS es abgelehnt hat. Ob ein anderes Programm ein Kürzel verwendet, erfährt OdooBar nicht. Darauf weist ein fester Text unter der App-Liste hin.

„Abmelden“ steht im Abschnitt „Sitzung“ und fragt vorher nach.

### Aktualisierung

Die installierte App fragt beim Start und danach alle 24 Stunden bei GitHub nach dem neuesten Release von `B42Labs/odoobar`. Die Anfrage enthält nichts aus der Konfiguration und nichts von Odoo. Ist das Release neuer als die laufende Version, erscheint links vom Zahnrad ein Knopf mit der neuen Versionsnummer, etwa „Update auf 0.2.0“. Er öffnet die Release-Seite im Standardbrowser und bleibt, bis OdooBar beendet wird.

Installiert wird von Hand: die `.dmg` von der Release-Seite laden, OdooBar beenden, die App im Ordner „Programme“ ersetzen und sie öffnen, wie es die Release-Seite beschreibt. Konfiguration und Anmeldung bleiben erhalten. Selbst installieren kann OdooBar ein Update nicht, denn macOS erlaubt das nur signierten Apps.

Schlägt eine Abfrage fehl, etwa ohne Netzwerk, zeigt OdooBar nichts an, und die nächste Abfrage versucht es erneut. `npm start` und `make run` fragen nie. Solange das Repository privat ist, beantwortet GitHub keine Anfrage ohne Anmeldung, und der Knopf erscheint nicht.

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
| `shortcut` | Globales Tastenkürzel im [Electron-Accelerator-Format](https://www.electronjs.org/docs/latest/api/accelerator): beliebig viele Modifikatoren wie `Command`, `Control`, `Alt` und `Shift`, dann genau eine Taste, verbunden mit `+`, etwa `Control+Alt+D`. `AltGr` gibt es auf dem Mac nicht, ein Kürzel damit ist ungültig. Leer für kein Kürzel |
| `menuBar` | `true` zeigt die App als Symbol in der Menüleiste. Bei `false` ist sie nur über App-Leiste und Kürzel erreichbar |

### Erster Start und fehlerhafte Datei

Beim ersten Start fragt OdooBar nach der Odoo-URL und legt die Datei mit zwei Apps an: „Home“ (`/odoo`) und „Zeiterfassung“ (`/odoo/timesheets`), beide mit Symbol in der Menüleiste und ohne Tastenkürzel. Wer die Abfrage schließt, beendet OdooBar, und der nächste Start fragt erneut.

Nur `baseUrl` ist Pflicht. Fehlt `launchAtLogin` oder `menuBar`, gilt `false`. Fehlt `apps`, ist die Liste leer. Fehlt `icon` oder `shortcut`, gilt der leere Text. Jede App braucht `id`, `name` und `url`, und jede `id` darf nur einmal vorkommen. Ein `shortcut`, der kein gültiges Kürzel ist, macht die Datei nicht ungültig, die App hat dann nur kein Kürzel.

`launchAtLogin` und `menuBar` sind `true` oder `false`, `apps` ist eine Liste, alle anderen Felder sind Texte. `id` und `name` dürfen nicht leer sein. `baseUrl` verwendet `http://` oder `https://` und enthält weder Benutzername noch Passwort, `?` oder `#`. Die `url` einer App ist ein Pfad, der mit `/` beginnt, oder eine vollständige Adresse mit `http://` oder `https://`.

OdooBar liest die Datei beim Start. Änderungen von Hand wirken nach einem Neustart. „Speichern“ im Einstellungsfenster schreibt die Datei in der Form des Beispiels neu und lässt Schlüssel weg, die OdooBar nicht kennt. Ist die Datei kein gültiges JSON oder verletzt sie eine dieser Regeln, nennt ein Dialog die Stelle und bietet zwei Wege an: „Beenden“ lässt die Datei unverändert, „Zurücksetzen“ benennt sie in `config.invalid-<Datum>-<Uhrzeit>.json` um und fragt erneut nach der Odoo-URL.

Die Oberfläche ist deutsch, wenn macOS OdooBar auf Deutsch startet, und sonst englisch. Auf einem englischen System heißt die zweite App „Timesheets“.

Der Start bei der Anmeldung gilt nur für die gebaute App, nicht für `npm start`. Unter `npm start` heißt das erste Menü außerdem „Electron“ statt „OdooBar“, weil macOS den Namen aus dem App-Bundle nimmt.

### Odoo-URLs

Welche Pfade gültig sind, hängt von der Odoo-Version ab:

- Ab Odoo 18 haben viele Apps sprechende Pfade wie `/odoo/discuss` oder `/odoo/crm`.
- Ältere Versionen verwenden Adressen der Form `/web#action=123&menu_id=45`.

Die Auswahl hinter „App hinzufügen“ trägt die passende Adresse selbst ein: ab Odoo 18 den sprechenden Pfad oder, wenn die App keinen hat, `/odoo/action-123`, davor die Form mit `/web#`.

Für alles andere ist es am einfachsten, die gewünschte Ansicht in Odoo zu öffnen und die Adresse aus der Adresszeile zu kopieren. So lassen sich auch gefilterte Listen oder einzelne Datensätze als eigene „App“ anlegen.

## Technik

OdooBar basiert auf [Electron](https://www.electronjs.org/) und bringt damit eine eigene Chromium-Engine mit. Die Wahl fiel auf Electron, weil es alle benötigten Bausteine fertig mitliefert:

| Anforderung | Electron-Baustein |
| --- | --- |
| Symbole in der Menüleiste | `Tray`, ein Exemplar pro App |
| Systemweite Tastenkürzel | `globalShortcut` |
| Eingebettete Odoo-Ansichten | `WebContentsView`, eine Ansicht pro App in einem gemeinsamen `BrowserWindow` |
| Gemeinsamer, dauerhafter Login | Eine persistente Session-Partition (`persist:odoo`) für alle Ansichten |
| Autostart | `app.setLoginItemSettings` |
| Menü in der Menüleiste | `Menu`, dazu `app.dock`, das das Dock-Symbol zeigt, solange ein Fenster offen ist |
| Hinweis auf neue Versionen | `net.fetch` gegen die Releases-API von GitHub |

Die App-Leiste ist eine eigene kleine Ansicht oberhalb der Odoo-Ansichten. Die Odoo-Seiten selbst werden nicht verändert. OdooBar hört in ihnen nur auf Klicks auf Links: Führt ein Link zur Startadresse einer anderen App, wechselt das Fenster dorthin, und die Seite erfährt von diesem Klick nichts. Jeder andere Klick erreicht die Seite unverändert.

Die Symbole der Menüleiste stammen aus [Lucide](https://lucide.dev) 1.52.0 (ISC-Lizenz). Der Build rendert jedes Symbol als Vorlagenbild in 18 Punkt, das macOS passend zur Menüleiste einfärbt.

Links, die einen neuen Tab oder ein neues Fenster verlangen, öffnen sich im Standardbrowser des Systems, wenn sie aus der Odoo-Instanz hinausführen, und in derselben Ansicht, wenn sie unterhalb von `baseUrl` liegen. Führt ein solcher Link zur Startadresse einer anderen App, wechselt das Fenster zu ihr, wie bei einem gewöhnlichen Klick. Ein Seitenwechsel innerhalb einer Ansicht bleibt in der Ansicht, auch wenn er zu einer fremden Adresse führt. Nur so funktioniert die Anmeldung über einen externen Identitätsanbieter. Adressen, die keine Webseiten sind, lädt keine Ansicht: `mailto:`- und `tel:`-Links gehen an das System, alles andere, etwa eine ins Fenster gezogene Datei, wird verworfen.

### Bekannte Einschränkungen

- macOS blendet Menüleisten-Symbole aus, wenn der Platz nicht reicht, vor allem auf MacBooks mit Notch. Bei vielen Apps lohnt es sich, nur die wichtigsten in die Menüleiste zu legen und den Rest über Kürzel und App-Leiste zu erreichen.
- Jede geöffnete App ist eine eigene Chromium-Ansicht und belegt entsprechend Arbeitsspeicher. Ansichten werden deshalb erst beim ersten Aufruf geladen.
- Electron hat keinen Push-Dienst. OdooBar bietet Odoo die Push-Schnittstelle deshalb nicht an, sonst meldete Odoo bei jedem Start „Push-Benachrichtigungen konnten nicht aktiviert werden“. Benachrichtigungen zeigt Odoo trotzdem, aber nur, solange OdooBar läuft und mindestens eine App geladen ist.
- Der Wechsel zu einer App, die in Odoo geöffnet wird, hängt am Klick auf ihren Link. Wer eine App in Odoo anders öffnet, etwa über die Suche der Startseite mit der Eingabetaste, öffnet sie wie bisher in der Ansicht, die gerade zu sehen ist. Dasselbe gilt für eine konfigurierte App, deren `url` nicht die Startadresse ist, die Odoo für sie verwendet: Sie bekommt beim Klick in Odoo einen zweiten Eintrag mit „×“.
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

### Release

Ein Release entsteht aus einem Versions-Tag. Zuerst die Version setzen und die Änderung wie jede andere über einen Pull Request zusammenführen:

```sh
npm version <x.y.z> --no-git-tag-version   # Version in package.json und package-lock.json setzen
```

Danach auf dem aktuellen `main` den Tag setzen und pushen:

```sh
git tag v<x.y.z>
git push origin v<x.y.z>
```

Der Workflow `.github/workflows/release.yml` vergleicht Tag und Version, baut die `.dmg` auf einem macOS-Runner, führt die Unit-Tests und die Prüfungen des Bundles aus und veröffentlicht das Release mit der `.dmg`, den Installationshinweisen aus `.github/release-notes.md` und der Liste der Änderungen, die GitHub aus den zusammengeführten Pull Requests erzeugt. Passt der Tag nicht zur Version, bricht der Workflow vor dem Bauen ab. Gibt es zum Tag schon ein Release, scheitert erst der letzte Schritt, und das Release muss zuvor gelöscht werden. Von Hand auf einem Branch gestartet, baut und prüft der Workflow, ohne etwas zu veröffentlichen.

Der Build ist nicht mit einer Developer ID signiert und nicht notarisiert. Die Smoke-Tests und die Tests `built app …` laufen im Workflow nicht, weil sie einen Bildschirm brauchen, der den Fokus nimmt. Vor dem Tag laufen sie lokal mit `npm test` und `npm run test:dist`.

## Offene Punkte

- Endgültiger Name der App
- Eigene Symbole für die Menüleiste
- Eigenes App-Symbol, das Dock zeigt bisher das Symbol von Electron
- Zähler für ungelesene Discuss-Nachrichten am Menüleisten-Symbol
- Unterstützung mehrerer Odoo-Instanzen
- Signierung und Notarisierung für die Verteilung außerhalb des App Store, die OdooBar auch braucht, um Updates selbst zu installieren
- Lizenz

## Hinweis

Odoo ist eine Marke der Odoo S.A. Dieses Projekt steht in keiner Verbindung zu Odoo S.A.
