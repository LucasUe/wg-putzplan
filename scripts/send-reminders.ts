/**
 * Versendet die Web-Push-Erinnerungen (läuft stündlich per GitHub Actions).
 * Aufruf: npx tsx scripts/send-reminders.ts [--dry-run] [--at=2026-11-02T09:00:00+01:00]
 * Benötigt: FIREBASE_SERVICE_ACCOUNT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (optional VAPID_SUBJECT).
 */
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import webpush from 'web-push';
import { planReminders } from './reminder-logic';
import type { Absence, Completion, Household, Snapshot, Task } from '../src/lib/types';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const atArg = args.find((a) => a.startsWith('--at='));
const now = atArg ? new Date(atArg.slice('--at='.length)) : new Date();

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Umgebungsvariable ${name} fehlt`);
  return v;
}

async function main(): Promise<void> {
  const serviceAccount = JSON.parse(env('FIREBASE_SERVICE_ACCOUNT')) as Record<string, string>;
  const vapidPublic = env('VAPID_PUBLIC_KEY');
  const vapidPrivate = env('VAPID_PRIVATE_KEY');
  const subject = process.env.VAPID_SUBJECT ?? 'https://lucasue.github.io/wg-putzplan/';
  webpush.setVapidDetails(subject, vapidPublic, vapidPrivate);

  initializeApp({ credential: cert(serviceAccount as Parameters<typeof cert>[0]) });
  const db: Firestore = getFirestore();

  const hh = (await db.doc('household/main').get()).data() as Household | undefined;
  if (!hh) throw new Error('household/main fehlt – App zuerst öffnen, damit die Daten angelegt werden.');
  const tasks = (await db.collection('tasks').get()).docs.map((d) => d.data() as Task);
  const absences = (await db.collection('absences').get()).docs.map((d) => d.data() as Absence);
  const snapshots = (await db.collection('snapshots').get()).docs.map((d) => d.data() as Snapshot);
  const completions = (await db.collection('completions').get()).docs.map((d) => d.data() as Completion);
  const sentDocs = await db.collection('sentReminders').get();
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
    sentKeys,
    lastAssignments,
  });

  console.log(`${dryRun ? '[Dry-Run] ' : ''}Jetzt: ${now.toISOString()} – ${result.messages.length} Nachricht(en) fällig`);

  const subsByMember = new Map<string, { id: string; subscription: webpush.PushSubscription }[]>();
  for (const d of (await db.collection('pushSubscriptions').get()).docs) {
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
        await webpush.sendNotification(s.subscription, JSON.stringify({ title: msg.title, body: msg.body, url: msg.url, tag: msg.tag }));
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.collection('pushSubscriptions').doc(s.id).delete();
          console.log(`  abgelaufene Subscription entfernt: ${s.id}`);
        } else {
          console.error(`  Versand fehlgeschlagen (${s.id}):`, status ?? err);
        }
      }
    }
    await db.collection('sentReminders').doc(msg.key).set({ sentAt: now.toISOString() });
  }

  if (!dryRun) {
    for (const snap of result.newSnapshots) {
      await db.collection('snapshots').doc(snap.periodKey).set(snap);
    }
    for (const [periodKey, assignments] of Object.entries(result.assignmentUpdates)) {
      await db.collection('sentReminders').doc(`assign_${periodKey}`).set({ assignments });
    }
  } else {
    console.log(`[Dry-Run] ${result.newSnapshots.length} Snapshot(s) würden angelegt.`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
