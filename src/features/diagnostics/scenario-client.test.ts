import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { parseScenarioStatus, readScenarioStatus, resetMockState, setScenario } from './scenario-client';

const require = createRequire(__filename);
const { startKitMock } = require('../../../test-support/kit-mock.cjs') as {
  startKitMock: (kitDirectory: string) => Promise<{ baseUrl: string; directory: string; stop: () => Promise<void> }>;
};

const kitDirectory = join(__dirname, '../../../../mobile-engineer-kit');

jest.setTimeout(20000);

describe('scenario diagnostics', () => {
  it('reads only the scenario and counters from a payload that also contains jobs', () => {
    const status = parseScenarioStatus({
      mode: 'lost_ack',
      stats: { createRequests: 2, newJobs: 1, duplicateHits: 1, deleteRequests: 0, acceptedBytes: 999 },
      jobs: [{ sha256: 'abc', bytes: 12, fileName: 'statement.pdf', merchant: 'StreamBeam' }],
    });

    expect(status).toEqual({
      mode: 'lost_ack',
      createRequests: 2,
      newJobs: 1,
      duplicateHits: 1,
      deleteRequests: 0,
    });
    expect(JSON.stringify(status)).not.toMatch(/statement|StreamBeam|sha256|abc/);
  });

  describe('against the kit mock', () => {
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

    it('switches scenario without changing application source', async () => {
      expect((await readScenarioStatus(baseUrl)).mode).toBe('happy');
      expect(await setScenario(baseUrl, 'stale_status')).toBe('stale_status');
      expect((await readScenarioStatus(baseUrl)).mode).toBe('stale_status');
      expect(await setScenario(baseUrl, 'delete_failure')).toBe('delete_failure');
      expect(await setScenario(baseUrl, 'happy')).toBe('happy');
    });

    it('resets mock counters without reading job contents', async () => {
      await resetMockState(baseUrl);
      expect(await readScenarioStatus(baseUrl)).toMatchObject({
        mode: 'happy',
        createRequests: 0,
        newJobs: 0,
        duplicateHits: 0,
        deleteRequests: 0,
      });
    });
  });
});
