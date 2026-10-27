# WG-Putzplan – Umsetzungsplan

Web-App (PWA) für Lucas, Marlen und Paul zum Verteilen und Abhaken von wöchentlichen und monatlichen WG-Aufgaben, mit fairer automatischer Umverteilung bei Abwesenheit und Push-Erinnerungen. Komplett kostenlos: Hosting über GitHub Pages.

---

## 1. Architektur (alles kostenlos)

| Baustein | Lösung | Warum |
|---|---|---|
| Frontend | Vite + React + TypeScript + Tailwind CSS, als PWA | Schnell, mobilfähig, auf dem Homescreen installierbar |
| Hosting | **GitHub Pages**, Deploy per GitHub Action bei jedem Push auf `main` | Kostenlos, kein Server |
| Daten (geteilt für alle 3) | **Firebase Firestore** (kostenloser Spark-Plan) | GitHub Pages ist nur statisch – die drei brauchen einen gemeinsamen Datenstand mit Live-Sync. Firestore läuft direkt aus dem Browser, das Gratis-Kontingent reicht um Größenordnungen |
| Erinnerungen | **GitHub Actions Cron** (kostenlos) startet ein Node-Skript, das Push-Nachrichten verschickt (Web Push mit VAPID-Keys) | Kein bezahlter Server oder Cloud Functions nötig |
| Login | Name auswählen (Lucas / Marlen / Paul) + gemeinsamer WG-PIN, im Browser gemerkt | Einfach, reicht aus, weil keine sensiblen Daten gespeichert werden |

**Zugang für Mitbewohner:** Link zur Seite (`https://<user>.github.io/<repo>/`) und den WG-PIN in den Gruppenchat schicken → Namen auswählen → „Zum Home-Bildschirm“ → Benachrichtigungen erlauben.

> Hinweis iPhone: Web-Push funktioniert ab iOS 16.4 nur, wenn die App über „Zum Home-Bildschirm“ installiert wurde. Android/Desktop: direkt im Browser.

---

## 2. Datenmodell (Firestore)

```
household/main
  members: [{id:"lucas", name:"Lucas", color:"#3B82F6"}, {id:"marleen",…}, {id:"paul",…}]
  pinHash: string                     // SHA-256 des WG-PINs
  startDate: "2026-11-02"             // Beginn der Rotation (ein Montag)
  weekStart: { weekday: 1, hour: 0 }  // Wochenbeginn für "ganze Woche"-Aufgaben (konfigurierbar)

tasks/{taskId}
  name, icon (Emoji), cadence: "weekly" | "monthly"
  window: "weekend" | "fullWeek" | "fullMonth"   // Zeitraum, in dem die Aufgabe erledigt werden muss
  weight: number (Standard 1)                    // Aufwand, für die Fairness
  active: boolean, createdAt                     // Löschen = active:false, damit die Historie stimmt

absences/{id}
  memberId, from (Datum), to (Datum), note?

completions/{periodKey_taskId}
  doneBy, doneAt                      // abgehakt

snapshots/{periodKey}
  assignments: {taskId: memberId}     // eingefrorene Zuteilung, sobald eine Periode begonnen hat

pushSubscriptions/{memberId_deviceHash}
  memberId, subscription (Web-Push-JSON)
```

**Start-Aufgaben:**
- Wöchentlich: Saugen (Wochenende Fr–So), Küche putzen (Wochenende Fr–So), Müll runterbringen (ganze Woche)
- Monatlich: Wohnung wischen, Kühlschrank putzen, Pappe/Glas wegbringen (jeweils ganzer Monat)

---

## 3. Zeiträume (klar sichtbar mit Datum & Uhrzeit)

- **Wochenend-Aufgaben:** Freitag 00:00 – Sonntag 23:59 der jeweiligen Woche.
- **Müll (ganze Woche):** z. B. Montag 00:00 – Sonntag 23:59 (Beginn konfigurierbar, siehe offene Fragen). Auf jeder Karte steht der konkrete Zeitraum, z. B. **„Mo 02.11. 00:00 – So 08.11. 23:59“**, dazu ein Countdown („noch 3 Tage 4 Std“).
- **Monatlich:** 1. des Monats 00:00 – letzter Tag 23:59.

---

## 4. Fairer Verteilungs-Algorithmus (Kernstück)

