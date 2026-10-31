import Dexie, { type EntityTable } from 'dexie';
import type {
  Machine,
  MaintenanceRecord,
  PendingOperation,
  UserPreference,
  WorkbookIssueDecision,
  WorkbookReviewRecord
} from '../types';

class FleetDatabase extends Dexie {
  machines!: EntityTable<Machine, 'id'>;
  maintenanceRecords!: EntityTable<MaintenanceRecord, 'id'>;
  outbox!: EntityTable<PendingOperation, 'id'>;
  settings!: EntityTable<UserPreference, 'key'>;
  workbookReviews!: EntityTable<WorkbookReviewRecord, 'id'>;
  workbookIssueDecisions!: EntityTable<WorkbookIssueDecision, 'id'>;

  constructor() {
    super('fleetwise-local');

    this.version(1).stores({
      machines:
        'id, displayName, manufacturer, model, serialNumber, registrationNumber, category, status, location, updatedAt',
      outbox: 'id, entityType, entityId, operation, status, createdAt'
    });

    this.version(2).stores({
      machines:
        'id, displayName, manufacturer, model, serialNumber, registrationNumber, category, status, location, updatedAt',
      outbox: 'id, entityType, entityId, operation, status, createdAt',
      settings: 'key, updatedAt'
    });

    this.version(3).stores({
      machines:
        'id, displayName, manufacturer, model, serialNumber, registrationNumber, category, status, location, updatedAt',
      maintenanceRecords: 'id, machineId, performedAt, updatedAt, [machineId+performedAt]',
      outbox: 'id, entityType, entityId, operation, status, createdAt, [entityType+entityId+createdAt]',
      settings: 'key, updatedAt',
      workbookReviews: 'id, fileName, analyzedAt',
      workbookIssueDecisions: 'id, workbookHash, issueId, updatedAt, [workbookHash+issueId]'
    });
  }
}

export const db = new FleetDatabase();
