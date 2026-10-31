import { db } from './localDb';
import { saveMachine } from './machines';
import { saveMaintenanceRecord } from './maintenance';
import {
  isNonPlaceholder,
  type ImportedCellSnapshot,
  type MachineCandidate,
  type MaintenanceRowCandidate,
  type WorkbookDryRun,
  type WorkbookIssue
} from './workbookImport';
import type {
  Machine,
  MachineInput,
  MachinePart,
  MaintenanceRecordInput,
  MeterUnit,
  WorkbookIssueDecision
} from '../types';

export type SkippedRowReason =
  | 'template-sample'
  | 'date-unresolved'
  | 'description-missing'
  | 'confirmed-duplicate';

export type DateInterpretation =
  | 'date-cell'
  | 'date-cell-day-first'
  | 'text-day-first'
  | 'review-decision';

export interface PlannedMachine {
  sheetName: string;
  input: MachineInput & { id: string };
}

export interface PlannedRecord {
  sheetName: string;
  rowNumber: number;
  dateInterpretation: DateInterpretation;
  input: MaintenanceRecordInput & { id: string };
}

export interface SkippedRow {
  sheetName: string;
  rowNumber: number;
  reason: SkippedRowReason;
  details?: string;
  description?: string;
  issueId?: string;
}

export interface WorkbookImportPlan {
  fileName: string;
  sourceHash: string;
  machines: PlannedMachine[];
  records: PlannedRecord[];
  skippedRows: SkippedRow[];
}

export interface WorkbookCommitResult {
  machinesCreated: number;
  machinesUpdated: number;
  machinesExisting: number;
  recordsCreated: number;
  recordsExisting: number;
}

const dateHeaders = ['date', 'servicedate'];
const descriptionHeaders = ['description', 'workperformed', 'maintenanceperformed'];
const meterHeaders = ['odometer', 'meter', 'meterreading', 'hours', 'mileage'];
const partsHeaders = ['partno', 'parts', 'partsused'];
const meterText = /^\s*(\d[\d,\s]*(?:\.\d+)?)\s*(?:h|hrs?|hours?|km|კმ)?\s*$/i;
const dayFirstText = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;

function normalizeLabel(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function columnOf(address: string): string {
  return address.replace(/\d+$/, '');
}

function rowOf(address: string): number {
  return Number(address.match(/\d+$/)?.[0]);
}

function parsedValue(cell: ImportedCellSnapshot): unknown {
  try {
    return JSON.parse(cell.valueJson);
  } catch {
    return undefined;
  }
}

function storedDate(cell: ImportedCellSnapshot): string | undefined {
  const value = parsedValue(cell);
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('type' in value) || value.type !== 'date' || !('value' in value)) return undefined;
  return typeof value.value === 'string' ? value.value.slice(0, 10) : undefined;
}

function isoDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

/**
 * The workbook writes dates day-first. Text such as "29/10/2025" stays text, while an entry such as
 * "10/07/2025" was converted by a month-first Excel locale into 7 October. A stored date whose day and
 * month are both 12 or less is therefore read day-first; the original cell value is kept as provenance.
 */
function resolveDate(
  cell: ImportedCellSnapshot | undefined,
  decision: WorkbookIssueDecision | undefined
): { performedAt: string; interpretation: DateInterpretation } | undefined {
  if (decision?.action === 'interpreted-date' && decision.interpretedValue) {
    const [year, month, day] = decision.interpretedValue.split('-').map(Number);
    const performedAt = isoDate(year, month, day);
    if (performedAt) return { performedAt, interpretation: 'review-decision' };
  }
  if (!cell) return undefined;

  const stored = storedDate(cell);
  if (stored) {
    const [year, month, day] = stored.split('-').map(Number);
    if (month <= 12 && day <= 12 && month !== day) {
      const performedAt = isoDate(year, day, month);
      if (performedAt) return { performedAt, interpretation: 'date-cell-day-first' };
    }
    return { performedAt: stored, interpretation: 'date-cell' };
  }

  const match = cell.displayText.trim().match(dayFirstText);
  if (!match) return undefined;
  const performedAt = isoDate(Number(match[3]), Number(match[2]), Number(match[1]));
  return performedAt ? { performedAt, interpretation: 'text-day-first' } : undefined;
}

