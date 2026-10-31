import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { db } from './localDb';
import { analyzeWorkbook, WorkbookImportError } from './workbookImport';

async function createWorkbook(): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const equipment = workbook.addWorksheet('Excavator A');
  equipment.getCell('A4').value = 'Year';
  equipment.getCell('B4').value = 2018;
  equipment.getCell('A5').value = 'Brand';
  equipment.getCell('B5').value = 'JCB';
  equipment.getCell('A6').value = 'Model';
  equipment.getCell('B6').value = '540-140';
  equipment.getCell('A7').value = 'Plate / Reg #';
  equipment.getCell('B7').value = 'ASSET-01';
  equipment.getCell('D7').value = 'VIN';
  equipment.getCell('E7').value = 'SERIAL-01';
  equipment.getCell('A9').value = 'Preventative Maintenance Schedule';
  equipment.getCell('A10').value = 'Mileage';
  equipment.getCell('B10').value = 'Recommended Maintenance';
  equipment.getCell('A11').value = '500h';
  equipment.getCell('B11').value = 'Replace oil filter';
  equipment.getCell('A15').value = 'Vehicle Maintenance Log';
  equipment.getCell('A16').value = 'Date';
  equipment.getCell('B16').value = 'Description';
  equipment.getCell('E16').value = 'Odometer';
  equipment.getCell('H16').value = 'Part No.';
  equipment.getCell('A17').value = new Date('2025-03-20T00:00:00.000Z');
  equipment.getCell('B17').value = 'Oil filter replaced';
  equipment.getCell('E17').value = 6019;
  equipment.getCell('H17').value = 'FILTER-1';
  equipment.getCell('B17').note = 'Original source note';
  equipment.getCell('M17').value = { formula: 'J17+K17', result: { error: '#VALUE!' } };
  equipment.getCell('A18').value = 'X';
  equipment.getCell('B18').value = 'Oil filter replaced';

  const duplicate = workbook.addWorksheet('Excavator B');
  duplicate.getCell('A7').value = 'Plate / Reg #';
  duplicate.getCell('B7').value = 'ASSET-01';
  duplicate.getCell('A15').value = 'Vehicle Maintenance Log';
  duplicate.getCell('A16').value = 'Date';
  duplicate.getCell('B16').value = 'Description';

  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  zip.file(
    'xl/threadedComments/threadedComment1.xml',
    '<ThreadedComments><threadedComment ref="B17"><text>Threaded source note</text></threadedComment></ThreadedComments>'
  );
  return zip.generateAsync({ type: 'uint8array' });
}

describe('Excel workbook dry run', () => {
  it('preserves worksheet provenance and reports unresolved rows without importing data', async () => {
    const preview = await analyzeWorkbook('fleet.xlsx', await createWorkbook());

    expect(preview.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.issues.every((issue) => Boolean(issue.id))).toBe(true);
    expect(preview.sheets.map((sheet) => sheet.name)).toEqual(['Excavator A', 'Excavator B']);
    expect(preview.machines).toHaveLength(2);
    expect(preview.machines[0]).toMatchObject({
      sheetName: 'Excavator A',
      registrationNumber: 'ASSET-01',
      serialNumber: 'SERIAL-01',
      historyRowCount: 2
    });
    expect(preview.maintenanceRows[0]).toMatchObject({
      sheetName: 'Excavator A',
      rowNumber: 17
    });
    expect(preview.maintenanceRows[0].cells.find(({ header }) => header === 'Part No.')?.source.displayText)
      .toBe('FILTER-1');
    expect(preview.schedules).toHaveLength(1);
    expect(preview.commentCount).toBe(1);
    expect(preview.threadedCommentCount).toBe(1);
    expect(preview.threadedCommentParts[0].xml).toContain('Threaded source note');
    expect(preview.formulaErrorCount).toBe(1);
    expect(
      preview.maintenanceRows[0].cells.find(({ source }) => source.address === 'M17')?.source.formulaPresent
    ).toBe(true);
    expect(preview.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'duplicate-machine-identifier' }),
      expect.objectContaining({ code: 'history-date-needs-review', rowNumber: 18 }),
      expect.objectContaining({ code: 'formula-error', cellAddress: 'M17' })
    ]));
    await expect(db.machines.count()).resolves.toBe(0);
    await expect(db.outbox.count()).resolves.toBe(0);
  });

  it('rejects invalid workbook data with an explicit error', async () => {
    await expect(analyzeWorkbook('bad.xlsx', new TextEncoder().encode('not a workbook')))
      .rejects.toMatchObject({ name: 'WorkbookImportError', code: 'invalid-workbook' });
  });

  it('rejects workbooks over the configured size limit before parsing', async () => {
    const oversized = new Uint8Array(20 * 1024 * 1024 + 1);
    await expect(analyzeWorkbook('large.xlsx', oversized)).rejects.toBeInstanceOf(
      WorkbookImportError
    );
  });
});
