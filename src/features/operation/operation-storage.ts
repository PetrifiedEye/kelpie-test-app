import AsyncStorage from '@react-native-async-storage/async-storage';

import { OPERATION_STATUSES, type ImportReport, type PersistedOperation } from './operation-machine';

const STORAGE_KEY = 'kelpie.operation.v1';

function isCharge(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const charge = value as Partial<ImportReport['items'][number]>;
  return (
    typeof charge.id === 'string' &&
    typeof charge.merchant === 'string' &&
    typeof charge.amountMinor === 'number' &&
    typeof charge.cadence === 'string' &&
    typeof charge.lastSeen === 'string'
  );
}

function isReport(value: unknown): value is ImportReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<ImportReport>;
  return typeof report.currency === 'string' && Array.isArray(report.items) && report.items.every(isCharge);
}

function isPersistedOperation(value: unknown): value is PersistedOperation {
  if (!value || typeof value !== 'object') return false;
  const operation = value as Partial<PersistedOperation>;
  const report = operation.report;
  return (
    operation.version === 1 &&
    typeof operation.importKey === 'string' &&
    typeof operation.deleteKey === 'string' &&
    (typeof operation.jobId === 'string' || operation.jobId === null) &&
    typeof operation.lastAcceptedRevision === 'number' &&
    typeof operation.temporaryCopyPath === 'string' &&
    typeof operation.fileName === 'string' &&
    typeof operation.sizeBytes === 'number' &&
    (operation.format === 'pdf' || operation.format === 'csv') &&
    OPERATION_STATUSES.includes(operation.status as PersistedOperation['status']) &&
    (report === undefined || report === null || isReport(report))
  );
}

export async function loadOperation(): Promise<PersistedOperation | null> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  const value: unknown = JSON.parse(stored);
  if (!isPersistedOperation(value)) throw new Error('Saved operation has an invalid format.');
  return { ...value, report: value.report ?? null };
}

export async function saveOperation(operation: PersistedOperation): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(operation));
}

export async function clearOperation(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
