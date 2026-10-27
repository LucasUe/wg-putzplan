import { useState } from 'react';
import { Badge, Button, Card, Field, SectionTitle, inputClass } from '../components/ui';
import { useApp } from '../lib/AppContext';
import { pinHashFor, sha256Hex } from '../lib/crypto';
import { startedPeriods, getBalances } from '../lib/schedule';
import { enablePush, isIOS, isStandalone, pushSupported, type PushResult } from '../lib/push';

const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });

const PUSH_TEXT: Record<PushResult, string> = {
  ok: 'Benachrichtigungen sind aktiv.',
  denied: 'Benachrichtigungen wurden nicht erlaubt. Das lässt sich in den Browser- bzw. iOS-Einstellungen ändern.',
  unsupported: 'Dieser Browser unterstützt keine Benachrichtigungen.',
  error: 'Die Anmeldung für Benachrichtigungen ist fehlgeschlagen. Ist der VAPID-Schlüssel in src/config.ts eingetragen?',
};

export function More() {
  const { household, members, schedule, now, completions, store, currentMember, logout, mode } = useApp();
  const [pushResult, setPushResult] = useState<PushResult | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  const weeklyBal = getBalances(startedPeriods(schedule.weekly, now), members);
  const monthlyBal = getBalances(startedPeriods(schedule.monthly, now), members);
  const doneCount = (id: string) => completions.filter((c) => c.doneBy === id).length;

  const onPush = async () => {
    if (!currentMember) return;
    setPushBusy(true);
    setPushResult(await enablePush(store, currentMember.id));
    setPushBusy(false);
  };

  const changePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentMember) return;
    if ((await sha256Hex(oldPin.trim())) !== pinHashFor(household, currentMember.id)) {
      return setPinMsg('Die aktuelle PIN stimmt nicht.');
    }
    if (newPin.trim().length < 4) return setPinMsg('Die neue PIN braucht mindestens 4 Zeichen.');
    // Alle Einträge mitschreiben, damit Personen ohne eigenen Eintrag ihre bisherige PIN behalten.
    const pins: Record<string, string> = {};
    for (const m of members) {
      const h = pinHashFor(household, m.id);
      if (h) pins[m.id] = h;
    }
    pins[currentMember.id] = await sha256Hex(newPin.trim());
    await store.updateHousehold({ pins });
    setOldPin('');
    setNewPin('');
    setPinMsg('Deine PIN wurde geändert. Auf anderen Geräten brauchst du beim nächsten Anmelden die neue PIN.');
  };

  return (
    <div className="pt-6">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Mehr</h1>

      <SectionTitle aside="wöchentlich · monatlich">Fairness – übernommene Dienste</SectionTitle>
      <Card className="divide-y divide-[var(--border)]">
        {members.map((m) => {
          const w = weeklyBal.find((b) => b.memberId === m.id)?.takeovers ?? 0;
          const mo = monthlyBal.find((b) => b.memberId === m.id)?.takeovers ?? 0;
          return (
            <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="flex items-center gap-2 font-medium">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} />
                {m.name}
              </span>
              <span className="flex gap-1.5">
                <Badge tone={w > 0 ? 'ok' : 'neutral'}>{fmt(w)} wöchentl.</Badge>
                <Badge tone={mo > 0 ? 'ok' : 'neutral'}>{fmt(mo)} monatl.</Badge>
              </span>
            </div>
          );
        })}
      </Card>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Wer weniger übernommen hat, ist bei der nächsten Abwesenheit zuerst dran. Wenn alle da sind, gilt der normale Rhythmus.
      </p>

      <SectionTitle>Erledigt insgesamt</SectionTitle>
      <Card className="divide-y divide-[var(--border)]">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2 font-medium">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: m.color }} />
              {m.name}
            </span>
            <span className="tabular-nums">{doneCount(m.id)}</span>
          </div>
        ))}
      </Card>

      <SectionTitle>Benachrichtigungen</SectionTitle>
      <Card className="space-y-3 p-4">
        <p className="text-sm text-[var(--muted)]">
          Erinnerungen zu Wochen-, Wochenend- und Monatsaufgaben als Push-Nachricht.
        </p>
        {isIOS() && !isStandalone() && (
          <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            iPhone: Benachrichtigungen funktionieren nur, wenn die App über <strong>Teilen → Zum Home-Bildschirm</strong> installiert und von dort geöffnet wurde (iOS 16.4 oder neuer).
          </p>
        )}
        {pushSupported() ? (
          <Button className="w-full" onClick={onPush} disabled={pushBusy}>
            {pushBusy ? 'Bitte warten …' : 'Benachrichtigungen aktivieren'}
          </Button>
        ) : (
          <p className="text-sm text-[var(--muted)]">Auf diesem Gerät nicht verfügbar.</p>
        )}
        {pushResult && <p className="text-sm">{PUSH_TEXT[pushResult]}</p>}
      </Card>

      <SectionTitle>Meine PIN</SectionTitle>
      <Card className="p-4">
        <form onSubmit={changePin} className="space-y-3">
          <Field label="Aktuelle PIN">
            <input className={inputClass} type="password" inputMode="numeric" value={oldPin} onChange={(e) => setOldPin(e.target.value)} />
          </Field>
          <Field label="Neue PIN">
            <input className={inputClass} type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
          </Field>
          {pinMsg && <p className="text-sm">{pinMsg}</p>}
          <Button type="submit" variant="secondary" className="w-full">
            PIN ändern
          </Button>
        </form>
      </Card>

      <div className="mt-8 space-y-3">
        <p className="text-center text-xs text-[var(--muted)]">
          {mode === 'firestore' ? 'Verbunden mit Firebase' : 'Demo-Modus (nur dieser Browser)'}
        </p>
        <Button variant="danger" className="w-full" onClick={logout}>
          Abmelden
        </Button>
      </div>
    </div>
  );
}
