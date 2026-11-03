export const OPERATION_STATUSES = [
  'selection',
  'confirmation',
  'submitting',
  'queued',
  'processing',
  'ready',
  'deleting',
  'deleted',
] as const;

export type OperationStatus = (typeof OPERATION_STATUSES)[number];
export type OperationPhase = OperationStatus | 'submissionUnknown' | 'error';
export type OperationErrorKind = 'read' | 'submit' | 'poll' | 'delete' | 'storage';
export type OperationErrorCode =
  | 'network'
  | 'conflict'
  | 'too_large'
  | 'unsupported'
  | 'not_found'
  | 'unavailable'
  | 'invalid'
  | 'missing_file';
export type StatementFormat = 'pdf' | 'csv';

export type ImportCharge = {
  id: string;
  merchant: string;
  amountMinor: number;
  cadence: string;
  lastSeen: string;
};

export type ImportReport = {
  currency: string;
  items: ImportCharge[];
};

export type StatementFileDetails = {
  temporaryCopyPath: string;
  fileName: string;
  sizeBytes: number;
  format: StatementFormat;
};

export type PersistedOperation = {
  version: 1;
  importKey: string;
  deleteKey: string;
  jobId: string | null;
  lastAcceptedRevision: number;
  status: OperationStatus;
  temporaryCopyPath: string;
  fileName: string;
  sizeBytes: number;
  format: StatementFormat;
  report: ImportReport | null;
};

export type OperationState = {
  phase: OperationPhase;
  operation: PersistedOperation | null;
  error: { kind: OperationErrorKind; message: string; code?: OperationErrorCode } | null;
};

export type JobSnapshot = {
  jobId: string;
  status: 'queued' | 'processing' | 'ready' | 'deleting' | 'deleted';
  revision: number;
  report: ImportReport | null;
};

export type OperationAction =
  | { type: 'restored'; operation: PersistedOperation | null }
  | { type: 'filePrepared'; temporaryCopyPath: string; fileName: string; sizeBytes: number; format: StatementFormat }
  | { type: 'confirmed' }
  | { type: 'submissionStarted' }
  | { type: 'submissionAccepted'; job: JobSnapshot }
  | { type: 'submissionOutcomeUnknown' }
  | { type: 'jobReceived'; job: JobSnapshot }
  | { type: 'deletionStarted' }
  | { type: 'deleteRejected'; message: string; code: 'unavailable' | 'network' }
  | { type: 'failed'; kind: OperationErrorKind; message: string; code?: OperationErrorCode }
  | { type: 'retry' }
  | { type: 'reset' };

export const initialOperationState: OperationState = {
  phase: 'selection',
  operation: null,
  error: null,
};

export function createOperation(
  importKey: string,
  deleteKey: string,
  file: StatementFileDetails,
): PersistedOperation {
  return {
    version: 1,
    importKey,
    deleteKey,
    jobId: null,
    lastAcceptedRevision: 0,
    status: 'confirmation',
    temporaryCopyPath: file.temporaryCopyPath,
    fileName: file.fileName,
    sizeBytes: file.sizeBytes,
    format: file.format,
    report: null,
  };
}

function canAcceptJob(state: OperationState, job: JobSnapshot): boolean {
  const operation = state.operation;
  if (!operation) return false;
  // A deleted job is a tombstone: a later ready snapshot must not resurrect it.
  if (operation.status === 'deleted' || state.phase === 'deleted') return false;
  if (operation.jobId && operation.jobId !== job.jobId) return false;
  if (operation.status === 'deleting' && job.status !== 'deleting' && job.status !== 'deleted') return false;
  return job.revision > operation.lastAcceptedRevision;
}

function applyJob(state: OperationState, job: JobSnapshot): OperationState {
  return updateOperation({ ...state, phase: job.status, error: null }, (operation) => ({
    ...operation,
    jobId: job.jobId,
    lastAcceptedRevision: job.revision,
    status: job.status,
    report: job.report ?? operation.report,
  }));
}

function updateOperation(
  state: OperationState,
  update: (operation: PersistedOperation) => PersistedOperation,
): OperationState {
  if (!state.operation) return state;
  return { ...state, operation: update(state.operation) };
}

export function operationReducer(
  state: OperationState,
  action: OperationAction,
): OperationState {
  switch (action.type) {
    case 'restored':
      return {
        phase: action.operation?.status ?? 'selection',
        operation: action.operation,
        error: null,
      };
    case 'filePrepared':
      return updateOperation(
        { ...state, phase: 'confirmation', error: null },
        (operation) => ({
          ...operation,
          temporaryCopyPath: action.temporaryCopyPath,
          fileName: action.fileName,
          sizeBytes: action.sizeBytes,
          format: action.format,
        }),
      );
    case 'confirmed':
      return state.phase === 'confirmation' ? { ...state, phase: 'submitting' } : state;
    case 'submissionStarted': {
      if (!state.operation) return state;
      const canStart =
        state.phase === 'confirmation' ||
        state.phase === 'submissionUnknown' ||
        (state.phase === 'error' && state.operation.jobId === null);
      if (!canStart) return state;
      return updateOperation({ ...state, phase: 'submitting', error: null }, (operation) => ({
        ...operation,
        status: 'submitting',
      }));
    }
    case 'submissionAccepted': {
      if (state.phase !== 'submitting' || !canAcceptJob(state, action.job)) return state;
      return applyJob(state, action.job);
    }
    case 'submissionOutcomeUnknown':
      return state.phase === 'submitting'
        ? { ...state, phase: 'submissionUnknown', error: null }
        : state;
    case 'jobReceived':
      if (state.phase === 'selection' || state.phase === 'confirmation') return state;
      return canAcceptJob(state, action.job) ? applyJob(state, action.job) : state;
    case 'deletionStarted':
      return state.phase === 'ready'
        ? updateOperation({ ...state, phase: 'deleting', error: null }, (operation) => ({
            ...operation,
            status: 'deleting',
          }))
        : state;
    case 'deleteRejected':
      if (state.operation?.status !== 'ready' || state.phase === 'deleting' || state.phase === 'deleted') {
        return state;
      }
      return {
        ...state,
        phase: 'ready',
        error: { kind: 'delete', message: action.message, code: action.code },
      };
    case 'failed':
      return {
        ...state,
        phase: 'error',
        error: { kind: action.kind, message: action.message, code: action.code },
      };
    case 'retry':
      return { ...state, phase: state.operation?.status ?? 'selection', error: null };
    case 'reset':
      return initialOperationState;
  }
}
