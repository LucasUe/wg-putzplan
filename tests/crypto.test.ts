import { describe, expect, it } from 'vitest';
import { pinHashFor } from '../src/lib/crypto';
import type { Household } from '../src/lib/types';

const base: Household = { members: [], startDate: '2026-10-26' };

describe('pinHashFor', () => {
  it('nimmt die eigene PIN der Person', () => {
    expect(pinHashFor({ ...base, pins: { lucas: 'a', paul: 'b' }, pinHash: 'alt' }, 'paul')).toBe('b');
  });
  it('fällt auf den alten gemeinsamen WG-PIN zurück, wenn kein eigener Eintrag existiert', () => {
    expect(pinHashFor({ ...base, pins: { lucas: 'a' }, pinHash: 'alt' }, 'paul')).toBe('alt');
    expect(pinHashFor({ ...base, pinHash: 'alt' }, 'lucas')).toBe('alt');
  });
});
