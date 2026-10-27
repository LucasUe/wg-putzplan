# WG-Putzplan

Progressive Web-App für Lucas, Marlen und Paul: wöchentliche und monatliche Putzaufgaben verteilen, abhaken und fair umverteilen, wenn jemand abwesend ist. Erinnerungen per Web-Push.

- Frontend: Vite, React, TypeScript, Tailwind CSS, HashRouter
- Daten: Firebase Firestore (ohne Config läuft die App im Demo-Modus im Browser)
- Hosting: GitHub Pages (Deploy bei jedem Push auf `main`)
- Erinnerungen: GitHub Actions (stündlich), Skript `scripts/send-reminders.ts`

Einrichtung: siehe [SETUP.md](SETUP.md). Spezifikation: [PLAN.md](PLAN.md).

## Entwicklung

```bash
npm install
npm run dev        # lokaler Server
npm test           # Tests (Verteilung, Zeiträume, Erinnerungen)
npm run build      # Typprüfung und Produktions-Build nach dist/
npm run icons      # PWA-Icons neu erzeugen
```

Erinnerungen lokal testen (braucht eine gesetzte Firebase-Config und die VAPID-Variablen aus SETUP.md):

```bash
npx tsx scripts/send-reminders.ts --dry-run
```

## Struktur

```
src/lib/periods.ts      Wochen-/Monatsgrenzen, Zeitzone Europe/Berlin
src/lib/schedule.ts     Verteilung, Abwesenheiten, Snapshots, Salden
src/lib/store/         Firestore- und localStorage-Backend
src/pages/             Login, Übersicht, Plan, Abwesend, Aufgaben, Mehr
scripts/               Erinnerungen und Icon-Erzeugung
tests/                 Vitest-Tests
```
