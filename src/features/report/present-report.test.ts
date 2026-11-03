import { presentReport } from './present-report';

describe('presentReport', () => {
  it('lists both ready charges and their detail fields', () => {
    const presented = presentReport({
      currency: 'AUD',
      items: [
        { id: 'rec-001', merchant: 'StreamBeam', amountMinor: 1999, cadence: 'monthly', lastSeen: '2026-10-01' },
        { id: 'rec-002', merchant: 'BrightGrid', amountMinor: 13200, cadence: 'monthly', lastSeen: '2026-10-03' },
      ],
    });

    expect(presented.totalLabel).toBe('151.99 AUD/мес.');
    expect(presented.charges).toEqual([
      {
        id: 'rec-001',
        merchant: 'StreamBeam',
        amountLabel: '19.99 AUD',
        cadence: 'monthly',
        lastSeen: '2026-10-01',
      },
      {
        id: 'rec-002',
        merchant: 'BrightGrid',
        amountLabel: '132.00 AUD',
        cadence: 'monthly',
        lastSeen: '2026-10-03',
      },
    ]);
  });
});
