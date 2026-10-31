import { describe, expect, it } from 'vitest';
import { nextService } from './service';
import type { Machine } from '../types';

function machine(overrides: Partial<Machine>): Machine {
  return {
    id: 'machine-1',
    displayName: 'Crane',
    status: 'active',
    meterUnit: 'unknown',
    sourceAttributes: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    localVersion: 1,
    syncStatus: 'pending',
    ...overrides
  };
}

describe('next service target', () => {
  it('reads quoted workbook targets and subtracts the current meter', () => {
    expect(nextService(machine({
      meterUnit: 'hours',
      meterValue: 3900,
      sourceAttributes: { 'workbook.profile.Next Service': '"4377H"' }
    }))).toEqual({ target: 4377, unit: 'hours', remaining: 477 });
  });

  it('falls back to the latest history reading when no current meter is recorded', () => {
    expect(nextService(machine({
      meterUnit: 'kilometers',
      sourceAttributes: { 'workbook.profile.Next Service Due': '140,400km' }
    }), 132400)).toEqual({ target: 140400, unit: 'kilometers', remaining: 8000 });
  });

  it('does not compare targets and meters in different units', () => {
    expect(nextService(machine({
      meterUnit: 'kilometers',
      meterValue: 1200,
      sourceAttributes: { 'workbook.profile.Next Service Due': '6400h' }
    }))).toEqual({ target: 6400, unit: 'hours', remaining: undefined });
  });

  it('ignores machines without a readable target', () => {
    expect(nextService(machine({}))).toBeUndefined();
    expect(nextService(machine({ sourceAttributes: { 'workbook.profile.Next Service Due': 'soon' } })))
      .toBeUndefined();
  });
});
