import { createOperation, initialOperationState, operationReducer } from './operation-machine';

describe('operationReducer file confirmation', () => {
  it('stores the picked name, counted size, and detected format before submission', () => {
    const operation = createOperation('import-key', 'delete-key', {
      temporaryCopyPath: 'file:///cache/statement-imports/copy.statement',
      fileName: 'statement.csv',
      sizeBytes: 112,
      format: 'csv',
    });

    const state = operationReducer(initialOperationState, { type: 'restored', operation });

    expect(state.phase).toBe('confirmation');
    expect(state.operation).toMatchObject({
      fileName: 'statement.csv',
      sizeBytes: 112,
      format: 'csv',
      status: 'confirmation',
    });
  });

  it('replaces the temporary copy when another file is prepared', () => {
    const operation = createOperation('import-key', 'delete-key', {
      temporaryCopyPath: 'file:///cache/statement-imports/first.statement',
      fileName: 'first.pdf',
      sizeBytes: 20,
      format: 'pdf',
    });
    const restored = operationReducer(initialOperationState, { type: 'restored', operation });
    const next = operationReducer(restored, {
      type: 'filePrepared',
      temporaryCopyPath: 'file:///cache/statement-imports/second.statement',
      fileName: 'second.csv',
      sizeBytes: 40,
      format: 'csv',
    });

    expect(next.operation).toMatchObject({
      importKey: 'import-key',
      temporaryCopyPath: 'file:///cache/statement-imports/second.statement',
      fileName: 'second.csv',
      sizeBytes: 40,
      format: 'csv',
    });
  });
});

const report = {
  currency: 'AUD',
  items: [
    { id: 'rec-001', merchant: 'StreamBeam', amountMinor: 1999, cadence: 'monthly', lastSeen: '2026-10-01' },
  ],
};

function readyState() {
  const operation = createOperation('import-key', 'delete-key', {
    temporaryCopyPath: 'file:///cache/statement-imports/copy.statement',
    fileName: 'statement.csv',
    sizeBytes: 112,
    format: 'csv',
  });
  let state = operationReducer(initialOperationState, { type: 'restored', operation });
  state = operationReducer(state, { type: 'submissionStarted' });
  state = operationReducer(state, {
    type: 'submissionAccepted',
    job: { jobId: 'job-demo-001', status: 'queued', revision: 1, report: null },
  });
  return operationReducer(state, {
    type: 'jobReceived',
    job: { jobId: 'job-demo-001', status: 'ready', revision: 3, report },
  });
}

describe('operationReducer revisions and deletion', () => {
  it('keeps ready revision 3 when an older processing revision arrives', () => {
    const ready = readyState();
    const next = operationReducer(ready, {
      type: 'jobReceived',
      job: { jobId: 'job-demo-001', status: 'processing', revision: 2, report: null },
    });

    expect(next).toBe(ready);
    expect(next.operation).toMatchObject({ status: 'ready', lastAcceptedRevision: 3, report });
  });

  it('ignores a late create acknowledgement after the job has moved on', () => {
    const ready = readyState();
    const next = operationReducer(ready, {
      type: 'submissionAccepted',
      job: { jobId: 'job-demo-001', status: 'queued', revision: 1, report: null },
    });

    expect(next).toBe(ready);
  });

  it('shows deleting after the delete is accepted and deleted only from a later snapshot', () => {
    const started = operationReducer(readyState(), { type: 'deletionStarted' });
    expect(started.phase).toBe('deleting');
    expect(started.operation?.status).toBe('deleting');

    const resurrected = operationReducer(started, {
      type: 'jobReceived',
      job: { jobId: 'job-demo-001', status: 'ready', revision: 99, report },
    });
    expect(resurrected).toBe(started);

    const deleted = operationReducer(started, {
      type: 'jobReceived',
      job: { jobId: 'job-demo-001', status: 'deleted', revision: 5, report: null },
    });
    expect(deleted.phase).toBe('deleted');
    const revived = operationReducer(deleted, {
      type: 'jobReceived',
      job: { jobId: 'job-demo-001', status: 'ready', revision: 100, report },
    });
    expect(revived).toBe(deleted);
  });

  it('keeps the ready report when deletion is rejected', () => {
    const rejected = operationReducer(readyState(), {
      type: 'deleteRejected',
      code: 'unavailable',
      message: 'Deletion was not accepted. The report is still available.',
    });

    expect(rejected.phase).toBe('ready');
    expect(rejected.operation?.report).toEqual(report);
    expect(rejected.operation?.deleteKey).toBe('delete-key');
    expect(rejected.error?.kind).toBe('delete');
  });
});
