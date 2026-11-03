export type MoneyCharge = {
  amountMinor: number;
  cadence: string;
};

const MINOR_PER_MAJOR = 100;

/** Formats an integer amount in minor units, for example 1999 AUD as "19.99 AUD". */
export function formatMinorAmount(amountMinor: number, currency: string): string {
  if (!Number.isInteger(amountMinor)) {
    throw new Error('Amount must be an integer number of minor units.');
  }
  const negative = amountMinor < 0;
  const absolute = Math.abs(amountMinor);
  const major = Math.trunc(absolute / MINOR_PER_MAJOR);
  const minor = String(absolute % MINOR_PER_MAJOR).padStart(2, '0');
  return `${negative ? '-' : ''}${major}.${minor} ${currency}`;
}

export function monthlyTotalMinor(charges: readonly MoneyCharge[]): number {
  return charges.reduce((total, charge) => {
    return charge.cadence === 'monthly' ? total + charge.amountMinor : total;
  }, 0);
}

/** Monthly charges only. The suffix is the acceptance label for this statement. */
export function formatMonthlyTotal(charges: readonly MoneyCharge[], currency: string): string {
  return `${formatMinorAmount(monthlyTotalMinor(charges), currency)}/мес.`;
}
