# WG-Putzplan einrichten (Schritt für Schritt)

Diese Anleitung richtet die App einmal komplett ein. Alles ist kostenlos. Du brauchst einen Google-Account (für Firebase) und einen GitHub-Account. Dauer: etwa 20 bis 30 Minuten.

Die Schritte sind nummeriert. Wenn du nicht weiterkommst, schick mir den Schritt und die Fehlermeldung.

---

## Schritt 1: GitHub-Repo anlegen und Code hochladen

1. Melde dich bei GitHub an und öffne <https://github.com/new>.
2. Repository name: `wg-putzplan`. Wichtig: **Public** auswählen. Ohne Haken bei „Add a README“ (das Repo bleibt leer). Auf **Create repository** klicken.
3. Öffne auf deinem Rechner ein Terminal im Projektordner `wg-putzplan` und führe aus:

   ```bash
   git remote add origin https://github.com/LucasUe/wg-putzplan.git
   git push -u origin main
   ```

4. Die Dateien erscheinen jetzt auf GitHub. Der Push startet noch keinen Deploy, weil GitHub Pages noch nicht eingerichtet ist. Das holen wir in Schritt 7 nach.

---

## Schritt 2: Firebase-Projekt anlegen (kostenloser Spark-Plan)

1. Öffne <https://console.firebase.google.com> und melde dich mit deinem Google-Account an.
2. Klicke auf **Projekt erstellen** (oder „Create a project“).
3. Projektname: z. B. `wg-putzplan`. Google-Analytics kannst du **deaktivieren**. Auf **Projekt erstellen** klicken und warten, bis es fertig ist.

---

## Schritt 3: Firestore aktivieren

1. Im Menü links: **Build → Firestore Database**.
2. **Datenbank erstellen** klicken.
3. Standort: `eur3 (Europe)` oder `europe-west3 (Frankfurt)` wählen.
4. Modus: **Im Testmodus starten** wählen. Die endgültigen Regeln spielen wir in Schritt 5 ein.
5. Auf **Erstellen** klicken.

---

## Schritt 4: Web-App registrieren und Config eintragen

1. Oben links auf das Zahnrad neben „Projektübersicht“ klicken, dann **Projekteinstellungen**.
2. Nach unten scrollen zu **Meine Apps**. Auf das Symbol **</>** (Web) klicken.
3. App-Spitzname: `wg-putzplan-web`. **Firebase Hosting** nicht ankreuzen. Auf **App registrieren** klicken.
4. Es erscheint ein Codeblock mit `const firebaseConfig = { ... }`. Kopiere die Werte.
5. Öffne im Projekt die Datei **`src/firebaseConfig.ts`** und trage die Werte ein:

   ```ts
   export const firebaseConfig = {
     apiKey: 'AIza...',            // aus der Konsole
     authDomain: 'wg-putzplan.firebaseapp.com',
     projectId: 'wg-putzplan',
     storageBucket: 'wg-putzplan.firebasestorage.app',
     messagingSenderId: '1234567890',
     appId: '1:1234567890:web:abcdef',
   };
   ```

6. Speichern, dann im Terminal:

   ```bash
   git add -A && git commit -m "Firebase-Config eintragen" && git push
   ```

   Die Werte sind öffentlich einsehbar. Das ist bei Firebase-Web-Configs normal, Schutz kommt aus den Regeln (Schritt 5).

---

## Schritt 5: Sicherheitsregeln einspielen

1. In der Firebase-Konsole: **Firestore Database → Regeln** (Tab „Rules“).
2. Den gesamten Inhalt durch den Inhalt der Datei **`firestore.rules`** aus dem Projekt ersetzen. Dabei auf den Inhalt des Projekts schauen, nicht auf die Testregeln.
3. Auf **Veröffentlichen** klicken.

Die Regeln sind bewusst einfach: Die App hat keine Benutzerkonten, der WG-PIN schützt nur die Oberfläche. Es werden keine sensiblen Daten gespeichert.

---

## Schritt 6: Push-Secret setzen

Das Schlüsselpaar für Web-Push ist schon erzeugt. Der öffentliche Schlüssel steht in `src/config.ts`. Nur der private Schlüssel muss als Secret ins Repo (geht komplett im Browser):

