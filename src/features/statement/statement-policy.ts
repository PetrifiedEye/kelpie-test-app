export const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;
export const STATEMENT_PREFIX_BYTES = 64;

const CSV_HEADER = 'date,description,amount';
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

export type StatementFormat = 'pdf' | 'csv';

export class StatementFileError extends Error {
  readonly code: 'TOO_LARGE' | 'INVALID' | 'READ';

  constructor(code: 'TOO_LARGE' | 'INVALID' | 'READ', message: string) {
    super(message);
    this.name = 'StatementFileError';
    this.code = code;
  }
}

export function detectStatementFormat(prefix: Uint8Array): StatementFormat {
  if (
    prefix.length >= PDF_SIGNATURE.length &&
    PDF_SIGNATURE.every((byte, index) => prefix[index] === byte)
  ) {
    return 'pdf';
  }

  let textBytes = prefix;
  if (prefix.length >= 3 && prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf) {
    textBytes = prefix.subarray(3);
  }

  let text = '';
  for (const byte of textBytes) text += String.fromCharCode(byte);
  if (
    text === CSV_HEADER ||
    text.startsWith(`${CSV_HEADER}\n`) ||
    text.startsWith(`${CSV_HEADER}\r\n`) ||
    text.startsWith(`${CSV_HEADER}\r`)
  ) {
    return 'csv';
  }

  throw new StatementFileError(
    'INVALID',
    'Expected a PDF signature or the exact CSV header.',
  );
}

export function statementFormatLabel(format: StatementFormat): string {
  return format === 'pdf' ? 'PDF' : 'CSV';
}

export function formatStatementSize(bytes: number): string {
  const exact = `${bytes} bytes`;
  if (bytes < 1024) return exact;
  if (bytes < 1024 * 1024) return `${trimQuantity(bytes / 1024)} KiB (${exact})`;
  return `${trimQuantity(bytes / (1024 * 1024))} MiB (${exact})`;
}

function trimQuantity(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

export function isOwnedStatementCopy(uri: string, cacheDirectoryUri: string): boolean {
  const root = cacheDirectoryUri.endsWith('/') ? cacheDirectoryUri : `${cacheDirectoryUri}/`;
  if (!uri.startsWith(root)) return false;
  const relative = uri.slice(root.length);
  return relative.length > 0 && !relative.includes('..') && !relative.includes('/');
}

/** Picker copies on iOS live in a temporary inbox. The user's original document is never a file we delete. */
export function isPickerTemporaryCopy(uri: string): boolean {
  if (!uri.startsWith('file:')) return false;
  const path = decodeURIComponent(uri);
  return path.includes('/tmp/') || path.includes('/Inbox/') || path.includes('/DocumentPicker/');
}
