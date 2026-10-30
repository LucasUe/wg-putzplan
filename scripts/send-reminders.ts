/**
 * Versendet die Web-Push-Erinnerungen (läuft stündlich per GitHub Actions).
 * Aufruf: npx tsx scripts/send-reminders.ts [--dry-run] [--at=2026-11-02T09:00:00+01:00]
 * Liest Firestore mit der Web-Config aus src/firebaseConfig.ts (Regeln sind offen).
 * Benötigt: VAPID_PRIVATE_KEY (optional VAPID_PUBLIC_KEY, sonst aus src/config.ts, und VAPID_SUBJECT).
 */
import { initializeApp } from 'firebase/app';
import { collection, deleteDoc, doc, getDoc, getDocs, getFirestore, setDoc, type Firestore } from 'firebase/firestore';
import webpush from 'web-push';
import { firebaseConfig } from '../src/firebaseConfig';
import { VAPID_PUBLIC_KEY } from '../src/config';
import { planReminders, type ReminderMessage } from './reminder-logic';
import type { Absence, Completion, Household, Override, Snapshot, Task } from '../src/lib/types';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const atArg = args.find((a) => a.startsWith('--at='));
/** --test (alle) bzw. --test=<memberId>: sofort eine Testbenachrichtigung senden */
const testArg = args.find((a) => a === '--test' || a.startsWith('--test='));
const testMember = testArg?.startsWith('--test=') ? testArg.slice('--test='.length) || null : null;
const now = atArg ? new Date(atArg.slice('--at='.length)) : new Date();

/** Push-Payload: der Service Worker kann damit direkt per Firestore-REST abhaken. */
function payloadFor(msg: ReminderMessage) {
  return {
    title: msg.title,
    body: msg.body,
    tag: msg.tag,
    url: msg.url,
    data: {
      url: msg.url,
      periodKey: msg.periodKey,
      taskId: msg.taskId,
      taskName: msg.taskName,
      memberId: msg.memberId,
      canComplete: msg.canComplete,
      firestore: { projectId: firebaseConfig.projectId, apiKey: firebaseConfig.apiKey },
    },
  };
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return v;
}

async function main(): Promise<void> {
  if (!firebaseConfig.apiKey.trim()) {
    console.log('Firebase nicht konfiguriert – nichts zu tun');
    return;
  }
  const vapidPublic = process.env.VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY;
  const vapidPrivate = env('VAPID_PRIVATE_KEY');
  const subject = process.env.VAPID_SUBJECT ?? 'https://lucasue.github.io/wg-putzplan/';
  webpush.setVapidDetails(subject, vapidPublic, vapidPrivate);

  const app = initializeApp(firebaseConfig);
  const db: Firestore = getFirestore(app);
  const all = async <T>(name: string): Promise<T[]> =>
    (await getDocs(collection(db, name))).docs.map((d) => d.data() as T);

  const hh = (await getDoc(doc(db, 'household', 'main'))).data() as Household | undefined;
  if (!hh) throw new Error('household/main fehlt – App zuerst öffnen, damit die Daten angelegt werden.');

  if (testArg) {
    await sendTest(db, hh, testMember);
    return;
  }
  const tasks = await all<Task>('tasks');
  const absences = await all<Absence>('absences');
  const snapshots = await all<Snapshot>('snapshots');
  const completions = await all<Completion>('completions');
  const overrides = await all<Override>('overrides');
  const sentDocs = await getDocs(collection(db, 'sentReminders'));
  const sentKeys = new Set<string>();
  const lastAssignments: Record<string, Record<string, string | null>> = {};
  for (const d of sentDocs.docs) {
    if (d.id.startsWith('assign_')) {
      lastAssignments[d.id.slice('assign_'.length)] = (d.data().assignments ?? {}) as Record<string, string | null>;
    } else {
      sentKeys.add(d.id);
    }
  }

  const result = planReminders({
    now,
    members: hh.members,
    tasks,
    absences,
    startDate: hh.startDate,
    snapshots,
    completions,
    overrides,
    sentKeys,
    lastAssignments,
  });

  console.log(`${dryRun ? '[Dry-Run] ' : ''}Jetzt: ${now.toISOString()} – ${result.messages.length} Nachricht(en) fällig`);

  const subsByMember = new Map<string, { id: string; subscription: webpush.PushSubscription }[]>();
  for (const d of (await getDocs(collection(db, 'pushSubscriptions'))).docs) {
    const data = d.data() as { memberId: string; subscription: webpush.PushSubscription };
    const list = subsByMember.get(data.memberId) ?? [];
    list.push({ id: d.id, subscription: data.subscription });
    subsByMember.set(data.memberId, list);
  }

  for (const msg of result.messages) {
    const subs = subsByMember.get(msg.memberId) ?? [];
    console.log(`- ${msg.key}: ${msg.body} -> ${subs.length} Gerät(e)`);
    if (dryRun) continue;
    for (const s of subs) {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify(payloadFor(msg)));
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await deleteDoc(doc(db, 'pushSubscriptions', s.id));
          console.log(`  abgelaufene Subscription entfernt: ${s.id}`);
        } else {
          console.error(`  Versand fehlgeschlagen (${s.id}):`, status ?? err);
        }
      }
    }
    await setDoc(doc(db, 'sentReminders', msg.key), { sentAt: now.toISOString() });
  }

  if (!dryRun) {
    for (const snap of result.newSnapshots) {
      await setDoc(doc(db, 'snapshots', snap.periodKey), snap);
    }
    for (const [periodKey, assignments] of Object.entries(result.assignmentUpdates)) {
      await setDoc(doc(db, 'sentReminders', `assign_${periodKey}`), { assignments });
    }
  } else {
    console.log(`[Dry-Run] ${result.newSnapshots.length} Snapshot(s) würden angelegt.`);
  }
}

/** Testbenachrichtigung an alle Geräte (oder einer Person). Kein Dedup, keine Snapshots. */
async function sendTest(db: Firestore, hh: Household, onlyMember: string | null): Promise<void> {
  const members = onlyMember ? hh.members.filter((m) => m.id === onlyMember) : hh.members;
  if (members.length === 0) throw new Error(`Unbekannte Person: ${onlyMember}`);
  const subs = (await getDocs(collection(db, 'pushSubscriptions'))).docs.map((d) => ({
    id: d.id,
    ...(d.data() as { memberId: string; subscription: webpush.PushSubscription }),
  }));
  console.log(`Testbenachrichtigung${dryRun ? ' [Dry-Run]' : ''} an ${onlyMember ?? 'alle'}`);
  for (const m of members) {
    const mine = subs.filter((s) => s.memberId === m.id);
    const results: string[] = [];
    for (const s of mine) {
      if (dryRun) {
        results.push('dry-run');
        continue;
      }
      const payload = {
        title: '🔔 Testbenachrichtigung',
        body: `Hallo ${m.name}, Benachrichtigungen funktionieren. Tippe auf ✓ Erledigt, um die Knöpfe zu testen.`,
        tag: `test-${m.id}`,
        url: './#/overview',
        data: { canComplete: true, test: true, url: './#/overview' },
      };
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify(payload));
        results.push('ok');
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await deleteDoc(doc(db, 'pushSubscriptions', s.id));
          results.push(`${status} (abgelaufen, entfernt)`);
        } else {
          results.push(String(status ?? 'Fehler'));
        }
      }
    }
    console.log(`- ${m.name}: ${mine.length} Gerät(e)${results.length ? ` -> ${results.join(', ')}` : ''}`);
  }
}

// Explizit beenden: Die offene Firestore-Verbindung hielte den Prozess sonst am Leben.
main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
