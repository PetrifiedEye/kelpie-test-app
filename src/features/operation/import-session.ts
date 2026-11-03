import { ImportRequestError, type ByteSource, type ImportApi } from './imports-api';
import {
  operationReducer,
  type OperationAction,
  type OperationErrorCode,
  type OperationState,
  type PersistedOperation,
} from './operation-machine';

const POLL_INTERVAL_MS = 400;

export type ImportSessionOptions = {
  api: ImportApi;
  readSource: (operation: PersistedOperation) => Promise<ByteSource>;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  onState?: (state: OperationState, previous: OperationState) => Promise<void> | void;
};

export class ImportSession {
  private state: OperationState;
  private generation = 0;
  private polling = false;

  constructor(
    initial: OperationState,
    private readonly options: ImportSessionOptions,
  ) {
    this.state = initial;
  }

  getState(): OperationState {
    return this.state;
  }

  stop(): void {
    this.generation += 1;
  }

  async apply(action: OperationAction): Promise<OperationState> {
    const previous = this.state;
    this.state = operationReducer(this.state, action);
    await this.options.onState?.(this.state, previous);
    return this.state;
  }

  /** Sends the staged file. A retry after a lost response looks the job up before posting again. */
  async submit(): Promise<void> {
    const operation = this.state.operation;
    if (!operation) return;
    const { phase } = this.state;
    const canUpload =
      phase === 'confirmation' ||
      phase === 'submissionUnknown' ||
      (phase === 'error' &&
        operation.jobId === null &&
        (operation.status === 'confirmation' || operation.status === 'submitting'));
    if (!canUpload) return;
    if (phase === 'error' && isTerminalSubmitCode(this.state.error?.code)) return;

    if (phase === 'submissionUnknown' || (phase === 'error' && operation.status === 'submitting')) {
      if (phase === 'error') await this.apply({ type: 'retry' });
      await this.recoverCreate(this.generation, 0);
      return;
    }
    await this.resolveCreate(0);
  }

  /**
   * Reloads a saved job. A normal restart never posts the file again, even when the
   * original acknowledgement was lost.
   */
  async restoreAfterRelaunch(): Promise<void> {
    const status = this.state.operation?.status;
    if (!status || status === 'selection' || status === 'confirmation' || status === 'deleted') return;
    await this.syncFromServer({ allowRepost: false });
  }

  async syncFromServer(options: { allowRepost: boolean }): Promise<void> {
    const operation = this.state.operation;
    if (!operation || operation.status === 'deleted') return;
    const token = this.generation;
    try {
      const job = operation.jobId
        ? await this.options.api.getJob(operation.jobId)
        : await this.options.api.getByKey(operation.importKey);
      if (token !== this.generation) return;
      await this.apply({ type: 'jobReceived', job });
      await this.pollIfNeeded(token);
    } catch (error) {
      if (token !== this.generation) return;
      if (error instanceof ImportRequestError && error.code === 'not_found') {
        if (options.allowRepost && operation.jobId === null) {
          await this.resolveCreate(1);
          return;
        }
        await this.apply({
          type: 'failed',
          kind: 'submit',
          code: 'not_found',
          message: operation.jobId
            ? 'The server job is no longer available.'
            : 'No server job was found. The same file can be sent again.',
        });
        return;
      }
      await this.apply({
        type: 'failed',
        kind: 'poll',
        code: 'network',
        message: 'The job status could not be refreshed.',
      });
    }
  }

  async delete(): Promise<void> {
    let operation = this.state.operation;
    if (!operation?.jobId) return;
    if (this.state.phase === 'error' && operation.status === 'ready') {
      await this.apply({ type: 'retry' });
      operation = this.state.operation;
    }
    if (this.state.phase !== 'ready' || !operation?.jobId) return;

    const token = this.generation;
    const jobId = operation.jobId;
    const deleteKey = operation.deleteKey;
    try {
      // The saved delete key is the one persisted with the operation, before this request.
      await this.options.api.deleteImport(jobId, deleteKey);
      if (token !== this.generation) return;
      // 202 only accepts the delete. A later GET is what confirms `deleted`.
      await this.apply({ type: 'deletionStarted' });
      await this.pollIfNeeded(token);
    } catch (error) {
      if (token !== this.generation) return;
      if (error instanceof ImportRequestError && (error.code === 'unavailable' || error.code === 'network')) {
        await this.reconcileDelete(token, error.code);
        return;
      }
      await this.apply({
        type: 'failed',
        kind: 'delete',
        code: 'invalid',
        message: 'The statement could not be deleted.',
      });
    }
  }

