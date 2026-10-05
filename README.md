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

### Tastenkürzel

| Kürzel | Wirkung |
| --- | --- |
| Frei konfigurierbar pro App | App systemweit nach vorn holen, erneutes Drücken blendet das Fenster aus |
| `⌘1` bis `⌘9` | Im Fenster zur ersten bis neunten App wechseln |
| `⌘R` | Aktive App neu laden |
| `⌘,` | Einstellungen öffnen |
| `⌘W` | Fenster ausblenden, OdooBar läuft in der Menüleiste weiter |

Ist ein globales Kürzel bereits von einem anderen Programm belegt, zeigen die Einstellungen einen Hinweis an.

### Anmeldung

Beim ersten Start fragt OdooBar nach der Odoo-URL und zeigt danach die normale Odoo-Anmeldeseite. Zwei-Faktor-Anmeldung und Single Sign-on funktionieren deshalb wie im Browser.

OdooBar speichert kein Passwort. Erhalten bleibt nur das Sitzungs-Cookie im eigenen Chromium-Profil der App. Läuft die Sitzung serverseitig ab, erscheint im Fenster wieder die Anmeldeseite. Nach dem Login gilt die Sitzung sofort für alle Apps.

„Abmelden“ in den Einstellungen löscht das Profil mit allen Cookies.

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
| `baseUrl` | Adresse der Odoo-Instanz, ohne abschließenden Schrägstrich |
| `launchAtLogin` | OdooBar bei der Anmeldung am Mac starten |
| `apps` | Liste der Apps. Die Reihenfolge bestimmt die Reihenfolge in Menüleiste und App-Leiste |

### Felder pro App

| Feld | Bedeutung |
| --- | --- |
| `id` | Eindeutiger interner Name |
| `name` | Anzeigename in der App-Leiste und als Tooltip in der Menüleiste |
| `url` | Startadresse der App. Ein Pfad wie `/odoo/crm` wird an `baseUrl` angehängt, eine vollständige URL wird unverändert verwendet |
| `icon` | Name des Symbols für die Menüleiste |
| `shortcut` | Globales Tastenkürzel im [Electron-Accelerator-Format](https://www.electronjs.org/docs/latest/api/accelerator), leer für kein Kürzel |
| `menuBar` | `true` zeigt die App als Symbol in der Menüleiste. Bei `false` ist sie nur über App-Leiste und Kürzel erreichbar |

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

Links, die aus der Odoo-Instanz hinausführen, öffnen sich im Standardbrowser des Systems. Alles unterhalb von `baseUrl` bleibt im Fenster.

### Bekannte Einschränkungen

- macOS blendet Menüleisten-Symbole aus, wenn der Platz nicht reicht, vor allem auf MacBooks mit Notch. Bei vielen Apps lohnt es sich, nur die wichtigsten in die Menüleiste zu legen und den Rest über Kürzel und App-Leiste zu erreichen.
- Jede geöffnete App ist eine eigene Chromium-Ansicht und belegt entsprechend Arbeitsspeicher. Ansichten werden deshalb erst beim ersten Aufruf geladen.

## Entwicklung

Voraussetzungen: macOS 13 oder neuer, Node.js 22 oder neuer.

```sh
git clone git@github.com:B42Labs/odoo.git
cd odoo
npm install
npm start        # App im Entwicklungsmodus starten
npm run dist     # .app und .dmg bauen
```

## Offene Punkte

- Endgültiger Name der App
- Symbolsatz für die Menüleiste und Umgang mit eigenen Symbolen
- Zähler für ungelesene Discuss-Nachrichten am Menüleisten-Symbol
- Unterstützung mehrerer Odoo-Instanzen
- Signierung und Notarisierung für die Verteilung außerhalb des App Store
- Lizenz

## Hinweis

Odoo ist eine Marke der Odoo S.A. Dieses Projekt steht in keiner Verbindung zu Odoo S.A.
