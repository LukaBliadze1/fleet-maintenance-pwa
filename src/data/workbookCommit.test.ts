import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { db } from './localDb';
import { saveMachine } from './machines';
import { analyzeWorkbook } from './workbookImport';
import { commitWorkbookImport, planWorkbookImport } from './workbookCommit';
import type { WorkbookIssueDecision } from '../types';

afterEach(async () => {
  await db.transaction('rw', db.machines, db.maintenanceRecords, db.outbox, async () => {
    await db.machines.clear();
    await db.maintenanceRecords.clear();
    await db.outbox.clear();
  });
});

function addHistoryHeader(worksheet: ExcelJS.Worksheet, row: number): void {
  worksheet.getCell(`A${row}`).value = 'Date';
  worksheet.getCell(`B${row}`).value = 'Description';
  worksheet.getCell(`E${row}`).value = 'Odometer';
  worksheet.getCell(`F${row}`).value = 'Service Provider';
  worksheet.getCell(`H${row}`).value = 'Part No.';
  worksheet.getCell(`I${row}`).value = 'Next Service Due';
  worksheet.getCell(`J${row}`).value = 'Material Cost';
}

function addTemplateSample(worksheet: ExcelJS.Worksheet, row: number): void {
  worksheet.getCell(`A${row}`).value = new Date('2021-09-01T00:00:00.000Z');
  worksheet.getCell(`B${row}`).value = 'Oil & Filter Change';
  worksheet.getCell(`E${row}`).value = 65000;
  worksheet.getCell(`F${row}`).value = 'PepBoys';
  worksheet.getCell(`H${row}`).value = 5729;
  worksheet.getCell(`J${row}`).value = 25;
}