  async retry(): Promise<void> {
    const { operation, error, phase } = this.state;
    if (!operation) return;
    if (isTerminalSubmitCode(error?.code)) return;
    if (error?.kind === 'delete' || (phase === 'ready' && error)) {
      await this.delete();
      return;
    }
    if (
      operation.jobId &&
      (operation.status === 'queued' ||
        operation.status === 'processing' ||
        operation.status === 'deleting' ||
        operation.status === 'ready')
    ) {
      if (phase === 'error') await this.apply({ type: 'retry' });
      await this.syncFromServer({ allowRepost: false });
      return;
    }
    await this.submit();
  }

  private async resolveCreate(attempt: number): Promise<void> {
    const operation = this.state.operation;
    if (!operation) return;
    const token = this.generation;
    if (this.state.phase !== 'submitting') await this.apply({ type: 'submissionStarted' });
    if (token !== this.generation || !this.state.operation) return;

    let source: ByteSource;
    try {
      source = await this.options.readSource(this.state.operation);
    } catch {
      if (token !== this.generation) return;
      await this.apply({
        type: 'failed',
        kind: 'submit',
        code: 'missing_file',
        message: 'The temporary file is no longer available. Choose the statement again.',
      });
      return;
    }
    if (token !== this.generation) return;

    try {
      const job = await this.options.api.createImport({
        importKey: this.state.operation.importKey,
        fileName: this.state.operation.fileName,
        source,
      });
      if (token !== this.generation) return;
      await this.apply({ type: 'submissionAccepted', job });
      await this.pollIfNeeded(token);
    } catch (error) {
      if (token !== this.generation) return;
      if (error instanceof ImportRequestError && error.code === 'network') {
        await this.apply({ type: 'submissionOutcomeUnknown' });
        await this.recoverCreate(token, attempt);
        return;
      }
      const requestError = error instanceof ImportRequestError ? error : null;
      await this.apply({
        type: 'failed',
        kind: 'submit',
        code: requestError?.code ?? 'invalid',
        message: requestError?.message ?? 'The statement could not be uploaded.',
      });
    }
  }

  private async recoverCreate(token: number, attempt: number): Promise<void> {
    const operation = this.state.operation;
    if (!operation || token !== this.generation) return;
    try {
      const job = await this.options.api.getByKey(operation.importKey);
      if (token !== this.generation) return;
      await this.apply({ type: 'jobReceived', job });
      await this.pollIfNeeded(token);
    } catch (error) {
      if (token !== this.generation) return;
      if (error instanceof ImportRequestError && error.code === 'not_found' && attempt < 1) {
        await this.resolveCreate(attempt + 1);
        return;
      }
      await this.apply({ type: 'submissionOutcomeUnknown' });
    }
  }

  private async reconcileDelete(token: number, code: 'unavailable' | 'network'): Promise<void> {
    const operation = this.state.operation;
    if (!operation?.jobId || token !== this.generation) return;
    try {
      const job = await this.options.api.getJob(operation.jobId);
      if (token !== this.generation) return;
      if (job.status === 'deleting' || job.status === 'deleted') {
        await this.apply({ type: 'jobReceived', job });
        await this.pollIfNeeded(token);
        return;
      }
    } catch {
      // Keep the report and let the same delete key be used again.
    }
    if (token !== this.generation || this.state.phase === 'deleting' || this.state.phase === 'deleted') return;
    await this.apply({
      type: 'deleteRejected',
      code,
      message:
        code === 'unavailable'
          ? 'Deletion was not accepted. The report is still available.'
          : 'Deletion did not finish. The report is still available.',
    });
  }

  private async pollIfNeeded(token: number): Promise<void> {
    if (!isPollingStatus(this.state.operation?.status) || this.polling) return;
    this.polling = true;
    try {
      const sleep = this.options.sleep ?? defaultSleep;
      const interval = this.options.pollIntervalMs ?? POLL_INTERVAL_MS;
      while (token === this.generation && isPollingStatus(this.state.operation?.status)) {
        const jobId = this.state.operation?.jobId;
        if (!jobId) return;
        await sleep(interval);
        if (token !== this.generation) return;
        try {
          const job = await this.options.api.getJob(jobId);
          if (token !== this.generation) return;
          await this.apply({ type: 'jobReceived', job });
        } catch {
          if (token !== this.generation) return;
          await this.apply({
            type: 'failed',
            kind: 'poll',
            code: 'network',
            message: 'The job status could not be refreshed.',
          });
          return;
        }
      }
    } finally {
      this.polling = false;
    }
  }
}

function isPollingStatus(status: PersistedOperation['status'] | undefined): boolean {
  return status === 'queued' || status === 'processing' || status === 'deleting';
}

function isTerminalSubmitCode(code: OperationErrorCode | undefined): boolean {
  return code === 'conflict' || code === 'too_large' || code === 'unsupported' || code === 'missing_file';
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
