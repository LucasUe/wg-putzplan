// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';

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

    // Snapshots wurden im Demo-Speicher für begonnene Perioden angelegt
    const data = JSON.parse(window.localStorage.getItem('wg-putzplan:demo:v1') ?? '{}');
    expect(data.snapshots.map((s: { periodKey: string }) => s.periodKey)).toContain('2026-W44');

    // Abhaken
    const check = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Abhaken'))!;
    await act(async () => check.click());
    await flush(10);
    expect(container.textContent).toContain('Rückgängig');
    const after = JSON.parse(window.localStorage.getItem('wg-putzplan:demo:v1') ?? '{}');
    expect(after.completions.length).toBe(1);

    await act(async () => root.unmount());
  });
});
