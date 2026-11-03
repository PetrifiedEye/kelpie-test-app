import type { OperationErrorCode, OperationPhase } from '@/features/operation/operation-machine';

import type { HomeScreenMode } from './home-screen-mode';

export const PRIMARY_ACTIONS = [
  'choose',
  'submit',
  'cancel-local-copy',
  'retry',
  'delete-import',
  'choose-another',
] as const;

export type PrimaryAction = (typeof PRIMARY_ACTIONS)[number];

function needsNewFile(code: OperationErrorCode | undefined): boolean {
  return code === 'conflict' || code === 'too_large' || code === 'unsupported' || code === 'missing_file';
}

/** Buttons for the current screen. Subscription cancellation is not an action. */
export function primaryActions(input: {
  mode: HomeScreenMode;
  phase: OperationPhase;
  hasError: boolean;
  errorCode?: OperationErrorCode;
}): PrimaryAction[] {
  if (input.mode === 'loading') return [];
  if (input.mode === 'empty' || input.mode === 'error') return ['choose'];
  if (input.mode === 'confirmation') return ['submit', 'cancel-local-copy'];

  const actions: PrimaryAction[] = [];
  if (input.phase === 'ready') actions.push('delete-import');
  const canRetry =
    input.phase === 'submissionUnknown' ||
    (input.hasError && input.phase !== 'ready' && !needsNewFile(input.errorCode));
  if (canRetry) actions.push('retry');
  if (input.phase === 'deleted' || (input.hasError && needsNewFile(input.errorCode))) {
    actions.push('choose-another');
  }
  return actions;
}
