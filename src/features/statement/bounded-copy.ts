import { MAX_STATEMENT_BYTES, STATEMENT_PREFIX_BYTES, StatementFileError } from './statement-policy';

const CHUNK_BYTES = 32 * 1024;

export async function copyBounded(
  read: (length: number) => Promise<Uint8Array>,
  write: (bytes: Uint8Array) => Promise<void>,
  maxBytes = MAX_STATEMENT_BYTES,
  prefixLimit = STATEMENT_PREFIX_BYTES,
): Promise<{ size: number; prefix: Uint8Array }> {
  let size = 0;
  const prefix = new Uint8Array(prefixLimit);
  let prefixSize = 0;

  for (;;) {
    const chunk = await read(CHUNK_BYTES);
    if (chunk.byteLength === 0) break;
    if (size + chunk.byteLength > maxBytes) {
      throw new StatementFileError('TOO_LARGE', 'File exceeds 10 MiB.');
    }
    if (prefixSize < prefixLimit) {
      const count = Math.min(chunk.byteLength, prefixLimit - prefixSize);
      prefix.set(chunk.subarray(0, count), prefixSize);
      prefixSize += count;
    }
    await write(chunk);
    size += chunk.byteLength;
  }

  return { size, prefix: prefix.subarray(0, prefixSize) };
}
