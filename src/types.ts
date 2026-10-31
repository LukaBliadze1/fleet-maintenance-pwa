export type MachineStatus = 'active' | 'inactive' | 'archived';

export type MeterUnit = 'hours' | 'kilometers' | 'miles' | 'unknown';

export interface MachinePart {
  component: string;
  specification: string;
  sourceCell?: string;
  author?: string;
  commentedAt?: string;
}

export interface Machine {
  id: string;
  displayName: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  registrationNumber?: string;
  yearManufactured?: number;
  category?: string;
  status: MachineStatus;
  location?: string;
  fuelType?: string;
  tankCapacity?: string;
  meterUnit: MeterUnit;
  meterValue?: number;
  meterRecordedAt?: string;
  notes?: string;
  parts?: MachinePart[];
  sourceAttributes: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  localVersion: number;
  serverVersion?: number;
  syncStatus: 'pending' | 'synced' | 'conflict';
}

export type MachineInput = Omit<
  Machine,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'localVersion'
  | 'serverVersion'
  | 'syncStatus'
> & { id?: string };

export interface MaintenanceRecord {
  id: string;
  machineId: string;
  performedAt: string;
  meterReading?: number;
  category: string;
  workPerformed: string;
  partsUsed?: string;
  notes?: string;
  sourceAttributes?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  localVersion: number;
  serverVersion?: number;
  syncStatus: 'pending' | 'synced' | 'conflict';
}

export type MaintenanceRecordInput = Omit<
  MaintenanceRecord,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'localVersion'
  | 'serverVersion'
  | 'syncStatus'
> & { id?: string };

export interface PendingOperation {
  id: string;
  entityType: 'machine' | 'maintenance';
  entityId: string;
  operation: 'create' | 'update' | 'archive';
  expectedServerVersion: number | null;
  payload: Machine | MaintenanceRecord;
  createdAt: string;
  status: 'pending' | 'processing' | 'failed' | 'conflict';
  retryCount: number;
  lastError?: string;
}

export interface UserPreference {
  key: string;
  value: string;
  updatedAt: string;
}

export interface WorkbookReviewRecord {
  id: string;
  fileName: string;
  analyzedAt: string;
}

export type WorkbookIssueDecisionAction =
  | 'interpreted-date'
  | 'confirmed-duplicate'
  | 'distinct-records'
  | 'interpreted-formula'
  | 'acknowledged-source-error'
  | 'acknowledged-missing-date'
  | 'reviewed';

export interface WorkbookIssueDecision {
  id: string;
  workbookHash: string;
  issueId: string;
  action: WorkbookIssueDecisionAction;
  interpretedValue?: string;
  note?: string;
  updatedAt: string;
}