function parseMeter(cell: ImportedCellSnapshot | null | undefined): number | undefined {
  if (!cell) return undefined;
  const value = parsedValue(cell);
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const match = value.match(meterText);
  if (!match) return undefined;
  const reading = Number(match[1].replace(/[,\s]/g, ''));
  return Number.isFinite(reading) ? reading : undefined;
}

function unitsIn(text: string): MeterUnit[] {
  const units: MeterUnit[] = [];
  if (/\d\s*(?:h|hrs?|hours?)\b/i.test(text) || /\bhours?\b/i.test(text)) units.push('hours');
  if (/\d\s*(?:km|კმ)/i.test(text) || /\bkm\b/i.test(text)) units.push('kilometers');
  return units;
}

function literalSignature(row: MaintenanceRowCandidate): string {
  return row.cells
    .filter(({ source }) => !source.formulaPresent)
    .map(({ source }) => `${columnOf(source.address)}=${source.valueJson}`)
    .sort()
    .join('|');
}

async function stableId(seed: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))
  );
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function categoriesBySheet(preview: WorkbookDryRun): Map<string, string> {
  const categories = new Map<string, string>();
  const index = preview.sheets.find((sheet) => sheet.kind === 'index');
  if (!index) return categories;

  const sheetNames = new Set(preview.machines.map((machine) => machine.sheetName));
  const columns = new Map<string, ImportedCellSnapshot[]>();
  for (const cell of index.cells) {
    if (!cell.displayText.trim()) continue;
    const column = columnOf(cell.address);
    columns.set(column, [...(columns.get(column) ?? []), cell]);
  }

  for (const cells of columns.values()) {
    let category: string | undefined;
    for (const cell of cells.sort((left, right) => rowOf(left.address) - rowOf(right.address))) {
      const text = cell.displayText.trim();
      if (!sheetNames.has(text)) {
        category = text;
      } else if (category) {
        categories.set(text, category);
      }
    }
  }
  return categories;
}

function profileSource(machine: MachineCandidate, label: string): ImportedCellSnapshot | null {
  return machine.profileFields.find((field) => field.label === label)?.source ?? null;
}

function profileText(machine: MachineCandidate, label: string): string | undefined {
  const text = profileSource(machine, label)?.displayText.trim();
  return isNonPlaceholder(text) ? text : undefined;
}

function rowIssue(
  preview: WorkbookDryRun,
  row: MaintenanceRowCandidate,
  codes: WorkbookIssue['code'][]
): WorkbookIssue | undefined {
  return preview.issues.find((candidate) =>
    candidate.sheetName === row.sheetName &&
    candidate.rowNumber === row.rowNumber &&
    codes.includes(candidate.code)
  );
}

