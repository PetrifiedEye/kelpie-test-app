import type { OperationPhase } from '@/features/operation/operation-machine';

export type HomeScreenMode = 'loading' | 'empty' | 'error' | 'confirmation' | 'status';

export function homeScreenMode(input: {
  hydrated: boolean;
  phase: OperationPhase;
  hasOperation: boolean;
  hasError: boolean;
}): HomeScreenMode {
  if (!input.hydrated) return 'loading';
  if (input.hasOperation && input.phase === 'confirmation') return 'confirmation';
  if (input.hasOperation) return 'status';
  if (input.hasError) return 'error';
  return 'empty';
}