Prinzip **„Soll vs. Ist“** pro Person, getrennt für wöchentliche und monatliche Aufgaben:

1. Für jede Periode (Woche bzw. Monat) wird ermittelt, wer **verfügbar** ist. Eine Person gilt als nicht verfügbar, wenn sich ihre Abwesenheit mit **mehr als 50 %** des Aufgabenzeitraums überschneidet (z. B. 2 von 3 Wochenendtagen, 4 von 7 Tagen in der Müllwoche).
2. Gesamtaufwand der Periode = Summe der `weight` aller aktiven Aufgaben. Jede **verfügbare** Person bekommt als Soll `Gesamtaufwand / Anzahl verfügbare Personen` gutgeschrieben. Abwesende bekommen kein Soll, müssen also nichts nachholen.
3. Aufgaben werden der Reihe nach (schwerste zuerst) an die verfügbare Person mit dem **niedrigsten Saldo** (Ist − Soll, inkl. schon in dieser Periode zugeteilter Aufgaben) vergeben.
4. Gleichstand → wer **diese konkrete Aufgabe am längsten nicht** gemacht hat (so rotieren Saugen/Küche/Müll ganz normal, wenn alle da sind) → dann feste Reihenfolge.
5. Ist niemand verfügbar, bleibt die Aufgabe unzugeteilt und wird markiert.

**Beispiel (aus der Anforderung):** Lucas ist zwei Wochen weg.
- Woche 1: Marlen und Paul haben je Soll 1,5. Marlen bekommt 2 Aufgaben (+0,5), Paul 1 (−0,5).
- Woche 2: Paul hat den niedrigeren Saldo → Paul bekommt 2 Aufgaben. Danach steht es ausgeglichen. ✔

**Stabilität:** Die Zuteilung wird deterministisch aus Startdatum, Aufgaben und Abwesenheiten berechnet (reine Funktion `computeSchedule`, ausführlich unit-getestet). Sobald eine Periode begonnen hat, wird ihre Zuteilung in `snapshots` eingefroren, damit spätere Änderungen die Vergangenheit nicht verschieben. Zukünftige Wochen werden live neu berechnet, sobald jemand eine Abwesenheit einträgt.

**Optional:** „Tauschen“-Button (zwei Personen tauschen eine Aufgabe in einer Periode; zählt im Saldo korrekt).

---

## 5. Ansichten

1. **Login:** Drei große farbige Namens-Buttons + PIN-Feld (nur einmal pro Gerät).
2. **Übersicht (Start):** Aktuelle Woche + aktueller Monat. Pro Aufgabe eine Karte mit Icon, Name, zuständiger Person (Farbpunkt + Name), exaktem Zeitraum, Countdown, Abhaken-Button. Hinweis-Badge bei Umverteilung („wegen Abwesenheit von Lucas“).
3. **Filter „Nur ich“:** Schalter oben, zeigt nur die eigenen Aufgaben (wird gemerkt).
4. **Plan / Vorschau:** Nächste 8 Wochen und 3 Monate als Liste, darin sieht man, wer wann dran ist.
5. **Abwesenheiten:** Zeitraum von–bis eintragen/löschen (für sich selbst, notfalls auch für andere). Zeigt sofort, was sich dadurch ändert.
6. **Aufgaben verwalten:** Hinzufügen, bearbeiten (Name, Icon, wöchentlich/monatlich, Zeitraum, Aufwand), löschen.
7. **Fairness/Statistik:** Saldo pro Person und erledigte Aufgaben der letzten Monate.
8. **Einstellungen:** Benachrichtigungen an/aus, Wochenbeginn, Abmelden.

---

## 6. Benachrichtigungen

Versand durch `.github/workflows/reminders.yml` (Cron, stündlich). Das Skript prüft, welche Nachrichten in der aktuellen Stunde fällig sind (Zeitzone Europe/Berlin), und merkt sich Versendetes in Firestore, damit nichts doppelt kommt:

| Wann | Was |
|---|---|
| Montag 09:00 | „Diese Woche bist du dran mit: Müll (Mo 02.11. – So 08.11.)“ |
| Freitag 10:00 | „Dieses Wochenende: Küche putzen“ |
| Sonntag 18:00 | Erinnerung, falls noch nicht abgehakt |
| 1. des Monats 10:00 | Monatsaufgabe |
| 3 Tage vor Monatsende | Erinnerung, falls offen |
| Sofort (vom Client ausgelöst) | Nicht per Push möglich ohne Server, daher: Umverteilungen erscheinen beim nächsten Cron-Lauf als „Neu zugeteilt: …“ |

