import { createRequire } from 'node:module';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ImportSession } from './import-session';
import { createFetchTransport, createImportApi, ImportRequestError, type ImportApi } from './imports-api';
import {
  createOperation,
  initialOperationState,
  type JobSnapshot,
  type PersistedOperation,
} from './operation-machine';

const require = createRequire(__filename);
const { startKitMock } = require('../../../test-support/kit-mock.cjs') as {
  startKitMock: (kitDirectory: string) => Promise<{ baseUrl: string; directory: string; stop: () => Promise<void> }>;
};

const kitDirectory = join(__dirname, '../../../../mobile-engineer-kit');
const statementCsv = new Uint8Array(readFileSync(join(kitDirectory, 'fixtures/statement.csv')));

jest.setTimeout(20000);

type MockStats = {
  stats: { createRequests: number; newJobs: number; duplicateHits: number; deleteRequests: number };
};

function stagedOperation(overrides: Partial<PersistedOperation> = {}): PersistedOperation {
  return {
    ...createOperation('import-key-0123456789', 'delete-key-0123456789', {
      temporaryCopyPath: 'file:///cache/statement-imports/copy.statement',
      fileName: 'statement.csv',
      sizeBytes: statementCsv.byteLength,
      format: 'csv',
    }),
    ...overrides,
  };
}

