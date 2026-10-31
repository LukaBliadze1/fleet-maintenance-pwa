import { db } from './localDb';
import type { Machine, MachineInput, PendingOperation } from '../types';

export class MachineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MachineValidationError';
  }
}

function validateMachine(input: MachineInput): void {
  if (!input.displayName.trim()) {
    throw new MachineValidationError('errors.machineNameRequired');
  }

  if (
    input.meterValue !== undefined &&
    (!Number.isFinite(input.meterValue) || input.meterValue < 0)
  ) {
    throw new MachineValidationError('errors.invalidMeter');
  }

  if (
    input.yearManufactured !== undefined &&
    (!Number.isInteger(input.yearManufactured) ||
      input.yearManufactured < 1800 ||
      input.yearManufactured > new Date().getFullYear() + 1)
  ) {
    throw new MachineValidationError('errors.invalidYear');
  }
}

export async function saveMachine(input: MachineInput): Promise<Machine> {
  validateMachine(input);

  const now = new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();

  return db.transaction('rw', db.machines, db.outbox, async () => {
    const previous = await db.machines.get(id);
    const machine: Machine = {
      ...input,
      id,
      displayName: input.displayName.trim(),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      localVersion: (previous?.localVersion ?? 0) + 1,
      serverVersion: previous?.serverVersion,
      syncStatus: 'pending'
    };

    await db.machines.put(machine);

    const operation: PendingOperation = {
      id: crypto.randomUUID(),
      entityType: 'machine',
      entityId: id,
      operation: input.status === 'archived' ? 'archive' : previous ? 'update' : 'create',
      expectedServerVersion: previous?.serverVersion ?? null,
      payload: machine,
      createdAt: now,
      status: 'pending',
      retryCount: 0
    };
    await db.outbox.add(operation);

    return machine;
  });
}

export async function archiveMachine(id: string): Promise<Machine> {
  const machine = await db.machines.get(id);
  if (!machine) {
    throw new Error('errors.machineNotFound');
  }

  return saveMachine({ ...machine, status: 'archived' });
}

export async function searchMachines(query: string): Promise<Machine[]> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const machines = await db.machines.orderBy('displayName').toArray();

  if (!normalizedQuery) {
    return machines.filter((machine) => machine.status !== 'archived');
  }

  return machines.filter((machine) => {
    const searchableFields = [
      machine.displayName,
      machine.manufacturer,
      machine.model,
      machine.serialNumber,
      machine.registrationNumber,
      machine.category,
      machine.location,
      machine.status
    ];

    return searchableFields.some((value) =>
      value?.toLocaleLowerCase().includes(normalizedQuery)
    );
  });
}