Secrets in GitHub: `FIREBASE_SERVICE_ACCOUNT`, `VAPID_PRIVATE_KEY`. Der öffentliche VAPID-Key liegt im Frontend. (GitHub-Cron kann sich um einige Minuten verzögern, für Erinnerungen ist das egal.)

---

## 7. Design

- Mobile-first, eine Spalte, unten eine Tab-Leiste (Übersicht · Plan · Abwesend · Aufgaben · Mehr).
- Personenfarben: Lucas **Blau** `#3B82F6`, Marlen **Grün** `#10B981`, Paul **Orange** `#F97316`, überall konsistent als Punkt bzw. Kartenrand.
- Karten mit großem Emoji-Icon (🧹 Saugen, 🍳 Küche, 🗑️ Müll, 🧽 Wischen, 🧊 Kühlschrank, 📦 Pappe/Glas).
- Status: offen (neutral), erledigt (abgehakt, gedimmt), überfällig (roter Rand).
- Hell- und Dunkelmodus automatisch, Schrift Inter, abgerundete Ecken, viel Weißraum.
- Sprache: Deutsch, Datumsformat `Fr 06.11. 00:00`.

---

## 8. Projektstruktur

```
src/
  lib/schedule.ts        // computeSchedule, Verfügbarkeit, Fairness (pure, getestet)
  lib/periods.ts         // Wochen-/Monatsgrenzen, Zeitzone Europe/Berlin
  lib/firebase.ts        // Init, Hooks (useTasks, useAbsences, …)
  pages/…                // Login, Overview, Plan, Absences, Tasks, Stats, Settings
  components/…           // TaskCard, MemberBadge, PeriodHeader, TabBar
public/sw.js             // Service Worker (Offline + Push-Empfang)
scripts/send-reminders.ts
.github/workflows/deploy.yml, reminders.yml
tests/schedule.test.ts   // Vitest
SETUP.md                 // Schritt-für-Schritt: Firebase, Secrets, Pages aktivieren
```

---

## 9. Vorgehen & Qualitätssicherung

1. **Umsetzung durch Sub-Agent (Haiku)** in Etappen:
   a) Gerüst + Deploy-Pipeline, b) Algorithmus + Tests, c) UI-Ansichten, d) Firebase-Anbindung, e) Push + Reminder-Workflow, f) SETUP.md.
2. **Review durch Hauptagent (Opus)** nach jeder Etappe: Code lesen, Tests laufen lassen, Fairness-Szenarien prüfen (Abwesenheit 1/2/3 Wochen, zwei gleichzeitig weg, Monatsgrenzen, Zeitumstellung Ende Oktober/März), Screenshots per Playwright auf Handy-Größe. Mängel gehen als konkrete Aufgaben zurück an den Sub-Agent, bis alles passt.
3. **Abnahme:** Live auf GitHub Pages, du testest mit den Mitbewohnern.

## 10. Was du selbst machen musst (ca. 10 Min, Anleitung kommt in SETUP.md)

- Ein GitHub-Repo bereitstellen (oder mir den Namen nennen).
- Kostenloses Firebase-Projekt anlegen (Google-Login nötig, kann ich nicht für dich tun) und mir die Web-Config geben.
- 2 Secrets im Repo eintragen und GitHub Pages aktivieren.

---

## 11. Entscheidungen (von Lucas bestätigt, 27.10.2026)

- Müll-Woche: **Mo 00:00 – So 23:59** (Europe/Berlin).
- Abwesende holen **nicht** nach – nur Anwesende gleichen untereinander aus (Soll nur bei Verfügbarkeit).
- Erinnerungen: **Web-Push** über die PWA (VAPID, Versand via GitHub Actions Cron).
- Repo: `LucasUe/wg-putzplan` (öffentlich) – muss Lucas selbst anlegen; Code wird lokal in `/home/user/wg-putzplan` gebaut.
- Daten-Layer mit zwei Backends: Firestore (produktiv) und localStorage-Demo-Modus (wenn keine Firebase-Config gesetzt ist), damit die App vorab testbar ist.