export async function planWorkbookImport(
  preview: WorkbookDryRun,
  decisions: WorkbookIssueDecision[]
): Promise<WorkbookImportPlan> {
  const decisionsByIssue = new Map(
    decisions
      .filter((decision) => decision.workbookHash === preview.sourceHash)
      .map((decision) => [decision.issueId, decision])
  );
  const templateSignatures = new Set(preview.templateRows.map(literalSignature));
  const templateValues = new Map<string, Set<string>>();
  for (const row of preview.templateRows) {
    for (const { source } of row.cells) {
      const column = columnOf(source.address);
      templateValues.set(column, (templateValues.get(column) ?? new Set()).add(source.valueJson));
    }
  }
  const categories = categoriesBySheet(preview);
  const provenance = {
    'workbook.fileName': preview.fileName,
    'workbook.sha256': preview.sourceHash
  };

  const machines: PlannedMachine[] = [];
  const records: PlannedRecord[] = [];
  const skippedRows: SkippedRow[] = [];

  for (const candidate of preview.machines) {
    const machineId = await stableId(`fleetwise-workbook-machine:${candidate.sheetName}`);
    const units = new Set<MeterUnit>();
    if (profileSource(candidate, 'Hours')) units.add('hours');
    for (const label of ['Hours', 'Mileage', 'Next Service', 'Next Service Due', 'Ending Mileage']) {
      unitsIn(profileSource(candidate, label)?.displayText ?? '').forEach((unit) => units.add(unit));
    }
    for (const schedule of preview.schedules.filter((row) => row.sheetName === candidate.sheetName)) {
      schedule.cells
        .filter(({ header }) => meterHeaders.includes(normalizeLabel(header)))
        .forEach(({ source }) => unitsIn(source.displayText).forEach((unit) => units.add(unit)));
    }

    for (const row of preview.maintenanceRows.filter((item) => item.sheetName === candidate.sheetName)) {
      if (templateSignatures.has(literalSignature(row))) {
        skippedRows.push({ sheetName: row.sheetName, rowNumber: row.rowNumber, reason: 'template-sample' });
        continue;
      }

      const findCell = (headers: string[]) =>
        row.cells.find(({ header }) => headers.includes(normalizeLabel(header)))?.source;
      const dateCell = findCell(dateHeaders);
      const descriptionCell = findCell(descriptionHeaders);
      const isTemplateValue = (source: ImportedCellSnapshot) =>
        templateValues.get(columnOf(source.address))?.has(source.valueJson) ?? false;
      const sourceCells = row.cells.filter(({ source }) =>
        !source.formulaPresent &&
        isNonPlaceholder(source.displayText) &&
        (source === dateCell || source === descriptionCell || !isTemplateValue(source))
      );
      const meterCell = sourceCells.find(({ header }) => meterHeaders.includes(normalizeLabel(header)))?.source;
      const partsCell = sourceCells.find(({ header }) => partsHeaders.includes(normalizeLabel(header)))?.source;
      for (const { header, source } of sourceCells) {
        if (meterHeaders.includes(normalizeLabel(header)) || normalizeLabel(header) === 'nextservicedue') {
          unitsIn(source.displayText).forEach((unit) => units.add(unit));
        }
      }

      const duplicateIssue = rowIssue(preview, row, ['duplicate-maintenance-record']);
      if (duplicateIssue?.id && decisionsByIssue.get(duplicateIssue.id)?.action === 'confirmed-duplicate') {
        skippedRows.push({ sheetName: row.sheetName, rowNumber: row.rowNumber, reason: 'confirmed-duplicate' });
        continue;
      }
      const workPerformed = descriptionCell?.displayText.trim();
      if (!workPerformed) {
        skippedRows.push({ sheetName: row.sheetName, rowNumber: row.rowNumber, reason: 'description-missing' });
        continue;
      }
      const dateIssue = rowIssue(preview, row, ['history-date-needs-review', 'history-date-missing']);
      const date = resolveDate(dateCell, dateIssue?.id ? decisionsByIssue.get(dateIssue.id) : undefined);
      if (!date) {
        skippedRows.push({
          sheetName: row.sheetName,
          rowNumber: row.rowNumber,
          reason: 'date-unresolved',
          details: dateCell?.displayText.trim() || undefined,
          description: workPerformed,
          issueId: dateIssue?.id
        });
        continue;
      }

      const notes = sourceCells
        .filter(({ source }) => ![dateCell, descriptionCell, meterCell, partsCell].includes(source))
        .map(({ header, source }) => `${header}: ${source.displayText.trim()}`)
        .join('\n');
      records.push({
        sheetName: row.sheetName,
        rowNumber: row.rowNumber,
        dateInterpretation: date.interpretation,
        input: {
          id: await stableId(`fleetwise-workbook-record:${row.sheetName}:${row.rowNumber}`),
          machineId,
          performedAt: date.performedAt,
          meterReading: parseMeter(meterCell),
          category: 'other',
          workPerformed,
          partsUsed: partsCell?.displayText.trim(),
          notes: notes || undefined,
          sourceAttributes: {
            ...provenance,
            'workbook.sheet': row.sheetName,
            'workbook.row': String(row.rowNumber),
            'workbook.date': dateCell ? storedDate(dateCell) ?? dateCell.displayText : '',
            'workbook.dateInterpretation': date.interpretation
          }
        }
      });
    }

    const year = Number(profileText(candidate, 'Year'));
    const meterValue = parseMeter(profileSource(candidate, 'Ending Mileage'));
    const sheetCells = new Map(
      preview.sheets.find((sheet) => sheet.name === candidate.sheetName)?.cells
        .map((cell) => [cell.address, cell] as const) ?? []
    );
    // Comments on the workbook's component rows hold part numbers and specifications. Replies are
    // conversation about a comment, so only the opening comment of each thread is kept.
    const parts: MachinePart[] = preview.comments
      .filter((comment) => comment.sheetName === candidate.sheetName && !comment.isReply && comment.text)
      .sort((left, right) => rowOf(left.cellAddress) - rowOf(right.cellAddress))
      .map((comment) => ({
        component: sheetCells.get(comment.cellAddress)?.displayText.trim() || comment.cellAddress,
        specification: comment.text,
        sourceCell: comment.cellAddress,
        author: comment.author,
        commentedAt: comment.createdAt
      }));
    machines.push({
      sheetName: candidate.sheetName,
      input: {
        id: machineId,
        displayName: candidate.sheetName,
        manufacturer: profileText(candidate, 'Brand'),
        model: profileText(candidate, 'Model'),
        registrationNumber: candidate.registrationNumber,
        serialNumber: candidate.serialNumber,
        yearManufactured:
          Number.isInteger(year) && year >= 1800 && year <= new Date().getFullYear() + 1 ? year : undefined,
        category: categories.get(candidate.sheetName),
        status: profileText(candidate, 'Status')?.toLocaleLowerCase() === 'inactive' ? 'inactive' : 'active',
        location: profileText(candidate, 'Location'),
        fuelType: profileText(candidate, 'Gasoline Type'),
        tankCapacity: profileText(candidate, 'Tank Capacity'),
        meterUnit: units.size === 1 ? [...units][0] : 'unknown',
        meterValue: meterValue ? meterValue : undefined,
        parts: parts.length > 0 ? parts : undefined,
        sourceAttributes: {
          ...provenance,
          'workbook.sheet': candidate.sheetName,
          ...Object.fromEntries(
            candidate.profileFields
              .filter(({ source }) => source?.displayText.trim())
              .map(({ label, source }) => [`workbook.profile.${label}`, source?.displayText.trim() ?? ''])
          )
        }
      }
    });
  }

  return {
    fileName: preview.fileName,
    sourceHash: preview.sourceHash,
    machines,
    records,
    skippedRows
  };
}