describe('import session against the kit mock', () => {
  let baseUrl: string;
  let directory: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const started = await startKitMock(kitDirectory);
    baseUrl = started.baseUrl;
    directory = started.directory;
    stop = started.stop;
  });

  afterAll(async () => {
    await stop?.();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const response = await fetch(`${baseUrl}/__test/reset`, { method: 'POST' });
    expect(response.status).toBe(200);
  });

  function openSession(bytes: Uint8Array = statementCsv): ImportSession {
    return new ImportSession(initialOperationState, {
      api: createImportApi(baseUrl, createFetchTransport()),
      pollIntervalMs: 40,
      readSource: async () => ({ kind: 'bytes', bytes }),
    });
  }

  async function stats(): Promise<MockStats> {
    return (await (await fetch(`${baseUrl}/__test/state`)).json()) as MockStats;
  }

  async function scenario(mode: string): Promise<void> {
    const response = await fetch(`${baseUrl}/__test/scenario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    expect(response.status).toBe(200);
  }

  it('recovers a lost acknowledgement as the same job', async () => {
    await scenario('lost_ack');
    const session = openSession();
    await session.apply({ type: 'restored', operation: stagedOperation() });
    await session.submit();

    expect(session.getState().phase).toBe('ready');
    expect(session.getState().operation?.importKey).toBe('import-key-0123456789');
    const observed = await stats();
    expect(observed.stats).toMatchObject({ createRequests: 1, newJobs: 1 });
  });

  it('reloads a saved job on relaunch without sending the file again', async () => {
    const session = openSession();
    await session.apply({ type: 'restored', operation: stagedOperation() });
    await session.submit();
    const saved = session.getState().operation;
    const before = await stats();

    const restarted = openSession();
    await restarted.apply({ type: 'restored', operation: saved });
    await restarted.restoreAfterRelaunch();

    expect(restarted.getState().phase).toBe('ready');
    expect((await stats()).stats.createRequests).toBe(before.stats.createRequests);
  });

  it('does not post again when a restart cannot find a job', async () => {
    const session = openSession();
    await session.apply({
      type: 'restored',
      operation: stagedOperation({ status: 'submitting' }),
    });
    await session.restoreAfterRelaunch();

    expect(session.getState().error?.code).toBe('not_found');
    expect((await stats()).stats.createRequests).toBe(0);
  });

  it('ignores a stale processing snapshot after ready', async () => {
    await scenario('stale_status');
    const session = openSession();
    await session.apply({ type: 'restored', operation: stagedOperation() });
    await session.submit();
    expect(session.getState().operation).toMatchObject({ status: 'ready', lastAcceptedRevision: 3 });

    await session.syncFromServer({ allowRepost: false });

    expect(session.getState().operation).toMatchObject({ status: 'ready', lastAcceptedRevision: 3 });
  });

  it('keeps the report after a failed delete and retries with the same delete key', async () => {
    const session = openSession();
    await session.apply({ type: 'restored', operation: stagedOperation() });
    await session.submit();
    const report = session.getState().operation?.report;
    const deleteKey = session.getState().operation?.deleteKey;
    expect(report?.items).toHaveLength(2);

    await scenario('delete_failure');
    await session.delete();
    expect(session.getState().phase).toBe('ready');
    expect(session.getState().operation?.report).toEqual(report);
    expect(session.getState().operation?.deleteKey).toBe(deleteKey);
    expect(session.getState().error?.message).toMatch(/report is still available/);

    await scenario('happy');
    await session.delete();
    expect(session.getState().phase).toBe('deleted');
    expect(session.getState().operation?.deleteKey).toBe(deleteKey);
    expect((await stats()).stats.deleteRequests).toBe(2);
  });
});

describe('import session recovery rules', () => {
  const queued: JobSnapshot = { jobId: 'job-demo-001', status: 'queued', revision: 1, report: null };
  const ready: JobSnapshot = { jobId: 'job-demo-001', status: 'ready', revision: 3, report: null };

  function scripted(api: ImportApi, bytes: Uint8Array = statementCsv): ImportSession {
    return new ImportSession(initialOperationState, {
      api,
      pollIntervalMs: 0,
      readSource: async () => ({ kind: 'bytes', bytes }),
    });
  }

  it('posts once more with the same key and bytes when lookup races a 404', async () => {
    const keys: string[] = [];
    const bodies: Uint8Array[] = [];
    let posts = 0;
    const session = scripted({
      async createImport({ importKey, source }) {
        keys.push(importKey);
        if (source.kind === 'bytes') bodies.push(source.bytes);
        posts += 1;
        if (posts === 1) throw new ImportRequestError('network', 'The network request did not finish.');
        return queued;
      },
      async getByKey() {
        if (posts < 2) throw new ImportRequestError('not_found', 'No server job was found for this upload.', 404);
        return queued;
      },
      async getJob() {
        return ready;
      },
      async deleteImport() {
        throw new Error('unexpected delete');
      },
    });

    await session.apply({ type: 'restored', operation: stagedOperation() });
    await session.submit();

    expect(posts).toBe(2);
    expect(keys).toEqual(['import-key-0123456789', 'import-key-0123456789']);
    expect(bodies[0]).toBe(bodies[1]);
    expect(session.getState().phase).toBe('ready');
    expect(session.getState().operation?.importKey).toBe('import-key-0123456789');
  });

  it('stops after one repost when the result is still unknown', async () => {
    let posts = 0;
    const session = scripted({
      async createImport() {
        posts += 1;
        throw new ImportRequestError('network', 'The network request did not finish.');
      },
      async getByKey() {
        throw new ImportRequestError('not_found', 'No server job was found for this upload.', 404);
      },
      async getJob() {
        return ready;
      },
      async deleteImport() {
        throw new Error('unexpected delete');
      },
    });
    await session.apply({ type: 'restored', operation: stagedOperation() });
    await session.submit();

    expect(posts).toBe(2);
    expect(session.getState().phase).toBe('submissionUnknown');
    expect(session.getState().operation?.importKey).toBe('import-key-0123456789');
  });

  it('does not replace the key after 409, 413, or 415', async () => {
    for (const code of ['conflict', 'too_large', 'unsupported'] as const) {
      const session = scripted({
        async createImport() {
          throw new ImportRequestError(code, `${code} kept the key`, code === 'conflict' ? 409 : code === 'too_large' ? 413 : 415);
        },
        async getByKey() {
          throw new Error('lookup should not adopt another job');
        },
        async getJob() {
          return ready;
        },
        async deleteImport() {
          throw new Error('unexpected delete');
        },
      });
      await session.apply({ type: 'restored', operation: stagedOperation() });
      await session.submit();
      expect(session.getState().operation?.importKey).toBe('import-key-0123456789');
      expect(session.getState().error?.code).toBe(code);
      await session.retry();
      expect(session.getState().operation?.importKey).toBe('import-key-0123456789');
      expect(session.getState().phase).toBe('error');
    }
  });

  it('saves the submitting operation before the first post', async () => {
    const events: string[] = [];
    const session = new ImportSession(initialOperationState, {
      pollIntervalMs: 0,
      readSource: async () => ({ kind: 'bytes', bytes: statementCsv }),
      onState: (state) => {
        events.push(state.operation?.status ?? 'cleared');
      },
      api: {
        async createImport() {
          events.push('post');
          return queued;
        },
        async getByKey() {
          return queued;
        },
        async getJob() {
          return ready;
        },
        async deleteImport() {
          throw new Error('unexpected delete');
        },
      },
    });
    await session.apply({ type: 'restored', operation: stagedOperation() });
    await session.submit();

    expect(events.indexOf('submitting')).toBeGreaterThan(-1);
    expect(events.indexOf('submitting')).toBeLessThan(events.indexOf('post'));
  });

  it('confirms deletion from a later GET, not from the 202 body', async () => {
    let gets = 0;
    const session = scripted({
      async createImport() {
        return queued;
      },
      async getByKey() {
        return queued;
      },
      async getJob() {
        gets += 1;
        if (gets === 1) return { jobId: 'job-demo-001', status: 'deleting', revision: 4, report: null };
        return { jobId: 'job-demo-001', status: 'deleted', revision: 5, report: null };
      },
      async deleteImport() {
        return { jobId: 'job-demo-001', status: 'deleted', revision: 9, report: null };
      },
    });
    await session.apply({
      type: 'restored',
      operation: stagedOperation({ status: 'ready', jobId: 'job-demo-001', lastAcceptedRevision: 3 }),
    });
    const pending = session.delete();
    await Promise.resolve();
    expect(session.getState().phase).not.toBe('deleted');
    await pending;
    expect(session.getState().operation).toMatchObject({ status: 'deleted', lastAcceptedRevision: 5 });
  });

  it('drops a late status after the operation is stopped', async () => {
    let release: (job: JobSnapshot) => void = () => undefined;
    const session = scripted({
      async createImport() {
        return queued;
      },
      async getByKey() {
        return queued;
      },
      async getJob() {
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      async deleteImport() {
        throw new Error('unexpected delete');
      },
    });
    await session.apply({
      type: 'restored',
      operation: stagedOperation({ status: 'queued', jobId: 'job-demo-001', lastAcceptedRevision: 1 }),
    });
    const pending = session.syncFromServer({ allowRepost: false });
    session.stop();
    release(ready);
    await pending;
    expect(session.getState().operation).toMatchObject({ status: 'queued', lastAcceptedRevision: 1 });
  });
});
