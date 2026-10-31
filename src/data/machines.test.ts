import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from './localDb';
import { archiveMachine, MachineValidationError, saveMachine, searchMachines } from './machines';
import type { MachineInput } from '../types';

const firstMachine: MachineInput = {
  displayName: 'Genie Z80-60',
  manufacturer: 'Genie',
  model: 'Z80/60',
  registrationNumber: 'ASSET-01',
  status: 'active',
  meterUnit: 'hours',
  meterValue: 6019,
  sourceAttributes: {}
};

afterEach(async () => {
  await db.transaction('rw', db.machines, db.outbox, db.settings, async () => {
    await db.machines.clear();
    await db.outbox.clear();
    await db.settings.clear();
  });
});

describe('local machine storage', () => {
  it('saves a machine and its pending operation atomically', async () => {
    const saved = await saveMachine(firstMachine);

    expect(await db.machines.get(saved.id)).toMatchObject({
      displayName: 'Genie Z80-60',
      localVersion: 1,
      syncStatus: 'pending'
    });
    expect(await db.outbox.where('entityId').equals(saved.id).count()).toBe(1);
  });

  it('preserves machine identity and increments its local version on edit', async () => {
    const saved = await saveMachine(firstMachine);
    const updated = await saveMachine({ ...saved, location: 'Rustavi' });

    expect(updated.id).toBe(saved.id);
    expect(updated.localVersion).toBe(2);
    expect(updated.location).toBe('Rustavi');
    expect(await db.outbox.where('entityId').equals(saved.id).count()).toBe(2);
  });

  it('searches locally across names, machine identifiers, model, and location', async () => {
    await saveMachine(firstMachine);

    await expect(searchMachines('asset-01')).resolves.toHaveLength(1);
    await expect(searchMachines('rustavi')).resolves.toHaveLength(0);
    await expect(searchMachines('z80/60')).resolves.toHaveLength(1);
  });

  it('archives rather than deleting the machine profile', async () => {
    const saved = await saveMachine(firstMachine);
    const archived = await archiveMachine(saved.id);

    expect(archived.status).toBe('archived');
    expect(await db.machines.get(saved.id)).toBeDefined();
    expect(await searchMachines('')).toHaveLength(0);
  });

  it('rejects invalid values before changing local data', async () => {
    await expect(saveMachine({ ...firstMachine, displayName: ' ' })).rejects.toBeInstanceOf(
      MachineValidationError
    );
    await expect(saveMachine({ ...firstMachine, meterValue: -1 })).rejects.toBeInstanceOf(
      MachineValidationError
    );
    await expect(db.machines.count()).resolves.toBe(0);
    await expect(db.outbox.count()).resolves.toBe(0);
  });
});
