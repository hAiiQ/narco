# Tequi-La-La Crew Portal

Ein vollständiges, responsives Mitarbeiter- und Verwaltungsportal für die Tequi-La-La Bar.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/hAiiQ/narco)

## Funktionen

- Registrierung mit IC-Vorname, IC-Nachname, IC-Geburtsdatum, Geschlecht und sicherem Passwort
- Login über den vollständigen Narco-City-Ingame-Namen
- Der erste registrierte Account wird automatisch freigeschalteter Admin
- Alle weiteren Accounts müssen von einem Admin bestätigt werden
- Mitarbeiterprofile mit Name, Rolle, Alter, Geburtsdatum, Aufgabenbereich, Info und Profilbild
- Abgaben mit persönlichem Fortschritt, Zielwert und Admin-Bestätigung
- Inventar mit Bildern, Mengen, Geld und Schwarzgeld
- Speisekarte mit Bildern, Preisen und Verfügbarkeit
- Eventübersicht mit Termin, Ort, Beschreibung und Bild
- Vollständiger Adminbereich für Accounts, Rollen, Abgaben und alle Inhalte
- Rollen können frei hinzugefügt, bearbeitet und entfernt werden
- Optimiert für Desktop, Tablet und Smartphone

## Auf Render veröffentlichen

1. Dieses Repository zu GitHub pushen.
2. Oben auf **Deploy to Render** klicken oder in Render **New → Blueprint** wählen.
3. Das Repository `hAiiQ/narco` verbinden und den Blueprint anwenden.
4. Nach dem ersten Start die Website öffnen und sofort den ersten Account registrieren. Dieser Account ist automatisch der Admin.

Die Datei `render.yaml` erstellt den Webservice und die PostgreSQL-Datenbank inklusive aller benötigten Umgebungsvariablen. Bilder werden direkt in PostgreSQL gespeichert und gehen deshalb bei einem Neustart des Webservices nicht verloren.

> Hinweis: Kostenlose Render-PostgreSQL-Datenbanken laufen laut Render nach 30 Tagen ab. Für einen dauerhaften Live-Betrieb sollte die Datenbank rechtzeitig auf einen bezahlten Tarif umgestellt werden.

## Lokal starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm run dev
```

Ohne `DATABASE_URL` nutzt die App lokal eine temporäre In-Memory-Datenbank. Für dauerhafte lokale Daten kann eine PostgreSQL-Verbindung in einer `.env`-Datei hinterlegt werden; alle verfügbaren Variablen stehen in `.env.example`.

## Sicherheit

- Passwörter werden mit bcrypt gehasht.
- Sessions liegen in PostgreSQL und verwenden sichere, HTTP-only Cookies.
- Adminrechte werden für jede geschützte Anfrage serverseitig geprüft.
- Login und Registrierung sind gegen schnelle Wiederholungsversuche begrenzt.
- Bild-Uploads sind auf gängige Bildformate und 4 MB begrenzt.
