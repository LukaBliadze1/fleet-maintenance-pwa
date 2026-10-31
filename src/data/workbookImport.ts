import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const maximumWorkbookBytes = 20 * 1024 * 1024;
const maximumWorkbookCells = 500_000;

export type WorkbookIssueCode =
  | 'duplicate-machine-identifier'
  | 'duplicate-maintenance-record'
  | 'formula-error'
  | 'history-date-needs-review'
  | 'history-description-missing'
  | 'history-date-missing'
  | 'machine-identifier-missing'
  | 'unrecognized-sheet';

export interface WorkbookIssue {
  id?: string;
  code: WorkbookIssueCode;
  sheetName: string;
  rowNumber?: number;
  cellAddress?: string;
  details?: string;
}

export interface ImportedCellSnapshot {
  address: string;
  type: number;
  displayText: string;
  valueJson: string;
  formulaPresent: boolean;
  formula?: string;
  resultJson?: string;
  numberFormat?: string;
  styleJson: string;
  noteJson?: string;
}

export interface ImportedSourceSheet {
  name: string;
  kind: 'template' | 'index' | 'equipment' | 'other';
  rowCount: number;
  columnCount: number;
  mergedRanges: string[];
  layoutJson: string;
  cells: ImportedCellSnapshot[];
}

export interface MaintenanceRowCandidate {
  sheetName: string;
  rowNumber: number;
  cells: Array<{ header: string; source: ImportedCellSnapshot }>;
}

export interface MachineCandidate {
  sheetName: string;
  profileFields: Array<{ label: string; source: ImportedCellSnapshot | null }>;
  registrationNumber?: string;
  serialNumber?: string;
  historyRowCount: number;
}

export interface WorkbookComment {
  sheetName: string;
  cellAddress: string;
  text: string;
  author?: string;
  createdAt?: string;
  isReply: boolean;
}

export interface ScheduleCandidate {
  sheetName: string;
  rowNumber: number;
  cells: Array<{ header: string; source: ImportedCellSnapshot }>;
}

export interface WorkbookDryRun {
  fileName: string;
  sourceHash: string;
  sheets: ImportedSourceSheet[];
  machines: MachineCandidate[];
  maintenanceRows: MaintenanceRowCandidate[];
  templateRows: MaintenanceRowCandidate[];
  schedules: ScheduleCandidate[];
  issues: WorkbookIssue[];
  formulaErrorCount: number;
  commentCount: number;
  threadedCommentCount: number;
  threadedCommentParts: Array<{ path: string; xml: string; count: number }>;
  comments: WorkbookComment[];
  sourceCellCount: number;
}

export class WorkbookImportError extends Error {
  readonly code: 'file-too-large' | 'too-many-cells' | 'invalid-workbook';

  constructor(
    code: 'file-too-large' | 'too-many-cells' | 'invalid-workbook',
    message: string
  ) {
    super(message);
    this.name = 'WorkbookImportError';
    this.code = code;
  }
}

const profileLabels = [
  'Year',
  'Brand',
  'Model',
  'Plate / Reg #',
  'VIN',
  'Status',
  'Gasoline Type',
  'Tank Capacity',
  'Operator',
  'Location',
  'Acquisition Date',
  'Exp. Date',
  'Next Service Due',
  'Next Service',
  'Hours',
  'Mileage',
  'Ending Mileage'
];

function normalizeLabel(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

async function sha256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

function serialized(value: unknown): string {
  const jsonValue = value instanceof Date
    ? { type: 'date', value: value.toISOString() }
    : value;
  return JSON.stringify(jsonValue) ?? 'null';
}

function formulaParts(value: ExcelJS.CellValue): { formula?: string; result?: unknown } {
  if (typeof value !== 'object' || value === null) return {};
  if ('formula' in value) {
    return {
      formula: typeof value.formula === 'string' ? value.formula : undefined,
      result: value.result
    };
  }
  if ('sharedFormula' in value) {
    return {
      formula: typeof value.sharedFormula === 'string' ? value.sharedFormula : undefined,
      result: value.result
    };
  }
  return {};
}

function containsFormula(value: unknown): boolean {
  return typeof value === 'object' &&
    value !== null &&
    ('formula' in value || 'sharedFormula' in value);
}

function formulaError(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('error' in value)) return undefined;
  return typeof value.error === 'string' ? value.error : undefined;
}

