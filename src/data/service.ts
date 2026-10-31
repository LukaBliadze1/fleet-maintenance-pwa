import type { Machine, MeterUnit } from '../types';

export interface NextService {
  target: number;
  unit: MeterUnit;
  remaining?: number;
}

const targetText = /^\s*["']?\s*(\d[\d,\s]*(?:\.\d+)?)\s*(h|hrs?|hours?|km|კმ)?\s*["']?\s*$/i;

/**
 * Reads the workbook's "Next service" target for a machine. The remaining amount uses the machine's
 * current meter, or the latest meter reading from its history when no current meter is recorded.
 */
export function nextService(machine: Machine, latestReading?: number): NextService | undefined {
  const source = machine.sourceAttributes['workbook.profile.Next Service Due'] ??
    machine.sourceAttributes['workbook.profile.Next Service'];
  const match = source?.match(targetText);
  if (!match) return undefined;

  const target = Number(match[1].replace(/[,\s]/g, ''));
  if (!Number.isFinite(target) || target <= 0) return undefined;

  const suffix = match[2]?.toLocaleLowerCase();
  const unit: MeterUnit = suffix === undefined
    ? machine.meterUnit
    : suffix.startsWith('h') ? 'hours' : 'kilometers';
  const current = machine.meterValue ?? latestReading;
  const comparable = machine.meterUnit === 'unknown' || machine.meterUnit === unit;
  return {
    target,
    unit,
    remaining: current === undefined || !comparable ? undefined : target - current
  };
}
