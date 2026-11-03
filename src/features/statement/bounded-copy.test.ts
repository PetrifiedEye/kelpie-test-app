import { copyBounded } from './bounded-copy';
import { MAX_STATEMENT_BYTES, StatementFileError } from './statement-policy';

function chunked(bytes: Uint8Array, chunkSize: number) {
  const writes: Uint8Array[] = [];
  let offset = 0;
  let reads = 0;
  return {
    writes,
    get reads() {
      return reads;
    },
    read: async (length: number) => {
      reads += 1;
      if (offset >= bytes.length) return new Uint8Array();
      const count = Math.min(length, chunkSize, bytes.length - offset);
      const chunk = bytes.subarray(offset, offset + count);
      offset += count;
      return chunk;
    },
    write: async (chunk: Uint8Array) => {
      writes.push(chunk);
    },
  };
}

describe('copyBounded', () => {
  it('counts bytes and keeps only a prefix in memory', async () => {
    const source = chunked(new Uint8Array(200).fill(1), 80);
    const copied = await copyBounded(source.read, source.write, MAX_STATEMENT_BYTES, 64);
    expect(copied.size).toBe(200);
    expect(copied.prefix).toHaveLength(64);
    expect(source.writes.reduce((sum, chunk) => sum + chunk.byteLength, 0)).toBe(200);
  });

  it('accepts a file of exactly 10 MiB', async () => {
    const source = chunked(new Uint8Array(MAX_STATEMENT_BYTES), MAX_STATEMENT_BYTES);
    const copied = await copyBounded(source.read, source.write);
    expect(copied.size).toBe(MAX_STATEMENT_BYTES);
  });

  it('stops once the next chunk would pass 10 MiB and does not keep those bytes', async () => {
    const source = chunked(new Uint8Array(MAX_STATEMENT_BYTES + 10), 1024);
    await expect(copyBounded(source.read, source.write)).rejects.toBeInstanceOf(StatementFileError);
    expect(source.writes.reduce((sum, chunk) => sum + chunk.byteLength, 0)).toBe(MAX_STATEMENT_BYTES);
  });
});