async function createWorkbook(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const template = workbook.addWorksheet('TEMPLATE');
  addHistoryHeader(template, 16);
  addTemplateSample(template, 17);

  const home = workbook.addWorksheet('Home');
  home.getCell('A1').value = 'Cranes';
  home.getCell('A2').value = 'Crane 7';

  const crane = workbook.addWorksheet('Crane 7');
  crane.getCell('A4').value = 'Year';
  crane.getCell('B4').value = '2018';
  crane.getCell('D4').value = 'Status';
  crane.getCell('E4').value = 'Active';
  crane.getCell('A5').value = 'Brand';
  crane.getCell('B5').value = 'Liebherr';
  crane.getCell('D5').value = 'Gasoline Type';
  crane.getCell('E5').value = 'Diesel';
  crane.getCell('A6').value = 'Model';
  crane.getCell('B6').value = 'LTM 1055';
  crane.getCell('A7').value = 'Plate / Reg #';
  crane.getCell('B7').value = 'CN055CN';
  crane.getCell('A9').value = 'Oil & Filter Change';
  crane.getCell('A10').value = 'Battery Replacement';
  crane.getCell('A11').value = 'Tires';
  crane.getCell('D7').value = 'VIN';
  crane.getCell('E7').value = '#';
  crane.getCell('A12').value = 'Ending Mileage';
  crane.getCell('B12').value = '9427h';
  addHistoryHeader(crane, 16);
  addTemplateSample(crane, 17);
  crane.getCell('A18').value = '29/10/2025';
  crane.getCell('B18').value = 'Hydraulic filter replaced';
  crane.getCell('E18').value = '9,400h';
  crane.getCell('F18').value = 'x';
  crane.getCell('H18').value = 'HF-22';
  crane.getCell('I18').value = '9,800h';
  crane.getCell('J18').value = 25;
  crane.getCell('A19').value = new Date('2025-10-07T00:00:00.000Z');
  crane.getCell('B19').value = 'Engine oil changed';
  crane.getCell('A20').value = new Date('2025-10-20T00:00:00.000Z');
  crane.getCell('B20').value = 'Fuel filter changed';
  crane.getCell('J20').value = 98;
  crane.getCell('A21').value = 'X';
  crane.getCell('B21').value = 'Belt replaced';

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function withThreadedComments(data: Uint8Array, sheetFile: string, comments: string[]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(data);
  const relsPath = `xl/worksheets/_rels/${sheetFile}.rels`;
  const rels = await zip.file(relsPath)?.async('string') ??
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  zip.file(relsPath, rels.replace(
    '</Relationships>',
    '<Relationship Id="rIdThreads" Type="http://schemas.microsoft.com/office/2017/10/relationships/threadedComment" Target="../threadedComments/threadedComment1.xml"/></Relationships>'
  ));
  zip.file(
    'xl/threadedComments/threadedComment1.xml',
    `<ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments">${comments.join('')}</ThreadedComments>`
  );
  zip.file(
    'xl/persons/person.xml',
    '<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><person displayName="luka bliadze" id="{P1}" userId="u1" providerId="None"/></personList>'
  );
  return zip.generateAsync({ type: 'uint8array' });
}

describe('workbook import commit', () => {
  it('maps machines and history while skipping template rows and undated entries', async () => {
    const preview = await analyzeWorkbook('fleet.xlsx', await createWorkbook());
    const plan = await planWorkbookImport(preview, []);

    expect(plan.machines).toHaveLength(1);
    expect(plan.machines[0].input).toMatchObject({
      displayName: 'Crane 7',
      manufacturer: 'Liebherr',
      model: 'LTM 1055',
      yearManufactured: 2018,
      category: 'Cranes',
      registrationNumber: 'CN055CN',
      serialNumber: undefined,
      status: 'active',
      fuelType: 'Diesel',
      meterUnit: 'hours',
      meterValue: 9427
    });
    expect(plan.machines[0].input.sourceAttributes).toMatchObject({
      'workbook.sheet': 'Crane 7',
      'workbook.profile.VIN': '#'
    });

    expect(plan.skippedRows).toEqual([
      { sheetName: 'Crane 7', rowNumber: 17, reason: 'template-sample' },
      {
        sheetName: 'Crane 7',
        rowNumber: 21,
        reason: 'date-unresolved',
        details: 'X',
        description: 'Belt replaced',
        issueId: expect.stringContaining('history-date-needs-review')
      }
    ]);
    expect(plan.records.map(({ rowNumber, input, dateInterpretation }) => ({
      rowNumber,
      performedAt: input.performedAt,
      dateInterpretation
    }))).toEqual([
      { rowNumber: 18, performedAt: '2025-10-29', dateInterpretation: 'text-day-first' },
      { rowNumber: 19, performedAt: '2025-07-10', dateInterpretation: 'date-cell-day-first' },
      { rowNumber: 20, performedAt: '2025-10-20', dateInterpretation: 'date-cell' }
    ]);
    expect(plan.records[0].input).toMatchObject({
      workPerformed: 'Hydraulic filter replaced',
      meterReading: 9400,
      partsUsed: 'HF-22',
      notes: 'Next Service Due: 9,800h',
      category: 'other'
    });
    expect(plan.records[1].input.sourceAttributes).toMatchObject({
      'workbook.row': '19',
      'workbook.date': '2025-10-07'
    });
    expect(plan.records[2].input.notes).toBe('Material Cost: 98');
    await expect(db.machines.count()).resolves.toBe(0);
  });

  it('imports a missing date only after a reviewer enters it', async () => {
    const preview = await analyzeWorkbook('fleet.xlsx', await createWorkbook());
    const issue = preview.issues.find(
      (candidate) => candidate.code === 'history-date-needs-review' && candidate.rowNumber === 21
    );
    const decision: WorkbookIssueDecision = {
      id: `${preview.sourceHash}:${issue?.id}`,
      workbookHash: preview.sourceHash,
      issueId: issue?.id ?? '',
      action: 'interpreted-date',
      interpretedValue: '2025-06-24',
      updatedAt: new Date().toISOString()
    };

    const plan = await planWorkbookImport(preview, [decision]);

    expect(plan.records.find((record) => record.rowNumber === 21)).toMatchObject({
      dateInterpretation: 'review-decision',
      input: { performedAt: '2025-06-24', workPerformed: 'Belt replaced' }
    });
  });

  it('commits atomically and leaves existing machines and imported rows unchanged on repeat', async () => {
    const existing = await saveMachine({
      displayName: 'Liebherr crane',
      registrationNumber: 'cn055cn',
      status: 'active',
      meterUnit: 'unknown',
      sourceAttributes: {}
    });
    const preview = await analyzeWorkbook('fleet.xlsx', await createWorkbook());
    const plan = await planWorkbookImport(preview, []);

    await expect(commitWorkbookImport(plan)).resolves.toEqual({
      machinesCreated: 0,
      machinesUpdated: 0,
      machinesExisting: 1,
      recordsCreated: 3,
      recordsExisting: 0
    });
    await expect(commitWorkbookImport(plan)).resolves.toEqual({
      machinesCreated: 0,
      machinesUpdated: 0,
      machinesExisting: 1,
      recordsCreated: 0,
      recordsExisting: 3
    });

    expect(await db.machines.get(existing.id)).toEqual(existing);
    const records = await db.maintenanceRecords.toArray();
    expect(records).toHaveLength(3);
    expect(records.every((record) => record.machineId === existing.id)).toBe(true);
    await expect(db.outbox.where('entityType').equals('maintenance').count()).resolves.toBe(3);
  });

  it('imports workbook comments as part details and adds them to an existing machine once', async () => {
    const data = await withThreadedComments(await createWorkbook(), 'sheet3.xml', [
      '<threadedComment ref="A9" dT="2026-06-19T10:20:02.43" personId="{P1}" id="{C1}"><text>Hengst E422H &amp; 01KHE21</text></threadedComment>',
      '<threadedComment ref="A9" dT="2026-06-19T10:21:00.00" personId="{P1}" id="{C2}" parentId="{C1}"><text>Oil changed</text></threadedComment>',
      '<threadedComment ref="A10" dT="2026-06-19T10:22:00.00" personId="{P1}" id="{C3}"><text>12V / 180Ah&#13;&#10;(2 ცალი)</text></threadedComment>',
      '<threadedComment ref="A11" dT="2026-06-19T10:23:00.00" personId="{P1}" id="{C4}"><text></text></threadedComment>'
    ]);
    const preview = await analyzeWorkbook('fleet.xlsx', data);

    expect(preview.comments).toHaveLength(4);
    expect(preview.comments[1]).toMatchObject({
      sheetName: 'Crane 7',
      cellAddress: 'A9',
      author: 'luka bliadze',
      isReply: true
    });

    const plan = await planWorkbookImport(preview, []);
    expect(plan.machines[0].input.parts).toEqual([
      {
        component: 'Oil & Filter Change',
        specification: 'Hengst E422H & 01KHE21',
        sourceCell: 'A9',
        author: 'luka bliadze',
        commentedAt: '2026-06-19T10:20:02.43'
      },
      {
        component: 'Battery Replacement',
        specification: '12V / 180Ah\n(2 ცალი)',
        sourceCell: 'A10',
        author: 'luka bliadze',
        commentedAt: '2026-06-19T10:22:00.00'
      }
    ]);

    const existing = await saveMachine({
      displayName: 'Liebherr crane',
      registrationNumber: 'CN055CN',
      status: 'active',
      meterUnit: 'unknown',
      sourceAttributes: {}
    });
    await expect(commitWorkbookImport(plan)).resolves.toMatchObject({ machinesCreated: 0, machinesUpdated: 1 });
    expect((await db.machines.get(existing.id))?.parts).toEqual(plan.machines[0].input.parts);
    await expect(commitWorkbookImport(plan)).resolves.toMatchObject({ machinesUpdated: 0, machinesExisting: 1 });
  });
});
