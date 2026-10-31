import { db } from './localDb';
import type {
  MaintenanceRecord,
  MaintenanceRecordInput,
  PendingOperation
} from '../types';

export class MaintenanceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaintenanceValidationError';
  }
}

function validateRecord(input: MaintenanceRecordInput): void {
  if (!input.workPerformed.trim()) {
    throw new MaintenanceValidationError('errors.workPerformedRequired');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.performedAt)) {
    throw new MaintenanceValidationError('errors.invalidMaintenanceDate');
  }

  const parsedDate = new Date(`${input.performedAt}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== input.performedAt) {
    throw new MaintenanceValidationError('errors.invalidMaintenanceDate');
  }

  if (
    input.meterReading !== undefined &&
    (!Number.isFinite(input.meterReading) || input.meterReading < 0)
  ) {
    throw new MaintenanceValidationError('errors.invalidMeter');
  }

  if (!input.category.trim()) {
    throw new MaintenanceValidationError('errors.maintenanceCategoryRequired');
  }
}

export async function saveMaintenanceRecord(
  input: MaintenanceRecordInput
): Promise<MaintenanceRecord> {
  validateRecord(input);
  const now = new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();

  return db.transaction('rw', db.machines, db.maintenanceRecords, db.outbox, async () => {
    const machine = await db.machines.get(input.machineId);
    if (!machine) {
      throw new MaintenanceValidationError('errors.machineNotFound');
    }

    const previous = await db.maintenanceRecords.get(id);
    if (previous && previous.machineId !== input.machineId) {
      throw new MaintenanceValidationError('errors.maintenanceMachineCannotChange');
    }

    const record: MaintenanceRecord = {
      ...input,
      id,
      workPerformed: input.workPerformed.trim(),
      category: input.category.trim(),
      partsUsed: input.partsUsed?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      localVersion: (previous?.localVersion ?? 0) + 1,
      serverVersion: previous?.serverVersion,
      syncStatus: 'pending'
    };

    await db.maintenanceRecords.put(record);
    const operation: PendingOperation = {
      id: crypto.randomUUID(),
      entityType: 'maintenance',
      entityId: id,
      operation: previous ? 'update' : 'create',
      expectedServerVersion: previous?.serverVersion ?? null,
      payload: record,
      createdAt: now,
      status: 'pending',
      retryCount: 0
    };
    await db.outbox.add(operation);

    return record;
  });
}
