import type { OperationPhase } from '@/features/operation/operation-machine';

/** The two charges stay visible while the import is ready, deleting, or failed to refresh. */
export function chargesVisible(phase: OperationPhase, hasReport: boolean): boolean {
  if (!hasReport) return false;
  return phase === 'ready' || phase === 'deleting' || phase === 'error';
}
