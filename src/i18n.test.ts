import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from './data/localDb';
import { saveMachine } from './data/machines';
import { i18n, restoreLocalePreference, saveLocalePreference } from './i18n';

afterEach(async () => {
  await db.transaction('rw', db.machines, db.outbox, db.settings, async () => {
    await db.machines.clear();
    await db.outbox.clear();
    await db.settings.clear();
  });
  await i18n.changeLanguage('en');
});

describe('interface language preference', () => {
  it('persists the selected locale without changing machine or pending operation data', async () => {
    const machine = await saveMachine({
      displayName: 'Genie Z80-60',
      manufacturer: 'Genie',
      model: 'Z80/60',
      status: 'active',
      meterUnit: 'hours',
      meterValue: 6019,
      notes: 'Original maintenance note',
      sourceAttributes: {}
    });
    const pendingOperations = await db.outbox.toArray();

    await saveLocalePreference('ka');

    expect(await restoreLocalePreference()).toBe('ka');
    expect(i18n.resolvedLanguage).toBe('ka');
    expect(await db.machines.get(machine.id)).toEqual(machine);
    expect(await db.outbox.toArray()).toEqual(pendingOperations);
  });
});
