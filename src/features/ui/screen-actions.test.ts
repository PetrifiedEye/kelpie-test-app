import type { OperationPhase } from '@/features/operation/operation-machine';

import type { HomeScreenMode } from './home-screen-mode';
import { primaryActions, type PrimaryAction } from './screen-actions';

const phases: OperationPhase[] = [
  'selection',
  'confirmation',
  'submitting',
  'submissionUnknown',
  'queued',
  'processing',
  'ready',
  'deleting',
  'deleted',
  'error',
];

describe('primary actions', () => {
  it('offers recovery for loading, empty, and error without an operation', () => {
    expect(actions('loading', 'selection', false)).toEqual([]);
    expect(actions('empty', 'selection', false)).toEqual(['choose']);
    expect(actions('error', 'error', true, 'network')).toEqual(['choose']);
  });

  it('confirms a local copy before submit and can drop that copy', () => {
    expect(actions('confirmation', 'confirmation', false)).toEqual(['submit', 'cancel-local-copy']);
  });

  it('deletes only a ready import and retries an uncertain upload', () => {
    expect(actions('status', 'ready', false)).toEqual(['delete-import']);
    expect(actions('status', 'deleting', false)).toEqual([]);
    expect(actions('status', 'submissionUnknown', false)).toEqual(['retry']);
    expect(actions('status', 'deleted', false)).toEqual(['choose-another']);
  });

  it('keeps the ready report actionable after a rejected delete', () => {
    expect(actions('status', 'ready', true, 'unavailable')).toEqual(['delete-import']);
    expect(actions('status', 'error', true, 'network')).toEqual(['retry']);
    expect(actions('status', 'error', true, 'missing_file')).toEqual(['choose-another']);
  });

  it('never offers subscription cancellation', () => {
    const offered = new Set<PrimaryAction>();
    for (const phase of phases) {
      for (const mode of ['loading', 'empty', 'error', 'confirmation', 'status'] as HomeScreenMode[]) {
        for (const action of primaryActions({ mode, phase, hasError: true, errorCode: 'unavailable' })) {
          offered.add(action);
        }
        for (const action of primaryActions({ mode, phase, hasError: false })) {
          offered.add(action);
        }
      }
    }

    expect([...offered].join(' ')).not.toMatch(/subscription|unsubscribe|cancel-subscription/);
    expect(offered.has('delete-import')).toBe(true);
  });
});

function actions(
  mode: HomeScreenMode,
  phase: OperationPhase,
  hasError: boolean,
  errorCode?: 'network' | 'unavailable' | 'missing_file',
): PrimaryAction[] {
  return primaryActions({ mode, phase, hasError, errorCode });
}