function isMergedChild(cell: ExcelJS.Cell): boolean {
  return cell.isMerged && cell.master.address !== cell.address;
}

function sourceValue(cell: ExcelJS.Cell): ExcelJS.CellValue {
  return cell.isMerged ? cell.master.value : cell.value;
}

function cellDisplayText(cell: ExcelJS.Cell): string {
  const source = cell.isMerged ? cell.master : cell;
  return source.value === null || source.value === undefined ? '' : source.text;
}

function snapshotCell(cell: ExcelJS.Cell): ImportedCellSnapshot {
  const mergedChild = isMergedChild(cell);
  const value = sourceValue(cell);
  const { formula, result } = mergedChild ? {} : formulaParts(value);
  const valueJson = mergedChild
    ? serialized({
        type: 'merged-cell',
        masterAddress: cell.master.address,
        masterValue: value
      })
    : serialized(value);
  return {
    address: cell.address,
    type: cell.type,
    displayText: cellDisplayText(cell),
    valueJson,
    formulaPresent: !mergedChild && containsFormula(value),
    formula,
    resultJson: result === undefined ? undefined : serialized(result),
    numberFormat: cell.numFmt,
    styleJson: serialized(cell.style),
    noteJson: cell.note === undefined ? undefined : serialized(cell.note)
  };
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlAttribute(tag: string, name: string): string | undefined {
  const value = tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  return value === undefined ? undefined : decodeXml(value);
}

function xmlTags(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}\\s[^>]*>`, 'g'))].map((match) => match[0]);
}

function resolvePartPath(baseDirectory: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = `${baseDirectory}${target}`.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

/** Reads Excel threaded comments and maps each one to its worksheet and cell. */
async function readThreadedComments(zip: JSZip): Promise<WorkbookComment[]> {
  const read = async (path: string) => zip.file(path)?.async('string') ?? '';
  const workbookXml = await read('xl/workbook.xml');
  const workbookRelationships = xmlTags(await read('xl/_rels/workbook.xml.rels'), 'Relationship');
  const people = new Map<string, string>();
  for (const path of Object.keys(zip.files).filter((file) => /^xl\/persons\/[^/]+\.xml$/i.test(file))) {
    for (const person of xmlTags(await read(path), 'person')) {
      const id = xmlAttribute(person, 'id');
      const displayName = xmlAttribute(person, 'displayName');
      if (id && displayName) people.set(id, displayName);
    }
  }

  const comments: WorkbookComment[] = [];
  for (const sheet of xmlTags(workbookXml, 'sheet')) {
    const sheetName = xmlAttribute(sheet, 'name');
    const relationshipId = xmlAttribute(sheet, 'r:id');
    const sheetRelationship = workbookRelationships
      .find((relationship) => xmlAttribute(relationship, 'Id') === relationshipId);
    const sheetTarget = sheetRelationship ? xmlAttribute(sheetRelationship, 'Target') : undefined;
    if (!sheetName || !sheetTarget) continue;

    const sheetPath = resolvePartPath('xl/', sheetTarget);
    const sheetDirectory = sheetPath.slice(0, sheetPath.lastIndexOf('/') + 1);
    const sheetFile = sheetPath.slice(sheetDirectory.length);
    const threadTargets = xmlTags(await read(`${sheetDirectory}_rels/${sheetFile}.rels`), 'Relationship')
      .filter((relationship) => /\/threadedComment$/.test(xmlAttribute(relationship, 'Type') ?? ''))
      .map((relationship) => xmlAttribute(relationship, 'Target'))
      .filter((target): target is string => Boolean(target));

    for (const target of threadTargets) {
      const xml = await read(resolvePartPath(sheetDirectory, target));
      for (const match of xml.matchAll(/<threadedComment(\s[^>]*)>([\s\S]*?)<\/threadedComment>/g)) {
        const cellAddress = xmlAttribute(match[1], 'ref');
        if (!cellAddress) continue;
        const personId = xmlAttribute(match[1], 'personId');
        comments.push({
          sheetName,
          cellAddress,
          text: decodeXml(match[2].match(/<text>([\s\S]*?)<\/text>/)?.[1] ?? '').replace(/\r\n?/g, '\n').trim(),
          author: personId ? people.get(personId) : undefined,
          createdAt: xmlAttribute(match[1], 'dT'),
          isReply: Boolean(xmlAttribute(match[1], 'parentId'))
        });
      }
    }
  }
  return comments;
}

function hasLiteralValue(cell: ExcelJS.Cell): boolean {
  if (isMergedChild(cell)) return false;
  const value = sourceValue(cell);
  if (value === null || value === undefined) return false;
  if (containsFormula(value)) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export function isNonPlaceholder(value: string | undefined): value is string {
  if (!value) return false;
  const normalized = value.trim().toLocaleLowerCase();
  return normalized !== '' &&
    !['#', 'x', 'n/a', 'na', 'unknown', '-', '...', '…'].includes(normalized);
}

function findHistoryHeader(worksheet: ExcelJS.Worksheet): ExcelJS.Row | undefined {
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const normalizedHeaders = new Set<string>();
    row.eachCell({ includeEmpty: false }, (cell) => {
      normalizedHeaders.add(normalizeLabel(cellDisplayText(cell)));
    });
    const hasDate = normalizedHeaders.has('date') || normalizedHeaders.has('servicedate');
    const hasDescription =
      normalizedHeaders.has('description') ||
      normalizedHeaders.has('workperformed') ||
      normalizedHeaders.has('maintenanceperformed');
    if (hasDate && hasDescription) return row;
  }
  return undefined;
}

function findProfileField(
  worksheet: ExcelJS.Worksheet,
  expectedLabel: string
): ImportedCellSnapshot | null {
  const expectedKey = normalizeLabel(expectedLabel);
  const finalRow = Math.min(20, worksheet.rowCount);
  for (let rowNumber = 1; rowNumber <= finalRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let result: ImportedCellSnapshot | null = null;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (result || isMergedChild(cell) || normalizeLabel(cellDisplayText(cell)) !== expectedKey) return;
      const valueCell = row.getCell(cell.fullAddress.col + 1);
      if (valueCell.value !== null && valueCell.value !== undefined) {
        result = snapshotCell(valueCell);
      }
    });
    if (result) return result;
  }
  return null;
}

function headerLabels(headerRow: ExcelJS.Row): Map<number, string> {
  const headers = new Map<number, string>();
  headerRow.eachCell({ includeEmpty: false }, (cell) => {
    if (isMergedChild(cell)) return;
    headers.set(
      cell.fullAddress.col,
      cellDisplayText(cell).trim() || `Column ${cell.col}`
    );
  });
  return headers;
}

function rowSnapshots(
  row: ExcelJS.Row,
  headers: Map<number, string>
): Array<{ header: string; source: ImportedCellSnapshot }> {
  const cells: Array<{ header: string; source: ImportedCellSnapshot }> = [];
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (isMergedChild(cell)) return;
    cells.push({
      header: headers.get(cell.fullAddress.col) ?? `Column ${cell.col}`,
      source: snapshotCell(cell)
    });
  });
  return cells;
}

function rowHasLiteralValue(row: ExcelJS.Row): boolean {
  let hasValue = false;
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (hasLiteralValue(cell)) hasValue = true;
  });
  return hasValue;
}

function extractMaintenanceRows(
  worksheet: ExcelJS.Worksheet,
  headerRow: ExcelJS.Row,
  issues: WorkbookIssue[]
): MaintenanceRowCandidate[] {
  const headers = headerLabels(headerRow);
  const dateColumn = [...headers].find(([, label]) =>
    ['date', 'servicedate'].includes(normalizeLabel(label))
  )?.[0];
  const descriptionColumn = [...headers].find(([, label]) =>
    ['description', 'workperformed', 'maintenanceperformed'].includes(normalizeLabel(label))
  )?.[0];
  const rows: MaintenanceRowCandidate[] = [];
  const fingerprints = new Map<string, number>();

  for (
    let rowNumber = headerRow.number + 1;
    rowNumber <= worksheet.rowCount;
    rowNumber += 1
  ) {
    const row = worksheet.getRow(rowNumber);
    if (!rowHasLiteralValue(row)) continue;

    const cells = rowSnapshots(row, headers);
    rows.push({ sheetName: worksheet.name, rowNumber, cells });

    const dateCell = dateColumn === undefined ? undefined : row.getCell(dateColumn);
    const descriptionCell =
      descriptionColumn === undefined ? undefined : row.getCell(descriptionColumn);
    const dateText = dateCell ? cellDisplayText(dateCell).trim() : undefined;
    const descriptionText = descriptionCell ? cellDisplayText(descriptionCell).trim() : undefined;

    if (!dateText) {
      issues.push({
        code: 'history-date-missing',
        sheetName: worksheet.name,
        rowNumber,
        cellAddress: dateCell?.address
      });
    } else if (!(dateCell?.value instanceof Date)) {
      issues.push({
        code: 'history-date-needs-review',
        sheetName: worksheet.name,
        rowNumber,
        cellAddress: dateCell?.address,
        details: dateText
      });
    }

    if (!descriptionText) {
      issues.push({
        code: 'history-description-missing',
        sheetName: worksheet.name,
        rowNumber,
        cellAddress: descriptionCell?.address
      });
    }

    if (dateCell && descriptionCell && dateText && descriptionText) {
      const fingerprint = `${serialized(dateCell.value)}|${normalizeLabel(descriptionText)}`;
      const firstMatchingRow = fingerprints.get(fingerprint);
      if (firstMatchingRow !== undefined) {
        issues.push({
          code: 'duplicate-maintenance-record',
          sheetName: worksheet.name,
          rowNumber,
          cellAddress: dateCell.address,
          details: `${dateText} · ${descriptionText}; first matching row ${firstMatchingRow}`
        });
      } else {
        fingerprints.set(fingerprint, rowNumber);
      }
    }
  }

  return rows;
}

function extractScheduleRows(
  worksheet: ExcelJS.Worksheet,
  historyHeaderRow: ExcelJS.Row | undefined
): ScheduleCandidate[] {
  let scheduleTitleRow = 0;
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    let isScheduleTitle = false;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const key = normalizeLabel(cellDisplayText(cell));
      if (key.includes('preventativemaintenanceschedule') || key.includes('maintenanceschedule')) {
        isScheduleTitle = true;
      }
    });
    if (isScheduleTitle) {
      scheduleTitleRow = rowNumber;
      break;
    }
  }
  if (!scheduleTitleRow) return [];

  let headerRow: ExcelJS.Row | undefined;
  for (let rowNumber = scheduleTitleRow + 1; rowNumber <= scheduleTitleRow + 4; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const labels: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell) => labels.push(normalizeLabel(cellDisplayText(cell))));
    if (labels.some((label) => /mileage|hours|meter/.test(label)) &&
        labels.some((label) => /recommendedmaintenance|description/.test(label))) {
      headerRow = row;
      break;
    }
  }
  if (!headerRow) return [];

  const headers = headerLabels(headerRow);
  const endRow = historyHeaderRow?.number ?? worksheet.rowCount + 1;
  const schedules: ScheduleCandidate[] = [];

  const dataEndRow = historyHeaderRow ? endRow - 1 : endRow;
  for (let rowNumber = headerRow.number + 1; rowNumber < dataEndRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (!rowHasLiteralValue(row)) continue;
    schedules.push({
      sheetName: worksheet.name,
      rowNumber,
      cells: rowSnapshots(row, headers)
    });
  }

  return schedules;
}

export async function analyzeWorkbook(
  fileName: string,
  data: ArrayBuffer | Uint8Array
): Promise<WorkbookDryRun> {
  const byteLength = data.byteLength;
  if (byteLength > maximumWorkbookBytes) {
    throw new WorkbookImportError(
      'file-too-large',
      'The selected workbook exceeds the 20 MB import limit.'
    );
  }

  const workbook = new ExcelJS.Workbook();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
    await workbook.xlsx.load(data);
  } catch (error) {
    throw new WorkbookImportError(
      'invalid-workbook',
      error instanceof Error ? error.message : 'The selected file is not a readable Excel workbook.'
    );
  }

  if (workbook.worksheets.length > 100) {
    throw new WorkbookImportError(
      'invalid-workbook',
      'The workbook contains more than 100 worksheets.'
    );
  }

  const issues: WorkbookIssue[] = [];
  const sheets: ImportedSourceSheet[] = [];
  const machines: MachineCandidate[] = [];
  const maintenanceRows: MaintenanceRowCandidate[] = [];
  const templateRows: MaintenanceRowCandidate[] = [];
  const schedules: ScheduleCandidate[] = [];
  const identifiers = new Map<string, string>();
  let formulaErrorCount = 0;
  let commentCount = 0;
  let sourceCellCount = 0;
  const threadedCommentParts: WorkbookDryRun['threadedCommentParts'] = [];
  let threadedCommentCount = 0;

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/^xl\/threadedComments\/.*\.xml$/i.test(path)) continue;
    const xml = await entry.async('string');
    const count = xml.match(/<(?:[A-Za-z0-9_]+:)?threadedComment(?=[\s>])/g)?.length ?? 0;
    threadedCommentCount += count;
    threadedCommentParts.push({ path, xml, count });
  }
  const comments = await readThreadedComments(zip);

  for (const worksheet of workbook.worksheets) {
    const isTemplate = normalizeLabel(worksheet.name) === 'template';
    const isIndex = normalizeLabel(worksheet.name) === 'home';
    const historyHeaderRow = isTemplate || isIndex ? undefined : findHistoryHeader(worksheet);
    const kind = isTemplate
      ? 'template'
      : isIndex
        ? 'index'
        : historyHeaderRow
          ? 'equipment'
          : 'other';
    const cells: ImportedCellSnapshot[] = [];

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const snapshot = snapshotCell(cell);
        cells.push(snapshot);
        sourceCellCount += 1;
        if (snapshot.noteJson) commentCount += 1;
        const { result } = isMergedChild(cell) ? {} : formulaParts(sourceValue(cell));
        const error = formulaError(result);
        if (error) {
          formulaErrorCount += 1;
          issues.push({
            code: 'formula-error',
            sheetName: worksheet.name,
            rowNumber: row.number,
            cellAddress: cell.address,
            details: error
          });
        }
      });
    });

    const mergedRanges = [...worksheet.model.merges];
    sheets.push({
      name: worksheet.name,
      kind,
      rowCount: worksheet.rowCount,
      columnCount: worksheet.columnCount,
      mergedRanges,
      layoutJson: serialized({
        columns: worksheet.columns.map((column, index) => ({
          index: index + 1,
          key: column.key,
          width: column.width,
          hidden: column.hidden,
          outlineLevel: column.outlineLevel,
          style: column.style
        })),
        rows: Array.from({ length: worksheet.rowCount }, (_, index) => {
          const row = worksheet.getRow(index + 1);
          return {
            row: index + 1,
            height: row.height,
            hidden: row.hidden,
            outlineLevel: row.outlineLevel
          };
        }).filter((row) =>
          row.height !== undefined ||
          row.hidden ||
          (typeof row.outlineLevel === 'number' && row.outlineLevel > 0)
        ),
        pageSetup: worksheet.pageSetup,
        views: worksheet.views,
        properties: worksheet.properties,
        headerFooter: worksheet.headerFooter,
        autoFilter: worksheet.autoFilter
      }),
      cells
    });

    if (kind === 'other') {
      issues.push({ code: 'unrecognized-sheet', sheetName: worksheet.name });
      continue;
    }
    if (kind === 'template') {
      const templateHeaderRow = findHistoryHeader(worksheet);
      if (templateHeaderRow) {
        templateRows.push(...extractMaintenanceRows(worksheet, templateHeaderRow, []));
      }
      continue;
    }
    if (kind !== 'equipment' || !historyHeaderRow) continue;

    const fieldLabels = profileLabels.map((label) => ({
      label,
      source: findProfileField(worksheet, label)
    }));
    const registrationNumber = fieldLabels
      .find(({ label }) => normalizeLabel(label) === 'platereg')
      ?.source?.displayText.trim();
    const serialNumber = fieldLabels
      .find(({ label }) => normalizeLabel(label) === 'vin')
      ?.source?.displayText.trim();
    const machineRows = extractMaintenanceRows(worksheet, historyHeaderRow, issues);
    const machine: MachineCandidate = {
      sheetName: worksheet.name,
      profileFields: fieldLabels,
      registrationNumber: isNonPlaceholder(registrationNumber) ? registrationNumber : undefined,
      serialNumber: isNonPlaceholder(serialNumber) ? serialNumber : undefined,
      historyRowCount: machineRows.length
    };

    if (!machine.registrationNumber && !machine.serialNumber) {
      issues.push({ code: 'machine-identifier-missing', sheetName: worksheet.name });
    }
    for (const [type, identifier] of [
      ['registration', machine.registrationNumber],
      ['serial', machine.serialNumber]
    ] as const) {
      if (!identifier) continue;
      const key = `${type}:${normalizeLabel(identifier)}`;
      const previousSheet = identifiers.get(key);
      if (previousSheet) {
        issues.push({
          code: 'duplicate-machine-identifier',
          sheetName: worksheet.name,
          details: `${identifier} · ${previousSheet}`
        });
      } else {
        identifiers.set(key, worksheet.name);
      }
    }

    machines.push(machine);
    maintenanceRows.push(...machineRows);
    schedules.push(...extractScheduleRows(worksheet, historyHeaderRow));
  }

  if (sourceCellCount > maximumWorkbookCells) {
    throw new WorkbookImportError(
      'too-many-cells',
      'The workbook exceeds the 500,000 populated cell import limit.'
    );
  }

  const issuePriority: Record<WorkbookIssueCode, number> = {
    'duplicate-machine-identifier': 0,
    'duplicate-maintenance-record': 1,
    'machine-identifier-missing': 2,
    'history-date-missing': 3,
    'history-date-needs-review': 4,
    'history-description-missing': 5,
    'formula-error': 6,
    'unrecognized-sheet': 7
  };
  issues.sort((left, right) => issuePriority[left.code] - issuePriority[right.code]);
  const identifiedIssues = issues.map((issue) => ({
    ...issue,
    id: [
      issue.code,
      encodeURIComponent(issue.sheetName),
      issue.rowNumber ?? '',
      issue.cellAddress ?? '',
      encodeURIComponent(issue.details ?? '')
    ].join(':')
  }));

  return {
    fileName,
    sourceHash: await sha256(data),
    sheets,
    machines,
    maintenanceRows,
    templateRows,
    schedules,
    issues: identifiedIssues,
    formulaErrorCount,
    commentCount,
    threadedCommentCount,
    threadedCommentParts,
    comments,
    sourceCellCount
  };
}
