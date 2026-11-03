import { stageStatement, type CacheCopy, type OpenedStatement, type StatementFiles } from './stage-statement';

function filesFrom(bytes: Uint8Array | null, fileName = 'statement.csv'): StatementFiles & { deleted: boolean; released: boolean } {
  const deleted = { value: false };
  const released = { value: false };
  const opened: OpenedStatement | null = bytes
    ? {
        fileName,
        read: (() => {
          let offset = 0;
          return async (length: number) => {
            if (offset >= bytes.length) return new Uint8Array();
            const count = Math.min(length, 32, bytes.length - offset);
            const chunk = bytes.subarray(offset, offset + count);
            offset += count;
            return chunk;
          };
        })(),
        close: () => undefined,
        releaseSource: () => {
          released.value = true;
        },
      }
    : null;

  return {
    get deleted() {
      return deleted.value;
    },
    get released() {
      return released.value;
    },
    async pick() {
      return opened;
    },
    beginCopy(): CacheCopy {
      return {
        path: 'file:///cache/statement-imports/copy.statement',
        write: async () => undefined,
        close: () => undefined,
        delete: () => {
          deleted.value = true;
        },
      };
    },
  };
}

describe('stageStatement', () => {
  it('returns nothing when the picker is canceled and creates no copy', async () => {
    const files = filesFrom(null);
    await expect(stageStatement(files)).resolves.toBeNull();
    expect(files.deleted).toBe(false);
  });

  it('keeps a validated private copy and releases the picker source', async () => {
    const files = filesFrom(new Uint8Array(Buffer.from('date,description,amount\n1,a,1\n')), 'notes.csv');
    await expect(stageStatement(files)).resolves.toEqual({
      path: 'file:///cache/statement-imports/copy.statement',
      fileName: 'notes.csv',
      size: Buffer.byteLength('date,description,amount\n1,a,1\n'),
      format: 'csv',
    });
    expect(files.deleted).toBe(false);
    expect(files.released).toBe(true);
  });

  it('deletes the private copy when the contents are not a statement', async () => {
    const files = filesFrom(new Uint8Array(Buffer.from('hello')), 'spoofed.pdf');
    await expect(stageStatement(files)).rejects.toThrow(/CSV header/);
    expect(files.deleted).toBe(true);
    expect(files.released).toBe(true);
  });
});
