import { formatMinorAmount, formatMonthlyTotal, monthlyTotalMinor } from './money';

const statementCharges = [
  { amountMinor: 1999, cadence: 'monthly' },
  { amountMinor: 13200, cadence: 'monthly' },
];

describe('minor-unit amounts', () => {
  it('formats each charge from minor units', () => {
    expect(formatMinorAmount(1999, 'AUD')).toBe('19.99 AUD');
    expect(formatMinorAmount(13200, 'AUD')).toBe('132.00 AUD');
    expect(formatMinorAmount(0, 'AUD')).toBe('0.00 AUD');
    expect(formatMinorAmount(-250, 'AUD')).toBe('-2.50 AUD');
  });

  it('sums the ready statement to 151.99 AUD per month', () => {
    expect(monthlyTotalMinor(statementCharges)).toBe(15199);
    expect(formatMonthlyTotal(statementCharges, 'AUD')).toBe('151.99 AUD/мес.');
  });

  it('leaves non-monthly charges out of the monthly total', () => {
    expect(monthlyTotalMinor([...statementCharges, { amountMinor: 500, cadence: 'yearly' }])).toBe(15199);
  });

  it('rejects fractional minor units', () => {
    expect(() => formatMinorAmount(19.99, 'AUD')).toThrow(/minor units/);
  });
});
