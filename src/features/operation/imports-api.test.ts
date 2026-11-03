import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { createFetchTransport, createImportApi, fileNameHeader, ImportRequestError } from './imports-api';

const require = createRequire(__filename);
const { startKitMock } = require('../../../test-support/kit-mock.cjs') as {
  startKitMock: (kitDirectory: string) => Promise<{ baseUrl: string; directory: string; stop: () => Promise<void> }>;
};

const kitDirectory = join(__dirname, '../../../../mobile-engineer-kit');
const statementPdf = new Uint8Array(readFileSync(join(kitDirectory, 'fixtures/statement.pdf')));
const otherCsv = new TextEncoder().encode('date,description,amount\n2026-01-01,Other,-1.00\n');

jest.setTimeout(20000);

type MockStats = {
  stats: { createRequests: number; newJobs: number; duplicateHits: number; deleteRequests: number };
  jobs: { jobId: string; sha256: string; bytes: number; status: string; revision: number }[];
};

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe('import HTTP contract', () => {
  let baseUrl: string;
  let directory: string;
  let stop: () => Promise<void>;
  const api = () => createImportApi(baseUrl, createFetchTransport());

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

  it('posts the original file bytes and treats 202 as a queued job', async () => {
    const created = await api().createImport({
      importKey: 'import-key-raw-bytes',
      fileName: 'statement.pdf',
      source: { kind: 'bytes', bytes: statementPdf },
    });

    expect(created).toMatchObject({ status: 'queued', revision: 1, report: null });
    expect(created.jobId).toMatch(/^job-demo-/);
    const observed = (await (await fetch(`${baseUrl}/__test/state`)).json()) as MockStats;
    expect(observed.stats.newJobs).toBe(1);
    expect(observed.jobs[0]).toMatchObject({
      bytes: statementPdf.byteLength,
      sha256: createHash('sha256').update(statementPdf).digest('hex'),
    });
  });

  it('sends octet-stream bytes without a JSON or base64 wrapper', async () => {
    let capture: (value: { contentType?: string; body: Buffer; fileName?: string; key?: string }) => void = () => undefined;
    const seen = new Promise<{ contentType?: string; body: Buffer; fileName?: string; key?: string }>((resolve) => {
      capture = resolve;
    });
    const probe = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      response.writeHead(202, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ jobId: 'job-demo-001', status: 'queued', revision: 1 }));
      capture({
        contentType: request.headers['content-type'],
        body: Buffer.concat(chunks),
        fileName: typeof request.headers['x-file-name'] === 'string' ? request.headers['x-file-name'] : undefined,
        key: typeof request.headers['idempotency-key'] === 'string' ? request.headers['idempotency-key'] : undefined,
      });
    });
    const probeUrl = await listen(probe);
    try {
      const created = await createImportApi(probeUrl, createFetchTransport()).createImport({
        importKey: 'import-key-probe',
        fileName: 'Выписка.csv',
        source: { kind: 'bytes', bytes: otherCsv },
      });
      const recorded = await seen;
      expect(created.status).toBe('queued');
      expect(recorded.contentType).toBe('application/octet-stream');
      expect(recorded.key).toBe('import-key-probe');
      expect(recorded.fileName).toBe(encodeURIComponent('Выписка.csv'));
      expect(Buffer.compare(recorded.body, Buffer.from(otherCsv))).toBe(0);
      expect(recorded.body.toString('utf8').startsWith('{')).toBe(false);
    } finally {
      await new Promise<void>((resolve) => probe.close(() => resolve()));
    }
  });

  it('repeats the same key and bytes as the same job, and keeps the key on 409 and 415', async () => {
    const client = api();
    const first = await client.createImport({
      importKey: 'import-key-same',
      fileName: 'statement.pdf',
      source: { kind: 'bytes', bytes: statementPdf },
    });
    const duplicate = await client.createImport({
      importKey: 'import-key-same',
      fileName: 'statement.pdf',
      source: { kind: 'bytes', bytes: statementPdf },
    });
    expect(duplicate.jobId).toBe(first.jobId);

    await expect(
      client.createImport({
        importKey: 'import-key-same',
        fileName: 'other.csv',
        source: { kind: 'bytes', bytes: otherCsv },
      }),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });
    await expect(
      client.createImport({
        importKey: 'import-key-same',
        fileName: 'notes.txt',
        source: { kind: 'bytes', bytes: new TextEncoder().encode('not a statement') },
      }),
    ).rejects.toMatchObject({ code: 'unsupported', status: 415 });

    const observed = (await (await fetch(`${baseUrl}/__test/state`)).json()) as MockStats;
    expect(observed.stats).toMatchObject({ newJobs: 1, duplicateHits: 1, createRequests: 4 });
  });

  it('maps 413 without requiring a new idempotency key', async () => {
    const probe = createServer((_request, response) => {
      response.writeHead(413, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'payload too large' }));
    });
    const probeUrl = await listen(probe);
    try {
      await expect(
        createImportApi(probeUrl, createFetchTransport()).createImport({
          importKey: 'import-key-too-large',
          fileName: 'oversize.csv',
          source: { kind: 'bytes', bytes: otherCsv },
        }),
      ).rejects.toBeInstanceOf(ImportRequestError);
      await expect(
        createImportApi(probeUrl, createFetchTransport()).createImport({
          importKey: 'import-key-too-large',
          fileName: 'oversize.csv',
          source: { kind: 'bytes', bytes: otherCsv },
        }),
      ).rejects.toMatchObject({ code: 'too_large', status: 413 });
    } finally {
      await new Promise<void>((resolve) => probe.close(() => resolve()));
    }
  });

  it('keeps file names header-safe', () => {
    expect(fileNameHeader('statement.csv')).toBe('statement.csv');
    expect(fileNameHeader('Выписка.csv')).toMatch(/^[%A-Za-z0-9._~-]+$/);
  });
});
