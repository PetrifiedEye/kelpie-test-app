import { createActionGate } from './action-gate';

describe('action gate', () => {
  it('ignores a second submit or delete while the first is still running', async () => {
    const gate = createActionGate();
    let release: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    let runs = 0;

    const first = gate.run(async () => {
      runs += 1;
      await started;
    });
    const second = await gate.run(async () => {
      runs += 1;
    });

    expect(second).toBe(false);
    expect(gate.busy).toBe(true);
    release();
    await expect(first).resolves.toBe(true);
    expect(runs).toBe(1);
    expect(gate.busy).toBe(false);

    await expect(
      gate.run(async () => {
        runs += 1;
      }),
    ).resolves.toBe(true);
    expect(runs).toBe(2);
  });
});
