import { useState } from 'react';
import { DemoBanner, Button, Card, inputClass } from '../components/ui';
import { useApp } from '../lib/AppContext';
import { sha256Hex } from '../lib/crypto';
import type { Member } from '../lib/types';

export function Login() {
  const { household, mode, login } = useApp();
  const [selected, setSelected] = useState<Member | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const hash = await sha256Hex(pin.trim());
      if (hash === household.pinHash) {
        login(selected.id);
      } else {
        setError('Die PIN stimmt nicht.');
      }
    } catch {
      setError('PIN konnte nicht geprüft werden. Bitte mit HTTPS öffnen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      {mode === 'local' && <DemoBanner />}
      <h1 className="mb-1 text-3xl font-bold tracking-tight">WG-Putzplan</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">Wer bist du?</p>

      {!selected ? (
        <div className="grid gap-3">
          {household.members.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelected(m)}
              className="rounded-2xl px-5 py-6 text-left text-xl font-semibold text-white shadow-md transition active:scale-[0.98]"
              style={{ backgroundColor: m.color }}
            >
              {m.name}
            </button>
          ))}
        </div>
      ) : (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-lg font-semibold" style={{ color: selected.color }}>
              Hallo {selected.name}
            </span>
            <button type="button" className="text-sm text-blue-600 dark:text-blue-400" onClick={() => { setSelected(null); setPin(''); setError(null); }}>
              Andere Person
            </button>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-[var(--muted)]">WG-PIN</span>
              <input
                className={inputClass}
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || pin.trim().length === 0}>
              Anmelden
            </Button>
          </form>
          {mode === 'local' && <p className="mt-3 text-xs text-[var(--muted)]">Demo-PIN: 1234</p>}
        </Card>
      )}
    </div>
  );
}
