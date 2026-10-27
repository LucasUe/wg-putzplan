import type { Household, Task } from './types';

/** Startdaten laut Plan: drei Mitbewohner, sechs Aufgaben, Rotation ab Montag 26.10.2026. */
export const SEED_START_DATE = '2026-10-26';
export const SEED_PIN = '1234';
const SEED_CREATED_AT = '2026-01-01T00:00:00.000Z';

export function seedHousehold(pinHash: string): Household {
  return {
    members: [
      { id: 'lucas', name: 'Lucas', color: '#3B82F6' },
      { id: 'marleen', name: 'Marleen', color: '#10B981' },
      { id: 'paul', name: 'Paul', color: '#F97316' },
    ],
    pinHash,
    startDate: SEED_START_DATE,
  };
}

export function seedTasks(): Task[] {
  const base = { active: true, weight: 1, createdAt: SEED_CREATED_AT };
  return [
    { ...base, id: 'saugen', name: 'Saugen', icon: '🧹', cadence: 'weekly', window: 'weekend' },
    { ...base, id: 'kueche', name: 'Küche putzen', icon: '🍳', cadence: 'weekly', window: 'weekend' },
    { ...base, id: 'muell', name: 'Müll runterbringen', icon: '🗑️', cadence: 'weekly', window: 'fullWeek' },
    { ...base, id: 'wischen', name: 'Wohnung wischen', icon: '🧽', cadence: 'monthly', window: 'fullMonth' },
    { ...base, id: 'kuehlschrank', name: 'Kühlschrank putzen', icon: '🧊', cadence: 'monthly', window: 'fullMonth' },
    { ...base, id: 'pappe', name: 'Pappe/Glas wegbringen', icon: '📦', cadence: 'monthly', window: 'fullMonth' },
  ];
}
