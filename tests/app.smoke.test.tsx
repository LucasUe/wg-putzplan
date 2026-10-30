// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

// Smoke-Test läuft immer im Demo-Modus, auch wenn eine echte Firebase-Config eingetragen ist.
vi.mock('../src/firebaseConfig', () => ({
  firebaseConfig: { apiKey: '', authDomain: '', projectId: '', storageBucket: '', messagingSenderId: '', appId: '' },
}));

// Hinweis: globalThis.IS_REACT_ACT_ENVIRONMENT setzen, damit act() sauber funktioniert.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flush(times = 10) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe('App-Smoke (Demo-Modus, jsdom)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = '#/';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('zeigt Login, meldet an und rendert die Übersicht mit Aufgaben', async () => {
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <HashRouter>
          <App />
        </HashRouter>,
      );
    });
    await flush(20);

    expect(container.textContent).toContain('Wer bist du?');
    expect(container.textContent).toContain('Demo-Modus');

    const lucas = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Lucas')!;
    await act(async () => lucas.click());
    await flush();

    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    // React-kontrollierte Eingabe setzen
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, '1234');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const form = container.querySelector('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush(30);

    expect(window.localStorage.getItem('wg-putzplan:member')).toBe('lucas');
    expect(container.textContent).toContain('Diese Woche');
    expect(container.textContent).toContain('Saugen');
    expect(container.textContent).toContain('Küche putzen');
    expect(container.textContent).toMatch(/Mo 26\.10\.|Fr 30\.10\.|So 01\.11\./);
    expect(container.textContent).toContain('Dieser Monat');
    expect(container.textContent).toContain('Wohnung wischen');

    // Nur beendete Perioden werden eingefroren; die laufende Woche bleibt live
    const data = JSON.parse(window.localStorage.getItem('wg-putzplan:demo:v1') ?? '{}');
    expect(data.snapshots.map((s: { periodKey: string }) => s.periodKey)).not.toContain('2026-W44');

    const cards = () => [...container.querySelectorAll('article')];
    const owner = (card: Element) => card.querySelector('.font-medium')?.textContent ?? '';
    const buttonIn = (card: Element, text: string) => [...card.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
    const cardFor = (name: string) => cards().find((c) => c.querySelector('h3')?.textContent === name)!;

    // Nur eigene Karten haben einen Abhaken-Button, fremde nicht
    expect(cards().length).toBeGreaterThan(2);
    for (const c of cards()) {
      if (owner(c) === 'Lucas') expect(buttonIn(c, 'Abhaken')).toBeDefined();
      else expect(buttonIn(c, 'Abhaken')).toBeUndefined();
    }
    const ownCards = cards().filter((c) => owner(c) === 'Lucas');
    expect(ownCards.length).toBeGreaterThanOrEqual(2);
    const ownNames = ownCards.map((c) => c.querySelector('h3')!.textContent!);
    const foreignName = cards().find((c) => owner(c) !== 'Lucas')!.querySelector('h3')!.textContent!;

    // Abgeben: erste eigene Aufgabe an Paul, nur abgeben
    const giveName = ownNames[0];
    await act(async () => buttonIn(cardFor(giveName), 'Abgeben')!.click());
    await flush(5);
    expect(container.textContent).toContain('An wen?');
    const toPaul = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes('Paul'))!;
    await act(async () => (toPaul as HTMLButtonElement).click());
    await flush(5);
    expect(container.textContent).toContain('Sollen die anderen Aufgaben angepasst werden?');
    expect(container.textContent).toContain('Paul hat dann eine Aufgabe mehr. Das wird nicht ausgeglichen.');
    const onlyGive = [...container.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.includes('Nein, nur abgeben'))!;
    await act(async () => (onlyGive as HTMLButtonElement).click());
    await flush(10);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const given = cardFor(giveName);
    expect(owner(given)).toBe('Paul');
    expect(given.textContent).toContain('von Lucas abgegeben');
    expect(buttonIn(given, 'Abhaken')).toBeUndefined();
    const stored = JSON.parse(window.localStorage.getItem('wg-putzplan:demo:v1') ?? '{}');
    expect(stored.overrides).toHaveLength(1);
    expect(stored.overrides[0]).toMatchObject({ memberId: 'paul', kind: 'handover', createdBy: 'lucas' });

    // Rückfrage-Dialog: bei fremder Aufgabe nicht, bei eigener schon
    const taskIdOf = (name: string) => (stored.tasks as { id: string; name: string }[]).find((t) => t.name === name)!.id;
    const periodOfCard = (name: string) => {
      const section = cardFor(name).closest('section')!;
      return section.textContent!.includes('Dieser Monat') ? 'monthly' : 'weekly';
    };
    const ownMonthly = ownNames.find((n) => periodOfCard(n) === 'monthly')!;
    expect(ownMonthly).toBeDefined();
    const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(new Date()).slice(0, 7);
    const foreignMonthly = cards()
      .filter((c) => owner(c) !== 'Lucas' && periodOfCard(c.querySelector('h3')!.textContent!) === 'monthly')
      .map((c) => c.querySelector('h3')!.textContent!)[0] ?? foreignName;

    await act(async () => {
      window.location.hash = `#/overview?confirm=${encodeURIComponent(`${monthKey}|${taskIdOf(foreignMonthly)}`)}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await flush(10);
    expect(container.textContent).not.toContain('Ja, erledigt');
    expect(window.location.hash).not.toContain('confirm');

    await act(async () => {
      window.location.hash = `#/overview?confirm=${encodeURIComponent(`${monthKey}|${taskIdOf(ownMonthly)}`)}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await flush(10);
    expect(container.textContent).toContain('erledigt?');
    const yes = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Ja, erledigt'))!;
    await act(async () => yes.click());
    await flush(10);
    const final = JSON.parse(window.localStorage.getItem('wg-putzplan:demo:v1') ?? '{}');
    expect(final.completions).toHaveLength(1);
    expect(final.completions[0]).toMatchObject({ taskId: taskIdOf(ownMonthly), doneBy: 'lucas' });
    expect(window.location.hash).not.toContain('confirm');
    expect(buttonIn(cardFor(ownMonthly), 'Rückgängig')).toBeDefined();

    await act(async () => root.unmount());
  });
});
