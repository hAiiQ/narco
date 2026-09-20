# Tequi-La-La Crew Portal

Ein vollständiges, responsives Mitarbeiter- und Verwaltungsportal für die Tequi-La-La Bar.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/hAiiQ/narco)

## Funktionen

- Registrierung mit IC-Vorname, IC-Nachname, IC-Geburtsdatum, Geschlecht und sicherem Passwort
- Login über den vollständigen Narco-City-Ingame-Namen
- Registrierte Accounts können sich sofort anmelden und benötigen keine Freischaltung
- Ohne zugewiesene Rolle bleibt das Portal gesperrt; Rollen werden im Adminbereich vergeben
- Der IC-Account `Michael Black` erhält automatisch Adminrechte und die Inhaber-Rolle
- Mitarbeiterprofile mit Name, Rolle, Alter, Geburtsdatum, Aufgabenbereich, Info und Profilbild
- Frei einstellbare Abgabezeiträume mit Start, Ende und Ziel pro Mitarbeiter
- Abgaben können Geld, Schwarzgeld oder einen frei gewählten Inventarartikel betreffen
- Jeder Mitarbeiter trägt seine Abgabe selbst ein; Fortschritt und noch offene Beträge sind für alle sichtbar
- Bestätigte Abgaben werden automatisch und ohne Doppelbuchung dem Geld, Schwarzgeld oder Inventar gutgeschrieben
- Inventar mit Bildern, Mengen, Geld und Schwarzgeld
- Speisekarte mit Bildern, Preisen und Verfügbarkeit
- Eventübersicht mit Termin, Ort, Beschreibung und Bild
- Vollständiger Adminbereich für Accounts, Rollen, Abgaben und alle Inhalte
- Rollen können frei hinzugefügt, bearbeitet und entfernt werden
- Neue Bild-Uploads werden automatisch verkleinert und platzsparend als WebP gespeichert
- Optimiert für Desktop, Tablet und Smartphone

## Auf Render veröffentlichen

1. Bei [Neon](https://neon.com/) ein kostenloses PostgreSQL-Projekt erstellen und die **Pooled connection string** kopieren.
2. Dieses Repository zu GitHub pushen.
3. Oben auf **Deploy to Render** klicken oder in Render **New → Blueprint** wählen.
4. Das Repository `hAiiQ/narco` verbinden und den Blueprint anwenden.
5. Für die abgefragte Variable `DATABASE_URL` die Neon-Verbindungsadresse eintragen. Bei einem bereits vorhandenen Render-Service muss sie unter **Environment** manuell ersetzt und anschließend **Save and deploy** gewählt werden.
6. Nach dem ersten Start den IC-Account `Michael Black` registrieren. Dieser Account erhält automatisch Adminrechte und kann anschließend die Rollen der übrigen Crew vergeben.

Die Datei `render.yaml` erstellt nur den kostenlosen Webservice. Die Datenbank liegt dauerhaft getrennt bei Neon. Bilder werden automatisch komprimiert und anschließend direkt in PostgreSQL gespeichert.

> Wichtig: Beim Wechsel der `DATABASE_URL` startet die neue Datenbank zunächst leer. Eine bisherige Render-Datenbank wird durch die Blueprint-Änderung nicht automatisch gelöscht und kann bei Bedarf vorher migriert werden.

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
