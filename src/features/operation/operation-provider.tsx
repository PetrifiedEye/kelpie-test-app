import * as Crypto from 'expo-crypto';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { MOCK_API_URL } from '@/config/api';
import { safeLog } from '@/features/privacy/safe-log';
import { deleteCachedStatement, createExpoStatementFiles } from '@/features/statement/expo-statement-files';
import { stageStatement } from '@/features/statement/stage-statement';
import { createActionGate } from '@/features/ui/action-gate';

import { createExpoImportTransport } from './expo-import-upload';
import { ImportSession } from './import-session';
import { createImportApi } from './imports-api';
import {
  createOperation,
  initialOperationState,
  type OperationState,
} from './operation-machine';
import { clearOperation, loadOperation, saveOperation } from './operation-storage';

type OperationContextValue = {
  state: OperationState;
  hydrated: boolean;
  busy: boolean;
  chooseStatement: () => Promise<void>;
  cancelStatement: () => Promise<void>;
  submitStatement: () => Promise<void>;
  deleteStatement: () => Promise<void>;
  retryOperation: () => Promise<void>;
  reset: () => Promise<void>;
};

const OperationContext = createContext<OperationContextValue | null>(null);

function releaseCopy(path: string | undefined): void {
  if (!path) return;
  try {
    deleteCachedStatement(path);
  } catch {
    // The cache copy may already be gone.
  }
}

export function OperationProvider({ children }: PropsWithChildren) {
  const mounted = useRef(true);
  const sessionRef = useRef<ImportSession | null>(null);
  const gateRef = useRef(createActionGate());
  const [state, setState] = useState(initialOperationState);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!sessionRef.current) {
    sessionRef.current = new ImportSession(initialOperationState, {
      api: createImportApi(MOCK_API_URL, createExpoImportTransport()),
      readSource: async (operation) => ({ kind: 'file', uri: operation.temporaryCopyPath }),
      onState: async (next, previous) => {
        safeLog('import', {
          phase: next.phase,
          status: next.operation?.status,
          revision: next.operation?.lastAcceptedRevision,
          code: next.error?.code,
          kind: next.error?.kind,
        });
        if (mounted.current) setState(next);
        const path = previous.operation?.temporaryCopyPath;
        const gainedJob = Boolean(next.operation?.jobId) && !previous.operation?.jobId;
        const deleted = next.operation?.status === 'deleted' && previous.operation?.status !== 'deleted';
        const cleared = !next.operation && Boolean(previous.operation);
        if (path && (gainedJob || deleted || cleared)) releaseCopy(path);
        if (next.operation) await saveOperation(next.operation);
        else await clearOperation();
      },
    });
  }
  const session = sessionRef.current;

  useEffect(() => {
    mounted.current = true;
    let active = true;
    loadOperation()
      .then(async (operation) => {
        if (!active) return;
        await session.apply({ type: 'restored', operation });
        if (!active) return;
        await session.restoreAfterRelaunch();
      })
      .catch(async () => {
        if (active) await session.apply({ type: 'restored', operation: null });
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
      mounted.current = false;
      session.stop();
    };
  }, [session]);

  const runExclusive = useCallback(async (work: () => Promise<void>) => {
    await gateRef.current.run(async () => {
      setBusy(true);
      try {
        await work();
      } finally {
        setBusy(false);
      }
    });
  }, []);

  const chooseStatement = useCallback(async () => {
    if (gateRef.current.busy || session.getState().operation) return;
    await runExclusive(async () => {
      let stagedPath: string | null = null;
      try {
        const staged = await stageStatement(createExpoStatementFiles());
        if (!staged) return;
        stagedPath = staged.path;
        const operation = createOperation(Crypto.randomUUID(), Crypto.randomUUID(), {
          temporaryCopyPath: staged.path,
          fileName: staged.fileName,
          sizeBytes: staged.size,
          format: staged.format,
        });
        stagedPath = null;
        await session.apply({ type: 'restored', operation });
      } catch (error) {
        releaseCopy(stagedPath ?? undefined);
        const message = error instanceof Error ? error.message : 'Could not read the selected file.';
        await session.apply({ type: 'failed', kind: 'read', message });
      }
    });
  }, [runExclusive, session]);

  const cancelStatement = useCallback(async () => {
    session.stop();
    releaseCopy(session.getState().operation?.temporaryCopyPath);
    await session.apply({ type: 'reset' });
  }, [session]);

  const reset = useCallback(async () => {
    session.stop();
    releaseCopy(session.getState().operation?.temporaryCopyPath);
    await session.apply({ type: 'reset' });
  }, [session]);

  const submitStatement = useCallback(
    () => runExclusive(() => session.submit()),
    [runExclusive, session],
  );

  const deleteStatement = useCallback(
    () => runExclusive(() => session.delete()),
    [runExclusive, session],
  );

  const retryOperation = useCallback(
    () => runExclusive(() => session.retry()),
    [runExclusive, session],
  );

  return (
    <OperationContext.Provider
      value={{
        state,
        hydrated,
        busy,
        chooseStatement,
        cancelStatement,
        submitStatement,
        deleteStatement,
        retryOperation,
        reset,
      }}
    >
      {children}
    </OperationContext.Provider>
  );
}

export function useOperation() {
  const context = useContext(OperationContext);
  if (!context) throw new Error('useOperation must be used inside OperationProvider.');
  return context;
}