1. Auf GitHub im Repo **Settings → Secrets and variables → Actions → New repository secret**.
2. Name: `VAPID_PRIVATE_KEY`, Wert: der private Schlüssel. Speichern.

Neues Schlüsselpaar nötig? `npx web-push generate-vapid-keys` ausführen, den Public Key in `src/config.ts` und den Private Key als Secret eintragen. Danach müssen alle einmal „Benachrichtigungen aktivieren“ neu drücken.

## Schritt 7: GitHub Pages aktivieren

1. Auf GitHub im Repo: **Settings → Pages**.
2. Unter **Build and deployment → Source** den Eintrag **GitHub Actions** wählen. (Nicht „Deploy from a branch“.)
3. Danach den Workflow neu anstoßen: Tab **Actions → Deploy to GitHub Pages → Run workflow** (oder einen kleinen Commit pushen).
4. Warte, bis der Lauf grün ist (etwa 1 bis 2 Minuten). Die App ist dann erreichbar unter:

   **https://lucasue.github.io/wg-putzplan/**

5. Erinnerungen prüfen: **Actions → Putzplan-Erinnerungen → Run workflow**. Der Lauf sollte ohne Fehler durchlaufen.

6. **Keepalive:** GitHub schaltet Cron-Workflows nach 60 Tagen ohne Aktivität im Repo ab. Der Workflow **Keepalive** schreibt deshalb alle zwei Wochen automatisch einen Zeitstempel ins Repo und aktiviert die Erinnerungen wieder. Manuell auslösen: **Actions → Keepalive → Run workflow**. Das erzeugt keinen Deploy.

---

## Schritt 8: WG-PIN ändern

Die Start-PIN ist **1234**. Ändere sie sofort:

1. Öffne die App, melde dich mit deinem Namen und der PIN `1234` an.
2. Tab **Mehr** → Abschnitt **WG-PIN** → neue PIN eintragen → **PIN ändern**.

Die neue PIN gilt danach für alle Geräte beim nächsten Anmelden.

---

## Schritt 9: Mitbewohner einladen und App auf den Homescreen legen

Schick Marleen und Paul den Link `https://lucasue.github.io/wg-putzplan/` und die PIN (am besten über den Gruppenchat).

**iPhone (iOS 16.4 oder neuer):**
1. Link in **Safari** öffnen (nicht in Chrome oder einer anderen App).
2. Unten auf das Teilen-Symbol tippen (Quadrat mit Pfeil nach oben).
3. **Zum Home-Bildschirm** wählen, dann **Hinzufügen**.
4. Die App vom Home-Bildschirm öffnen. Wichtig: Benachrichtigungen funktionieren nur so, nicht im Safari-Tab.
5. Namen wählen, PIN eingeben, im Tab **Mehr** auf **Benachrichtigungen aktivieren** tippen und erlauben.

**Android:**
1. Link in **Chrome** öffnen.
2. Menü (drei Punkte oben rechts) → **App installieren** oder **Zum Startbildschirm hinzufügen**.
3. Namen wählen, PIN eingeben, im Tab **Mehr** auf **Benachrichtigungen aktivieren** tippen und erlauben.

---

## Fehlerbehebung

- **„Demo-Modus“-Banner sichtbar:** Die Config in `src/firebaseConfig.ts` ist noch leer oder die `apiKey` fehlt. Schritt 4 wiederholen.
- **Die Seite zeigt „Fehler beim Laden“:** Firestore ist nicht aktiviert (Schritt 3) oder die Regeln fehlen (Schritt 5).
- **Benachrichtigungen funktionieren nicht:** Prüfen, ob der Public Key in `src/config.ts` steht und die drei Secrets gesetzt sind. Auf dem iPhone muss die App über den Home-Bildschirm geöffnet sein.
- **Der Erinnerungs-Workflow ist rot:** Meist fehlt das Secret `VAPID_PRIVATE_KEY` (Schritt 6). Steht im Lauf „Firebase nicht konfiguriert“, ist nur die Config in `src/firebaseConfig.ts` leer; der Lauf bleibt dann absichtlich grün.
- **Erinnerungen laufen nicht mehr:** Actions → Keepalive → Run workflow auslösen (aktiviert die Cron-Workflows wieder).