function sharesIdentifier(machine: Machine, input: MachineInput): boolean {
  const same = (left?: string, right?: string) =>
    Boolean(left && right && normalizeLabel(left) === normalizeLabel(right));
  return same(machine.serialNumber, input.serialNumber) ||
    same(machine.registrationNumber, input.registrationNumber);
}

/**
 * Saves planned machines and history in one transaction. Rows already imported are left unchanged,
 * and machines that already exist on this device only gain part details they do not have yet, so
 * importing the same workbook again is safe.
 */
export async function commitWorkbookImport(plan: WorkbookImportPlan): Promise<WorkbookCommitResult> {
  return db.transaction('rw', db.machines, db.maintenanceRecords, db.outbox, async () => {
    const existingMachines = await db.machines.toArray();
    const machineIds = new Map<string, string>();
    const result: WorkbookCommitResult = {
      machinesCreated: 0,
      machinesUpdated: 0,
      machinesExisting: 0,
      recordsCreated: 0,
      recordsExisting: 0
    };

    for (const { input } of plan.machines) {
      const existing = existingMachines.find((machine) => machine.id === input.id) ??
        existingMachines.find((machine) => sharesIdentifier(machine, input));
      if (existing) {
        machineIds.set(input.id, existing.id);
        if (existing.parts === undefined && input.parts) {
          await saveMachine({ ...existing, parts: input.parts });
          result.machinesUpdated += 1;
        } else {
          result.machinesExisting += 1;
        }
        continue;
      }
      await saveMachine(input);
      machineIds.set(input.id, input.id);
      result.machinesCreated += 1;
    }

    for (const { input } of plan.records) {
      if (await db.maintenanceRecords.get(input.id)) {
        result.recordsExisting += 1;
        continue;
      }
      await saveMaintenanceRecord({
        ...input,
        machineId: machineIds.get(input.machineId) ?? input.machineId
      });
      result.recordsCreated += 1;
    }

    return result;
  });
}
