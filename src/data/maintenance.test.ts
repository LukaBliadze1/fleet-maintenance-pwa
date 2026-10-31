import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from './localDb';
import { saveMachine } from './machines';
import { MaintenanceValidationError, saveMaintenanceRecord } from './maintenance';

afterEach(async () => {
  await db.transaction(
    'rw',
    db.machines,
    db.maintenanceRecords,
    db.outbox,
    async () => {
      await db.machines.clear();
      await db.maintenanceRecords.clear();
      await db.outbox.clear();
    }
  );
});

describe('offline maintenance record storage', () => {
  it('saves records and their outbox operations atomically and persists across database reopen', async () => {
    const machine = await saveMachine({
      displayName: 'Offline loader',
      status: 'active',
      meterUnit: 'hours',
      sourceAttributes: {}
    });

    const record = await saveMaintenanceRecord({
      machineId: machine.id,
      performedAt: '2026-10-30',
      meterReading: 1280,
      category: 'preventive',
      workPerformed: 'Changed engine oil',
      partsUsed: 'Oil filter',
      notes: 'Saved offline'
    });

    expect(await db.maintenanceRecords.get(record.id)).toMatchObject({
      id: record.id,
      machineId: machine.id,
      localVersion: 1,
      syncStatus: 'pending'
    });
    expect(await db.outbox.where('entityId').equals(record.id).toArray()).toEqual([
      expect.objectContaining({
        entityType: 'maintenance',
        entityId: record.id,
        operation: 'create',
        status: 'pending'
      })
    ]);

    db.close();
    await db.open();
    await expect(db.maintenanceRecords.get(record.id)).resolves.toMatchObject({
      workPerformed: 'Changed engine oil',
      notes: 'Saved offline'
    });
    await expect(db.outbox.where('entityId').equals(record.id).count()).resolves.toBe(1);
  });

  it('rejects invalid input or a missing machine without writing a record or operation', async () => {
    await expect(saveMaintenanceRecord({
      machineId: 'missing-machine',
      performedAt: '2026-02-31',
      category: 'other',
      workPerformed: 'Repair'
    })).rejects.toBeInstanceOf(MaintenanceValidationError);

    await expect(saveMaintenanceRecord({
      machineId: 'missing-machine',
      performedAt: '2026-10-30',
      category: 'other',
      workPerformed: 'Repair'
    })).rejects.toMatchObject({ message: 'errors.machineNotFound' });
    await expect(db.maintenanceRecords.count()).resolves.toBe(0);
    await expect(db.outbox.count()).resolves.toBe(0);
  });
});
