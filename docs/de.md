# ZoneMinder

Bringt die Monitore eines [ZoneMinder](https://zoneminder.com/)-Servers in Gladys: ihr Bild, ob sie im
Alarm sind, ihren Modus (Monitor, Modect, Record, Mocord, Nodect), ob sie aufnehmen, und die Zahl der
Ereignisse des Tages. Ein neues Ereignis löst eine Szene mit Ursache und Punktzahl aus, dazu das Bild des
Moments, das eine Szene dir schicken kann. Szenen können außerdem alle Monitore auf Modect stellen, wenn
du gehst, und einen erzwungenen Alarm auslösen.

Getestet mit echten ZoneMinder-Servern in Docker (1.36.4 und 1.38.6) und simulierten Netzwerkkameras,
noch nicht mit einer lange laufenden Installation: Rückmeldungen sind willkommen auf
[GitHub](https://github.com/guim31/gladys-zoneminder/issues) oder im Gladys-Forum.

## Was du brauchst

- Gladys 5.1 oder neuer.
- Einen ZoneMinder-Server, den Gladys im lokalen Netzwerk erreicht, Version 1.36 oder neuer. 1.36 und
  1.37+ werden unterstützt: Ab 1.37 besteht der Modus aus den
  Einstellungen „Analysing“ und „Recording“, die die Integration liest und schreibt.
- Die eingeschaltete API: **Options → System → OPT_USE_API** (standardmäßig an).
- Wenn ZoneMinder eine Anmeldung verlangt (**OPT_USE_AUTH**), ein Konto mit angehaktem **API Enabled**
  unter **Options → Users**. Lesen braucht „Monitors: View“ und „Events: View“, den Modus ändern
  braucht „Monitors: Edit“.

## Einrichtung

1. Öffne in Gladys **Integrationen**, suche **ZoneMinder** und installiere es.
2. Fülle im Tab **Konfiguration** aus:
   - **ZoneMinder-Adresse**: die Adresse der ZoneMinder-Weboberfläche, z. B. `http://192.168.1.20/zm`.
     Ohne Pfad werden `/zm` und dann `/` versucht (manche Docker-Images liefern ZoneMinder unter der
     Wurzel aus). Füge bei Bedarf `https://` oder einen Port hinzu.
   - **Benutzername** (standardmäßig `admin`) und **Passwort**. Lass den Benutzernamen leer, wenn
     ZoneMinder keine Anmeldung hat.
   - **Alarmprüfung**: wie oft Alarmzustand und neue Ereignisse der in Gladys hinzugefügten Monitore
     gelesen werden (2, 5, 10 oder 30 Sekunden, standardmäßig 5).
   - **Bildaktualisierung**: wie oft das Bild jeder Kamera an Gladys gesendet wird (10 Sekunden bis 15
     Minuten, standardmäßig 1 Minute). Ein Alarm oder ein neues Ereignis sendet sofort eines.
   - **Sprache der Namen**: die Sprache der Funktionsnamen, die beim Hinzufügen einer Kamera vergeben
     werden.
3. Speichere und öffne den Tab **Entdecken**: ein Gerät pro Monitor. Füge die gewünschten hinzu.
4. **Verbindung prüfen** zeigt, was die Integration liest: die ZoneMinder-Version, jeden Monitor, ob er
   Bilder empfängt, und seinen Modus.

## Die Gladys-Geräte

Jeder Monitor wird zu einer Gladys-Kamera mit dem Namen des Monitors, mit:

| Funktion             | Was es ist                                                                        |
| -------------------- | --------------------------------------------------------------------------------- |
| **Bild**             | Das Kamerabild, im gewählten Takt und sofort bei Alarm oder Ereignis gesendet.    |
| **Alarm**            | 1, solange ZoneMinder den Monitor im Alarm meldet (Bewegung, erzwungen), sonst 0. |
| **Modus**            | Monitor, Modect, Record, Mocord oder Nodect. Im Dashboard änderbar.               |
| **Aufnahme aktiv**   | 1, wenn der Monitor aktiviert ist und aufnimmt, 0, wenn er in ZoneMinder aus ist. |
| **Ereignisse heute** | Seit Mitternacht auf diesem Monitor begonnene Ereignisse.                         |

Der **Modus** ist absichtlich eine Liste: eine bewusste Wahl, nie ein Schalter, den ein
Sprachassistent versehentlich ausschaltet. **Aufnahme aktiv** ist nur lesbar: eine Überwachungskamera
auszuschalten bleibt eine Entscheidung in ZoneMinder. Ein Monitor, der keine Bilder mehr von seiner
Kamera bekommt, erscheint in Gladys als nicht erreichbar (jede Minute geprüft).

**Mit Version 1.0.x hinzugefügte Monitore**: Die alte Funktion **Aufnahme aktiv** hatte den
Gladys-Typ „Kamera aktiviert", den Gladys 5.2 als Privatsphäre-Modus der Kamera nutzt (bei 0
verweigert Gladys ihre Bilder). Öffne den Tab „Entdecken" der Integration und klicke bei jedem
Monitor auf **Aktualisieren**: Die Funktion wird durch die neue ersetzt. Bis dahin setzt die
Integration die alte beim Start einmal auf 1, damit die Bilder weiter ankommen.

## Dashboard-Widget

**ZoneMinder-Kamera** zeigt das Bild einer Kamera, ob sie im Alarm ist, ihren Modus, die Ereignisse
des Tages und zwei Schaltflächen: **Alarm auslösen** (oder **Alarm beenden**, solange einer läuft; nur
für einen Monitor in Modect, Mocord oder Nodect) und **Neues Bild**.

## Szenen

### Auslöser

- **ZoneMinder: neues Ereignis**: ZoneMinder beginnt, ein Ereignis aufzuzeichnen. Filter: die Kamera
  (leer = alle) und die **Art des Ereignisses**: Bewegung, Erzwungener Alarm, Daueraufnahme (die
  Abschnitte von Record und Mocord), Signalverlust, Verknüpfter Monitor, Andere. Variablen:
  Kameraname, Art, Ursache (wie ZoneMinder sie schreibt, z. B. `Motion: All`), Punktzahl (die höchste
  beim Erkennen des Ereignisses; sie kann noch steigen) und Ereignisnummer. Das Bild des Moments wird
  zuerst an Gladys gesendet.
- **ZoneMinder: Kamera offline**: ein Monitor bekommt keine Bilder mehr von seiner Kamera, oder
  ZoneMinder selbst antwortet nicht mehr. Nicht ausgelöst für einen in ZoneMinder ausgeschalteten
  Monitor.

### Aktionen

- **ZoneMinder: Modus ändern**: stellt den Modus einer Kamera ein, oder aller Kameras, wenn die Kamera
  leer bleibt. „Alle“ meint die in Gladys hinzugefügten, aufnehmenden Kameras. Nur Monitore, deren Modus sich ändert, werden geschrieben (jeder startet einige
  Sekunden neu). Ausgabe: die Zahl der geänderten Kameras.
- **ZoneMinder: erzwungener Alarm**: **Auslösen** lässt ZoneMinder ein Ereignis aufzeichnen (Ursache
  „Forced Web“), bis **Beenden**. Nur für einen Monitor in Modect, Mocord oder Nodect.
- **ZoneMinder: Kamera abfragen**: liest eine Kamera jetzt. Ausgaben: empfängt Bilder, im Alarm,
  Aufnahme aktiv, Modus (`monitor`, `modect`…) und Ereignisse heute, für die Bedingungen der folgenden
  Aktionen.

Die Kern-Aktion **Kameraaufnahme senden** sendet das letzte Bild einer Kamera: direkt nach
**ZoneMinder: neues Ereignis** ist es das Bild dieses Ereignisses.

### Szenen-Ideen

- **Alarmanlage scharf**: wenn alle weg sind, **ZoneMinder: Modus ändern** auf Modect für alle
  Kameras; zurück auf Monitor, wenn jemand heimkommt.
- **Einbruch**: **ZoneMinder: neues Ereignis**, Art Bewegung, Kamera „Garten“, bei scharfer Anlage →
  **Kameraaufnahme senden** dieser Kamera auf dein Handy.
- **Tür nachts geöffnet**: ein Öffnungssensor öffnet → **ZoneMinder: erzwungener Alarm**, Auslösen, an
  der Flurkamera; zwei Minuten später Beenden.
- **Kamera verloren**: **ZoneMinder: Kamera offline** → eine Nachricht mit dem Kameranamen senden.

## Fehlerbehebung

- **„ZoneMinder lehnt Benutzername oder Passwort ab“**: prüfe sie auf der Anmeldeseite von ZoneMinder.
- **„Dieser ZoneMinder-Benutzer darf die API nicht nutzen“**: hake **API Enabled** für diesen Benutzer
  unter **Options → Users** an.
- **„ZoneMinder antwortet, aber nicht wie erwartet“**: der Adresse fehlt vielleicht der Pfad. Versuche
  `http://<Adresse>/zm` oder die Adresse aus dem Browser, ohne `index.php`.
- **„Insufficient privileges“ beim Ändern eines Modus**: das Konto braucht „Monitors: Edit“.
- **Ein erzwungener Alarm wird abgelehnt**: der Monitor analysiert seine Bilder nicht (Monitor oder
  Record). Stelle ihn zuerst auf Modect, Mocord oder Nodect.
- **Eine Kamera bleibt nicht erreichbar**: ZoneMinder bekommt keine Bilder von ihr (ihr Status ist in
  der ZoneMinder-Konsole nicht „Connected“). Prüfe die Kamera in ZoneMinder.
- **Mehr Details**: die Protokolle der Integration (Integrationen → ZoneMinder → Protokolle); setze
  `LOG_LEVEL` auf `debug`, um jede Anfrage zu sehen.

## Grenzen

- Kein Live-Video: Gladys zeigt Bilder im gewählten Takt (Gladys behält höchstens 12 Bilder pro Minute
  und Kamera). Den Live-Stream siehst du in ZoneMinder.
- Alarme und Ereignisse werden alle paar Sekunden gelesen (die Alarmprüfung): ein sehr kurzer Alarm
  zwischen zwei Prüfungen erscheint als Ereignis, nicht als Alarmzustand.
- **Ereignisse heute** zählt ab Mitternacht in der Zeitzone von ZoneMinder: Gladys und ZoneMinder
  sollten dieselbe haben.
- Ein ZoneMinder-Server pro Integration. Bei mehreren ZoneMinder-Servern (Multi-Server) werden die
  Bilder eines Monitors bei der Adresse der Konfiguration angefragt.
- Der Modus „None“ (keine Aufnahme) und das Ausschalten eines Monitors werden nicht angeboten: mach das
  in ZoneMinder.
- Unter ZoneMinder 1.37+ bedeutet Nodect ohne Analyse: ein erzwungener Alarm braucht dort einen analysierenden Monitor (Modect, Mocord). Ein in ZoneMinder ausgeschalteter Monitor behält seinen Modus.
- Ohne lange laufende ZoneMinder-Installation entwickelt: Rückmeldungen sind willkommen.

Diese Integration ist nicht mit dem ZoneMinder-Projekt verbunden.
