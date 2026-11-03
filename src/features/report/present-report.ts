import type { ImportReport } from '@/features/operation/operation-machine';

import { formatMinorAmount, formatMonthlyTotal } from './money';

export type PresentedCharge = {
  id: string;
  merchant: string;
  amountLabel: string;
  cadence: string;
  lastSeen: string;
};

export type PresentedReport = {
  totalLabel: string;
  charges: PresentedCharge[];
};

export function presentReport(report: ImportReport): PresentedReport {
  return {
    totalLabel: formatMonthlyTotal(report.items, report.currency),
    charges: report.items.map((charge) => ({
      id: charge.id,
      merchant: charge.merchant,
      amountLabel: formatMinorAmount(charge.amountMinor, report.currency),
      cadence: charge.cadence,
      lastSeen: charge.lastSeen,
    })),
  };
}
