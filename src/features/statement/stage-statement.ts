import { copyBounded } from './bounded-copy';
import { detectStatementFormat, type StatementFormat } from './statement-policy';

export type StagedStatement = {
  path: string;
  fileName: string;
  size: number;
  format: StatementFormat;
};

export type OpenedStatement = {
  fileName: string;
  read: (length: number) => Promise<Uint8Array>;
  close: () => void;
  releaseSource: () => void;
};

export type CacheCopy = {
  path: string;
  write: (bytes: Uint8Array) => Promise<void>;
  close: () => void;
  delete: () => void;
};

export type StatementFiles = {
  pick: () => Promise<OpenedStatement | null>;
  beginCopy: () => CacheCopy;
};

export async function stageStatement(files: StatementFiles): Promise<StagedStatement | null> {
  const source = await files.pick();
  if (!source) return null;

  let copy: CacheCopy | null = null;
  let failed = true;
  try {
    copy = files.beginCopy();
    const copied = await copyBounded((length) => source.read(length), (bytes) => copy!.write(bytes));
    const format = detectStatementFormat(copied.prefix);
    failed = false;
    return {
      path: copy.path,
      fileName: source.fileName || 'statement',
      size: copied.size,
      format,
    };
  } finally {
    source.close();
    copy?.close();
    source.releaseSource();
    if (failed) copy?.delete();
  }
}
